import React, { useEffect, useRef, useState } from "react";
import { usePM } from "../../state/ProjectManagerContext";
import { useSounds } from "../../hooks/useSounds";
// import { SidebarProjectSkeleton } from './Skeletons';
import { EmptyState } from "./EmptyState";

const COLOR_PRESETS = ["#6366F1", "#EC4899", "#10B981", "#F59E0B", "#3B82F6", "#8B5CF6", "#EF4444", "#14B8A6"];
const WEEKDAYS = [
    { value: 1, label: "M", name: "Monday" },
    { value: 2, label: "T", name: "Tuesday" },
    { value: 3, label: "W", name: "Wednesday" },
    { value: 4, label: "T", name: "Thursday" },
    { value: 5, label: "F", name: "Friday" },
    { value: 6, label: "S", name: "Saturday" },
    { value: 0, label: "S", name: "Sunday" },
] as const;
const TIME_OPTIONS = Array.from({ length: 48 }, (_, index) => {
    const hours = Math.floor(index / 2);
    const minutes = index % 2 === 0 ? "00" : "30";
    return `${String(hours).padStart(2, "0")}:${minutes}`;
});

function formatScheduleTime(value: string): string {
    const [hours, minutes] = value.split(":").map(Number);
    const period = hours >= 12 ? "PM" : "AM";
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${String(minutes).padStart(2, "0")} ${period}`;
}

const ScheduleTimeSelect: React.FC<{ label: string; value: string; options: string[]; onChange: (value: string) => void }> = ({ label, value, options, onChange }) => {
    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(() => Math.max(0, options.indexOf(value)));
    const rootRef = useRef<HTMLDivElement>(null);
    const activeOptionRef = useRef<HTMLButtonElement>(null);
    const listboxId = React.useId();

    useEffect(() => {
        if (!open) return;
        const closeOnOutsideClick = (event: MouseEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", closeOnOutsideClick);
        return () => document.removeEventListener("mousedown", closeOnOutsideClick);
    }, [open]);

    useEffect(() => {
        if (open) activeOptionRef.current?.scrollIntoView({ block: "nearest" });
    }, [activeIndex, open]);

    const openAtCurrentValue = () => {
        setActiveIndex(Math.max(0, options.indexOf(value)));
        setOpen(true);
    };
    const choose = (nextValue: string) => {
        onChange(nextValue);
        setOpen(false);
    };
    const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
        if (event.key === "Escape") {
            setOpen(false);
            return;
        }
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (open) choose(options[activeIndex]);
            else openAtCurrentValue();
            return;
        }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            if (!open) {
                openAtCurrentValue();
                return;
            }
            if (event.key === "Home") setActiveIndex(0);
            else if (event.key === "End") setActiveIndex(options.length - 1);
            else setActiveIndex((current) => Math.max(0, Math.min(options.length - 1, current + (event.key === "ArrowDown" ? 1 : -1))));
        }
    };

    return (
        <div ref={rootRef} className="relative min-w-0 flex-1 space-y-1.5">
            <span className="block text-[10px] font-medium uppercase tracking-wide text-neutral-500">{label}</span>
            <button
                type="button"
                role="combobox"
                aria-label={`Workable ${label.toLowerCase()} time`}
                aria-expanded={open}
                aria-controls={listboxId}
                onClick={() => open ? setOpen(false) : openAtCurrentValue()}
                onKeyDown={handleKeyDown}
                className={`relative w-full rounded-lg border bg-neutral-950 py-2 pl-2.5 pr-7 text-left text-xs font-medium text-neutral-100 outline-none transition hover:border-neutral-600 focus:ring-2 focus:ring-indigo-500/20 ${open ? "border-indigo-500" : "border-neutral-700"}`}
            >
                {formatScheduleTime(value)}
                <svg aria-hidden viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={`pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-500 transition-transform ${open ? "rotate-180" : ""}`}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m6 8 4 4 4-4" />
                </svg>
            </button>
            {open && (
                <div
                    id={listboxId}
                    role="listbox"
                    aria-label={`${label} time options`}
                    className="absolute left-0 right-0 top-full z-30 mt-1 max-h-44 overflow-y-auto rounded-lg border border-neutral-700 bg-neutral-950 p-1 shadow-xl shadow-black/40 [scrollbar-color:#525252_#171717] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-neutral-600 [&::-webkit-scrollbar-track]:bg-neutral-900"
                >
                    {options.map((time, index) => {
                        const selected = time === value;
                        const active = index === activeIndex;
                        return (
                            <button
                                ref={active ? activeOptionRef : undefined}
                                key={time}
                                type="button"
                                role="option"
                                aria-selected={selected}
                                onMouseEnter={() => setActiveIndex(index)}
                                onClick={() => choose(time)}
                                className={`block w-full rounded-md px-2 py-1.5 text-left text-xs transition ${selected ? "bg-indigo-600 text-white" : active ? "bg-neutral-800 text-neutral-100" : "text-neutral-300 hover:bg-neutral-800"}`}
                            >
                                {formatScheduleTime(time)}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

const getRandomPresetColor = () => COLOR_PRESETS[Math.floor(Math.random() * COLOR_PRESETS.length)];

export const ProjectsSidebar: React.FC<{ onSelectProject?: () => void }> = ({ onSelectProject }) => {
    const { state, createProject, setFilters, deleteProject, updateProject } = usePM();
    const { play } = useSounds();
    const activeProjectId = state.ui.selectedProjectIds[0] || null;
    const activeProject = activeProjectId ? state.projects[activeProjectId] : null;
    const [search, setSearch] = useState("");
    const projects = Object.values(state.projects).filter((p) => !p.isArchived);
    const archived = Object.values(state.projects).filter((p) => p.isArchived);
    const filtered = projects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));

    const [showArchived, setShowArchived] = useState(false);
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [newProjectName, setNewProjectName] = useState("");
    const [newProjectColor, setNewProjectColor] = useState<string>(getRandomPresetColor);
    const nameInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (showCreateForm) {
            nameInputRef.current?.focus();
        }
    }, [showCreateForm]);

    const openCreateForm = () => {
        setNewProjectName("");
        setNewProjectColor(getRandomPresetColor());
        setShowCreateForm(true);
        play("pressSide");
    };

    const closeCreateForm = () => {
        setShowCreateForm(false);
        setNewProjectName("");
        setNewProjectColor(getRandomPresetColor());
        play("pressSide");
    };

    const handleCreateProject = () => {
        const trimmed = newProjectName.trim();
        if (!trimmed) return;
        const created = createProject(trimmed, newProjectColor);
        setFilters({ selectedProjectIds: [created.id] });
        play("pressSide");
        setShowCreateForm(false);
        setNewProjectName("");
        setNewProjectColor(getRandomPresetColor());
        onSelectProject?.();
    };

    return (
        <div className="flex h-full flex-col">
            <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                    <h2 className="text-sm font-semibold">Projects</h2>
                    <p className="text-[11px] text-neutral-500">Organize work and jump between projects quickly.</p>
                </div>
                <button
                    type="button"
                    onMouseEnter={() => play("hover")}
                    className={`flex items-center gap-1 rounded px-3 py-1.5 text-xs font-semibold transition ${
                        showCreateForm ? "bg-neutral-800 text-neutral-100 hover:bg-neutral-700" : "bg-indigo-600 text-white hover:bg-indigo-500"
                    }`}
                    onClick={() => {
                        if (showCreateForm) closeCreateForm();
                        else openCreateForm();
                    }}
                    title={showCreateForm ? "Close new project form" : "Create a new project"}
                >
                    <span aria-hidden className="text-sm">
                        {showCreateForm ? "×" : "+"}
                    </span>
                    <span>{showCreateForm ? "Cancel" : "New Project"}</span>
                </button>
            </div>
            {showCreateForm && (
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        handleCreateProject();
                    }}
                    className="mb-3 space-y-3 rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-xs"
                >
                    <div className="space-y-1">
                        <label className="block text-[10px] uppercase tracking-wide text-neutral-400">Project name</label>
                        <input
                            ref={nameInputRef}
                            value={newProjectName}
                            onChange={(e) => setNewProjectName(e.target.value)}
                            placeholder="Project name"
                            className="w-full rounded bg-neutral-800 px-2 py-1.5 text-xs outline-none transition focus:ring-1 focus:ring-indigo-500"
                        />
                    </div>
                    <div className="space-y-2">
                        <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-neutral-400">
                            <span>Color</span>
                            <span className="font-mono normal-case text-neutral-500">{newProjectColor}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                            {COLOR_PRESETS.map((color) => (
                                <button
                                    key={color}
                                    type="button"
                                    onMouseEnter={() => play("hover")}
                                    onClick={() => setNewProjectColor(color)}
                                    className={`h-7 w-7 rounded-full border transition ${newProjectColor === color ? "border-white shadow-[0_0_0_2px_rgba(99,102,241,0.4)]" : "border-transparent"}`}
                                    style={{ background: color }}
                                    title={`Use ${color}`}
                                />
                            ))}
                            <label className="ml-2 inline-flex items-center gap-2 text-[10px] uppercase tracking-wide text-neutral-400">
                                Custom
                                <input
                                    type="color"
                                    value={newProjectColor}
                                    onChange={(e) => setNewProjectColor(e.target.value)}
                                    className="h-7 w-7 cursor-pointer rounded border border-neutral-700 bg-transparent p-0"
                                    title="Choose a custom color"
                                />
                            </label>
                        </div>
                    </div>
                    <div className="flex justify-end gap-2 text-xs">
                        <button type="button" onMouseEnter={() => play("hover")} onClick={closeCreateForm} className="rounded bg-neutral-800 px-3 py-1.5 hover:bg-neutral-700">
                            Cancel
                        </button>
                        <button
                            type="submit"
                            onMouseEnter={() => play("hover")}
                            className="rounded bg-indigo-600 px-3 py-1.5 font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400"
                            disabled={!newProjectName.trim()}
                        >
                            Create Project
                        </button>
                    </div>
                </form>
            )}
            {activeProject && (
                <div className="mb-3 space-y-3 rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-xs text-neutral-200">
                    <div className="flex items-center gap-3">
                        <span className="h-3.5 w-3.5 flex-shrink-0 rounded-full" style={{ background: activeProject.color }} />
                        <div className="flex-1">
                            <p className="text-[10px] uppercase tracking-wide text-neutral-500">Active project</p>
                            <p className="truncate text-sm font-semibold">{activeProject.name}</p>
                        </div>
                        <label onMouseEnter={() => play("hover")} className="relative inline-flex h-8 w-8 items-center justify-center rounded-full border border-neutral-700 bg-neutral-950/70">
                            <span className="sr-only">Change project color</span>
                            <input
                                type="color"
                                value={activeProject.color || "#6366F1"}
                                onChange={(e) => {
                                    updateProject(activeProject.id, {
                                        color: e.target.value,
                                    });
                                    play("pressSide");
                                }}
                                className="absolute inset-0 cursor-pointer opacity-0"
                                title="Change project color"
                            />
                            <span aria-hidden className="h-5 w-5 rounded-full border border-neutral-800" style={{ background: activeProject.color }} />
                        </label>
                    </div>
                    <div className="space-y-3 border-t border-neutral-800 pt-3">
                        <div className="flex items-center justify-between gap-2">
                            <div>
                                <p className="text-[10px] uppercase tracking-wide text-neutral-500">Workable hours</p>
                                <p className="mt-0.5 text-[11px] text-neutral-300">{formatScheduleTime(activeProject.workableStart)} – {formatScheduleTime(activeProject.workableEnd)}</p>
                            </div>
                            <svg aria-hidden viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4 text-indigo-400">
                                <circle cx="10" cy="10" r="7" />
                                <path strokeLinecap="round" d="M10 6v4l2.5 1.5" />
                            </svg>
                        </div>
                        <div className="flex items-end gap-2">
                            <ScheduleTimeSelect
                                label="Start"
                                value={activeProject.workableStart}
                                options={[...new Set([...TIME_OPTIONS.filter((time) => time < activeProject.workableEnd), activeProject.workableStart])].sort()}
                                onChange={(workableStart) => updateProject(activeProject.id, { workableStart })}
                            />
                            <span aria-hidden className="pb-2.5 text-neutral-600">→</span>
                            <ScheduleTimeSelect
                                label="End"
                                value={activeProject.workableEnd}
                                options={[...new Set([...TIME_OPTIONS.filter((time) => time > activeProject.workableStart), activeProject.workableEnd])].sort()}
                                onChange={(workableEnd) => updateProject(activeProject.id, { workableEnd })}
                            />
                        </div>
                        <div>
                            <p className="mb-1 text-[10px] text-neutral-400">Workable weekdays</p>
                            <div className="grid grid-cols-7 gap-1">
                                {WEEKDAYS.map((day) => {
                                    const selected = activeProject.workableDays.includes(day.value);
                                    return (
                                        <button key={day.name} type="button" aria-label={day.name} aria-pressed={selected} title={day.name} onClick={() => {
                                            const next = selected ? activeProject.workableDays.filter((value) => value !== day.value) : [...activeProject.workableDays, day.value];
                                            if (next.length > 0) updateProject(activeProject.id, { workableDays: next });
                                        }} className={`rounded py-1 text-[10px] font-semibold transition ${selected ? "bg-indigo-600 text-white" : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"}`}>
                                            {day.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-[11px]">
                        <button
                            onMouseEnter={() => play("hover")}
                            className="rounded bg-neutral-800 px-2 py-1.5 font-medium text-neutral-100 transition hover:bg-neutral-700"
                            onClick={() => {
                                const name = prompt("Rename project", activeProject.name);
                                if (name && name.trim()) {
                                    updateProject(activeProject.id, {
                                        name: name.trim(),
                                    });
                                    play("pressSide");
                                }
                            }}
                        >
                            Rename
                        </button>
                        <button
                            onMouseEnter={() => play("hover")}
                            className="rounded bg-neutral-800 px-2 py-1.5 font-medium text-neutral-100 transition hover:bg-neutral-700"
                            title={activeProject.isArchived ? "Unarchive project" : "Archive project"}
                            onClick={() => {
                                updateProject(activeProject.id, {
                                    isArchived: !activeProject.isArchived,
                                });
                                play("pressSide");
                            }}
                        >
                            {activeProject.isArchived ? "Unarchive" : "Archive"}
                        </button>
                        <button
                            onMouseEnter={() => play("hover")}
                            className="rounded bg-red-700 px-2 py-1.5 font-medium text-white transition hover:bg-red-600"
                            onClick={() => {
                                const tasksCount = Object.values(state.tasks).filter((t) => t.projectId === activeProject.id && !t.isArchived).length;
                                const ok = confirm(`Delete project "${activeProject.name}"${tasksCount ? ` and ${tasksCount} linked task(s)` : ""}? This cannot be undone.`);
                                if (ok) {
                                    deleteProject(activeProject.id);
                                    play("pressSide");
                                }
                            }}
                        >
                            Delete
                        </button>
                    </div>
                </div>
            )}
            <div className="mb-3 space-y-1 text-xs">
                <span className="text-[10px] uppercase tracking-wide text-neutral-500">Search projects</span>
                <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-neutral-500">
                        <svg aria-hidden viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3.5 w-3.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M11.5 11.5L15 15" />
                            <circle cx="8.5" cy="8.5" r="4.75" />
                        </svg>
                    </span>
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Find a project..."
                        aria-label="Search projects"
                        className="w-full rounded bg-neutral-900 py-1.5 pl-7 pr-2 text-xs outline-none transition focus:bg-neutral-800 focus:ring-1 focus:ring-indigo-500"
                    />
                </div>
            </div>
            <div className="flex-1 overflow-y-auto pr-1 space-y-1 text-xs">
                {filtered.length === 0 && projects.length === 0 && (
                    <EmptyState
                        title="Create your first project"
                        action={
                            <button
                                onClick={() => {
                                    if (!showCreateForm) openCreateForm();
                                }}
                                className="text-xs underline"
                            >
                                New Project
                            </button>
                        }
                    />
                )}
                {filtered.map((p) => {
                    const tasks = Object.values(state.tasks).filter((t) => t.projectId === p.id && !t.isArchived);
                    const done = tasks.filter((t) => t.status === "Done").length;
                    const progress = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
                    return (
                        <button
                            onMouseEnter={() => play("hover")}
                            key={p.id}
                            onClick={() => {
                                setFilters({ selectedProjectIds: [p.id] });
                                play("pressSide");
                                onSelectProject?.();
                            }}
                            className={`w-full text-left px-2 py-1.5 rounded hover:bg-neutral-800 focus:bg-neutral-800 group ${activeProjectId === p.id ? "bg-neutral-800" : ""}`}
                        >
                            <div className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full" style={{ background: p.color }} />
                                <span className="flex-1 truncate">{p.name}</span>
                                <span className="text-[10px] opacity-60">
                                    {done}/{tasks.length}
                                </span>
                            </div>
                            <div className="h-1 w-full bg-neutral-700 rounded mt-1 overflow-hidden">
                                <div className="h-full bg-neutral-400" style={{ width: progress + "%" }} />
                            </div>
                        </button>
                    );
                })}
                {archived.length > 0 && (
                    <div className="mt-3">
                        <button onMouseEnter={() => play("hover")} className="text-[10px] uppercase tracking-wide opacity-60" onClick={() => setShowArchived((s) => !s)}>
                            {showArchived ? "Hide" : "Show"} Archived ({archived.length})
                        </button>
                        {showArchived && (
                            <div className="mt-1 space-y-1">
                                {archived.map((p) => (
                                    <div key={p.id} className="px-2 py-1 rounded bg-neutral-900/40 text-neutral-500 flex items-center gap-2">
                                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: p.color }} />
                                        <span className="flex-1 truncate">{p.name}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
