import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { DataAccessAuthError } from "../lib/data/DataAccess";
import { createTauriCloseAdapter, type TauriCloseAdapter } from "../lib/platform/tauriClose";

/**
 * Authenticated sync capability handed to the close provider. `SyncProvider`
 * registers it while authenticated and unregisters it on sign-out/unmount. On a
 * close request the provider calls `pendingCount()` and, when work is pending,
 * `syncForClose()` (which must reject on sync/auth failure so the dialog stays
 * open). `syncForClose()` resolves with the pending count AFTER the close sync,
 * so the provider approves closing only when the exit is provably clean; edits
 * made while the sync ran leave that count above zero.
 */
export interface CloseSyncHandler {
    pendingCount(): number;
    syncForClose(): Promise<number>;
}

export interface TauriCloseContextValue {
    registerCloseSyncHandler(handler: CloseSyncHandler): void;
    unregisterCloseSyncHandler(): void;
}

interface CloseDialogState {
    pendingCount: number;
}

const TauriCloseContext = createContext<TauriCloseContextValue | undefined>(undefined);

/**
 * Root close provider, mounted inside `AuthProvider` but outside the
 * authenticated `DataProvider`/routes so login, signup, and reset pages still
 * close immediately when no handler is registered. Owns the native
 * `worktime-close-requested` listener and the sync/skip/cancel dialog.
 */
export const TauriCloseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [adapter, setAdapter] = useState<TauriCloseAdapter | null>(null);
    const adapterRef = useRef<TauriCloseAdapter | null>(null);
    const handlerRef = useRef<CloseSyncHandler | null>(null);
    const dialogRef = useRef<CloseDialogState | null>(null);
    const syncingRef = useRef(false);

    const [dialog, setDialog] = useState<CloseDialogState | null>(null);
    const [syncing, setSyncing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [errorKind, setErrorKind] = useState<"auth" | "sync" | null>(null);

    useEffect(() => {
        let cancelled = false;
        void createTauriCloseAdapter().then((created) => {
            if (cancelled) return;
            adapterRef.current = created;
            setAdapter(created);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        dialogRef.current = dialog;
    }, [dialog]);

    // Subscribe once the adapter is ready. Handler/dialog state is read from
    // refs so the callback stays stable and never reads stale state. The native
    // handler intercepts closes only after the readiness signal, which is
    // emitted only once the listener subscription resolves; a failed or absent
    // adapter/listener leaves native closes allowed so the window can never be
    // trapped. Listener rejection is caught so it cannot become an unhandled
    // rejection. The cleanup disarms native interception (`worktime-close-unready`)
    // so a reloaded or re-subscribed frontend re-arms readiness only after its
    // new listener is registered; Rust also disarms on every page load.
    useEffect(() => {
        if (!adapter) return;
        let unlisten: (() => void) | null = null;
        let cancelled = false;
        void adapter
            .listen(() => {
                // A second OS close request while the dialog is open must not
                // open a duplicate dialog or approve unexpectedly.
                if (dialogRef.current) return;
                const handler = handlerRef.current;
                if (!handler || handler.pendingCount() === 0) {
                    void adapterRef.current?.approveAndClose();
                    return;
                }
                setDialog({ pendingCount: handler.pendingCount() });
                setError(null);
                setErrorKind(null);
            })
            .then((unlistenFn) => {
                if (cancelled) {
                    unlistenFn();
                    return;
                }
                unlisten = unlistenFn;
                // Listener confirmed registered: hand close interception to the
                // frontend. Until this emits, Rust allows every close request.
                void adapterRef.current?.signalReady();
            })
            .catch((err) => {
                console.warn("Failed to subscribe to the Tauri close handshake", err);
            });
        return () => {
            cancelled = true;
            unlisten?.();
            // Rust re-arms interception only from a fresh `worktime-close-ready`,
            // so disarm here to avoid trapping the window if this frontend
            // instance never re-subscribes.
            void adapterRef.current?.signalUnready();
        };
    }, [adapter]);

    // Best-effort disarming on unload (reload/close) when the webview is about
    // to destroy this frontend. Rust also disarms on every page load, so a
    // reloaded frontend can never inherit an armed intercept without a live
    // listener.
    useEffect(() => {
        if (!adapter) return;
        const onPageHide = () => {
            void adapterRef.current?.signalUnready();
        };
        window.addEventListener("pagehide", onPageHide);
        return () => {
            window.removeEventListener("pagehide", onPageHide);
        };
    }, [adapter]);

    const registerCloseSyncHandler = useCallback((handler: CloseSyncHandler) => {
        handlerRef.current = handler;
    }, []);

    const unregisterCloseSyncHandler = useCallback(() => {
        handlerRef.current = null;
        // Sign-out while the dialog is open: the next action must never touch
        // the old owner's store, so dismiss the dialog and keep the window open.
        if (dialogRef.current) {
            dialogRef.current = null;
            setDialog(null);
            setError(null);
            setErrorKind(null);
            setSyncing(false);
            syncingRef.current = false;
        }
    }, []);

    const syncAndExit = useCallback(async () => {
        const handler = handlerRef.current;
        if (!handler || syncingRef.current) return;
        syncingRef.current = true;
        setSyncing(true);
        setError(null);
        setErrorKind(null);
        try {
            const pendingAfter = await handler.syncForClose();
            // Unregistered mid-sync (sign-out) already dismissed the dialog.
            if (!handlerRef.current) return;
            if (pendingAfter > 0) {
                // Edits made while the close sync was in flight stayed pending:
                // the exit is not clean, so keep the dialog open with the
                // updated count and let the user sync again or exit unsynced.
                dialogRef.current = { pendingCount: pendingAfter };
                setDialog({ pendingCount: pendingAfter });
                setSyncing(false);
                syncingRef.current = false;
                return;
            }
            dialogRef.current = null;
            setDialog(null);
            setSyncing(false);
            syncingRef.current = false;
            await adapterRef.current?.approveAndClose();
        } catch (err) {
            const authFailure =
                err instanceof DataAccessAuthError ||
                (err instanceof Error && err.name === "DataAccessAuthError");
            setErrorKind(authFailure ? "auth" : "sync");
            setError(err instanceof Error ? err.message : String(err));
            setSyncing(false);
            syncingRef.current = false;
        }
    }, []);

    const skipAndExit = useCallback(() => {
        // Exit without syncing: staged data stays intact; approve and close.
        dialogRef.current = null;
        setDialog(null);
        setError(null);
        setErrorKind(null);
        void adapterRef.current?.approveAndClose();
    }, []);

    const cancel = useCallback(() => {
        dialogRef.current = null;
        setDialog(null);
        setError(null);
        setErrorKind(null);
    }, []);

    // Memoized so `SyncProvider`'s close-handler registration effect does not
    // churn (unregister/re-register) on every provider re-render.
    const value = useMemo<TauriCloseContextValue>(
        () => ({
            registerCloseSyncHandler,
            unregisterCloseSyncHandler,
        }),
        [registerCloseSyncHandler, unregisterCloseSyncHandler],
    );

    return (
        <TauriCloseContext.Provider value={value}>
            {children}
            {dialog && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Unsaved changes"
                >
                    <div className="w-96 rounded-lg border border-neutral-800 bg-neutral-900 p-4 text-neutral-200 shadow-xl">
                        <h2 className="text-sm font-semibold">Unsaved changes</h2>
                        <p className="mt-1 text-xs text-neutral-400">
                            {dialog.pendingCount} change{dialog.pendingCount === 1 ? "" : "s"} not synced to the
                            cloud. What would you like to do?
                        </p>
                        {error && (
                            <p role="alert" className="mt-2 text-xs text-red-300">
                                {errorKind === "auth"
                                    ? "Your session is no longer valid. Sign in again to sync, or exit without syncing."
                                    : error}
                            </p>
                        )}
                        <div className="mt-4 flex flex-col gap-2">
                            <button
                                type="button"
                                disabled={syncing}
                                onClick={() => void syncAndExit()}
                                className="rounded bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
                            >
                                Sync and exit
                            </button>
                            <button
                                type="button"
                                disabled={syncing}
                                onClick={skipAndExit}
                                className="rounded border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
                            >
                                Exit without syncing
                            </button>
                            <button
                                type="button"
                                disabled={syncing}
                                onClick={cancel}
                                className="rounded border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </TauriCloseContext.Provider>
    );
};

export function useTauriClose(): TauriCloseContextValue {
    const ctx = useContext(TauriCloseContext);
    if (!ctx) throw new Error("useTauriClose must be inside TauriCloseProvider");
    return ctx;
}
