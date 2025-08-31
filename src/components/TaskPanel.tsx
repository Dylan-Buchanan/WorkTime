import React, { useState } from "react";
import { useAppState } from "../state/AppStateContext";

export const TaskPanel: React.FC = () => {
    const { state, createTask, setActiveTask, finalizeTask } = useAppState();
    const [name, setName] = useState("");
    const [target, setTarget] = useState(4);

    const tasks = Object.values(state?.tasks || {}).filter((t) => !t.archived);

    return (
        <div>
            <h3>Tasks</h3>
            <form
                onSubmit={async (e) => {
                    e.preventDefault();
                    if (!name) return;
                    await createTask(name, target);
                    setName("");
                }}
            >
                <input
                    value={name}
                    placeholder="Task name"
                    onChange={(e) => setName(e.target.value)}
                />
                <input
                    type="number"
                    min={1}
                    value={target}
                    style={{ width: 60 }}
                    onChange={(e) => setTarget(Number(e.target.value))}
                />
                <button type="submit">Add</button>
            </form>
            <ul style={{ listStyle: "none", padding: 0, marginTop: 8 }}>
                {tasks.map((t) => (
                    <li
                        key={t.id}
                        style={{
                            padding: "4px 0",
                            cursor: "pointer",
                            fontWeight:
                                state?.active_task === t.id ? "bold" : "normal",
                            display: "flex",
                            alignItems: "center",
                        }}
                        onClick={() => setActiveTask(t.id)}
                    >
                        <span style={{ flex: 1 }}>
                            {t.name} ({t.completed_pomodoros}/
                            {t.target_pomodoros})
                        </span>
                        {state?.active_task === t.id && (
                            <>
                                <span
                                    style={{
                                        fontSize: 10,
                                        background: "#1976d2",
                                        color: "white",
                                        padding: "2px 4px",
                                        borderRadius: 3,
                                        marginRight: 4,
                                    }}
                                >
                                    ACTIVE
                                </span>
                                {!t.completed_at && (
                                    <button
                                        style={{ fontSize: 10 }}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            finalizeTask(t.id);
                                        }}
                                    >
                                        Complete
                                    </button>
                                )}
                            </>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
};
