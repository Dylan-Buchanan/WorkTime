import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { TauriCloseProvider, useTauriClose, type CloseSyncHandler } from "./TauriCloseContext";
import { createTauriCloseAdapter, type TauriCloseAdapter } from "../lib/platform/tauriClose";

vi.mock("../lib/platform/tauriClose", () => ({
    createTauriCloseAdapter: vi.fn(),
}));

const mockedCreateAdapter = vi.mocked(createTauriCloseAdapter);

function createFakeAdapter() {
    const log: string[] = [];
    let handler: (() => void) | null = null;
    const unlisten = vi.fn(() => {
        log.push("unlisten");
    });
    const adapter: TauriCloseAdapter = {
        async listen(fn) {
            log.push("listen");
            handler = fn;
            return unlisten;
        },
        async signalReady() {
            log.push("ready");
        },
        async signalUnready() {
            log.push("unready");
        },
        async approveAndClose() {
            // Assertion target: approve must always precede close.
            log.push("approve");
            log.push("close");
        },
    };
    return { adapter, log, fire: () => handler?.() };
}

function createRejectingAdapter() {
    const log: string[] = [];
    const adapter: TauriCloseAdapter = {
        async listen() {
            log.push("listen");
            throw new Error("subscription failed");
        },
        async signalReady() {
            log.push("ready");
        },
        async signalUnready() {
            log.push("unready");
        },
        async approveAndClose() {
            log.push("approve");
            log.push("close");
        },
    };
    return { adapter, log };
}

function makeHandler(pending: number, syncForClose: () => Promise<number>) {
    const handler: CloseSyncHandler = {
        pendingCount: vi.fn(() => pending),
        syncForClose: vi.fn(syncForClose),
    };
    return { handler };
}

/** Registers the injected handler the way SyncProvider does while authenticated. */
function Registrar({ handler }: { handler: CloseSyncHandler }) {
    const { registerCloseSyncHandler, unregisterCloseSyncHandler } = useTauriClose();
    useEffect(() => {
        registerCloseSyncHandler(handler);
        return () => unregisterCloseSyncHandler();
    }, [handler, registerCloseSyncHandler, unregisterCloseSyncHandler]);
    return null;
}

function renderProvider(fake: ReturnType<typeof createFakeAdapter>, handler?: CloseSyncHandler) {
    mockedCreateAdapter.mockResolvedValue(fake.adapter);
    const result = render(
        <TauriCloseProvider>
            {handler && <Registrar handler={handler} />}
        </TauriCloseProvider>,
    );
    return result;
}

async function awaitListener(fake: ReturnType<typeof createFakeAdapter>) {
    await waitFor(() => expect(fake.log).toContain("listen"));
}

describe("TauriCloseContext close decisions", () => {
    beforeEach(() => {
        mockedCreateAdapter.mockReset();
    });

    it("closes immediately on a public/no-handler close request", async () => {
        const fake = createFakeAdapter();
        renderProvider(fake);
        await awaitListener(fake);
        act(() => fake.fire());
        await waitFor(() => expect(fake.log).toContain("approve"));
        expect(fake.log.indexOf("approve")).toBeLessThan(fake.log.indexOf("close"));
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("closes immediately when authenticated work is clean", async () => {
        const fake = createFakeAdapter();
        const { handler } = makeHandler(0, vi.fn().mockResolvedValue(0));
        renderProvider(fake, handler);
        await awaitListener(fake);
        act(() => fake.fire());
        await waitFor(() => expect(fake.log).toContain("approve"));
        expect(handler.syncForClose).not.toHaveBeenCalled();
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("opens the dialog for pending work and does not approve", async () => {
        const fake = createFakeAdapter();
        const { handler } = makeHandler(2, vi.fn().mockResolvedValue(0));
        renderProvider(fake, handler);
        await awaitListener(fake);
        act(() => fake.fire());
        expect(screen.getByRole("dialog")).toHaveTextContent("2 changes not synced");
        expect(fake.log).not.toContain("approve");
        expect(handler.syncForClose).not.toHaveBeenCalled();
    });

    it("syncs then closes exactly once on Sync and exit", async () => {
        const fake = createFakeAdapter();
        const { handler } = makeHandler(1, vi.fn().mockResolvedValue(0));
        renderProvider(fake, handler);
        await awaitListener(fake);
        act(() => fake.fire());
        act(() => screen.getByText("Sync and exit").click());
        await waitFor(() => expect(fake.log).toContain("approve"));
        expect(handler.syncForClose).toHaveBeenCalledTimes(1);
        expect(fake.log.indexOf("approve")).toBeLessThan(fake.log.indexOf("close"));
        expect(fake.log.filter((entry) => entry === "close")).toHaveLength(1);
    });

    it("keeps the dialog open when a close sync still leaves work pending", async () => {
        const fake = createFakeAdapter();
        // The close sync resolves with a pending count of 2: edits made while it
        // ran stayed staged, so the exit is not clean and must not be approved.
        const { handler } = makeHandler(1, vi.fn().mockResolvedValue(2));
        renderProvider(fake, handler);
        await awaitListener(fake);
        act(() => fake.fire());
        act(() => screen.getByText("Sync and exit").click());
        await waitFor(() =>
            expect(screen.getByRole("dialog")).toHaveTextContent("2 changes not synced"),
        );
        expect(handler.syncForClose).toHaveBeenCalledTimes(1);
        expect(fake.log).not.toContain("approve");
        expect(screen.getByText("Sync and exit")).toBeEnabled();
        expect(screen.getByText("Exit without syncing")).toBeEnabled();
    });

    it("keeps the dialog open and retains choices when sync fails", async () => {
        const fake = createFakeAdapter();
        const { handler } = makeHandler(1, vi.fn().mockRejectedValue(new Error("Network down")));
        renderProvider(fake, handler);
        await awaitListener(fake);
        act(() => fake.fire());
        act(() => screen.getByText("Sync and exit").click());
        await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Network down"));
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        expect(fake.log).not.toContain("approve");
        expect(screen.getByText("Sync and exit")).toBeEnabled();
        expect(screen.getByText("Exit without syncing")).toBeEnabled();
        expect(screen.getByText("Cancel")).toBeEnabled();
    });

    it("shows auth-specific copy when the session is invalid", async () => {
        const fake = createFakeAdapter();
        const authError = new Error("session expired");
        authError.name = "DataAccessAuthError";
        const { handler } = makeHandler(1, vi.fn().mockRejectedValue(authError));
        renderProvider(fake, handler);
        await awaitListener(fake);
        act(() => fake.fire());
        act(() => screen.getByText("Sync and exit").click());
        await waitFor(() =>
            expect(screen.getByRole("alert")).toHaveTextContent("Your session is no longer valid"),
        );
        expect(fake.log).not.toContain("approve");
    });

    it("skips sync, preserves staged work, and closes on Exit without syncing", async () => {
        const fake = createFakeAdapter();
        const { handler } = makeHandler(3, vi.fn().mockResolvedValue(0));
        renderProvider(fake, handler);
        await awaitListener(fake);
        act(() => fake.fire());
        act(() => screen.getByText("Exit without syncing").click());
        await waitFor(() => expect(fake.log).toContain("approve"));
        expect(handler.syncForClose).not.toHaveBeenCalled();
        expect(handler.pendingCount).toHaveBeenCalled();
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("dismisses the dialog and keeps the window open on Cancel", async () => {
        const fake = createFakeAdapter();
        const { handler } = makeHandler(1, vi.fn().mockResolvedValue(0));
        renderProvider(fake, handler);
        await awaitListener(fake);
        act(() => fake.fire());
        act(() => screen.getByText("Cancel").click());
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(fake.log).not.toContain("approve");
        expect(handler.syncForClose).not.toHaveBeenCalled();
    });

    it("ignores a duplicate close request while the dialog is open", async () => {
        const fake = createFakeAdapter();
        const { handler } = makeHandler(1, vi.fn().mockResolvedValue(0));
        renderProvider(fake, handler);
        await awaitListener(fake);
        act(() => fake.fire());
        expect(screen.getAllByRole("dialog")).toHaveLength(1);
        act(() => fake.fire());
        expect(screen.getAllByRole("dialog")).toHaveLength(1);
        expect(fake.log).not.toContain("approve");
    });

    it("cleans up the native listener on unmount", async () => {
        const fake = createFakeAdapter();
        const { unmount } = renderProvider(fake);
        await awaitListener(fake);
        unmount();
        await waitFor(() => expect(fake.log).toContain("unlisten"));
        // Disarming native interception on teardown lets a reloaded frontend
        // re-arm readiness only after its new listener is registered.
        await waitFor(() => expect(fake.log).toContain("unready"));
    });

    it("disarms native interception on pagehide so a reload can never trap the window", async () => {
        const fake = createFakeAdapter();
        renderProvider(fake);
        await awaitListener(fake);
        act(() => window.dispatchEvent(new Event("pagehide")));
        await waitFor(() => expect(fake.log).toContain("unready"));
    });

    it("signals native readiness only after the close listener is registered", async () => {
        const fake = createFakeAdapter();
        renderProvider(fake);
        await waitFor(() => expect(fake.log).toContain("ready"));
        expect(fake.log.indexOf("listen")).toBeLessThan(fake.log.indexOf("ready"));
    });

    it("keeps native close interception unarmed when the listener subscription rejects", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const fake = createRejectingAdapter();
        mockedCreateAdapter.mockResolvedValue(fake.adapter);
        render(
            <TauriCloseProvider>{null}</TauriCloseProvider>,
        );
        await waitFor(() => expect(fake.log).toContain("listen"));
        // The rejection is caught (no unhandled rejection) and readiness is
        // never signalled, so Rust continues allowing close requests.
        await waitFor(() => expect(warn).toHaveBeenCalledWith(
            "Failed to subscribe to the Tauri close handshake",
            expect.any(Error),
        ));
        expect(fake.log).not.toContain("ready");
        expect(fake.log).not.toContain("approve");
        warn.mockRestore();
    });

    it("keeps the close provider inert when the adapter cannot be created", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        mockedCreateAdapter.mockResolvedValue(null);
        const result = render(<TauriCloseProvider>{null}</TauriCloseProvider>);
        expect(result.container).toBeInTheDocument();
        expect(screen.queryByRole("dialog")).toBeNull();
        warn.mockRestore();
    });
});
