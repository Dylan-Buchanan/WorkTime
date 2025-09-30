// Clean board view implementation (reset after corruption)
import React from "react";
import { usePM } from "../../state/ProjectManagerContext";
import { DndContext, useSensor, useSensors, PointerSensor, DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { PMTask, TaskStatus } from "../../state/types";

const columns: TaskStatus[] = ["Backlog", "Next", "In Progress", "Blocked", "Done"];

export const TasksBoardView: React.FC = () => {
    const { state, moveTaskToStatus, reorderTasks, setSelectedTask } = usePM();
    const sensors = useSensors(useSensor(PointerSensor));
    const activeProjectId = state.ui.selectedProjectIds[0] ?? null;
    const shouldFilterByProject = !state.ui.boardShowAllTasks && Boolean(activeProjectId);
    const tasksByStatus: Record<TaskStatus, PMTask[]> = {
        Backlog: [],
        Next: [],
        "In Progress": [],
        Blocked: [],
        Done: [],
    };
    Object.values(state.tasks)
        .filter((t) => !t.isArchived)
        .filter((t) => {
            if (!shouldFilterByProject) return true;
            return t.projectId === activeProjectId;
        })
        .forEach((t) => {
            tasksByStatus[t.status].push(t);
        });
    columns.forEach((c) => tasksByStatus[c].sort((a, b) => a.sortOrder - b.sortOrder));

    const onDragEnd = (e: DragEndEvent) => {
        const { active, over } = e;
        if (!over) return;
        const [fromStatus, taskId] = active.id.toString().split(":");
        const [toStatus] = over.id.toString().split(":");
        const task = state.tasks[taskId];
        if (!task) return;
        if (fromStatus !== toStatus) {
            moveTaskToStatus(task.id, toStatus as TaskStatus);
        } else {
            const arr = tasksByStatus[fromStatus as TaskStatus];
            const oldIndex = arr.findIndex((t) => t.id === task.id);
            const newIndex = (over.data.current as any)?.sortable?.index ?? oldIndex;
            if (oldIndex !== newIndex) {
                const ordered = arrayMove(
                    arr.map((t) => t.id),
                    oldIndex,
                    newIndex
                );
                reorderTasks(ordered, fromStatus as TaskStatus);
            }
        }
    };

    return (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
            <div className="flex gap-3 h-full overflow-x-auto pb-2">
                {columns.map((col) => (
                    <Column key={col} status={col} tasks={tasksByStatus[col]} onSelect={(id) => setSelectedTask(id)} selectedId={state.ui.selectedTaskId} />
                ))}
            </div>
        </DndContext>
    );
};

const Column: React.FC<{
    status: TaskStatus;
    tasks: PMTask[];
    onSelect: (id: string) => void;
    selectedId: string | null;
}> = ({ status, tasks, onSelect, selectedId }) => (
    <div className="flex flex-col bg-neutral-900/40 rounded w-56 flex-shrink-0">
        <div className="px-3 py-2 text-[10px] uppercase tracking-wide font-medium opacity-70">
            {status} <span className="opacity-40">{tasks.length}</span>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2">
            <SortableContext items={tasks.map((t) => `${status}:${t.id}`)} strategy={verticalListSortingStrategy}>
                {tasks.map((t) => (
                    <TaskCard key={t.id} task={t} status={status} selected={selectedId === t.id} onClick={() => onSelect(t.id)} />
                ))}
            </SortableContext>
        </div>
    </div>
);

const TaskCard: React.FC<{
    task: PMTask;
    status: TaskStatus;
    selected: boolean;
    onClick: () => void;
}> = ({ task, status, selected, onClick }) => {
    const { state } = usePM();
    const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: `${status}:${task.id}` });
    const style: React.CSSProperties = {
        transform: CSS.Translate.toString(transform),
        transition,
    };
    const overdue = task.dueDate && new Date(task.dueDate) < new Date();
    const progressPct = task.estimatePomos ? Math.min(100, Math.round(((task.workedPomos || 0) / (task.estimatePomos || 1)) * 100)) : 0;
    const project = task.projectId ? state.projects[task.projectId] : null;
    return (
        <div
            ref={setNodeRef}
            style={style}
            onPointerDown={() => onClick()}
            className={`rounded bg-neutral-800 pt-2 pb-2 pl-2 pr-2 shadow-sm border border-transparent hover:border-neutral-600 text-xs space-y-1 select-none ${
                selected ? "ring-1 ring-neutral-400" : ""
            }`}
        >
            <div className="flex items-start gap-2">
                <div
                    className="w-3 flex flex-col items-center cursor-grab active:cursor-grabbing text-neutral-500 mt-0.5"
                    {...attributes}
                    {...listeners}
                    onClick={(e) => e.stopPropagation()}
                    title="Drag"
                >
                    ⋮
                </div>
                <div
                    className="flex-1 min-w-0"
                    onClick={(e) => {
                        e.stopPropagation();
                        onClick();
                    }}
                >
                    <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="flex items-center gap-2 min-w-0">
                            {project?.color && (
                                <span
                                    className="w-2.5 h-2.5 rounded-full border border-black/30 shadow-[0_0_0_1px_rgba(255,255,255,0.08)] flex-shrink-0"
                                    style={{ background: project.color }}
                                    aria-hidden
                                />
                            )}
                            <div className="font-medium truncate">{task.title || "Untitled"}</div>
                        </div>
                        <PriorityBadge priority={task.priority} />
                    </div>
                    {task.dueDate && (
                        <div className="flex items-center flex-wrap gap-2 text-[10px] opacity-70">
                            <span className={`px-1 rounded ${overdue ? "bg-red-600/30 text-red-300" : "bg-neutral-600/30"}`}>{task.dueDate.slice(5)}</span>
                        </div>
                    )}
                    {task.estimatePomos && (
                        <div className="h-1 bg-neutral-700 rounded overflow-hidden mt-1">
                            <div className="h-full bg-neutral-400" style={{ width: progressPct + "%" }} />
                        </div>
                    )}
                    <div className="mt-1 text-[10px] opacity-60 flex items-center gap-2">
                        <span>{Number(task.timeSpentMinutes || 0).toFixed(1)}m</span>
                        <span>
                            {Number(task.workedPomos || 0).toFixed(1)}p{Number.isFinite(Number(task.estimatePomos)) && " / " + Number(task.estimatePomos) + "p"}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
};

const priorityStyles: Record<PMTask["priority"], { bg: string; text: string; dot: string; label: string }> = {
    High: {
        bg: "bg-red-500/20",
        text: "text-red-200",
        dot: "bg-red-400",
        label: "High",
    },
    Medium: {
        bg: "bg-amber-500/20",
        text: "text-amber-100",
        dot: "bg-amber-300",
        label: "Medium",
    },
    Low: {
        bg: "bg-emerald-500/20",
        text: "text-emerald-200",
        dot: "bg-emerald-300",
        label: "Low",
    },
};

const PriorityBadge: React.FC<{ priority: PMTask["priority"] }> = ({ priority }) => {
    const styles = priorityStyles[priority];
    return (
        <span className={`flex-shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${styles.bg} ${styles.text}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${styles.dot}`} aria-hidden />
            {styles.label}
        </span>
    );
};
