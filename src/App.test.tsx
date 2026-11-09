import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "./App";
import { InMemoryDataAccess } from "./lib/data/InMemoryDataAccess";
import { makeActiveTimer, makeAppState } from "./test/mockTauri";
import { createDefaultDataAccess } from "./lib/data/defaultDataAccess";

const auth = vi.hoisted(() => ({ session: { user: { id: "pet-route-owner" } } as { user: { id: string } } | null }));
const memoLifecycle = vi.hoisted(() => ({ mount: vi.fn(), unmount: vi.fn() }));

vi.mock("./state/ResumeMemoContext", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./state/ResumeMemoContext")>();
    return { ...actual, ResumeMemoProvider: ({ children }: { children: React.ReactNode }) => {
        React.useEffect(() => { memoLifecycle.mount(); return () => { memoLifecycle.unmount(); }; }, []);
        return <actual.ResumeMemoProvider>{children}</actual.ResumeMemoProvider>;
    } };
});

// Route-level test: /pet must render PetPage inside the authenticated shell
// and TopNav must expose a Pet link. Auth is stubbed so the shell mounts with
// a stable owner, and the production data graph is swapped for the in-memory
// implementation so no Supabase/staging store is needed.

vi.mock("./auth/AuthContext", () => ({
    AuthProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    useAuth: () => ({
        session: auth.session,
        loading: false,
        signOut: vi.fn(async () => {}),
    }),
}));

vi.mock("./lib/supabase", () => ({ supabase: {} }));

vi.mock("./lib/data/defaultDataAccess", () => ({
    createDefaultDataAccess: vi.fn(() => new InMemoryDataAccess(makeAppState())),
}));

beforeEach(() => { auth.session = { user: { id: "pet-route-owner" } }; vi.mocked(createDefaultDataAccess).mockClear(); });

describe("App resume memo lifecycle", () => {
    beforeEach(() => { memoLifecycle.mount.mockClear(); memoLifecycle.unmount.mockClear(); });

    it("keeps an empty card dismissed across TimerPanel route remounts until a different enter at", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        try {
            const at = "2026-11-09T14:00:00.000Z";
            vi.setSystemTime(new Date(at));
            const data = new InMemoryDataAccess(makeAppState({ active_task: "A", tasks: { A: {
                id: "A", name: "Route task", target_pomodoros: 2, completed_pomodoros: 0, completed_at: null,
                archived: false, break_skips: 0, created_at: at,
            } }, logs: [{ id: "history-A", task_id: "A", was_break: false, break_skipped: false,
                duration_minutes: 1, finished_at: at }],
            timer: makeActiveTimer({ task_id: "A", started_at: at, window_started_at: at,
                ends_at: "2026-11-09T14:25:00.000Z", paused: true, paused_remaining_secs: 1500 }) }));
            vi.mocked(createDefaultDataAccess).mockReturnValueOnce(data);
            window.history.pushState({}, "", "/");
            render(<App />);
            fireEvent.click(await screen.findByRole("button", { name: "Resume" }));
            const card = await screen.findByRole("region", { name: "Resume Route task" });
            fireEvent.click(within(card).getByRole("button", { name: "Dismiss" }));
            expect(screen.queryByRole("region", { name: "Resume Route task" })).toBeNull();
            fireEvent.click(screen.getByRole("link", { name: "Goals" }));
            await screen.findByRole("heading", { name: "Goals" });
            fireEvent.click(screen.getByRole("link", { name: "Timer" }));
            await screen.findByRole("button", { name: "Pause" });
            expect(screen.queryByRole("region", { name: "Resume Route task" })).toBeNull();
            expect(memoLifecycle.mount).toHaveBeenCalledOnce();
            fireEvent.click(screen.getByRole("button", { name: "Pause" }));
            fireEvent.keyDown(await screen.findByRole("dialog"), { key: "Escape" });
            vi.setSystemTime(new Date("2026-11-09T14:00:01.000Z"));
            fireEvent.click(screen.getByRole("button", { name: "Resume" }));
            expect(await screen.findByRole("region", { name: "Resume Route task" })).toHaveTextContent("No note from your last exit");
        } finally { vi.useRealTimers(); }
    });

    it("holds a TaskPanel switch memo until the mobile Tasks and settings drawer closes", async () => {
        const media = vi.spyOn(window, "matchMedia").mockImplementation(query => ({
            matches: false, media: query, onchange: null, addListener() {}, removeListener() {},
            addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
        }));
        const oldWidth = window.innerWidth;
        window.innerWidth = 375;
        const now = Date.now();
        const started = new Date(now - 60_000).toISOString();
        const data = new InMemoryDataAccess(makeAppState({ active_task: "A", tasks: Object.fromEntries(
            ["A", "B"].map(id => [id, { id, name: `Drawer task ${id}`, target_pomodoros: 2,
                completed_pomodoros: 0, completed_at: null, archived: false, break_skips: 0, created_at: started }]),
        ), timer: makeActiveTimer({ task_id: "A", started_at: started, window_started_at: started,
            ends_at: new Date(now + 1_440_000).toISOString() }) }));
        vi.mocked(createDefaultDataAccess).mockReturnValueOnce(data);
        window.history.pushState({}, "", "/");
        const observed: number[] = [];
        const observer = new MutationObserver(() => observed.push(document.querySelectorAll('[role="dialog"][aria-modal="true"]').length));
        try {
            const view = render(<App />);
            observer.observe(view.container, { childList: true, subtree: true });
            await screen.findByRole("button", { name: "Pause" });
            fireEvent.click(screen.getByRole("button", { name: "Tasks & Settings" }));
            const drawer = screen.getByRole("dialog", { name: "Tasks and settings" });
            fireEvent.click(await within(drawer).findByText("Drawer task B (0/2)"));
            await waitFor(() => expect(data.store.state.timer?.task_id).toBe("B"));
            // Flush the provider's scheduled presentation while the drawer holds it.
            await act(async () => { await new Promise<void>(resolve => setTimeout(resolve, 10)); });
            expect(screen.getAllByRole("dialog")).toEqual([drawer]);
            fireEvent.click(within(drawer).getByRole("button", { name: "Close" }));
            const memo = await screen.findByRole("dialog", { name: "What were you doing in Drawer task A?" });
            expect(screen.getAllByRole("dialog")).toEqual([memo]);
            expect(observed.length).toBeGreaterThan(0);
            expect(observed.every(count => count <= 1)).toBe(true);
        } finally {
            observer.disconnect(); media.mockRestore(); window.innerWidth = oldWidth;
        }
    });

    it("keeps the authenticated memo provider and its draft mounted across route changes", async () => {
        const data = new InMemoryDataAccess(makeAppState({ active_task: "A", tasks: { A: {
            id: "A", name: "Route task", target_pomodoros: 2, completed_pomodoros: 0, completed_at: null,
            archived: false, break_skips: 0, created_at: new Date().toISOString(),
        } }, timer: makeActiveTimer({ task_id: "A" }) }));
        vi.mocked(createDefaultDataAccess).mockReturnValueOnce(data);
        window.history.pushState({}, "", "/");
        const view = render(<App />);
        fireEvent.click(await screen.findByRole("button", { name: "Pause" }));
        const dialog = await screen.findByRole("dialog", { name: "What were you doing in Route task?" });
        fireEvent.change(screen.getByLabelText("Where I am"), { target: { value: "Survive navigation" } });
        fireEvent.click(screen.getByRole("link", { name: "Goals" }));
        await screen.findByRole("heading", { name: "Goals" });
        expect(screen.getByRole("dialog")).toBe(dialog);
        expect(screen.getByLabelText("Where I am")).toHaveValue("Survive navigation");
        expect(memoLifecycle.mount).toHaveBeenCalledOnce();
        expect(memoLifecycle.unmount).not.toHaveBeenCalled();
        view.unmount();
        expect(memoLifecycle.unmount).toHaveBeenCalledOnce();
    });

    it.each([["/login", "Sign in"], ["/signup", "Create an account"], ["/reset-password", "Reset link unavailable"], ["/", "Sign in"]])(
        "never mounts a memo provider or data graph on public/unauthenticated %s", async (path, heading) => {
            auth.session = null;
            window.history.pushState({}, "", path);
            render(<App />);
            await screen.findByRole("heading", { name: heading });
            expect(memoLifecycle.mount).not.toHaveBeenCalled();
            expect(createDefaultDataAccess).not.toHaveBeenCalled();
            expect(screen.queryByRole("dialog")).toBeNull();
        },
    );
});

describe("App theme bootstrap", () => {
    it("applies the stored theme at the document root for a public auth route", async () => {
        localStorage.setItem("worktime:theme:v1", "light");
        auth.session = null;
        window.history.pushState({}, "", "/login");
        render(<App />);

        expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
        await waitFor(() => expect(document.documentElement).toHaveAttribute("data-theme", "light"));
    });

    it("falls back to Dark at the document root when no preference is stored", async () => {
        auth.session = null;
        window.history.pushState({}, "", "/login");
        render(<App />);

        expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
        await waitFor(() => expect(document.documentElement).toHaveAttribute("data-theme", "dark"));
    });
});

describe("App /pet routing", () => {
    it("registers the lazy /pet route behind the authenticated shell", async () => {
        window.history.pushState({}, "", "/pet");
        render(<App />);

        await waitFor(() => expect(screen.getByRole("heading", { name: /pet care/i })).toBeInTheDocument());
        expect(screen.getByRole("tab", { name: "Today" })).toBeInTheDocument();
        await waitFor(() => expect(screen.getByRole("button", { name: "🚽 Potty" })).toBeInTheDocument());
    });

    it("links /pet from the top navigation", async () => {
        window.history.pushState({}, "", "/");
        render(<App />);

        const petLink = await screen.findByRole("link", { name: "Pet" });
        expect(petLink).toHaveAttribute("href", "/pet");
    });
});

describe("App /goals routing", () => {
    it("registers the lazy goals page and nav inside the authenticated provider graph", async () => {
        const load = vi.spyOn(InMemoryDataAccess.prototype, "loadGoals");
        window.history.pushState({}, "", "/goals");
        render(<App />);
        expect(await screen.findByRole("heading", { name: "Goals" })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Goals" })).toHaveAttribute("href", "/goals");
        await waitFor(() => expect(screen.getByRole("button", { name: "Add tracker" })).toBeEnabled());
        expect(load).toHaveBeenCalled();
    });

    it.each([
        ["/login", "Sign in"],
        ["/signup", "Create an account"],
        ["/reset-password", "Reset link unavailable"],
        ["/goals", "Sign in"],
    ])("never constructs authenticated data or reads goals for public/unauthenticated %s", async (path, heading) => {
        auth.session = null;
        const load = vi.spyOn(InMemoryDataAccess.prototype, "loadGoals");
        window.history.pushState({}, "", path);
        render(<App />);
        expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
        expect(createDefaultDataAccess).not.toHaveBeenCalled();
        expect(load).not.toHaveBeenCalled();
        expect(screen.queryByRole("link", { name: "Goals" })).not.toBeInTheDocument();
    });
});
