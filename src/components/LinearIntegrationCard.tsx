import { useEffect, useMemo, useState } from "react";
import { Workflow, X } from "lucide-react";
import type { PMTask, Project } from "../state/types";
import {
    LinearIntegrationError,
    type LinearDataAccess,
    type LinearSettings,
} from "../lib/data/LinearDataAccess";
import {
    classifyLinearIssues,
    describeLinearEmptyResult,
    type LinearClassificationResult,
    type LinearTaskProposal,
} from "../lib/engine/linearClassification";

export interface LinearIntegrationCardProps {
    dataAccess: LinearDataAccess;
    currentTasks: readonly PMTask[];
    projects: readonly Project[];
    createTask: (title: string, options: Partial<PMTask>) => Promise<PMTask>;
}

interface SyncSummary {
    created: number;
    skippedAlreadyAdded: number;
    skippedStatusNotIncluded: number;
}

function statusesFromInput(value: string): string[] {
    return [...new Set(value.split(/[,\n]/).map((status) => status.trim()).filter(Boolean))];
}

function errorMessage(error: unknown): string {
    if (!(error instanceof LinearIntegrationError)) return "Something went wrong. Please try again.";
    switch (error.code) {
        case "LINEAR_TOKEN_INVALID":
            return "Your Linear personal API key is invalid or has been revoked. Reconnect with a new key.";
        case "LINEAR_RATE_LIMITED":
            return error.retryAfterSeconds === undefined
                ? "Linear's rate limit was reached. Try again later."
                : `Linear's rate limit was reached. Try again in ${error.retryAfterSeconds} seconds.`;
        case "LINEAR_TEAM_NOT_FOUND":
            return "That Linear team key was not found or is not accessible. Leave it blank to sync all teams.";
        case "LINEAR_UPSTREAM_ERROR":
        case "NETWORK_ERROR":
            return "Linear could not be reached. Check your connection and try again.";
        default:
            return error.message;
    }
}

function formatLastSynced(value: string | null): string {
    if (!value) return "Never";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function LinearIntegrationCard({ dataAccess, currentTasks, projects, createTask }: LinearIntegrationCardProps) {
    const [settings, setSettings] = useState<LinearSettings | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<"connect" | "save" | "disconnect" | "sync" | "create" | null>(null);
    const [token, setToken] = useState("");
    const [teamKey, setTeamKey] = useState("");
    const [includedInput, setIncludedInput] = useState("");
    const [defaultProjectId, setDefaultProjectId] = useState("");
    const [reconnecting, setReconnecting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [errorCode, setErrorCode] = useState<LinearIntegrationError["code"] | null>(null);
    const [preview, setPreview] = useState<LinearClassificationResult | null>(null);
    const [summary, setSummary] = useState<SyncSummary | null>(null);
    const [discoveredStates, setDiscoveredStates] = useState<string[]>([]);
    const [truncated, setTruncated] = useState(false);

    const includedStatuses = useMemo(() => statusesFromInput(includedInput), [includedInput]);
    const activeProjects = useMemo(
        () => projects.filter((project) => !project.isArchived).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
        [projects],
    );
    const savedTeamKey = settings?.teamKey ?? "";
    const settingsDirty = settings !== null && (
        teamKey.trim() !== savedTeamKey
        || includedStatuses.join("\n") !== settings.includedStatuses.join("\n")
        || (defaultProjectId || null) !== settings.defaultProjectId
    );

    useEffect(() => {
        let active = true;
        setLoading(true);
        void dataAccess.loadSettings().then((loaded) => {
            if (!active) return;
            setSettings(loaded);
            if (loaded) {
                setTeamKey(loaded.teamKey ?? "");
                setIncludedInput(loaded.includedStatuses.join(", "));
                setDefaultProjectId(loaded.defaultProjectId ?? "");
            }
        }).catch((caught) => {
            if (active) setError(errorMessage(caught));
        }).finally(() => {
            if (active) setLoading(false);
        });
        return () => { active = false; };
    }, [dataAccess]);

    const recordError = (caught: unknown) => {
        setError(errorMessage(caught));
        setErrorCode(caught instanceof LinearIntegrationError ? caught.code : "UNKNOWN_ERROR");
    };

    const clearError = () => {
        setError(null);
        setErrorCode(null);
    };

    function applySettings(next: LinearSettings) {
        setSettings(next);
        setTeamKey(next.teamKey ?? "");
        setIncludedInput(next.includedStatuses.join(", "));
        setDefaultProjectId(next.defaultProjectId ?? "");
    }

    function toggleDiscoveredState(name: string) {
        setIncludedInput((current) => {
            const names = statusesFromInput(current);
            const next = names.includes(name)
                ? names.filter((status) => status !== name)
                : [...names, name];
            return next.join(", ");
        });
    }

    async function connect() {
        if (busy) return;
        clearError();
        setBusy("connect");
        try {
            await dataAccess.connect({ token, teamKey, includedStatuses, defaultProjectId: defaultProjectId || null });
            const now = new Date().toISOString();
            applySettings({
                teamKey: teamKey.trim() || null,
                includedStatuses,
                defaultProjectId: defaultProjectId || null,
                lastSyncedAt: settings?.lastSyncedAt ?? null,
                updatedAt: now,
            });
            setToken("");
            setReconnecting(false);
        } catch (caught) {
            recordError(caught);
        } finally {
            setBusy(null);
        }
    }

    async function savePreferences() {
        if (busy || !settings) return;
        clearError();
        setBusy("save");
        try {
            await dataAccess.updatePreferences({ teamKey, includedStatuses, defaultProjectId: defaultProjectId || null });
            setSettings({
                ...settings,
                teamKey: teamKey.trim() || null,
                includedStatuses,
                defaultProjectId: defaultProjectId || null,
                updatedAt: new Date().toISOString(),
            });
        } catch (caught) {
            recordError(caught);
        } finally {
            setBusy(null);
        }
    }

    async function disconnect() {
        if (busy) return;
        clearError();
        setBusy("disconnect");
        try {
            await dataAccess.disconnect();
            setSettings(null);
            setTeamKey("");
            setIncludedInput("");
            setDefaultProjectId("");
            setToken("");
            setReconnecting(false);
            setSummary(null);
            setPreview(null);
            setDiscoveredStates([]);
            setTruncated(false);
        } catch (caught) {
            recordError(caught);
        } finally {
            setBusy(null);
        }
    }

    async function syncNow() {
        if (busy || !settings) return;
        clearError();
        setSummary(null);
        setBusy("sync");
        try {
            const synced = await dataAccess.sync();
            setSettings({ ...settings, lastSyncedAt: synced.syncedAt });
            setDiscoveredStates(synced.states);
            setTruncated(synced.truncated);
            setPreview(classifyLinearIssues({
                issues: synced.issues,
                currentTasks,
                includedStatuses,
                defaultProjectId: defaultProjectId || null,
            }));
        } catch (caught) {
            recordError(caught);
        } finally {
            setBusy(null);
        }
    }

    async function confirmPreview() {
        if (busy || !preview) return;
        clearError();
        setBusy("create");
        let created = 0;
        try {
            for (const proposal of preview.proposals) {
                // `createTask` still assigns its own fallback estimate to the
                // persisted timer/PM task; the Linear proposal deliberately
                // carries none because the sync payload exposes no estimate.
                const { title, ...options } = proposal;
                await createTask(title, options);
                created += 1;
            }
            setSummary({
                created,
                skippedAlreadyAdded: preview.counts.skippedAlreadyAdded,
                skippedStatusNotIncluded: preview.counts.skippedStatusNotIncluded,
            });
            setPreview(null);
        } catch (caught) {
            setSummary({
                created,
                skippedAlreadyAdded: preview.counts.skippedAlreadyAdded,
                skippedStatusNotIncluded: preview.counts.skippedStatusNotIncluded,
            });
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

    const showConnectionForm = !settings || reconnecting;

    return (
        <article aria-labelledby="integration-linear-title" className="flex min-h-52 flex-col rounded-lg border border-neutral-800 bg-neutral-900/60 p-4">
            <div className="flex items-start gap-3">
                <span className="rounded-lg border border-neutral-700 bg-neutral-950 p-2 text-neutral-300">
                    <Workflow aria-hidden="true" size={20} strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <h2 id="integration-linear-title" className="text-sm font-semibold text-neutral-100">Linear</h2>
                        {settings && <span className="rounded-full border border-emerald-700/60 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide text-emerald-300">Connected</span>}
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-neutral-400">Import issues assigned to you in Linear after reviewing a task preview.</p>
                </div>
            </div>

            {loading ? (
                <p className="mt-5 text-[11px] text-neutral-500">Loading Linear settings…</p>
            ) : (
                <div className="mt-4 space-y-3 border-t border-neutral-800/80 pt-4">
                    {showConnectionForm && (
                        <label className="block text-[10px] text-neutral-400">
                            Linear API token
                            <input
                                type="password"
                                value={token}
                                onChange={(event) => setToken(event.target.value)}
                                autoComplete="off"
                                className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2.5 py-2 text-[11px] text-neutral-100 outline-none focus:border-neutral-500"
                            />
                        </label>
                    )}
                    <label className="block text-[10px] text-neutral-400">
                        Team key
                        <input
                            type="text"
                            role="combobox"
                            aria-expanded="false"
                            value={teamKey}
                            onChange={(event) => setTeamKey(event.target.value)}
                            placeholder="All teams (optional)"
                            className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2.5 py-2 text-[11px] text-neutral-100 outline-none focus:border-neutral-500"
                        />
                    </label>
                    <label className="block text-[10px] text-neutral-400">
                        Default project
                        <select
                            value={defaultProjectId}
                            onChange={(event) => setDefaultProjectId(event.target.value)}
                            className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2.5 py-2 text-[11px] text-neutral-100 outline-none focus:border-neutral-500"
                        >
                            <option value="">No Project</option>
                            {activeProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                        </select>
                    </label>
                    <label className="block text-[10px] text-neutral-400">
                        Included statuses
                        <textarea
                            value={includedInput}
                            onChange={(event) => setIncludedInput(event.target.value)}
                            rows={2}
                            aria-describedby="linear-included-help"
                            className="mt-1 w-full resize-y rounded border border-neutral-700 bg-neutral-950 px-2.5 py-2 text-[11px] text-neutral-100 outline-none focus:border-neutral-500"
                        />
                    </label>
                    <p id="linear-included-help" className="text-[9px] text-neutral-600">Only issues in these workflow states are imported. Separate names with commas or new lines. Leave blank to import nothing until you pick a discovered state.</p>

                    <DiscoveredStateHints
                        states={discoveredStates}
                        includedStatuses={includedStatuses}
                        onToggle={toggleDiscoveredState}
                    />

                    {error && !preview && (
                        <div role="alert" className="rounded border border-red-900/70 bg-red-950/30 p-2 text-[10px] text-red-300">
                            <p>{error}</p>
                            {errorCode === "LINEAR_TOKEN_INVALID" && settings && !reconnecting && (
                                <button type="button" onClick={() => { clearError(); setReconnecting(true); }} className="mt-2 underline underline-offset-2">Reconnect</button>
                            )}
                        </div>
                    )}

                    {summary && <SyncSummaryView summary={summary} />}
                    {truncated && !preview && <TruncationNotice />}

                    {settings && !reconnecting && (
                        <p className="text-[9px] text-neutral-500">Last synced: <span className="text-neutral-300">{formatLastSynced(settings.lastSyncedAt)}</span></p>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                        {showConnectionForm ? (
                            <>
                                <button type="button" onClick={() => void connect()} disabled={busy !== null || !token.trim()} className="rounded bg-neutral-100 px-3 py-1.5 text-[10px] font-medium text-neutral-950 disabled:cursor-not-allowed disabled:opacity-40">
                                    {busy === "connect" ? "Connecting…" : reconnecting ? "Reconnect" : "Connect"}
                                </button>
                                {reconnecting && <button type="button" onClick={() => { setReconnecting(false); setToken(""); clearError(); }} disabled={busy !== null} className="rounded border border-neutral-700 px-3 py-1.5 text-[10px] text-neutral-300 disabled:opacity-40">Cancel</button>}
                            </>
                        ) : (
                            <>
                                <button type="button" title={settingsDirty ? "Save settings before syncing" : undefined} onClick={() => void syncNow()} disabled={busy !== null || settingsDirty} className="rounded bg-neutral-100 px-3 py-1.5 text-[10px] font-medium text-neutral-950 disabled:cursor-not-allowed disabled:opacity-40">
                                    {busy === "sync" ? "Syncing…" : "Sync now"}
                                </button>
                                <button type="button" onClick={() => void savePreferences()} disabled={busy !== null} className="rounded border border-neutral-700 px-3 py-1.5 text-[10px] text-neutral-200 disabled:opacity-40">
                                    {busy === "save" ? "Saving…" : "Save settings"}
                                </button>
                                <button type="button" onClick={() => setReconnecting(true)} disabled={busy !== null} className="rounded border border-neutral-800 px-3 py-1.5 text-[10px] text-neutral-400 disabled:opacity-40">Reconnect</button>
                                <button type="button" onClick={() => void disconnect()} disabled={busy !== null} className="rounded border border-red-900/70 px-3 py-1.5 text-[10px] text-red-300 disabled:opacity-40">
                                    {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
                                </button>
                            </>
                        )}
                    </div>
                    <div className="flex items-end justify-between pt-1">
                        <div><p className="text-[9px] uppercase tracking-wide text-neutral-600">Authentication</p><p className="mt-0.5 text-[10px] text-neutral-400">API token</p></div>
                    </div>
                </div>
            )}

            {preview && (
                <LinearPreviewModal
                    preview={preview}
                    projects={activeProjects}
                    truncated={truncated}
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

function DiscoveredStateHints({
    states,
    includedStatuses,
    onToggle,
}: {
    states: readonly string[];
    includedStatuses: readonly string[];
    onToggle: (name: string) => void;
}) {
    if (states.length === 0) return null;
    return (
        <div aria-label="Discovered Linear states" className="rounded border border-neutral-800 bg-neutral-950/60 p-2">
            <p className="text-[9px] text-neutral-500">States found in your synced scope. Click to include or exclude.</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
                {states.map((name) => {
                    const included = includedStatuses.includes(name);
                    return (
                        <button
                            key={name}
                            type="button"
                            aria-pressed={included}
                            onClick={() => onToggle(name)}
                            className={`rounded-full border px-2 py-0.5 text-[9px] ${included
                                ? "border-emerald-700/70 bg-emerald-500/10 text-emerald-200"
                                : "border-neutral-700 bg-neutral-900 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200"}`}
                        >
                            {name}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

function TruncationNotice() {
    return (
        <p role="status" aria-label="Linear truncation notice" className="rounded border border-amber-900/70 bg-amber-950/20 p-2 text-[10px] text-amber-200">
            Linear returned a partial sync at the page limit, so some issues or state names may be missing.
        </p>
    );
}

function SyncSummaryView({ summary }: { summary: SyncSummary }) {
    return (
        <div aria-label="Linear sync result" className="rounded border border-emerald-900/60 bg-emerald-950/20 p-2 text-[10px] text-emerald-200">
            Created {summary.created} · Skipped already added {summary.skippedAlreadyAdded} · Skipped status not included {summary.skippedStatusNotIncluded}
        </div>
    );
}

function LinearPreviewModal({
    preview,
    projects,
    truncated,
    creating,
    error,
    onCancel,
    onConfirm,
    onProjectChange,
    onRemove,
}: {
    preview: LinearClassificationResult;
    projects: readonly Project[];
    truncated: boolean;
    creating: boolean;
    error: string | null;
    onCancel: () => void;
    onConfirm: () => void;
    onProjectChange: (index: number, projectId: string | null) => void;
    onRemove: (index: number) => void;
}) {
    const emptyMessage = describeLinearEmptyResult(preview) ?? "No new tasks to create.";
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="linear-preview-title">
            <button type="button" aria-label="Close Linear preview" className="absolute inset-0 bg-black/70" onClick={onCancel} disabled={creating} />
            <div className="app-scrollbar relative z-10 flex max-h-[85vh] w-full max-w-2xl flex-col overflow-y-auto rounded-xl border border-neutral-700 bg-neutral-950 p-4 shadow-2xl">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h2 id="linear-preview-title" className="text-sm font-semibold text-neutral-100">Linear sync preview</h2>
                        <p className="mt-1 text-[10px] text-neutral-500">No tasks are created until you confirm.</p>
                    </div>
                    <button type="button" aria-label="Close" onClick={onCancel} disabled={creating} className="rounded p-1 text-neutral-400 hover:bg-neutral-800 disabled:opacity-40"><X size={16} /></button>
                </div>

                {truncated && <div className="mt-3"><TruncationNotice /></div>}

                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Count label="Assigned issues" value={preview.totalIssues} />
                    <Count label="New" value={preview.counts.new} />
                    <Count label="Already added" value={preview.counts.skippedAlreadyAdded} />
                    <Count label="Status not included" value={preview.counts.skippedStatusNotIncluded} />
                </div>

                <div className="mt-4 space-y-2">
                    {preview.proposals.length === 0 ? (
                        <p className="rounded border border-neutral-800 p-4 text-center text-[11px] text-neutral-500">{emptyMessage}</p>
                    ) : preview.proposals.map((proposal, index) => (
                        <ProposalPreview
                            key={`${proposal.tags[0]}-${index}`}
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
    proposal: LinearTaskProposal;
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
            {proposal.description && <p className="mt-1 line-clamp-2 text-[10px] text-neutral-500">{proposal.description}</p>}
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
            <div className="mt-2 flex flex-wrap gap-2 text-[9px] text-neutral-400">
                <span>{proposal.priority} priority</span>
                {proposal.dueDate && <span>Due {proposal.dueDate}</span>}
                <span>{proposal.tags[0]}</span>
            </div>
        </article>
    );
}
