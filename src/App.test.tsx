import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { Outlet } from "react-router-dom";
import App from "./App";
import { InMemoryDataAccess } from "./lib/data/InMemoryDataAccess";
import { makeAppState } from "./test/mockTauri";

// Route-level test: /pet must render PetPage inside the authenticated shell
// and TopNav must expose a Pet link. Auth is stubbed so the shell mounts with
// a stable owner, and the production data graph is swapped for the in-memory
// implementation so no Supabase/staging store is needed.

vi.mock("./auth/AuthContext", () => ({
    AuthProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    useAuth: () => ({
        session: { user: { id: "pet-route-owner" } },
        loading: false,
        signOut: vi.fn(async () => {}),
    }),
}));

vi.mock("./auth/RequireAuth", () => ({
    RequireAuth: () => <Outlet />,
    AuthLoading: () => null,
}));

vi.mock("./auth/RedirectIfAuthenticated", () => ({
    RedirectIfAuthenticated: () => <Outlet />,
}));

vi.mock("./lib/supabase", () => ({ supabase: {} }));

vi.mock("./lib/data/defaultDataAccess", () => ({
    createDefaultDataAccess: () => new InMemoryDataAccess(makeAppState()),
}));

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
