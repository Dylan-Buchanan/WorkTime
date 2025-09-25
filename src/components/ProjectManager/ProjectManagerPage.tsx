import React, { useState } from "react";
import { ProjectsSidebar } from "./ProjectsSidebar";
import { TasksListView } from "./TasksListView";
import { TasksBoardView } from "./TasksBoardView";
import { TaskInspector } from "./TaskInspector";
import { usePM } from "../../state/ProjectManagerContext";

export const ProjectManagerPage: React.FC = () => {
    const {
        state,
        createTask,
        quickAddParse,
        ensureProjectByName,
        setFilters,
        setView,
    } = usePM();
    const [quick, setQuick] = useState("");
    const activeProjectId = state.ui.selectedProjectIds[0] || null;

    const submitQuick = async () => {
        const raw = quick.trim();
        if (!raw) return;
        const { task, projectName } = quickAddParse(raw);
        let projectId: string | null = null;
        if (projectName) {
            projectId = ensureProjectByName(projectName).id;
        } else if (activeProjectId) {
            projectId = activeProjectId;
        } else {
            alert("Select a project first");
            return;
        }
        const created = await createTask(task.title || "Untitled", {
            ...task,
            projectId,
        });
        setFilters({ selectedTaskId: created.id });
        setQuick("");
    };

    return (
        <div className="flex flex-col h-full">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-neutral-800 text-xs">
                {activeProjectId && (
                    <div className="text-[11px] px-2 py-1 rounded bg-neutral-800 flex items-center gap-1">
                        <span
                            className="w-2 h-2 rounded-full"
                            style={{
                                background:
                                    state.projects[activeProjectId]?.color,
                            }}
                        />
                        {state.projects[activeProjectId]?.name}
                    </div>
                )}
                <input
                    value={quick}
                    onChange={(e) => setQuick(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            void submitQuick();
                        }
                    }}
                    placeholder="Quick add: Title @Project ^YYYY-MM-DD #tag !high"
                    className="flex-1 bg-neutral-900 rounded px-2 py-1"
                />
                <button
                    onClick={() => {
                        submitQuick();
                    }}
                    className="px-2 py-1 rounded bg-neutral-800"
                >
                    Add
                </button>
                <div className="ml-auto flex items-center gap-1">
                    <ViewSwitch
                        cur={state.ui.view}
                        onChange={(v) => setView(v)}
                    />
                </div>
            </div>
            <div className="flex flex-1 min-h-0">
                <div className="w-64 border-r border-neutral-800 p-2 flex flex-col">
                    <ProjectsSidebar />
                </div>
                <div className="flex-1 min-w-0 p-2 overflow-hidden">
                    {state.ui.view === "list" ? (
                        <div className="flex flex-col h-full">
                            {activeProjectId && (
                                <InlineAddTask projectId={activeProjectId} />
                            )}
                            <div className="flex-1 overflow-auto">
                                <TasksListView />
                            </div>
                        </div>
                    ) : (
                        <TasksBoardView />
                    )}
                </div>
                <div className="w-80 border-l border-neutral-800 p-2 hidden xl:block">
                    <TaskInspector />
                </div>
            </div>
            <DebugInfo />
        </div>
    );
};

// Temporary debug info (can remove later)
const DebugInfo: React.FC = () => {
    const { state } = usePM();
    const projectCount = Object.keys(state.projects).length;
    const taskCount = Object.keys(state.tasks).length;
    return (
        <div className="px-2 py-1 text-[10px] text-neutral-500 flex gap-3 border-t border-neutral-800">
            <span>Projects: {projectCount}</span>
            <span>Tasks: {taskCount}</span>
            <span>
                SelectedProj: {state.ui.selectedProjectIds.join(",") || "none"}
            </span>
        </div>
    );
};

const ViewSwitch: React.FC<{
    cur: "list" | "board";
    onChange: (v: "list" | "board") => void;
}> = ({ cur, onChange }) => (
    <div className="inline-flex bg-neutral-900 rounded overflow-hidden">
        {(["list", "board"] as const).map((v) => (
            <button
                key={v}
                onClick={() => onChange(v)}
                className={`px-2 py-1 text-[10px] ${
                    cur === v ? "bg-neutral-700" : ""
                }`}
            >
                {v === "list" ? "List" : "Board"}
            </button>
        ))}
    </div>
);

const InlineAddTask: React.FC<{ projectId: string }> = ({ projectId }) => {
    const { createTask, setFilters } = usePM();
    const [title, setTitle] = React.useState("");
    const submit = async () => {
        const t = title.trim();
        if (!t) return;
        const task = await createTask(t, { projectId });
        setFilters({ selectedTaskId: task.id });
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
                className="flex-1 bg-neutral-900 rounded px-2 py-1"
            />
            <button
                onClick={() => {
                    submit();
                }}
                className="px-2 py-1 rounded bg-neutral-800"
            >
                Add
            </button>
        </div>
    );
};
