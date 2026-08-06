import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SyncControls, UnsyncedBanner } from "./SyncControls";
import { SyncProvider } from "../state/SyncContext";
import { DataProvider } from "../state/DataContext";
import { TauriCloseProvider } from "../state/TauriCloseContext";
import { InMemoryDataAccess } from "../lib/data/InMemoryDataAccess";
import { DataAccessAuthError } from "../lib/data/DataAccess";
import { makeAppState } from "../test/mockTauri";
import { isTauri } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: vi.fn() }));

const OWNER = "owner-1";

function deferred<T = void>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

function wrap(data: InMemoryDataAccess, children: React.ReactNode) {
    return (
        <TauriCloseProvider>
            <DataProvider dataAccess={data}><SyncProvider ownerId={OWNER}>{children}</SyncProvider></DataProvider>
        </TauriCloseProvider>
    );
}

beforeEach(() => {
    vi.mocked(isTauri).mockReset();
    vi.mocked(isTauri).mockReturnValue(false);
});

describe("SyncControls", () => {
    it("calls sync({ reason: \"manual\" }) when clicked", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        render(wrap(data, <SyncControls />));
        await waitFor(() => expect(screen.getByTestId("sync-status")).toHaveTextContent("Synced"));
        const button = screen.getByRole("button", { name: /sync data/i });
        act(() => button.click());
        await waitFor(() => expect(data.syncCalls.some((c) => c.reason === "manual")).toBe(true));
    });

    it("shows a pending badge and disables while syncing", async () => {
        const gate = deferred();
        const data = new InMemoryDataAccess(makeAppState(), { onSync: () => gate.promise });
        await data.createTask("Pending", 1);
        render(wrap(data, <SyncControls />));
        const button = screen.getByRole("button", { name: /sync data/i });
        expect(screen.getByTestId("pending-badge")).toHaveTextContent("1");
        expect(button).toBeDisabled();
        await act(async () => {
            gate.resolve(undefined);
        });
        await waitFor(() => expect(button).not.toBeDisabled());
    });

    it("shows the success live-region text after a clean sync", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        render(wrap(data, <SyncControls />));
        await waitFor(() => expect(screen.getByTestId("sync-status")).toHaveTextContent("Synced"));
    });

    it("shows an ordinary sync error without implying data loss", async () => {
        const data = new InMemoryDataAccess(makeAppState(), {
            onSync: () => {
                throw new Error("network down");
            },
        });
        render(wrap(data, <SyncControls />));
        await waitFor(() => expect(screen.getByTestId("sync-status")).toHaveTextContent(/Sync failed/i));
        expect(screen.getByTestId("sync-status")).toHaveTextContent(/your local changes are safe/i);
    });

    it("shows auth-specific copy that asks to reauthenticate", async () => {
        const data = new InMemoryDataAccess(makeAppState(), {
            onSync: () => {
                throw new DataAccessAuthError("DATA_ACCESS_NO_SESSION");
            },
        });
        render(wrap(data, <SyncControls />));
        await waitFor(() => expect(screen.getByTestId("sync-status")).toHaveTextContent(/reauthenticate/i));
        expect(screen.getByTestId("sync-status")).toHaveTextContent(/your local changes are safe/i);
    });

    it("retries from an error state", async () => {
        let attempts = 0;
        const data = new InMemoryDataAccess(makeAppState(), {
            onSync: () => {
                attempts += 1;
                if (attempts === 1) throw new Error("network down");
            },
        });
        render(wrap(data, <SyncControls />));
        await waitFor(() => expect(screen.getByTestId("sync-status")).toHaveTextContent(/Sync failed/i));
        const button = screen.getByRole("button", { name: /sync data/i });
        act(() => button.click());
        await waitFor(() => expect(screen.getByTestId("sync-status")).toHaveTextContent("Synced"));
    });

    it("requires typed confirmation before deleting staged changes", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        render(wrap(data, <SyncControls />));
        await waitFor(() => expect(screen.getByTestId("sync-status")).toHaveTextContent("Synced"));
        await act(async () => {
            await data.createTask("Pending", 1);
        });

        const openButton = screen.getByRole("button", { name: "Delete Changes" });
        expect(openButton).toBeEnabled();
        act(() => openButton.click());

        const dialog = screen.getByRole("dialog", { name: "Delete staged changes?" });
        const deleteButton = screen.getAllByRole("button", { name: "Delete Changes" })[1];
        expect(dialog).toBeInTheDocument();
        expect(deleteButton).toBeDisabled();

        fireEvent.change(screen.getByLabelText("Confirmation"), { target: { value: "confirm" } });
        expect(deleteButton).toBeEnabled();
        await act(async () => deleteButton.click());

        expect(screen.queryByRole("dialog", { name: "Delete staged changes?" })).not.toBeInTheDocument();
        expect(data.pendingCount()).toBe(0);
        expect(data.store.state.tasks).toEqual(makeAppState().tasks);
        expect(openButton).toBeDisabled();
    });

    it("cancels deletion without removing staged changes", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        render(wrap(data, <SyncControls />));
        await waitFor(() => expect(screen.getByTestId("sync-status")).toHaveTextContent("Synced"));
        await act(async () => {
            await data.createTask("Pending", 1);
        });

        act(() => screen.getByRole("button", { name: "Delete Changes" }).click());
        expect(screen.getByRole("dialog").parentElement).toBe(document.body);
        act(() => screen.getByRole("button", { name: "Cancel" }).click());

        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(data.pendingCount()).toBe(1);
    });
});

describe("UnsyncedBanner", () => {
    it("renders nothing on a clean store", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        render(wrap(data, <UnsyncedBanner />));
        await waitFor(() => expect(data.syncCalls.some((c) => c.reason === "bootstrap")).toBe(true));
        expect(screen.queryByTestId("unsynced-banner")).not.toBeInTheDocument();
    });

    it("syncs on demand and dismisses without clearing staged data", async () => {
        const gate = deferred();
        const data = new InMemoryDataAccess(makeAppState(), { onSync: () => gate.promise });
        await data.createTask("Pending", 1);
        render(wrap(data, <UnsyncedBanner />));
        expect(screen.getByTestId("unsynced-banner")).toBeInTheDocument();
        act(() => screen.getByText("Sync now").click());
        expect(data.syncCalls.some((c) => c.reason === "manual")).toBe(true);
        act(() => screen.getByText("Dismiss").click());
        expect(screen.queryByTestId("unsynced-banner")).not.toBeInTheDocument();
    });
});
