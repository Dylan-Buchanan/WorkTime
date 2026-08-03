import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { SyncProvider, useSync } from "./SyncContext";
import { DataProvider } from "./DataContext";
import { TauriCloseProvider } from "./TauriCloseContext";
import { InMemoryDataAccess } from "../lib/data/InMemoryDataAccess";
import { stagingKey } from "../lib/data/staging/LocalStagingStore";
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

function Probe() {
    const ctx = useSync();
    return (
        <div>
            <div data-testid="status">{ctx.status}</div>
            <div data-testid="error-kind">{ctx.errorKind ?? "none"}</div>
            <div data-testid="pending">{ctx.pendingCount}</div>
            <div data-testid="revision">{ctx.revision}</div>
            <div data-testid="banner">{ctx.showUnsyncedBanner ? "yes" : "no"}</div>
            <button onClick={() => { void ctx.sync({ reason: "manual" }).catch(() => undefined); }}>sync-manual</button>
            <button onClick={ctx.dismissUnsyncedBanner}>dismiss</button>
        </div>
    );
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

afterEach(() => {
    delete (document as unknown as { visibilityState?: string }).visibilityState;
});

describe("SyncContext lifecycle triggers", () => {
    it("re-enables manual sync after a hung coordinator watchdog", async () => {
        vi.useFakeTimers();
        const gate = deferred();
        const data = new InMemoryDataAccess(makeAppState(), { onSync: () => gate.promise });
        render(wrap(data, <Probe />));

        expect(screen.getByTestId("status")).toHaveTextContent("syncing");
        act(() => vi.advanceTimersByTime(60_000));
        expect(screen.getByTestId("status")).toHaveTextContent("error");
        expect(screen.getByText("sync-manual")).not.toBeDisabled();

        await act(async () => {
            gate.resolve(undefined);
        });
        vi.useRealTimers();
    });

    it("bootstraps a sync on authenticated mount", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        render(wrap(data, <Probe />));
        await waitFor(() => expect(data.syncCalls.some((c) => c.reason === "bootstrap")).toBe(true));
    });

    it("syncs on window focus", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        render(wrap(data, <Probe />));
        await waitFor(() => expect(data.syncCalls.some((c) => c.reason === "bootstrap")).toBe(true));
        const before = data.syncCalls.length;
        act(() => window.dispatchEvent(new Event("focus")));
        await waitFor(() => expect(data.syncCalls.length).toBe(before + 1));
        expect(data.syncCalls[data.syncCalls.length - 1].reason).toBe("focus");
    });

    it("syncs only when the document becomes visible", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        render(wrap(data, <Probe />));
        await waitFor(() => expect(data.syncCalls.some((c) => c.reason === "bootstrap")).toBe(true));

        Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
        const beforeHidden = data.syncCalls.length;
        act(() => document.dispatchEvent(new Event("visibilitychange")));
        expect(data.syncCalls.length).toBe(beforeHidden);

        Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
        const beforeVisible = data.syncCalls.length;
        act(() => document.dispatchEvent(new Event("visibilitychange")));
        await waitFor(() => expect(data.syncCalls.length).toBe(beforeVisible + 1));
        expect(data.syncCalls[data.syncCalls.length - 1].reason).toBe("visibility");
    });

    it("registers pagehide for web builds as best effort", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        render(wrap(data, <Probe />));
        await waitFor(() => expect(data.syncCalls.some((c) => c.reason === "bootstrap")).toBe(true));
        const before = data.syncCalls.length;
        act(() => window.dispatchEvent(new Event("pagehide")));
        expect(data.syncCalls.length).toBe(before + 1);
        expect(data.syncCalls[data.syncCalls.length - 1]).toEqual({ reason: "pagehide", bestEffort: true });
    });

    it("does not register pagehide inside Tauri", async () => {
        vi.mocked(isTauri).mockReturnValue(true);
        const data = new InMemoryDataAccess(makeAppState());
        render(wrap(data, <Probe />));
        await waitFor(() => expect(data.syncCalls.some((c) => c.reason === "bootstrap")).toBe(true));
        const before = data.syncCalls.length;
        act(() => window.dispatchEvent(new Event("pagehide")));
        expect(data.syncCalls.length).toBe(before);
    });
});

describe("SyncContext cross-tab storage", () => {
    it("reloads local views on a matching owner storage event without calling sync", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        render(wrap(data, <Probe />));
        await waitFor(() => expect(data.syncCalls.some((c) => c.reason === "bootstrap")).toBe(true));
        const before = data.syncCalls.length;
        act(() => {
            window.dispatchEvent(new StorageEvent("storage", { key: stagingKey(OWNER), newValue: "{}" }));
        });
        await waitFor(() => expect(screen.getByTestId("revision")).toHaveTextContent("1"));
        expect(data.syncCalls.length).toBe(before);
    });

    it("ignores storage events for other owners", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        render(wrap(data, <Probe />));
        await waitFor(() => expect(data.syncCalls.some((c) => c.reason === "bootstrap")).toBe(true));
        const before = data.syncCalls.length;
        act(() => {
            window.dispatchEvent(new StorageEvent("storage", { key: stagingKey("other-owner"), newValue: "{}" }));
        });
        expect(screen.getByTestId("revision")).toHaveTextContent("0");
        expect(data.syncCalls.length).toBe(before);
    });

    it("reloads only the current local view on a localStorage clear without calling sync", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        render(wrap(data, <Probe />));
        await waitFor(() => expect(data.syncCalls.some((c) => c.reason === "bootstrap")).toBe(true));
        const before = data.syncCalls.length;
        act(() => {
            window.dispatchEvent(new StorageEvent("storage", { key: null, newValue: null }));
        });
        await waitFor(() => expect(screen.getByTestId("revision")).toHaveTextContent("1"));
        expect(data.syncCalls.length).toBe(before);
    });
});

describe("SyncContext pending state and banner", () => {
    it("tracks a local edit as pending and leaves the success state for a new edit", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        render(wrap(data, <Probe />));
        await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("success"));
        await act(async () => {
            await data.createTask("New", 1);
        });
        await waitFor(() => expect(screen.getByTestId("pending")).toHaveTextContent("1"));
        expect(screen.getByTestId("status")).toHaveTextContent("idle");
    });

    it("shows the previous-visit banner and clears it after a successful clean sync", async () => {
        const gate = deferred();
        const data = new InMemoryDataAccess(makeAppState(), { onSync: () => gate.promise });
        await data.createTask("Previous", 1);
        render(wrap(data, <Probe />));
        expect(screen.getByTestId("banner")).toHaveTextContent("yes");
        await act(async () => {
            gate.resolve(undefined);
        });
        await waitFor(() => expect(screen.getByTestId("banner")).toHaveTextContent("no"));
        expect(screen.getByTestId("pending")).toHaveTextContent("0");
    });

    it("keeps the previous-visit banner when a successful sync still leaves work pending", async () => {
        const data = new InMemoryDataAccess(makeAppState(), { pendingAfterSync: 2 });
        await data.createTask("Previous", 1);
        render(wrap(data, <Probe />));
        expect(screen.getByTestId("banner")).toHaveTextContent("yes");
        await waitFor(() => expect(data.syncCalls.some((c) => c.reason === "bootstrap")).toBe(true));
        // A sync that succeeds while residual completion work stays pending must
        // not retire the backstop banner or clear the reported pending count.
        await waitFor(() => expect(screen.getByTestId("pending")).toHaveTextContent("2"));
        expect(screen.getByTestId("banner")).toHaveTextContent("yes");
    });

    it("stays hidden on a clean store", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        render(wrap(data, <Probe />));
        await waitFor(() => expect(data.syncCalls.some((c) => c.reason === "bootstrap")).toBe(true));
        expect(screen.getByTestId("banner")).toHaveTextContent("no");
    });

    it("dismisses without clearing staged data and is not re-shown by current-visit edits", async () => {
        const gate = deferred();
        const data = new InMemoryDataAccess(makeAppState(), { onSync: () => gate.promise });
        await data.createTask("Previous", 1);
        render(wrap(data, <Probe />));
        expect(screen.getByTestId("banner")).toHaveTextContent("yes");
        act(() => screen.getByText("dismiss").click());
        expect(screen.getByTestId("banner")).toHaveTextContent("no");
        await act(async () => {
            await data.createTask("Later", 1);
        });
        expect(screen.getByTestId("banner")).toHaveTextContent("no");
        expect(screen.getByTestId("pending")).toHaveTextContent("2");
    });
});
