import { useEffect, useMemo, useState } from "react";
import { Milestone, X } from "lucide-react";
import type { PMTask, Project } from "../state/types";
import {
    DEFAULT_SHORTCUT_INCLUDED_STATUSES,
    ShortcutIntegrationError,
    type ShortcutDataAccess,
    type ShortcutSettings,
} from "../lib/data/ShortcutDataAccess";
import {
    classifyShortcutStories,
    type ShortcutClassificationResult,
    type ShortcutTaskProposal,
} from "../lib/engine/shortcutClassification";

export interface ShortcutIntegrationCardProps {
    dataAccess: ShortcutDataAccess;
    currentTasks: readonly PMTask[];
    projects: readonly Project[];
    createTask: (title: string, options: Partial<PMTask>) => Promise<PMTask>;
}

interface SyncSummary {
    created: number;
    skippedAlreadyAdded: number;
    skippedStatusNotIncluded: number;
    skippedArchived: number;
}

function statusesFromInput(value: string): string[] {
    return [...new Set(value.split(/[,\n]/).map((status) => status.trim()).filter(Boolean))];
}

function errorMessage(error: unknown): string {
    if (!(error instanceof ShortcutIntegrationError)) return "Something went wrong. Please try again.";
    switch (error.code) {
        case "SHORTCUT_TOKEN_INVALID":
            return "Your Shortcut token is invalid or has been revoked. Reconnect with a new token.";
        case "SHORTCUT_RATE_LIMITED":
            return error.retryAfterSeconds === undefined
                ? "Shortcut's rate limit was reached. Try again later."
                : `Shortcut's rate limit was reached. Try again in ${error.retryAfterSeconds} seconds.`;
        case "SHORTCUT_UPSTREAM_ERROR":
        case "NETWORK_ERROR":
            return "Shortcut could not be reached. Check your connection and try again.";
        default:
            return error.message;
    }
}

function formatLastSynced(value: string | null): string {
    if (!value) return "Never";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function ShortcutIntegrationCard({ dataAccess, currentTasks, projects, createTask }: ShortcutIntegrationCardProps) {
    const [settings, setSettings] = useState<ShortcutSettings | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<"connect" | "save" | "disconnect" | "sync" | "create" | null>(null);
    const [token, setToken] = useState("");
    const [teamName, setTeamName] = useState("");
    const [includedInput, setIncludedInput] = useState(DEFAULT_SHORTCUT_INCLUDED_STATUSES.join(", "));
    const [defaultProjectId, setDefaultProjectId] = useState("");
    const [reconnecting, setReconnecting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [errorCode, setErrorCode] = useState<ShortcutIntegrationError["code"] | null>(null);
    const [preview, setPreview] = useState<ShortcutClassificationResult | null>(null);
    const [summary, setSummary] = useState<SyncSummary | null>(null);

    const includedStatuses = useMemo(() => statusesFromInput(includedInput), [includedInput]);
    const activeProjects = useMemo(
        () => projects.filter((project) => !project.isArchived).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
        [projects],
    );
    const settingsDirty = settings !== null && (
        teamName.trim() !== settings.teamName
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
                setTeamName(loaded.teamName);
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
        setErrorCode(caught instanceof ShortcutIntegrationError ? caught.code : "UNKNOWN_ERROR");
    };

    const clearError = () => {
        setError(null);
        setErrorCode(null);
    };

    async function connect() {
        if (busy) return;
        clearError();
        setBusy("connect");
        try {
            await dataAccess.connect({ token, teamName, includedStatuses, defaultProjectId: defaultProjectId || null });
            const now = new Date().toISOString();
            setSettings({
                teamName: teamName.trim(),
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
            await dataAccess.updatePreferences({ teamName, includedStatuses, defaultProjectId: defaultProjectId || null });
            setSettings({
                ...settings,
                teamName: teamName.trim(),
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
            setTeamName("");
            setIncludedInput(DEFAULT_SHORTCUT_INCLUDED_STATUSES.join(", "));
            setDefaultProjectId("");
            setToken("");
            setReconnecting(false);
            setSummary(null);
            setPreview(null);
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
            setPreview(classifyShortcutStories({
                stories: synced.stories,
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
                const { title, ...options } = proposal;
                await createTask(title, options);
                created += 1;
            }
            setSummary({
                created,
                skippedAlreadyAdded: preview.counts.skippedAlreadyAdded,
                skippedStatusNotIncluded: preview.counts.skippedStatusNotIncluded,
                skippedArchived: preview.counts.skippedArchived,
            });
            setPreview(null);
        } catch (caught) {
            setSummary({
                created,
                skippedAlreadyAdded: preview.counts.skippedAlreadyAdded,
                skippedStatusNotIncluded: preview.counts.skippedStatusNotIncluded,
                skippedArchived: preview.counts.skippedArchived,
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
        <article aria-labelledby="integration-shortcut-title" className="flex min-h-52 flex-col rounded-lg border border-neutral-800 bg-neutral-900/60 p-4">
            <div className="flex items-start gap-3">
                <span className="rounded-lg border border-neutral-700 bg-neutral-950 p-2 text-neutral-300">
                    <Milestone aria-hidden="true" size={20} strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <h2 id="integration-shortcut-title" className="text-sm font-semibold text-neutral-100">Shortcut</h2>
                        {settings && <span className="rounded-full border border-emerald-700/60 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide text-emerald-300">Connected</span>}
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-neutral-400">Import your owned Shortcut stories into WorkTime after reviewing a task preview.</p>
                </div>
            </div>

            {loading ? (
                <p className="mt-5 text-[11px] text-neutral-500">Loading Shortcut settings…</p>
            ) : (
                <div className="mt-4 space-y-3 border-t border-neutral-800/80 pt-4">
                    {showConnectionForm && (
                        <label className="block text-[10px] text-neutral-400">
                            Shortcut API token
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
                        Team
                        <input
                            type="text"
                            role="combobox"
                            aria-expanded="false"
                            value={teamName}
                            onChange={(event) => setTeamName(event.target.value)}
                            placeholder="Team name"
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
                            aria-describedby="shortcut-included-help"
                            className="mt-1 w-full resize-y rounded border border-neutral-700 bg-neutral-950 px-2.5 py-2 text-[11px] text-neutral-100 outline-none focus:border-neutral-500"
                        />
                    </label>
                    <p id="shortcut-included-help" className="text-[9px] text-neutral-600">Only stories in these statuses are imported. Separate names with commas or new lines.</p>

                    {error && !preview && (
                        <div role="alert" className="rounded border border-red-900/70 bg-red-950/30 p-2 text-[10px] text-red-300">
                            <p>{error}</p>
                            {errorCode === "SHORTCUT_TOKEN_INVALID" && settings && !reconnecting && (
                                <button type="button" onClick={() => { clearError(); setReconnecting(true); }} className="mt-2 underline underline-offset-2">Reconnect</button>
                            )}
                        </div>
                    )}

                    {summary && <SyncSummaryView summary={summary} />}

                    {settings && !reconnecting && (
                        <p className="text-[9px] text-neutral-500">Last synced: <span className="text-neutral-300">{formatLastSynced(settings.lastSyncedAt)}</span></p>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                        {showConnectionForm ? (
                            <>
                                <button type="button" onClick={() => void connect()} disabled={busy !== null || !token.trim() || !teamName.trim()} className="rounded bg-neutral-100 px-3 py-1.5 text-[10px] font-medium text-neutral-950 disabled:cursor-not-allowed disabled:opacity-40">
                                    {busy === "connect" ? "Connecting…" : reconnecting ? "Reconnect" : "Connect"}
                                </button>
                                {reconnecting && <button type="button" onClick={() => { setReconnecting(false); setToken(""); clearError(); }} disabled={busy !== null} className="rounded border border-neutral-700 px-3 py-1.5 text-[10px] text-neutral-300 disabled:opacity-40">Cancel</button>}
                            </>
                        ) : (
                            <>
                                <button type="button" title={settingsDirty ? "Save settings before syncing" : undefined} onClick={() => void syncNow()} disabled={busy !== null || settingsDirty} className="rounded bg-neutral-100 px-3 py-1.5 text-[10px] font-medium text-neutral-950 disabled:cursor-not-allowed disabled:opacity-40">
                                    {busy === "sync" ? "Syncing…" : "Sync now"}
                                </button>
                                <button type="button" onClick={() => void savePreferences()} disabled={busy !== null || !teamName.trim()} className="rounded border border-neutral-700 px-3 py-1.5 text-[10px] text-neutral-200 disabled:opacity-40">
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
                <ShortcutPreviewModal
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

function SyncSummaryView({ summary }: { summary: SyncSummary }) {
    return (
        <div aria-label="Shortcut sync result" className="rounded border border-emerald-900/60 bg-emerald-950/20 p-2 text-[10px] text-emerald-200">
            Created {summary.created} · Skipped already added {summary.skippedAlreadyAdded} · Skipped status not included {summary.skippedStatusNotIncluded}
            {summary.skippedArchived > 0 && <> · Skipped archived {summary.skippedArchived}</>}
        </div>
    );
}

function ShortcutPreviewModal({
    preview,
    projects,
    creating,
    error,
    onCancel,
    onConfirm,
    onProjectChange,
    onRemove,
}: {
    preview: ShortcutClassificationResult;
    projects: readonly Project[];
    creating: boolean;
    error: string | null;
    onCancel: () => void;
    onConfirm: () => void;
    onProjectChange: (index: number, projectId: string | null) => void;
    onRemove: (index: number) => void;
}) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="shortcut-preview-title">
            <button type="button" aria-label="Close Shortcut preview" className="absolute inset-0 bg-black/70" onClick={onCancel} disabled={creating} />
            <div className="app-scrollbar relative z-10 flex max-h-[85vh] w-full max-w-2xl flex-col overflow-y-auto rounded-xl border border-neutral-700 bg-neutral-950 p-4 shadow-2xl">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h2 id="shortcut-preview-title" className="text-sm font-semibold text-neutral-100">Shortcut sync preview</h2>
                        <p className="mt-1 text-[10px] text-neutral-500">No tasks are created until you confirm.</p>
                    </div>
                    <button type="button" aria-label="Close" onClick={onCancel} disabled={creating} className="rounded p-1 text-neutral-400 hover:bg-neutral-800 disabled:opacity-40"><X size={16} /></button>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Count label="New" value={preview.counts.new} />
                    <Count label="Already added" value={preview.counts.skippedAlreadyAdded} />
                    <Count label="Status not included" value={preview.counts.skippedStatusNotIncluded} />
                    <Count label="Archived" value={preview.counts.skippedArchived} />
                </div>

                <div className="mt-4 space-y-2">
                    {preview.proposals.length === 0 ? (
                        <p className="rounded border border-neutral-800 p-4 text-center text-[11px] text-neutral-500">No new tasks to create.</p>
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
    proposal: ShortcutTaskProposal;
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
                {proposal.estimatePomos !== undefined && <span>{proposal.estimatePomos} pomodoros</span>}
                {proposal.dueDate && <span>Due {proposal.dueDate}</span>}
            </div>
        </article>
    );
}
