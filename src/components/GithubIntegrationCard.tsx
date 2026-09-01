import { useEffect, useMemo, useState } from "react";
import { GitPullRequest, X } from "lucide-react";
import type { PMTask, Project } from "../state/types";
import {
    GitHubIntegrationError,
    type GitHubDataAccess,
    type GitHubRepoOptionsInput,
    type GitHubRepoRow,
    type GitHubSettings,
} from "../lib/data/GitHubDataAccess";
import {
    classifyGithubIssues,
    type GithubClassificationResult,
    type GithubTaskProposal,
} from "../lib/engine/githubClassification";

export interface GithubIntegrationCardProps {
    dataAccess: GitHubDataAccess;
    currentTasks: readonly PMTask[];
    projects: readonly Project[];
    createTask: (title: string, options: Partial<PMTask>) => Promise<PMTask>;
    navigateTo?: (url: string) => void;
}

interface RepoSyncSummary {
    created: number;
    skippedAlreadyAdded: number;
    skippedClosed: number;
    skippedLabelNotIncluded: number;
}

interface RepoPreview {
    repoFullName: string;
    result: GithubClassificationResult;
}

type RepoBusyKind = "sync" | "save" | "toggle" | "remove";

function randomOAuthState(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function errorMessage(error: unknown): string {
    if (!(error instanceof GitHubIntegrationError)) return "Something went wrong. Please try again.";
    switch (error.code) {
        case "GITHUB_TOKEN_INVALID":
            return "Your GitHub connection is invalid or has been revoked. Reconnect to continue.";
        case "GITHUB_RATE_LIMITED":
            return error.retryAfterSeconds === undefined
                ? "GitHub's rate limit was reached. Try again later."
                : `GitHub's rate limit was reached. Try again in ${error.retryAfterSeconds} seconds.`;
        case "GITHUB_REPO_NOT_FOUND":
            return "This repository is no longer accessible on GitHub. It stays editable here, but it cannot be synced.";
        case "GITHUB_UPSTREAM_ERROR":
        case "SYNC_UNAVAILABLE":
        case "SYNC_FAILED":
        case "ENUMERATION_UNAVAILABLE":
        case "ENUMERATION_FAILED":
        case "NETWORK_ERROR":
            return "GitHub could not be reached. Check your connection and try again.";
        default:
            return error.message;
    }
}

function formatLastSynced(value: string | null): string {
    if (!value) return "Never";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function GithubIntegrationCard({
    dataAccess,
    currentTasks,
    projects,
    createTask,
    navigateTo = (url) => window.location.assign(url),
}: GithubIntegrationCardProps) {
    const [settings, setSettings] = useState<GitHubSettings | null>(null);
    const [repos, setRepos] = useState<GitHubRepoRow[]>([]);
    const [labels, setLabels] = useState<Record<string, string[]>>({});
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<"connect" | "disconnect" | "create" | null>(null);
    const [repoBusy, setRepoBusy] = useState<{ fullName: string; kind: RepoBusyKind } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [errorCode, setErrorCode] = useState<GitHubIntegrationError["code"] | null>(null);
    const [preview, setPreview] = useState<RepoPreview | null>(null);
    const [summaries, setSummaries] = useState<Record<string, RepoSyncSummary>>({});

    const activeProjects = useMemo(
        () => projects.filter((project) => !project.isArchived).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
        [projects],
    );

    useEffect(() => {
        let active = true;
        setLoading(true);
        void dataAccess.loadSettings().then(async (loaded) => {
            if (!active) return;
            setSettings(loaded);
            if (loaded) {
                const list = await dataAccess.listRepos();
                if (!active) return;
                setRepos(list.repos);
                setLabels(list.labels);
            }
        }).catch((caught) => {
            if (active) setError(errorMessage(caught));
        }).finally(() => {
            if (active) setLoading(false);
        });
        return () => { active = false; };
    }, [dataAccess]);

    const anyBusy = busy !== null || repoBusy !== null;

    const recordError = (caught: unknown) => {
        setError(errorMessage(caught));
        setErrorCode(caught instanceof GitHubIntegrationError ? caught.code : "NETWORK_ERROR");
    };

    const clearError = () => {
        setError(null);
        setErrorCode(null);
    };

    async function connect() {
        if (anyBusy) return;
        clearError();
        setBusy("connect");
        try {
            const authorizationUrl = await dataAccess.beginAuthorization(randomOAuthState());
            navigateTo(authorizationUrl);
        } catch (caught) {
            recordError(caught);
        } finally {
            setBusy(null);
        }
    }

    async function disconnect() {
        if (anyBusy) return;
        clearError();
        setBusy("disconnect");
        try {
            await dataAccess.disconnect();
            setSettings(null);
            setRepos([]);
            setLabels({});
            setSummaries({});
            setPreview(null);
        } catch (caught) {
            recordError(caught);
        } finally {
            setBusy(null);
        }
    }

    async function toggleRepo(repo: GitHubRepoRow, selected: boolean) {
        if (anyBusy) return;
        clearError();
        setRepoBusy({ fullName: repo.fullName, kind: "toggle" });
        setRepos((current) => current.map((row) => row.fullName === repo.fullName ? { ...row, selected } : row));
        try {
            await dataAccess.toggleSelection(repo.fullName, selected);
        } catch (caught) {
            setRepos((current) => current.map((row) => row.fullName === repo.fullName ? { ...row, selected: repo.selected } : row));
            recordError(caught);
        } finally {
            setRepoBusy(null);
        }
    }

    async function saveRepoOptions(
        repo: GitHubRepoRow,
        patch: Partial<Pick<GitHubRepoRow, "projectId" | "labelFilter" | "includeClosed">>,
    ) {
        if (anyBusy) return;
        clearError();
        const next: GitHubRepoOptionsInput = {
            projectId: repo.projectId,
            labelFilter: repo.labelFilter,
            includeClosed: repo.includeClosed,
            ...patch,
        };
        setRepoBusy({ fullName: repo.fullName, kind: "save" });
        setRepos((current) => current.map((row) => row.fullName === repo.fullName ? { ...row, ...patch } : row));
        try {
            await dataAccess.updateRepoOptions(repo.fullName, next);
        } catch (caught) {
            setRepos((current) => current.map((row) => row.fullName === repo.fullName ? { ...row, ...repo } : row));
            recordError(caught);
        } finally {
            setRepoBusy(null);
        }
    }

    async function removeRepo(repo: GitHubRepoRow) {
        if (anyBusy || !repo.isStale) return;
        clearError();
        setRepoBusy({ fullName: repo.fullName, kind: "remove" });
        try {
            await dataAccess.removeRepo(repo.fullName);
            setRepos((current) => current.filter((row) => row.fullName !== repo.fullName));
            setSummaries((current) => {
                const next = { ...current };
                delete next[repo.fullName];
                return next;
            });
        } catch (caught) {
            recordError(caught);
        } finally {
            setRepoBusy(null);
        }
    }

    async function syncRepo(repo: GitHubRepoRow) {
        if (anyBusy || repo.isStale) return;
        clearError();
        setRepoBusy({ fullName: repo.fullName, kind: "sync" });
        try {
            const synced = await dataAccess.sync(repo.fullName, { isStale: repo.isStale });
            setSettings((current) => current ? { ...current, lastSyncedAt: synced.syncedAt } : current);
            setPreview({
                repoFullName: repo.fullName,
                result: classifyGithubIssues({
                    issues: synced.issues,
                    currentTasks,
                    repoName: repo.fullName,
                    defaultProjectId: synced.repo.projectId,
                    includeClosed: synced.repo.includeClosed,
                    labelFilter: synced.repo.labelFilter,
                }),
            });
        } catch (caught) {
            recordError(caught);
        } finally {
            setRepoBusy(null);
        }
    }

    async function confirmPreview() {
        if (anyBusy || !preview) return;
        clearError();
        setBusy("create");
        let created = 0;
        const recordSummary = (count: number) => setSummaries((current) => ({
            ...current,
            [preview.repoFullName]: {
                created: count,
                skippedAlreadyAdded: preview.result.counts.skippedAlreadyAdded,
                skippedClosed: preview.result.counts.skippedClosed,
                skippedLabelNotIncluded: preview.result.counts.skippedLabelNotIncluded,
            },
        }));
        try {
            for (const proposal of preview.result.proposals) {
                const { title, ...options } = proposal;
                await createTask(title, options);
                created += 1;
            }
            recordSummary(created);
            setPreview(null);
        } catch (caught) {
            recordSummary(created);
            setError(`Created ${created} task${created === 1 ? "" : "s"} before task creation failed. ${errorMessage(caught)}`);
            setPreview({
                ...preview,
                result: {
                    proposals: preview.result.proposals.slice(created),
                    counts: { ...preview.result.counts, new: Math.max(0, preview.result.counts.new - created) },
                },
            });
        } finally {
            setBusy(null);
        }
    }

    return (
        <article aria-labelledby="integration-github-title" className="flex min-h-52 flex-col rounded-lg border border-neutral-800 bg-neutral-900/60 p-4">
            <div className="flex items-start gap-3">
                <span className="rounded-lg border border-neutral-700 bg-neutral-950 p-2 text-neutral-300">
                    <GitPullRequest aria-hidden="true" size={20} strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <h2 id="integration-github-title" className="text-sm font-semibold text-neutral-100">GitHub</h2>
                        {settings && <span className="rounded-full border border-emerald-700/60 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide text-emerald-300">Connected</span>}
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-neutral-400">Import issues from your GitHub repositories into WorkTime after reviewing a task preview.</p>
                </div>
            </div>

            {loading ? (
                <p className="mt-5 text-[11px] text-neutral-500">Loading GitHub settings…</p>
            ) : !settings ? (
                <div className="mt-auto border-t border-neutral-800/80 pt-4">
                    <p className="text-[10px] text-neutral-500">You'll be redirected to GitHub to authorize WorkTime.</p>
                    <button
                        type="button"
                        onClick={() => void connect()}
                        disabled={anyBusy}
                        className="mt-2 rounded bg-neutral-100 px-3 py-1.5 text-[10px] font-medium text-neutral-950 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        {busy === "connect" ? "Opening GitHub…" : "Connect GitHub"}
                    </button>
                </div>
            ) : (
                <div className="mt-4 space-y-3 border-t border-neutral-800/80 pt-4">
                    <p className="text-[10px] text-neutral-400">Signed in as <span className="text-neutral-200">{settings.githubUsername}</span></p>
                    <p className="text-[9px] text-neutral-500">Last synced: <span className="text-neutral-300">{formatLastSynced(settings.lastSyncedAt)}</span></p>

                    {repos.length === 0 ? (
                        <p className="rounded border border-neutral-800 p-3 text-center text-[11px] text-neutral-500">
                            No repositories are tracked yet. They appear here once GitHub enumerates the repositories you can access.
                        </p>
                    ) : (
                        <ul aria-label="GitHub repositories" className="space-y-2">
                            {repos.map((repo) => (
                                <RepoRow
                                    key={repo.fullName}
                                    repo={repo}
                                    labels={labels[repo.fullName] ?? []}
                                    projects={activeProjects}
                                    summary={summaries[repo.fullName]}
                                    busyKind={repoBusy?.fullName === repo.fullName ? repoBusy.kind : null}
                                    disabled={anyBusy}
                                    onToggle={toggleRepo}
                                    onOptionsChange={saveRepoOptions}
                                    onSync={syncRepo}
                                    onRemove={removeRepo}
                                />
                            ))}
                        </ul>
                    )}

                    {error && !preview && (
                        <div role="alert" className="rounded border border-red-900/70 bg-red-950/30 p-2 text-[10px] text-red-300">
                            <p>{error}</p>
                            {errorCode === "GITHUB_TOKEN_INVALID" && (
                                <button type="button" onClick={() => void connect()} disabled={anyBusy} className="mt-2 underline underline-offset-2 disabled:opacity-40">Reconnect</button>
                            )}
                        </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={() => void disconnect()}
                            disabled={anyBusy}
                            className="rounded border border-red-900/70 px-3 py-1.5 text-[10px] text-red-300 disabled:opacity-40"
                        >
                            {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
                        </button>
                    </div>
                    <div className="flex items-end justify-between pt-1">
                        <div><p className="text-[9px] uppercase tracking-wide text-neutral-600">Authentication</p><p className="mt-0.5 text-[10px] text-neutral-400">OAuth 2.0</p></div>
                    </div>
                </div>
            )}

            {preview && (
                <GithubPreviewModal
                    preview={preview.result}
                    projects={activeProjects}
                    creating={busy === "create"}
                    error={busy === "create" ? null : error}
                    onCancel={() => { if (!busy) { setPreview(null); clearError(); } }}
                    onConfirm={() => void confirmPreview()}
                    onProjectChange={(index, projectId) => setPreview((current) => current ? {
                        ...current,
                        result: {
                            ...current.result,
                            proposals: current.result.proposals.map((proposal, proposalIndex) => proposalIndex === index
                                ? { ...proposal, projectId }
                                : proposal),
                        },
                    } : current)}
                    onRemove={(index) => setPreview((current) => current ? {
                        ...current,
                        result: {
                            ...current.result,
                            proposals: current.result.proposals.filter((_, proposalIndex) => proposalIndex !== index),
                            counts: { ...current.result.counts, new: Math.max(0, current.result.counts.new - 1) },
                        },
                    } : current)}
                />
            )}
        </article>
    );
}

function RepoRow({
    repo,
    labels,
    projects,
    summary,
    busyKind,
    disabled,
    onToggle,
    onOptionsChange,
    onSync,
    onRemove,
}: {
    repo: GitHubRepoRow;
    labels: readonly string[];
    projects: readonly Project[];
    summary: RepoSyncSummary | undefined;
    busyKind: RepoBusyKind | null;
    disabled: boolean;
    onToggle: (repo: GitHubRepoRow, selected: boolean) => void;
    onOptionsChange: (repo: GitHubRepoRow, patch: Partial<Pick<GitHubRepoRow, "projectId" | "labelFilter" | "includeClosed">>) => void;
    onSync: (repo: GitHubRepoRow) => void;
    onRemove: (repo: GitHubRepoRow) => void;
}) {
    const labelOptions = repo.labelFilter && !labels.includes(repo.labelFilter)
        ? [repo.labelFilter, ...labels]
        : labels;
    return (
        <li className={`rounded border p-3 ${repo.isStale ? "border-amber-900/60 bg-amber-950/10" : "border-neutral-800 bg-neutral-900/50"}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="flex min-w-0 items-center gap-2 text-[11px] text-neutral-100">
                    <input
                        type="checkbox"
                        checked={repo.selected}
                        onChange={(event) => onToggle(repo, event.target.checked)}
                        disabled={disabled}
                        aria-label={`Select ${repo.fullName}`}
                        className="shrink-0"
                    />
                    <span className="truncate font-medium" title={repo.fullName}>{repo.fullName}</span>
                </label>
                <div className="flex shrink-0 items-center gap-2">
                    {repo.isStale && (
                        <span className="rounded-full border border-amber-700/60 bg-amber-500/10 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide text-amber-300">
                            No longer accessible
                        </span>
                    )}
                    <button
                        type="button"
                        aria-label={`Sync ${repo.fullName}`}
                        title={repo.isStale ? "This repository is no longer accessible on GitHub." : undefined}
                        onClick={() => onSync(repo)}
                        disabled={disabled || repo.isStale}
                        className="rounded bg-neutral-100 px-3 py-1.5 text-[10px] font-medium text-neutral-950 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        {busyKind === "sync" ? "Syncing…" : "Sync"}
                    </button>
                    {repo.isStale && (
                        <button
                            type="button"
                            aria-label={`Remove ${repo.fullName}`}
                            onClick={() => onRemove(repo)}
                            disabled={disabled}
                            className="rounded border border-neutral-700 px-3 py-1.5 text-[10px] text-neutral-300 disabled:opacity-40"
                        >
                            {busyKind === "remove" ? "Removing…" : "Remove"}
                        </button>
                    )}
                </div>
            </div>
            {repo.isStale && (
                <p className="mt-1 text-[9px] leading-relaxed text-amber-500/80">
                    This repository is no longer accessible on GitHub. Its settings stay editable and already-imported tasks are unaffected.
                </p>
            )}
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
                <label className="block text-[9px] text-neutral-500">
                    Project
                    <select
                        aria-label={`Project for ${repo.fullName}`}
                        value={repo.projectId ?? ""}
                        onChange={(event) => onOptionsChange(repo, { projectId: event.target.value || null })}
                        disabled={disabled}
                        className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-[10px] text-neutral-200 outline-none focus:border-neutral-500 disabled:opacity-40"
                    >
                        <option value="">No Project</option>
                        {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                    </select>
                </label>
                <label className="block text-[9px] text-neutral-500">
                    Label filter
                    <select
                        aria-label={`Label filter for ${repo.fullName}`}
                        value={repo.labelFilter ?? ""}
                        onChange={(event) => onOptionsChange(repo, { labelFilter: event.target.value || null })}
                        disabled={disabled}
                        className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-[10px] text-neutral-200 outline-none focus:border-neutral-500 disabled:opacity-40"
                    >
                        <option value="">No filter</option>
                        {labelOptions.map((label) => <option key={label} value={label}>{label}</option>)}
                    </select>
                </label>
                <label className="flex items-center gap-2 self-end pb-1.5 text-[9px] text-neutral-500">
                    <input
                        type="checkbox"
                        checked={repo.includeClosed}
                        onChange={(event) => onOptionsChange(repo, { includeClosed: event.target.checked })}
                        disabled={disabled}
                        aria-label={`Include closed issues from ${repo.fullName}`}
                    />
                    Include closed issues
                </label>
            </div>
            {busyKind === "save" && <p role="status" className="mt-2 text-[9px] text-neutral-500">Saving…</p>}
            {summary && (
                <div aria-label={`GitHub sync result for ${repo.fullName}`} className="mt-2 rounded border border-emerald-900/60 bg-emerald-950/20 p-2 text-[10px] text-emerald-200">
                    Created {summary.created} · Skipped already added {summary.skippedAlreadyAdded}
                    {summary.skippedClosed > 0 && <> · Skipped closed {summary.skippedClosed}</>}
                    {summary.skippedLabelNotIncluded > 0 && <> · Skipped label filtered {summary.skippedLabelNotIncluded}</>}
                </div>
            )}
        </li>
    );
}

function GithubPreviewModal({
    preview,
    projects,
    creating,
    error,
    onCancel,
    onConfirm,
    onProjectChange,
    onRemove,
}: {
    preview: GithubClassificationResult;
    projects: readonly Project[];
    creating: boolean;
    error: string | null;
    onCancel: () => void;
    onConfirm: () => void;
    onProjectChange: (index: number, projectId: string | null) => void;
    onRemove: (index: number) => void;
}) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="github-preview-title">
            <button type="button" aria-label="Close GitHub preview" className="absolute inset-0 bg-black/70" onClick={onCancel} disabled={creating} />
            <div className="app-scrollbar relative z-10 flex max-h-[85vh] w-full max-w-2xl flex-col overflow-y-auto rounded-xl border border-neutral-700 bg-neutral-950 p-4 shadow-2xl">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h2 id="github-preview-title" className="text-sm font-semibold text-neutral-100">GitHub sync preview</h2>
                        <p className="mt-1 text-[10px] text-neutral-500">No tasks are created until you confirm.</p>
                    </div>
                    <button type="button" aria-label="Close" onClick={onCancel} disabled={creating} className="rounded p-1 text-neutral-400 hover:bg-neutral-800 disabled:opacity-40"><X size={16} /></button>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Count label="New" value={preview.counts.new} />
                    <Count label="Already added" value={preview.counts.skippedAlreadyAdded} />
                    <Count label="Closed" value={preview.counts.skippedClosed} />
                    <Count label="Label filtered" value={preview.counts.skippedLabelNotIncluded} />
                </div>

                <div className="mt-4 space-y-2">
                    {preview.proposals.length === 0 ? (
                        <p className="rounded border border-neutral-800 p-4 text-center text-[11px] text-neutral-500">
                            No new tasks to create. Every issue matched an existing task or was filtered out.
                        </p>
                    ) : preview.proposals.map((proposal, index) => (
                        <ProposalPreview
                            key={`${proposal.links[0]}-${index}`}
                            proposal={proposal}
                            projects={projects}
                            onProjectChange={(projectId) => onProjectChange(index, projectId)}
                            onRemove={() => onRemove(index)}
                        />
                    ))}
                </div>

                {error && <p role="alert" className="mt-3 rounded border border-red-900/70 bg-red-950/30 p-2 text-[10px] text-red-300">{error}</p>}

                <div className="mt-4 flex justify-end gap-2 border-t border-neutral-800 pt-4">
                    <button type="button" onClick={onCancel} disabled={creating} className="rounded border border-neutral-700 px-3 py-2 text-[10px] text-neutral-300 disabled:opacity-40">Cancel</button>
                    <button type="button" onClick={onConfirm} disabled={creating || preview.proposals.length === 0} className="rounded bg-neutral-100 px-3 py-2 text-[10px] font-medium text-neutral-950 disabled:cursor-not-allowed disabled:opacity-40">
                        {creating ? "Creating tasks…" : `Create ${preview.proposals.length} task${preview.proposals.length === 1 ? "" : "s"}`}
                    </button>
                </div>
            </div>
        </div>
    );
}

function Count({ label, value }: { label: string; value: number }) {
    return <div className="rounded border border-neutral-800 bg-neutral-900/60 p-2"><p className="text-[9px] text-neutral-500">{label}</p><p className="mt-0.5 text-sm font-semibold text-neutral-200">{value}</p></div>;
}

function ProposalPreview({
    proposal,
    projects,
    onProjectChange,
    onRemove,
}: {
    proposal: GithubTaskProposal;
    projects: readonly Project[];
    onProjectChange: (projectId: string | null) => void;
    onRemove: () => void;
}) {
    return (
        <article className="rounded border border-neutral-800 bg-neutral-900/50 p-3">
            <div className="flex items-start justify-between gap-3">
                <h3 className="text-[11px] font-medium text-neutral-100">{proposal.title}</h3>
                <button
                    type="button"
                    aria-label={`Remove ${proposal.title} from import`}
                    title="Remove from import"
                    onClick={onRemove}
                    className="shrink-0 rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
                >
                    <X aria-hidden="true" size={14} />
                </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-[9px] text-neutral-400">
                {proposal.tags[0] && <span className="rounded-full border border-neutral-700 bg-neutral-900 px-2 py-0.5">{proposal.tags[0]}</span>}
                <a href={proposal.links[0]} target="_blank" rel="noreferrer" className="underline underline-offset-2">{proposal.links[0]}</a>
            </div>
            <label className="mt-2 block text-[9px] text-neutral-500">
                Project
                <select
                    aria-label={`Project for ${proposal.title}`}
                    value={proposal.projectId ?? ""}
                    onChange={(event) => onProjectChange(event.target.value || null)}
                    className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-[10px] text-neutral-200 outline-none focus:border-neutral-500"
                >
                    <option value="">No Project</option>
                    {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
            </label>
        </article>
    );
}
