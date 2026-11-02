import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import App from "./App";
import { InMemoryDataAccess } from "./lib/data/InMemoryDataAccess";
import { makeAppState } from "./test/mockTauri";
import { createDefaultDataAccess } from "./lib/data/defaultDataAccess";

const auth = vi.hoisted(() => ({ session: { user: { id: "pet-route-owner" } } as { user: { id: string } } | null }));

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
