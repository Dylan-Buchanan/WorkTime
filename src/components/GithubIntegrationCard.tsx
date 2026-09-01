import { useEffect, useMemo, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { ChevronDown, ChevronRight, GitPullRequest, X } from "lucide-react";
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
    type GithubClassificationCounts,
    type GithubClassificationResult,
    type GithubTaskProposal,
} from "../lib/engine/githubClassification";
import { clearGitHubOAuthState, prepareGitHubOAuthState } from "../lib/integrations/githubOAuthReturn";

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

interface RepoPreviewEntry {
    fullName: string;
    result: GithubClassificationResult;
}

interface RepoPreview {
    entries: RepoPreviewEntry[];
    proposals: GithubTaskProposal[];
    counts: GithubClassificationCounts;
}

type RepoBusyKind = "sync" | "save" | "toggle" | "remove";

type BulkBusy = { kind: "toggle" } | { kind: "sync"; completed: number; total: number };

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

function aggregatePreview(entries: RepoPreviewEntry[]): RepoPreview {
    const counts = entries.reduce<GithubClassificationCounts>((acc, entry) => ({
        new: acc.new + entry.result.counts.new,
        skippedAlreadyAdded: acc.skippedAlreadyAdded + entry.result.counts.skippedAlreadyAdded,
        skippedClosed: acc.skippedClosed + entry.result.counts.skippedClosed,
        skippedLabelNotIncluded: acc.skippedLabelNotIncluded + entry.result.counts.skippedLabelNotIncluded,
    }), { new: 0, skippedAlreadyAdded: 0, skippedClosed: 0, skippedLabelNotIncluded: 0 });
    return { entries, proposals: entries.flatMap((entry) => entry.result.proposals), counts };
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
    const [bulkBusy, setBulkBusy] = useState<BulkBusy | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [errorCode, setErrorCode] = useState<GitHubIntegrationError["code"] | null>(null);
    const [preview, setPreview] = useState<RepoPreview | null>(null);
    const [summaries, setSummaries] = useState<Record<string, RepoSyncSummary>>({});
    const [filter, setFilter] = useState("");
    const [expandedRepos, setExpandedRepos] = useState<Record<string, boolean>>({});

    const activeProjects = useMemo(
        () => projects.filter((project) => !project.isArchived).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
        [projects],
    );

    const visibleRepos = useMemo(() => {
        const query = filter.trim().toLowerCase();
        if (!query) return repos;
        return repos.filter((repo) => repo.fullName.toLowerCase().includes(query));
    }, [repos, filter]);

    const syncableSelected = useMemo(
        () => repos.filter((repo) => repo.selected && !repo.isStale),
        [repos],
    );

    const selectedCount = repos.filter((repo) => repo.selected).length;
    const allVisibleSelected = visibleRepos.length > 0 && visibleRepos.every((repo) => repo.selected);
    const someVisibleSelected = visibleRepos.some((repo) => repo.selected);

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

    const anyBusy = busy !== null || repoBusy !== null || bulkBusy !== null;

    const recordError = (caught: unknown) => {
        setError(errorMessage(caught));
        setErrorCode(caught instanceof GitHubIntegrationError ? caught.code : "NETWORK_ERROR");
    };

    const clearError = () => {
        setError(null);
        setErrorCode(null);
    };

    const toggleExpanded = (repo: GitHubRepoRow) => {
        setExpandedRepos((current) => ({ ...current, [repo.fullName]: !current[repo.fullName] }));
    };

    async function connect() {
        if (anyBusy) return;
        clearError();
        setBusy("connect");
        try {
            const state = prepareGitHubOAuthState(isTauri());
            const authorizationUrl = await dataAccess.beginAuthorization(state);
            navigateTo(authorizationUrl);
        } catch (caught) {
            try { clearGitHubOAuthState(); } catch { /* The original start error remains actionable. */ }
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
            setFilter("");
            setExpandedRepos({});
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

    async function setAllSelected(selected: boolean, targets: GitHubRepoRow[]) {
        if (anyBusy || targets.length === 0) return;
        clearError();
        setBulkBusy({ kind: "toggle" });
        const targetNames = new Set(targets.map((repo) => repo.fullName));
        setRepos((current) => current.map((row) => targetNames.has(row.fullName) ? { ...row, selected } : row));
        try {
            const outcomes = await Promise.all(targets.map(async (repo) => {
                try {
                    await dataAccess.toggleSelection(repo.fullName, selected);
                    return null;
                } catch (caught) {
                    return { repo, caught };
                }
            }));
            const failures = outcomes.filter((outcome): outcome is { repo: GitHubRepoRow; caught: unknown } => outcome !== null);
            if (failures.length > 0) {
                const failedNames = new Set(failures.map((failure) => failure.repo.fullName));
                setRepos((current) => current.map((row) => failedNames.has(row.fullName) ? { ...row, selected: !selected } : row));
                recordError(failures[0].caught);
            }
        } finally {
            setBulkBusy(null);
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
            setExpandedRepos((current) => {
                if (!(repo.fullName in current)) return current;
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

    async function syncOne(repo: GitHubRepoRow): Promise<RepoPreviewEntry> {
        const synced = await dataAccess.sync(repo.fullName, { isStale: repo.isStale });
        setSettings((current) => current ? { ...current, lastSyncedAt: synced.syncedAt } : current);
        return {
            fullName: repo.fullName,
            result: classifyGithubIssues({
                issues: synced.issues,
                currentTasks,
                repoName: repo.fullName,
                defaultProjectId: synced.repo.projectId,
                includeClosed: synced.repo.includeClosed,
                labelFilter: synced.repo.labelFilter,
            }),
        };
    }

    async function syncRepo(repo: GitHubRepoRow) {
        if (anyBusy || repo.isStale) return;
        clearError();
        setRepoBusy({ fullName: repo.fullName, kind: "sync" });
        try {
            setPreview(aggregatePreview([await syncOne(repo)]));
        } catch (caught) {
            recordError(caught);
        } finally {
            setRepoBusy(null);
        }
    }

    async function syncSelected() {
        if (anyBusy || syncableSelected.length === 0) return;
        clearError();
        setBulkBusy({ kind: "sync", completed: 0, total: syncableSelected.length });
        const entries: RepoPreviewEntry[] = [];
        const failures: string[] = [];
        let firstFailure: unknown = null;
        let skippedRemaining = false;
        for (const repo of syncableSelected) {
            try {
                entries.push(await syncOne(repo));
            } catch (caught) {
                if (firstFailure === null) firstFailure = caught;
                failures.push(`${repo.fullName}: ${errorMessage(caught)}`);
                if (caught instanceof GitHubIntegrationError
                    && (caught.code === "GITHUB_TOKEN_INVALID" || caught.code === "GITHUB_RATE_LIMITED")) {
                    skippedRemaining = true;
                    break;
                }
            }
            setBulkBusy((current) => current?.kind === "sync" ? { ...current, completed: current.completed + 1 } : current);
        }
        setBulkBusy(null);
        if (entries.length > 0) setPreview(aggregatePreview(entries));
        if (failures.length > 0) {
            setError(
                `Synced ${entries.length} of ${syncableSelected.length} repositories. ${failures.join(" · ")}`
                + (skippedRemaining ? " Remaining repositories were skipped." : ""),
            );
            setErrorCode(firstFailure instanceof GitHubIntegrationError ? firstFailure.code : "NETWORK_ERROR");
        }
    }

    async function confirmPreview() {
        if (anyBusy || !preview) return;
        clearError();
        setBusy("create");
        const createdPerRepo: Record<string, number> = {};
        let created = 0;
        const recordSummaries = () => setSummaries((current) => {
            const next = { ...current };
            for (const entry of preview.entries) {
                next[entry.fullName] = {
                    created: createdPerRepo[entry.fullName] ?? 0,
                    skippedAlreadyAdded: entry.result.counts.skippedAlreadyAdded,
                    skippedClosed: entry.result.counts.skippedClosed,
                    skippedLabelNotIncluded: entry.result.counts.skippedLabelNotIncluded,
                };
            }
            return next;
        });
        try {
            for (const proposal of preview.proposals) {
                const { title, ...options } = proposal;
                await createTask(title, options);
                created += 1;
                const repoName = proposal.tags[0] ?? preview.entries[0].fullName;
                createdPerRepo[repoName] = (createdPerRepo[repoName] ?? 0) + 1;
            }
            recordSummaries();
            setPreview(null);
        } catch (caught) {
            recordSummaries();
            setError(`Created ${created} task${created === 1 ? "" : "s"} before task creation failed. ${errorMessage(caught)}`);
            setPreview({
                ...preview,
                proposals: preview.proposals.slice(created),
                counts: { ...preview.counts, new: Math.max(0, preview.counts.new - created) },
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
                    {error && (
                        <p role="alert" className="mt-2 rounded border border-red-900/70 bg-red-950/30 p-2 text-[10px] text-red-300">{error}</p>
                    )}
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
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[10px] text-neutral-400">Signed in as <span className="text-neutral-200">{settings.githubUsername}</span></p>
                        <p className="text-[9px] text-neutral-500">Last synced: <span className="text-neutral-300">{formatLastSynced(settings.lastSyncedAt)}</span></p>
                    </div>

                    {repos.length === 0 ? (
                        <p className="rounded border border-neutral-800 p-3 text-center text-[11px] text-neutral-500">
                            No repositories are tracked yet. They appear here once GitHub enumerates the repositories you can access.
                        </p>
                    ) : (
                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                                <input
                                    type="search"
                                    value={filter}
                                    onChange={(event) => setFilter(event.target.value)}
                                    placeholder="Search repositories…"
                                    aria-label="Search repositories"
                                    className="h-7 min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 text-[10px] text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-neutral-500"
                                />
                                <span className="shrink-0 text-[9px] text-neutral-500">{selectedCount} of {repos.length} selected</span>
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <label className="flex items-center gap-2 text-[10px] text-neutral-300">
                                    <input
                                        ref={(element) => { if (element) element.indeterminate = someVisibleSelected && !allVisibleSelected; }}
                                        type="checkbox"
                                        checked={allVisibleSelected}
                                        onChange={() => void setAllSelected(!allVisibleSelected, visibleRepos)}
                                        disabled={anyBusy || visibleRepos.length === 0}
                                        aria-label="Select all repositories"
                                    />
                                    Select all
                                </label>
                                <button
                                    type="button"
                                    onClick={() => void syncSelected()}
                                    disabled={anyBusy || syncableSelected.length === 0}
                                    className="rounded bg-neutral-100 px-3 py-1.5 text-[10px] font-medium text-neutral-950 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                    {bulkBusy?.kind === "sync"
                                        ? `Syncing ${bulkBusy.completed}/${bulkBusy.total}…`
                                        : `Sync selected (${syncableSelected.length})`}
                                </button>
                            </div>
                            {bulkBusy?.kind === "sync" && (
                                <div role="status" aria-label="Repository sync progress">
                                    <div className="h-1 w-full rounded-full bg-neutral-800">
                                        <div
                                            className="h-1 rounded-full bg-neutral-100 transition-all"
                                            style={{ width: `${Math.round((bulkBusy.completed / bulkBusy.total) * 100)}%` }}
                                        />
                                    </div>
                                </div>
                            )}
                            <ul aria-label="GitHub repositories" className="app-scrollbar max-h-72 space-y-1.5 overflow-y-auto pr-1">
                                {visibleRepos.length === 0 ? (
                                    <li className="rounded border border-neutral-800 p-3 text-center text-[11px] text-neutral-500">
                                        No repositories match "{filter.trim()}".
                                    </li>
                                ) : visibleRepos.map((repo) => (
                                    <RepoRow
                                        key={repo.fullName}
                                        repo={repo}
                                        labels={labels[repo.fullName] ?? []}
                                        projects={activeProjects}
                                        summary={summaries[repo.fullName]}
                                        busyKind={repoBusy?.fullName === repo.fullName ? repoBusy.kind : null}
                                        disabled={anyBusy}
                                        expanded={Boolean(expandedRepos[repo.fullName])}
                                        onToggle={toggleRepo}
                                        onOptionsChange={saveRepoOptions}
                                        onSync={syncRepo}
                                        onRemove={removeRepo}
                                        onToggleExpanded={toggleExpanded}
                                    />
                                ))}
                            </ul>
                        </div>
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
                    preview={preview}
                    projects={activeProjects}
                    creating={busy === "create"}
                    error={busy === "create" ? null : error}
                    onCancel={() => { if (!busy) { setPreview(null); clearError(); } }}
                    onConfirm={() => void confirmPreview()}
                    onProjectChange={(index, projectId) => setPreview((current) => current ? {
                        ...current,
                        proposals: current.proposals.map((proposal, proposalIndex) => proposalIndex === index
                            ? { ...proposal, projectId }
                            : proposal),
                    } : current)}
                    onRemove={(index) => setPreview((current) => current ? {
                        ...current,
                        proposals: current.proposals.filter((_, proposalIndex) => proposalIndex !== index),
                        counts: { ...current.counts, new: Math.max(0, current.counts.new - 1) },
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
    expanded,
    onToggle,
    onOptionsChange,
    onSync,
    onRemove,
    onToggleExpanded,
}: {
    repo: GitHubRepoRow;
    labels: readonly string[];
    projects: readonly Project[];
    summary: RepoSyncSummary | undefined;
    busyKind: RepoBusyKind | null;
    disabled: boolean;
    expanded: boolean;
    onToggle: (repo: GitHubRepoRow, selected: boolean) => void;
    onOptionsChange: (repo: GitHubRepoRow, patch: Partial<Pick<GitHubRepoRow, "projectId" | "labelFilter" | "includeClosed">>) => void;
    onSync: (repo: GitHubRepoRow) => void;
    onRemove: (repo: GitHubRepoRow) => void;
    onToggleExpanded: (repo: GitHubRepoRow) => void;
}) {
    const labelOptions = repo.labelFilter && !labels.includes(repo.labelFilter)
        ? [repo.labelFilter, ...labels]
        : labels;
    return (
        <li className={`rounded border p-2 ${repo.isStale ? "border-amber-900/60 bg-amber-950/10" : "border-neutral-800 bg-neutral-900/50"}`}>
            <div className="flex items-center gap-2">
                <label className="flex min-w-0 flex-1 items-center gap-2 text-[11px] text-neutral-100">
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
                {repo.isStale && (
                    <span className="shrink-0 rounded-full border border-amber-700/60 bg-amber-500/10 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide text-amber-300">
                        No longer accessible
                    </span>
                )}
                <div className="flex shrink-0 items-center gap-1.5">
                    {!repo.isStale && (
                        <button
                            type="button"
                            aria-label={`Sync ${repo.fullName}`}
                            onClick={() => onSync(repo)}
                            disabled={disabled}
                            className="rounded bg-neutral-100 px-2.5 py-1 text-[10px] font-medium text-neutral-950 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            {busyKind === "sync" ? "Syncing…" : "Sync"}
                        </button>
                    )}
                    {repo.isStale && (
                        <button
                            type="button"
                            aria-label={`Remove ${repo.fullName}`}
                            onClick={() => onRemove(repo)}
                            disabled={disabled}
                            className="rounded border border-neutral-700 px-2.5 py-1 text-[10px] text-neutral-300 disabled:opacity-40"
                        >
                            {busyKind === "remove" ? "Removing…" : "Remove"}
                        </button>
                    )}
                    <button
                        type="button"
                        aria-expanded={expanded}
                        aria-label={`Toggle options for ${repo.fullName}`}
                        title={expanded ? "Hide options" : "Show options"}
                        onClick={() => onToggleExpanded(repo)}
                        className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
                    >
                        {expanded
                            ? <ChevronDown aria-hidden="true" size={14} />
                            : <ChevronRight aria-hidden="true" size={14} />}
                    </button>
                </div>
            </div>
            {expanded && (
                <div className="mt-2 rounded border border-neutral-800 bg-neutral-950/40 p-2">
                    {repo.isStale && (
                        <p className="mb-2 text-[9px] leading-relaxed text-amber-500/80">
                            This repository is no longer accessible on GitHub. Its settings stay editable and already-imported tasks are unaffected.
                        </p>
                    )}
                    <div className="grid gap-2 sm:grid-cols-3">
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
                </div>
            )}
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
    preview: RepoPreview;
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
                        <p className="mt-1 text-[10px] text-neutral-500">
                            {preview.entries.length > 1 ? `From ${preview.entries.length} repositories · ` : ""}No tasks are created until you confirm.
                        </p>
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
