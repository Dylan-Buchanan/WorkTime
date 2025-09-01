import React from "react";
import { usePM } from "../../state/ProjectManagerContext";
import { PMTask } from "../../state/types";
// import { TaskRowSkeleton } from "./Skeletons";
import { EmptyState } from "./EmptyState";

export const TasksListView: React.FC<{ filter?: string }> = ({
    filter = "",
}) => {
    const { state, updateTask, setSelectedTask } = usePM();
    const tasks = Object.values(state.tasks).filter((t) => !t.isArchived);
    const search = state.ui.search.toLowerCase();
    const fLower = filter.toLowerCase();
    const filtered = tasks.filter(
        (t) =>
            (!search || t.title.toLowerCase().includes(search)) &&
            (!fLower || t.title.toLowerCase().includes(fLower)) &&
            (state.ui.selectedProjectIds.length === 0 ||
                (t.projectId &&
                    state.ui.selectedProjectIds.includes(t.projectId)))
    );
    if (filtered.length === 0)
        return (
            <div className="p-4">
                <EmptyState
                    title="No tasks match filters"
                    action={
                        <button
                            onClick={() => {
                                /* TODO: clear filters */
                            }}
                            className="text-xs underline"
                        >
                            Clear filters
                        </button>
                    }
                />
            </div>
        );
    const sorted = filtered.sort((a, b) => a.sortOrder - b.sortOrder);
    return (
        <div className="text-xs divide-y divide-neutral-800">
            {sorted.map((t) => (
                <TaskRow
                    key={t.id}
                    task={t}
                    onClick={() => setSelectedTask(t.id)}
                    onUpdate={(p) => updateTask(t.id, p)}
                    selected={state.ui.selectedTaskId === t.id}
                />
            ))}
        </div>
    );
};

const TaskRow: React.FC<{
    task: PMTask;
    onUpdate: (p: Partial<PMTask>) => void;
    onClick: () => void;
    selected: boolean;
}> = ({ task, onUpdate, onClick, selected }) => {
    const overdue = task.dueDate && new Date(task.dueDate) < new Date();
    return (
        <div
            onClick={onClick}
            className={`px-3 py-2 grid items-center gap-2 cursor-pointer hover:bg-neutral-800 ${
                selected ? "bg-neutral-800" : ""
            }`}
            style={{ gridTemplateColumns: "16px 1fr auto auto auto auto" }}
        >
            <input
                type="checkbox"
                className="w-4 h-4"
                checked={task.status === "Done"}
                onChange={(e) =>
                    onUpdate({ status: e.target.checked ? "Done" : "Backlog" })
                }
                onClick={(e) => e.stopPropagation()}
            />
            <InlineEditable
                value={task.title}
                onChange={(v) => onUpdate({ title: v })}
                className="truncate pr-2"
            />
            <StatusChip
                status={task.status}
                onChange={(s) => onUpdate({ status: s })}
            />
            <PriorityChip
                priority={task.priority}
                onChange={(p) => onUpdate({ priority: p })}
            />
            <div
                className={`text-[10px] px-2 py-0.5 rounded ${
                    overdue
                        ? "bg-red-600/30 text-red-300"
                        : "bg-neutral-700/40 text-neutral-400"
                }`}
            >
                {task.dueDate?.slice(5) || "--"}
            </div>
            <div className="text-[10px] text-neutral-500 flex flex-col items-end leading-tight">
                <span>
                    {(task.timeSpentMinutes || 0).toFixed(1)}m
                    {task.estimatePomos && (
                        <>
                            {" "}
                            ·{" "}
                            {(
                                task.workedPomos ||
                                (task.timeSpentMinutes || 0) / 25
                            ).toFixed(1)}
                            p{"/" + task.estimatePomos + "p"}
                        </>
                    )}
                </span>
            </div>
        </div>
    );
};

const statuses: PMTask["status"][] = [
    "Backlog",
    "Next",
    "In Progress",
    "Blocked",
    "Done",
];
const priorities: PMTask["priority"][] = ["Low", "Medium", "High"];

const StatusChip: React.FC<{
    status: PMTask["status"];
    onChange: (s: PMTask["status"]) => void;
}> = ({ status, onChange }) => {
    return (
        <select
            value={status}
            onChange={(e) => onChange(e.target.value as PMTask["status"])}
            className="bg-neutral-900 text-[10px] rounded px-2 py-1 outline-none"
        >
            {statuses.map((s) => (
                <option key={s}>{s}</option>
            ))}
        </select>
    );
};
const PriorityChip: React.FC<{
    priority: PMTask["priority"];
    onChange: (p: PMTask["priority"]) => void;
}> = ({ priority, onChange }) => {
    return (
        <select
            value={priority}
            onChange={(e) => onChange(e.target.value as PMTask["priority"])}
            className="bg-neutral-900 text-[10px] rounded px-2 py-1 outline-none"
        >
            {priorities.map((s) => (
                <option key={s}>{s}</option>
            ))}
        </select>
    );
};

const InlineEditable: React.FC<{
    value: string;
    onChange: (v: string) => void;
    className?: string;
}> = ({ value, onChange, className }) => {
    const [editing, setEditing] = React.useState(false);
    const [local, setLocal] = React.useState(value);
    React.useEffect(() => setLocal(value), [value]);
    if (editing)
        return (
            <input
                autoFocus
                onBlur={() => {
                    setEditing(false);
                    if (local !== value) onChange(local);
                }}
                value={local}
                onChange={(e) => setLocal(e.target.value)}
                className={`bg-neutral-900 rounded px-1 py-0.5 text-xs w-full ${
                    className || ""
                }`}
            />
        );
    return (
        <div onDoubleClick={() => setEditing(true)} className={className}>
            {value || "Untitled"}
        </div>
    );
};
