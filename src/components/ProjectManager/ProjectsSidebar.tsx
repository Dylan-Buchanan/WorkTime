import React, { useEffect, useRef, useState } from "react";
import { usePM } from "../../state/ProjectManagerContext";
import { useSounds } from "../../hooks/useSounds";
// import { SidebarProjectSkeleton } from './Skeletons';
import { EmptyState } from "./EmptyState";

const COLOR_PRESETS = ["#6366F1", "#EC4899", "#10B981", "#F59E0B", "#3B82F6", "#8B5CF6", "#EF4444", "#14B8A6"];

const getRandomPresetColor = () => COLOR_PRESETS[Math.floor(Math.random() * COLOR_PRESETS.length)];

export const ProjectsSidebar: React.FC = () => {
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
    };

    return (
        <div className="flex flex-col h-full">
            <div className="flex items-center gap-2 mb-2">
                <h2 className="text-sm font-semibold flex-1">Projects</h2>
                {activeProject && (
                    <div className="flex items-center gap-1">
                        <button
                            onMouseEnter={() => play("hover")}
                            className="text-[10px] px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600"
                            title="Rename project"
                            onClick={() => {
                                const name = prompt("Rename project", activeProject.name);
                                if (name && name.trim())
                                    updateProject(activeProject.id, {
                                        name: name.trim(),
                                    });
                                play("pressSide");
                            }}
                        >
                            Ren
                        </button>
                        <button
                            onMouseEnter={() => play("hover")}
                            className="text-[10px] px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600"
                            title={activeProject.isArchived ? "Unarchive" : "Archive"}
                            onClick={() =>
                                updateProject(activeProject.id, {
                                    isArchived: !activeProject.isArchived,
                                })
                            }
                        >
                            {activeProject.isArchived ? "UnArc" : "Arc"}
                        </button>
                        <button
                            onMouseEnter={() => play("hover")}
                            className="text-[10px] px-2 py-1 rounded bg-red-700 hover:bg-red-600"
                            title="Delete project"
                            onClick={() => {
                                if (!activeProject) return;
                                const tasksCount = Object.values(state.tasks).filter((t) => t.projectId === activeProject.id && !t.isArchived).length;
                                const ok = confirm(`Delete project "${activeProject.name}"${tasksCount ? ` and ${tasksCount} linked task(s)` : ""}? This cannot be undone.`);
                                if (ok) {
                                    deleteProject(activeProject.id);
                                    play("pressSide");
                                }
                            }}
                        >
                            Del
                        </button>
                    </div>
                )}
                {activeProject && (
                    <div className="flex items-center">
                        <label className="relative inline-flex items-center justify-center w-7 h-7 rounded-full border border-neutral-700 overflow-hidden">
                            <span className="sr-only">Project color</span>
                            <input
                                type="color"
                                value={activeProject.color || "#6366F1"}
                                onChange={(e) => {
                                    updateProject(activeProject.id, {
                                        color: e.target.value,
                                    });
                                    play("pressSide");
                                }}
                                className="absolute inset-0 opacity-0 cursor-pointer"
                                title="Change project color"
                            />
                            <span aria-hidden className="w-full h-full" style={{ background: activeProject.color }} />
                        </label>
                    </div>
                )}
                <button
                    onMouseEnter={() => play("hover")}
                    className="text-xs px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600"
                    onClick={() => {
                        if (showCreateForm) closeCreateForm();
                        else openCreateForm();
                    }}
                >
                    {showCreateForm ? "Close" : "+ New"}
                </button>
            </div>
            {showCreateForm && (
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        handleCreateProject();
                    }}
                    className="mb-2 text-xs space-y-3 rounded border border-neutral-800 bg-neutral-900 p-3"
                >
                    <div className="space-y-1">
                        <label className="block text-[10px] uppercase tracking-wide text-neutral-400">Project name</label>
                        <input
                            ref={nameInputRef}
                            value={newProjectName}
                            onChange={(e) => setNewProjectName(e.target.value)}
                            placeholder="Project name"
                            className="w-full rounded bg-neutral-800 px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                    </div>
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] uppercase tracking-wide text-neutral-400">Color</span>
                            <span className="text-[10px] text-neutral-500">{newProjectColor}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                            {COLOR_PRESETS.map((color) => (
                                <button
                                    key={color}
                                    type="button"
                                    onClick={() => setNewProjectColor(color)}
                                    className={`h-6 w-6 rounded-full border transition ${newProjectColor === color ? "border-white" : "border-transparent"}`}
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
                                    className="h-6 w-6 cursor-pointer rounded border border-neutral-700 bg-transparent p-0"
                                />
                            </label>
                        </div>
                    </div>
                    <div className="flex justify-end gap-2">
                        <button type="button" onClick={closeCreateForm} className="rounded bg-neutral-800 px-2 py-1 text-xs hover:bg-neutral-700">
                            Cancel
                        </button>
                        <button type="submit" className="rounded bg-indigo-600 px-2 py-1 text-xs text-white hover:bg-indigo-500" disabled={!newProjectName.trim()}>
                            Create
                        </button>
                    </div>
                </form>
            )}
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" className="mb-2 text-xs px-2 py-1 rounded bg-neutral-800 outline-none" />
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
                            }}
                            className={`w-full text-left px-2 py-1 rounded hover:bg-neutral-800 focus:bg-neutral-800 group ${activeProjectId === p.id ? "bg-neutral-800" : ""}`}
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
