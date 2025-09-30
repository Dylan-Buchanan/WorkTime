import React from "react";
import { usePM } from "../../state/ProjectManagerContext";
import { PMTask, TaskPriority, TaskStatus } from "../../state/types";
import { useAppState } from "../../state/AppStateContext";
import { useNavigate } from "react-router-dom";
// import { InspectorSkeleton } from './Skeletons';

export const TaskInspector: React.FC = () => {
    const { state, updateTask } = usePM();
    const app = useAppState();
    const navigate = useNavigate();
    const id = state.ui.selectedTaskId;
    const task = id ? state.tasks[id] : null;
    const minEstimate = React.useMemo(() => {
        const worked = Number(task?.workedPomos);
        const safeWorked = Number.isFinite(worked) && worked >= 0 ? worked : 0;
        const min = Math.max(1, Math.ceil(safeWorked));
        return Number.isFinite(min) ? min : 1;
    }, [task?.workedPomos]);

    const [estimateDraft, setEstimateDraft] = React.useState<string>("");
    React.useEffect(() => {
        if (!task) {
            setEstimateDraft("");
            return;
        }
        const estRaw = (task as any).estimatePomos;
        const estNum = Number(estRaw);
        const estValid = Number.isFinite(estNum) && estNum > 0;
        setEstimateDraft(String(estValid ? estNum : minEstimate));
    }, [task?.id, task?.estimatePomos, minEstimate, task]);

    const commitEstimateDraft = React.useCallback(() => {
        if (!task) return;
        const raw = estimateDraft.trim();
        if (!raw) {
            const fallback = String(minEstimate);
            setEstimateDraft(fallback);
            if ((task.estimatePomos ?? minEstimate) !== minEstimate) {
                updateTask(task.id, { estimatePomos: minEstimate });
            }
            return;
        }

        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) {
            setEstimateDraft(String(task.estimatePomos ?? minEstimate));
            return;
        }

        let next = Math.round(parsed);
        if (next < minEstimate) {
            next = minEstimate;
        }
        const nextString = String(next);
        if (estimateDraft !== nextString) {
            setEstimateDraft(nextString);
        }
        if (next !== task.estimatePomos) {
            updateTask(task.id, { estimatePomos: next });
        }
    }, [estimateDraft, minEstimate, task, updateTask]);

    if (!task) return <div className="h-full flex items-center justify-center text-xs opacity-60">Select a task</div>;

    const formatMetaDate = React.useCallback((value?: string) => {
        if (!value) return "Unknown";
        if (value.length >= 10) {
            return value.slice(0, 10);
        }
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
            return "Unknown";
        }
        return parsed.toISOString().slice(0, 10);
    }, []);

    return (
        <div className="flex flex-col h-full text-xs">
            <div className="p-3 border-b border-neutral-800 space-y-2">
                <InlineEditable value={task.title} onChange={(v) => updateTask(task.id, { title: v })} className="text-sm font-medium" />
                <div className="flex items-center gap-2 flex-wrap">
                    <Select value={task.projectId || ""} onValueChange={(v) => updateTask(task.id, { projectId: v || null })}>
                        <option value="">No Project</option>
                        {Object.values(state.projects)
                            .filter((p) => !p.isArchived)
                            .map((p) => (
                                <option key={p.id} value={p.id}>
                                    {p.name}
                                </option>
                            ))}
                    </Select>
                    <Select value={task.status} onValueChange={(v) => updateTask(task.id, { status: v as TaskStatus })}>
                        {["Backlog", "Next", "In Progress", "Blocked", "Done"].map((s) => (
                            <option key={s}>{s}</option>
                        ))}
                    </Select>
                    <Select value={task.priority} onValueChange={(v) => updateTask(task.id, { priority: v as TaskPriority })}>
                        {["Low", "Medium", "High"].map((s) => (
                            <option key={s}>{s}</option>
                        ))}
                    </Select>
                </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-4">
                <Section title="When">
                    <div className="flex items-center gap-2">
                        <label className="flex items-center gap-1">
                            Due{" "}
                            <input
                                type="date"
                                value={task.dueDate || ""}
                                onChange={(e) =>
                                    updateTask(task.id, {
                                        dueDate: e.target.value || undefined,
                                    })
                                }
                                className="bg-neutral-900 text-xs"
                            />
                        </label>
                        <button
                            className="text-[10px] underline"
                            onClick={() =>
                                updateTask(task.id, {
                                    dueDate: new Date().toISOString().slice(0, 10),
                                })
                            }
                        >
                            Today
                        </button>
                        <button
                            className="text-[10px] underline"
                            onClick={() => {
                                const d = new Date();
                                d.setDate(d.getDate() + 1);
                                updateTask(task.id, {
                                    dueDate: d.toISOString().slice(0, 10),
                                });
                            }}
                        >
                            Tomorrow
                        </button>
                        <button
                            className="text-[10px] underline"
                            onClick={() => {
                                const d = new Date();
                                d.setDate(d.getDate() + 7);
                                updateTask(task.id, {
                                    dueDate: d.toISOString().slice(0, 10),
                                });
                            }}
                        >
                            Next Week
                        </button>
                    </div>
                </Section>
                <Section title="Estimate & Time">
                    <div className="flex items-center gap-2">
                        <label className="flex items-center gap-1">
                            Est{" "}
                            <input
                                type="number"
                                min={Number.isFinite(minEstimate) ? minEstimate : 1}
                                step={1}
                                value={estimateDraft}
                                onChange={(e) => {
                                    setEstimateDraft(e.target.value);
                                }}
                                onBlur={() => {
                                    commitEstimateDraft();
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        e.preventDefault();
                                        commitEstimateDraft();
                                        e.currentTarget.blur();
                                    }
                                }}
                                className="w-16 bg-neutral-900"
                            />
                            p
                        </label>
                        <div className="opacity-70">Spent {task.timeSpentMinutes}m</div>
                        <button
                            className="text-[10px] px-2 py-1 rounded bg-neutral-800"
                            onClick={async () => {
                                // Link or create timer task
                                let appId = task.appTaskId;
                                if (!appId) {
                                    const est = task.estimatePomos || 1;
                                    try {
                                        const created = await app.createTask(task.title || "Untitled", est);
                                        appId = created.id;
                                        updateTask(task.id, {
                                            appTaskId: created.id,
                                        });
                                    } catch (err) {
                                        console.error("Failed to create timer task", err);
                                        return;
                                    }
                                } else {
                                    await app.setActiveTask(appId);
                                }
                                await app.startWork();
                                navigate("/");
                            }}
                        >
                            Start
                        </button>
                    </div>
                    {Number.isFinite(Number(task.estimatePomos)) && (
                        <div className="h-1 bg-neutral-800 rounded overflow-hidden mt-1">
                            <div
                                className="h-full bg-neutral-400"
                                style={{
                                    width: (() => {
                                        const spent = Number(task.timeSpentMinutes) || 0;
                                        const est = Number(task.estimatePomos);
                                        const estSafe = Number.isFinite(est) && est > 0 ? est : 1;
                                        const pct = Math.round((spent / (estSafe * 25)) * 100);
                                        return Math.min(100, Math.max(0, pct)) + "%";
                                    })(),
                                }}
                            />
                        </div>
                    )}
                </Section>
                <Section title="Details">
                    <textarea
                        value={task.description || ""}
                        onChange={(e) => updateTask(task.id, { description: e.target.value })}
                        placeholder="Markdown notes"
                        className="w-full h-28 bg-neutral-900 rounded p-2 text-xs"
                    />
                    <TagEditor tags={task.tags} onChange={(tags) => updateTask(task.id, { tags })} />
                    <LinksEditor links={task.links} onChange={(links) => updateTask(task.id, { links })} />
                </Section>
                <Section title="Checklist">
                    <Checklist task={task} update={(patch) => updateTask(task.id, patch)} />
                </Section>
            </div>
            <div className="p-3 border-t border-neutral-800 text-[10px] flex flex-wrap gap-2 items-center">
                <div className="opacity-60">Created {formatMetaDate(task.createdAt)}</div>
                <div className="opacity-60">Updated {formatMetaDate(task.updatedAt)}</div>
                <button onClick={() => updateTask(task.id, { isArchived: !task.isArchived })} className="ml-auto underline">
                    {task.isArchived ? "Unarchive" : "Archive"} Task
                </button>
            </div>
        </div>
    );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <div className="space-y-2">
        <div className="text-[10px] uppercase tracking-wide opacity-60">{title}</div>
        {children}
    </div>
);

interface MiniSelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "onChange"> {
    onValueChange?: (v: string) => void;
}
const Select: React.FC<MiniSelectProps> = ({ onValueChange, ...rest }) => (
    <select {...rest} onChange={(e) => onValueChange?.(e.target.value)} className={`bg-neutral-900 rounded px-2 py-1 text-[10px] outline-none ${rest.className || ""}`}>
        {rest.children}
    </select>
);

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
                className={`bg-neutral-900 rounded px-2 py-1 text-xs w-full ${className || ""}`}
            />
        );
    return (
        <div onDoubleClick={() => setEditing(true)} className={className}>
            {value || "Untitled"}
        </div>
    );
};

const TagEditor: React.FC<{
    tags: string[];
    onChange: (t: string[]) => void;
}> = ({ tags, onChange }) => {
    const [input, setInput] = React.useState("");
    const add = () => {
        const v = input.trim();
        if (v && !tags.includes(v)) onChange([...tags, v]);
        setInput("");
    };
    return (
        <div className="space-y-1">
            <div className="flex flex-wrap gap-1">
                {tags.map((t) => (
                    <span key={t} className="px-2 py-0.5 bg-neutral-800 rounded-full text-[10px]">
                        {t} <button onClick={() => onChange(tags.filter((x) => x !== t))}>×</button>
                    </span>
                ))}
            </div>
            <div className="flex items-center gap-1">
                <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Add tag"
                    className="bg-neutral-900 rounded px-2 py-1 text-[10px]"
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            add();
                        }
                    }}
                />
                <button onClick={add} className="text-[10px] px-2 py-1 rounded bg-neutral-800">
                    Add
                </button>
            </div>
        </div>
    );
};

const LinksEditor: React.FC<{
    links: string[];
    onChange: (l: string[]) => void;
}> = ({ links, onChange }) => {
    const [input, setInput] = React.useState("");
    const add = () => {
        const v = input.trim();
        if (v && /^https?:\/\//i.test(v)) onChange([...links, v]);
        setInput("");
    };
    return (
        <div className="space-y-1">
            <div className="space-y-1">
                {links.map((l, i) => (
                    <div key={i} className="flex items-center gap-2 text-[10px] bg-neutral-900 px-2 py-1 rounded">
                        <a href={l} target="_blank" rel="noreferrer" className="underline truncate flex-1">
                            {l}
                        </a>
                        <button onClick={() => onChange(links.filter((x) => x !== l))}>×</button>
                    </div>
                ))}
            </div>
            <div className="flex items-center gap-1">
                <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="https://"
                    className="bg-neutral-900 rounded px-2 py-1 text-[10px] flex-1"
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            add();
                        }
                    }}
                />
                <button onClick={add} className="text-[10px] px-2 py-1 rounded bg-neutral-800">
                    Add
                </button>
            </div>
        </div>
    );
};

const Checklist: React.FC<{
    task: PMTask;
    update: (patch: Partial<PMTask>) => void;
}> = ({ task, update }) => {
    const add = () => {
        const title = prompt("Subtask title");
        if (!title) return;
        update({
            checklist: [...task.checklist, { id: crypto.randomUUID(), title, done: false }],
        });
    };
    return (
        <div className="space-y-2">
            <div className="space-y-1">
                {task.checklist.map((item) => (
                    <label key={item.id} className="flex items-center gap-2 text-[11px] bg-neutral-900 px-2 py-1 rounded">
                        <input
                            type="checkbox"
                            checked={item.done}
                            onChange={() =>
                                update({
                                    checklist: task.checklist.map((c) => (c.id === item.id ? { ...c, done: !c.done } : c)),
                                })
                            }
                        />
                        <span className={item.done ? "line-through opacity-60" : ""}>{item.title}</span>
                    </label>
                ))}
            </div>
            <button onClick={add} className="text-[10px] px-2 py-1 rounded bg-neutral-800">
                Add Item
            </button>
        </div>
    );
};
