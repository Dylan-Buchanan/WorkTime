import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
