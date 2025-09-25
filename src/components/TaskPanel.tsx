import React, { useState } from "react";
import { useAppState } from "../state/AppStateContext";
import { useSounds } from "../hooks/useSounds";

export const TaskPanel: React.FC = () => {
    const { state, createTask, setActiveTask, finalizeTask } = useAppState();
    const { play } = useSounds();
    const [name, setName] = useState("");
    const [target, setTarget] = useState(4);
    const tasks = Object.values(state?.tasks || {}).filter((t) => !t.archived);

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Tasks</h3>
                <span className="text-[10px] text-neutral-500">{tasks.length}</span>
            </div>
            <form
                onSubmit={async (e) => {
                    e.preventDefault();
                    if (!name.trim()) return;
                    await createTask(name.trim(), target);
                    play("pressSide");
                    setName("");
                }}
                className="flex gap-2"
            >
                <input
                    value={name}
                    placeholder="Task name"
                    onChange={(e) => setName(e.target.value)}
                    className="flex-1 bg-neutral-800/60 border border-neutral-700 rounded px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <input
                    type="number"
                    min={1}
                    value={target}
                    onChange={(e) => setTarget(Number(e.target.value))}
                    className="w-14 bg-neutral-800/60 border border-neutral-700 rounded px-1 py-1 text-[11px] text-center focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <button type="submit" onMouseEnter={() => play("hover")} className="px-2 py-1 text-[11px] rounded bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 transition-colors">
                    Add
                </button>
            </form>
            <ul className="space-y-1">
                {tasks.map((t) => {
                    const active = state?.active_task === t.id;
                    return (
                        <li
                            key={t.id}
                            onClick={() => {
                                setActiveTask(t.id);
                                play("pressSide");
                            }}
                            className={`group flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-[11px] border border-transparent hover:border-neutral-700 hover:bg-neutral-800/50 transition ${
                                active ? "bg-neutral-800/60 border-neutral-700" : ""
                            }`}
                        >
                            <span className="flex-1 truncate">
                                {t.name} ({Math.round(t.completed_pomodoros * 10) / 10}/{t.target_pomodoros})
                            </span>
                            {active && <span className="text-[9px] font-medium tracking-wide px-1.5 py-0.5 rounded bg-indigo-600 text-white">ACTIVE</span>}
                            {active && !t.completed_at && (
                                <button
                                    onMouseEnter={() => play("hover")}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        finalizeTask(t.id);
                                        play("completeTask");
                                    }}
                                    className="text-[10px] px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white"
                                >
                                    Complete
                                </button>
                            )}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
};
