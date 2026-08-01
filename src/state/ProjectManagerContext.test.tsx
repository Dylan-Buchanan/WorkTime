import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { ProjectManagerProvider, usePM } from "./ProjectManagerContext";
import { AppStateProvider } from "./AppStateContext";
import StateSyncBridge from "./StateSyncBridge";
import { makeAppState } from "../test/mockTauri";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

function PMProbe() {
    const { state, createProject, createTask, quickAddParse } = usePM();
    return (
        <div>
            <div data-testid="project-count">{Object.keys(state.projects).length}</div>
            <div data-testid="task-count">{Object.keys(state.tasks).length}</div>
            <div data-testid="hydrated">{state.meta.initializedAt.length > 0 ? "yes" : "no"}</div>
            <button
                onClick={() => {
                    const p = createProject("Alpha");
                    createTask("First task", { projectId: p.id });
                }}
            >
                add
            </button>
            <button onClick={() => createTask("Quick task", { ...quickAddParse("Quick task #dev 2p").task })}>quick</button>
        </div>
    );
}

function wrap(children: React.ReactNode) {
    return (
        <AppStateProvider>
            <ProjectManagerProvider>
                <StateSyncBridge />
                {children}
            </ProjectManagerProvider>
        </AppStateProvider>
    );
}

function mockBackendWithCreate() {
    invokeMock.mockImplementation(async (cmd: string, args?: any) => {
        switch (cmd) {
            case "get_state":
                return makeAppState();
            case "create_task":
                return {
                    id: "created-" + Math.random().toString(36).slice(2),
                    name: args?.payload?.name ?? "Untitled",
                    target_pomodoros: args?.payload?.target_pomodoros ?? 1,
                    completed_pomodoros: 0,
                    created_at: new Date().toISOString(),
                    completed_at: null,
                    break_skips: 0,
                    archived: false,
                };
            case "set_active_task":
                return undefined;
            case "set_task_target":
                return undefined;
            default:
                throw new Error("unexpected command " + cmd);
        }
    });
}

beforeEach(() => {
    invokeMock.mockReset();
    localStorage.clear();
});

describe("ProjectManagerContext (browser path)", () => {
    it("hydrates a default state and persists to localStorage", async () => {
        invokeMock.mockImplementation(async (cmd: string) => {
            if (cmd === "get_state") return makeAppState();
            throw new Error("unexpected command " + cmd);
        });

        render(wrap(<PMProbe />));

        await waitFor(() => expect(screen.getByTestId("project-count")).toHaveTextContent("1"));
        expect(localStorage.getItem("pm_state_v1")).toBeTruthy();
    });

    it("restores state from localStorage", async () => {
        invokeMock.mockImplementation(async (cmd: string) => (cmd === "get_state" ? makeAppState() : undefined));
        localStorage.setItem(
            "pm_state_v1",
            JSON.stringify({
                projects: {
                    p1: {
                        id: "p1",
                        name: "Restored",
                        color: "#fff",
                        isArchived: false,
                        sortOrder: 0,
                        createdAt: "2026-01-01T00:00:00Z",
                        updatedAt: "2026-01-01T00:00:00Z",
                    },
                },
                tasks: {},
                ui: {},
                meta: { initializedAt: "2026-01-01T00:00:00Z" },
            })
        );

        render(wrap(<PMProbe />));

        await waitFor(() => {
            expect(screen.getByTestId("project-count")).toHaveTextContent("1");
        });
        const restored = JSON.parse(localStorage.getItem("pm_state_v1")!);
        expect(Object.values(restored.projects)[0].name).toBe("Restored");
    });

    it("createProject and createTask update state", async () => {
        mockBackendWithCreate();

        render(wrap(<PMProbe />));
        await waitFor(() => expect(screen.getByTestId("hydrated")).toHaveTextContent("yes"));

        await act(async () => {
            screen.getByText("add").click();
        });

        expect(screen.getByTestId("project-count")).toHaveTextContent("2");
        expect(screen.getByTestId("task-count")).toHaveTextContent("1");
    });

    it("createTask falls back to a General project when none selected", async () => {
        mockBackendWithCreate();

        render(wrap(<PMProbe />));
        await waitFor(() => expect(screen.getByTestId("hydrated")).toHaveTextContent("yes"));

        await act(async () => {
            screen.getByText("quick").click();
        });

        expect(screen.getByTestId("task-count")).toHaveTextContent("1");
    });
});

describe("StateSyncBridge", () => {
    it("creates PM metadata for backend tasks", async () => {
        invokeMock.mockImplementation(async (cmd: string) => {
            if (cmd === "get_state") {
                return makeAppState({
                    tasks: {
                        bt1: {
                            id: "bt1",
                            name: "Synced task",
                            target_pomodoros: 4,
                            completed_pomodoros: 0,
                            created_at: "2026-01-01T00:00:00Z",
                            completed_at: null,
                            break_skips: 0,
                            archived: false,
                        },
                    },
                });
            }
            if (cmd === "set_task_target") return undefined;
            throw new Error("unexpected command " + cmd);
        });

        render(wrap(<PMProbe />));

        await waitFor(() => expect(screen.getByTestId("task-count")).toHaveTextContent("1"));
        const stored = JSON.parse(localStorage.getItem("pm_state_v1")!);
        const pmTask = Object.values(stored.tasks as any)[0] as any;
        expect(pmTask.appTaskId).toBe("bt1");
        expect(pmTask.title).toBe("Synced task");
        expect(pmTask.estimatePomos).toBe(4);
    });

    it("marks PM tasks Done when the backend task completes", async () => {
        invokeMock.mockImplementation(async (cmd: string) => {
            if (cmd === "get_state") {
                return makeAppState({
                    tasks: {
                        bt1: {
                            id: "bt1",
                            name: "Done task",
                            target_pomodoros: 2,
                            completed_pomodoros: 2,
                            created_at: "2026-01-01T00:00:00Z",
                            completed_at: "2026-01-05T00:00:00Z",
                            break_skips: 0,
                            archived: false,
                        },
                    },
                });
            }
            if (cmd === "set_task_target") return undefined;
            throw new Error("unexpected command " + cmd);
        });

        // Seed PM state with a linked-but-not-Done task so the bridge can flip it.
        localStorage.setItem(
            "pm_state_v1",
            JSON.stringify({
                projects: {
                    p1: {
                        id: "p1",
                        name: "P",
                        color: "#fff",
                        isArchived: false,
                        sortOrder: 0,
                        createdAt: "2026-01-01T00:00:00Z",
                        updatedAt: "2026-01-01T00:00:00Z",
                    },
                },
                tasks: {
                    pt1: {
                        id: "pt1",
                        title: "Done task",
                        projectId: "p1",
                        status: "In Progress",
                        priority: "Medium",
                        timeSpentMinutes: 0,
                        workedPomos: 0,
                        tags: [],
                        links: [],
                        checklist: [],
                        sortOrder: 0,
                        isArchived: false,
                        createdAt: "2026-01-01T00:00:00Z",
                        updatedAt: "2026-01-01T00:00:00Z",
                        appTaskId: "bt1",
                        relatedTo: [],
                    },
                },
                ui: {},
                meta: {},
            })
        );

        render(wrap(<PMProbe />));

        await waitFor(() => {
            const stored = JSON.parse(localStorage.getItem("pm_state_v1")!);
            expect(stored.tasks.pt1.status).toBe("Done");
        });
    });
});
