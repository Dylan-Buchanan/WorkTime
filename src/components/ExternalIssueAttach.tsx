import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { PMTask, Project } from "../state/types";
import {
    availableExternalIssues,
    externalIssueAttachPatch,
    hasExternalIssueReference,
    isExternalIssueAttachedElsewhere,
    type ExternalIssueCandidate,
    type ExternalIssueProvider,
} from "../lib/engine/externalIssueAttach";

interface AttachProps {
    provider: ExternalIssueProvider;
    tasks: readonly PMTask[];
    projects: readonly Project[];
    knownShortcutStories?: readonly ExternalIssueCandidate[];
    disabled: boolean;
    updateTask: (id: string, patch: Partial<PMTask>) => void;
    onError: (message: string | null) => void;
}

type CandidateScope =
    | { candidates: readonly ExternalIssueCandidate[] }
    | { repositories: ReadonlyMap<string, readonly ExternalIssueCandidate[]> };

const buttonClass = "rounded border border-neutral-700 px-3 py-1.5 text-[10px] text-neutral-200 disabled:opacity-40";
const inputClass = "w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-200";
const rowClass = "w-full rounded border border-neutral-800 px-3 py-2 text-left text-xs hover:bg-neutral-800 aria-pressed:border-neutral-400 aria-pressed:bg-neutral-800";

export function ExternalIssueAttach(props: AttachProps & CandidateScope) {
    const [open, setOpen] = useState(false);
    const { disabled, onError } = props;

    function openPicker() {
        onError(null);
        const hasSync = "repositories" in props ? props.repositories.size > 0 : props.candidates.length > 0;
        if (!hasSync) {
            onError("Nothing to attach yet. Sync issues from the card and try again.");
            return;
        }
        setOpen(true);
    }

    return (
        <>
            <button type="button" disabled={disabled} onClick={openPicker} className={buttonClass}>
                Attach existing issue
            </button>
            {open && <AttachPicker {...props} onClose={() => setOpen(false)} />}
        </>
    );
}

const NO_CANDIDATES: readonly ExternalIssueCandidate[] = [];

function AttachPicker({
    onClose,
    provider,
    tasks,
    projects,
    knownShortcutStories,
    updateTask,
    onError,
    ...scope
}: AttachProps & CandidateScope & { onClose: () => void }) {
    const dialog = useRef<HTMLDialogElement>(null);
    const taskSearchInput = useRef<HTMLInputElement>(null);
    const headingId = useId();
    const [repo, setRepo] = useState("");
    const [issueQuery, setIssueQuery] = useState("");
    const [taskQuery, setTaskQuery] = useState("");
    const [candidate, setCandidate] = useState<ExternalIssueCandidate | null>(null);
    const [taskId, setTaskId] = useState<string | null>(null);
    const repositories = "repositories" in scope ? scope.repositories : null;
    const candidates = "candidates" in scope ? scope.candidates : scope.repositories.get(repo) ?? NO_CANDIDATES;
    const available = useMemo(() => availableExternalIssues(tasks, candidates, provider), [tasks, candidates, provider]);
    const eligibleTasks = useMemo(() => tasks.filter((task) => !task.isArchived && !hasExternalIssueReference(task)), [tasks]);
    const projectNames = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects]);
    const issueSearch = issueQuery.trim().toLowerCase();
    const visibleIssues = available.filter((issue) => `${issue.key} ${issue.title} ${issue.url}`.toLowerCase().includes(issueSearch));
    const taskSearch = taskQuery.trim().toLowerCase();
    const visibleTasks = eligibleTasks.filter((task) => task.title.toLowerCase().includes(taskSearch));
    const selectedTask = taskId ? tasks.find((task) => task.id === taskId) : undefined;

    useEffect(() => {
        dialog.current?.showModal();
    }, []);

    useEffect(() => {
        if (candidate) taskSearchInput.current?.focus();
    }, [candidate]);

    function closePicker() {
        dialog.current?.close();
        onClose();
    }

    function attach() {
        if (!candidate || !taskId) return;
        if (!selectedTask || selectedTask.isArchived) {
            onError("This WorkTime task is no longer available. Choose another task.");
        } else if (isExternalIssueAttachedElsewhere(tasks, candidate, taskId)) {
            onError("This issue is already attached to another WorkTime task.");
        } else {
            try {
                const patch = externalIssueAttachPatch(selectedTask, candidate, knownShortcutStories);
                if (patch.links !== selectedTask.links) updateTask(taskId, patch);
            } catch {
                onError("Could not attach this issue. Please try again.");
            }
        }
        closePicker();
    }

    return (
        <dialog
            ref={dialog}
            aria-labelledby={headingId}
            onCancel={(event) => { event.preventDefault(); closePicker(); }}
            className="app-scrollbar m-auto max-h-[85vh] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-xl border border-neutral-700 bg-neutral-950 p-4 text-neutral-200 shadow-2xl backdrop:bg-black/70"
        >
            <h2 id={headingId} className="text-sm font-semibold text-neutral-100">Attach existing issue</h2>
            {repositories && (
                <label className="mt-4 block space-y-1 text-xs">
                    <span>Repository</span>
                    <select
                        value={repo}
                        onChange={(event) => {
                            setRepo(event.target.value);
                            setIssueQuery("");
                            setCandidate(null);
                            setTaskId(null);
                        }}
                        className={inputClass}
                    >
                        <option value="">Choose a synced repository</option>
                        {[...repositories.keys()].map((name) => <option key={name} value={name}>{name}</option>)}
                    </select>
                </label>
            )}
            {(!repositories || repo) && (
                <div className="mt-4 space-y-2">
                    <input type="search" aria-label="Search issues" placeholder="Search issues…" value={issueQuery} onChange={(event) => setIssueQuery(event.target.value)} className={inputClass} />
                    {visibleIssues.length > 0 ? (
                        <ul aria-label="Available issues" className="app-scrollbar max-h-44 space-y-1 overflow-y-auto">
                            {visibleIssues.map((issue) => (
                                <li key={issue.url}>
                                    <button type="button" aria-pressed={candidate === issue} onClick={() => {
                                        setCandidate(issue);
                                        setTaskId(null);
                                        setTaskQuery("");
                                    }} className={rowClass}>
                                        {issue.key} · {issue.title}{" "}
                                        <span className="block break-all text-[10px] text-neutral-400">{issue.url}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-xs text-neutral-400">{available.length ? "No issues match your search." : "No issues available to attach."}</p>
                    )}
                </div>
            )}
            {candidate && (
                <div className="mt-4 space-y-2">
                    <p className="text-xs">Attach <strong>{candidate.key} · {candidate.title}</strong> to a WorkTime task.</p>
                    <input ref={taskSearchInput} type="search" aria-label="Search WorkTime tasks" placeholder="Search WorkTime tasks…" value={taskQuery} onChange={(event) => setTaskQuery(event.target.value)} className={inputClass} />
                    {visibleTasks.length > 0 ? (
                        <ul aria-label="WorkTime tasks" className="app-scrollbar max-h-44 space-y-1 overflow-y-auto">
                            {visibleTasks.map((task) => (
                                <li key={task.id}>
                                    <button type="button" aria-pressed={taskId === task.id} onClick={() => setTaskId(task.id)} className={rowClass}>
                                        {task.title}{" "}
                                        <span className="block text-[10px] text-neutral-400">{task.projectId && projectNames.get(task.projectId) || "No project"}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-xs text-neutral-400">{eligibleTasks.length ? "No tasks match your search." : "No eligible WorkTime tasks."}</p>
                    )}
                    {taskId && !visibleTasks.some((task) => task.id === taskId) && (
                        <p className="text-xs text-neutral-400">Selected task: {selectedTask?.title ?? "Unavailable"}</p>
                    )}
                    {selectedTask && !selectedTask.isArchived && hasExternalIssueReference(selectedTask) && (
                        <p className="text-xs text-neutral-400">The selected task now has an issue link. Attaching will replace its existing reference.</p>
                    )}
                </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={closePicker} className={buttonClass}>Cancel</button>
                <button type="button" onClick={attach} disabled={!candidate || !taskId} className="rounded bg-neutral-100 px-3 py-1.5 text-[10px] font-medium text-neutral-950 disabled:opacity-40">
                    Attach issue
                </button>
            </div>
        </dialog>
    );
}
