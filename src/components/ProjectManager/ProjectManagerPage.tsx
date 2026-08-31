import React, { useEffect, useRef, useState } from "react";
import { ProjectsSidebar } from "./ProjectsSidebar";
import { TasksListView } from "./TasksListView";
import { TasksBoardView } from "./TasksBoardView";
import { TaskInspector } from "./TaskInspector";
import { usePM } from "../../state/ProjectManagerContext";
import { AgentPanel } from "./AgentPanel";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import type { GoogleCalendarDataAccess } from "../../lib/data/GoogleCalendarDataAccess";
import { consumeGoogleCalendarOAuthReturn, type GoogleCalendarOAuthReturn } from "../../lib/integrations";

export interface ProjectManagerPageProps {
    googleCalendarDataAccess?: GoogleCalendarDataAccess;
}

export const ProjectManagerPage: React.FC<ProjectManagerPageProps> = ({ googleCalendarDataAccess }) => {
    const { state, createTask, quickAddParse, setFilters, setView } = usePM();
    const [quick, setQuick] = useState("");
    const [quickError, setQuickError] = useState<string | null>(null);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [inspectorOpen, setInspectorOpen] = useState(false);
    const isLg = useMediaQuery("(min-width: 1024px)");
    const isXl = useMediaQuery("(min-width: 1280px)");
    const activeProjectId = state.ui.selectedProjectIds[0] || null;
    const selectedTaskId = state.ui.selectedTaskId;
    const lastSelectedTaskRef = useRef<string | null>(selectedTaskId);
    const [googleCalendarResume, setGoogleCalendarResume] = useState<GoogleCalendarOAuthReturn | null>(() =>
        googleCalendarDataAccess ? consumeGoogleCalendarOAuthReturn() : null,
    );

    useEffect(() => {
        if (googleCalendarResume?.pendingTaskId && state.tasks[googleCalendarResume.pendingTaskId] && selectedTaskId !== googleCalendarResume.pendingTaskId) {
            setFilters({ selectedTaskId: googleCalendarResume.pendingTaskId });
        }
    }, [googleCalendarResume?.pendingTaskId, selectedTaskId, setFilters, state.tasks]);

    useEffect(() => {
        if (isLg) setSidebarOpen(false);
    }, [isLg]);

    useEffect(() => {
        if (isXl) setInspectorOpen(false);
    }, [isXl]);

    useEffect(() => {
        if (isXl) return;
        if (selectedTaskId && selectedTaskId !== lastSelectedTaskRef.current) {
            setInspectorOpen(true);
        }
        lastSelectedTaskRef.current = selectedTaskId;
    }, [selectedTaskId, isXl]);


    const submitQuick = async () => {
        const raw = quick.trim();
        if (!raw) return;
        setQuickError(null);
        const { task, projectName } = quickAddParse(raw);
        const parsedTitle = task.title?.trim();
        const title = parsedTitle && parsedTitle.length > 0 ? parsedTitle : "Untitled";

        let projectId: string | null = null;
        if (projectName) {
            const match = Object.values(state.projects).find((p) => p.name.toLowerCase() === projectName.toLowerCase());
            if (!match) {
                alert(`"${projectName}" is not a valid project`);
                return;
            }
            projectId = match.id;
        } else if (activeProjectId) {
            projectId = activeProjectId;
        } else {
            alert("Select a project first");
            return;
        }

        const { title: _omit, ...taskPayload } = task;
        let created;
        try {
            created = await createTask(title, {
                ...taskPayload,
                projectId,
            });
        } catch (err) {
            console.warn("Failed to quick-add task", err);
            setQuickError("Could not add task. Please try again.");
            return;
        }
        setFilters({ selectedTaskId: created.id });
        setQuick("");
    };

    return (
        <div className="flex flex-col h-full min-w-0">
            {googleCalendarResume?.errorCode && (
                <div role="alert" className="flex items-center gap-2 border-b border-amber-900/70 bg-amber-950/30 px-3 py-2 text-[10px] text-amber-200">
                    <span>Google Calendar authorization did not complete ({googleCalendarResume.errorCode}). No task was pushed.</span>
                    <button type="button" onClick={() => setGoogleCalendarResume(null)} className="ml-auto rounded px-2 py-1 text-amber-300 hover:bg-amber-900/40">Dismiss</button>
                </div>
            )}
            <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-neutral-800 text-xs">
                {!isLg && (
                    <button
                        type="button"
                        onClick={() => setSidebarOpen(true)}
                        aria-expanded={sidebarOpen}
                        aria-controls="pm-projects-drawer"
                        className="rounded bg-neutral-800 px-2.5 py-1.5 text-[11px] font-medium text-neutral-200 hover:bg-neutral-700"
                    >
                        Projects
                    </button>
                )}
                {activeProjectId && (
                    <div className="text-[11px] px-2 py-1 rounded bg-neutral-800 flex items-center gap-1 min-w-0">
                        <span
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{
                                background: state.projects[activeProjectId]?.color,
                            }}
                        />
                        <span className="truncate max-w-[8rem]">{state.projects[activeProjectId]?.name}</span>
                    </div>
                )}
                <input
                    value={quick}
                    onChange={(e) => {
                        setQuick(e.target.value);
                        setQuickError(null);
                    }}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            void submitQuick();
                        }
                    }}
                    placeholder="Quick add: Title @Project ^YYYY-MM-DD #tag !high"
                    className="flex-1 min-w-[10rem] bg-neutral-900 rounded px-2 py-1.5 sm:py-1"
                />
                {quickError && <span role="alert" className="text-red-400">{quickError}</span>}
                <button
                    onClick={() => {
                        submitQuick();
                    }}
                    className="px-3 py-1.5 sm:px-2 sm:py-1 rounded bg-neutral-800 hover:bg-neutral-700"
                >
                    Add
                </button>
                <div className="ml-auto flex flex-wrap items-center gap-1">
                    {state.ui.view === "board" && (
                        <button
                            onClick={() =>
                                setFilters({
                                    boardShowAllTasks: !state.ui.boardShowAllTasks,
                                })
                            }
                            className={`px-2.5 py-1.5 sm:px-2 sm:py-1 rounded bg-neutral-900 border border-neutral-800 text-[10px] flex items-center gap-1 transition-opacity ${
                                state.ui.boardShowAllTasks ? "opacity-100" : "opacity-80"
                            }`}
                            aria-pressed={state.ui.boardShowAllTasks}
                            title={state.ui.boardShowAllTasks ? "Showing tasks from all projects" : "Showing tasks from the selected project"}
                        >
                            <span className={`w-2 h-2 rounded-full ${state.ui.boardShowAllTasks ? "bg-emerald-400" : "bg-sky-400"}`} aria-hidden />
                            {state.ui.boardShowAllTasks ? "All projects" : "Selected project"}
                        </button>
                    )}
                    {!isXl && selectedTaskId && (
                        <button
                            type="button"
                            onClick={() => setInspectorOpen(true)}
                            aria-expanded={inspectorOpen}
                            aria-controls="pm-task-inspector-drawer"
                            className="rounded bg-neutral-800 px-2.5 py-1.5 sm:px-2 sm:py-1 text-[10px] text-neutral-200 hover:bg-neutral-700"
                        >
                            Task details
                        </button>
                    )}
                    <ViewSwitch cur={state.ui.view} onChange={(v) => setView(v)} />
                </div>
            </div>
            <div className="flex flex-1 min-h-0">
                {isLg && (
                    <div className="w-64 border-r border-neutral-800 p-2 flex flex-col min-h-0">
                        <ProjectsSidebar />
                    </div>
                )}
                <div className="flex-1 min-w-0 p-2 overflow-hidden">
                    {state.ui.view === "list" ? (
                        <div className="flex flex-col h-full">
                            {activeProjectId && <InlineAddTask projectId={activeProjectId} />}
                            <div className="flex-1 overflow-auto app-scrollbar">
                                <TasksListView />
                            </div>
                        </div>
                    ) : (
                        <TasksBoardView />
                    )}
                </div>
                {isXl && (
                    <div className="w-80 border-l border-neutral-800 p-2 min-h-0">
                        <TaskInspector googleCalendarDataAccess={googleCalendarDataAccess} googleCalendarResume={googleCalendarResume} onGoogleCalendarResumeConsumed={() => setGoogleCalendarResume(null)} />
                    </div>
                )}
            </div>
            {!isLg && sidebarOpen && (
                <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Projects">
                    <div className="absolute inset-0 bg-black/60" onClick={() => setSidebarOpen(false)} />
                    <div id="pm-projects-drawer" className="absolute inset-y-0 left-0 flex w-80 max-w-[85vw] flex-col border-r border-neutral-800 bg-neutral-950 shadow-2xl">
                        <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Projects</span>
                            <button type="button" onClick={() => setSidebarOpen(false)} className="rounded bg-neutral-800 px-3 py-2 text-[11px] text-neutral-200 hover:bg-neutral-700">
                                Close
                            </button>
                        </div>
                        <div className="flex-1 min-h-0 p-2">
                            <ProjectsSidebar onSelectProject={() => setSidebarOpen(false)} />
                        </div>
                    </div>
                </div>
            )}
            {!isXl && inspectorOpen && (
                <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Task details">
                    <div className="absolute inset-0 bg-black/60" onClick={() => setInspectorOpen(false)} />
                    <div id="pm-task-inspector-drawer" className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-neutral-800 bg-neutral-950 shadow-2xl">
                        <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Task details</span>
                            <button type="button" onClick={() => setInspectorOpen(false)} className="rounded bg-neutral-800 px-3 py-2 text-[11px] text-neutral-200 hover:bg-neutral-700">
                                Close
                            </button>
                        </div>
                        <div className="flex-1 min-h-0 overflow-hidden p-2">
                            <TaskInspector googleCalendarDataAccess={googleCalendarDataAccess} googleCalendarResume={googleCalendarResume} onGoogleCalendarResumeConsumed={() => setGoogleCalendarResume(null)} />
                        </div>
                    </div>
                </div>
            )}
            <DebugInfo />
            {activeProjectId && <AgentPanel googleCalendarDataAccess={googleCalendarDataAccess} />}
        </div>
    );
};

// Temporary debug info (can remove later)
const DebugInfo: React.FC = () => {
    const { state } = usePM();
    const projectCount = Object.keys(state.projects).length;
    const taskCount = Object.keys(state.tasks).length;
    return (
        <div className="px-2 py-1 text-[10px] text-neutral-500 flex flex-wrap gap-x-3 gap-y-0.5 border-t border-neutral-800">
            <span>Projects: {projectCount}</span>
            <span>Tasks: {taskCount}</span>
            <span>SelectedProj: {state.ui.selectedProjectIds.join(",") || "none"}</span>
        </div>
    );
};

const ViewSwitch: React.FC<{
    cur: "list" | "board";
    onChange: (v: "list" | "board") => void;
}> = ({ cur, onChange }) => (
    <div className="inline-flex bg-neutral-900 rounded overflow-hidden">
        {(["list", "board"] as const).map((v) => (
            <button key={v} onClick={() => onChange(v)} className={`px-2.5 py-1.5 sm:px-2 sm:py-1 text-[10px] ${cur === v ? "bg-neutral-700" : ""}`}>
                {v === "list" ? "List" : "Board"}
            </button>
        ))}
    </div>
);

const InlineAddTask: React.FC<{ projectId: string }> = ({ projectId }) => {
    const { createTask, setFilters } = usePM();
    const [title, setTitle] = React.useState("");
    const [error, setError] = React.useState<string | null>(null);
    const submit = async () => {
        const t = title.trim();
        if (!t) return;
        setError(null);
        try {
            const task = await createTask(t, { projectId });
            setFilters({ selectedTaskId: task.id });
        } catch (err) {
            console.warn("Failed to add task", err);
            setError("Could not add task.");
            return;
        }
        setTitle("");
    };
    return (
        <div className="flex items-center gap-2 mb-2 text-xs">
            <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter") {
                        void submit();
                    }
                }}
                placeholder="Add task title"
                className="flex-1 min-w-0 bg-neutral-900 rounded px-2 py-1.5 sm:py-1"
            />
            <button
                onClick={() => {
                    submit();
                }}
                className="px-3 py-1.5 sm:px-2 sm:py-1 rounded bg-neutral-800 hover:bg-neutral-700"
            >
                Add
            </button>
            {error && <span role="alert" className="text-red-400">{error}</span>}
        </div>
    );
};
