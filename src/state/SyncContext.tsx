import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { useData } from "./DataContext";
import { DataAccessAuthError, type SyncOptions, type SyncResult } from "../lib/data/DataAccess";
import { stagingOwnerId } from "../lib/data/staging/LocalStagingStore";
import { useTauriClose, type CloseSyncHandler } from "./TauriCloseContext";

export interface SyncContextValue {
    status: "idle" | "syncing" | "success" | "error";
    error: string | null;
    errorKind: "auth" | "sync" | null;
    pendingCount: number;
    initialized: boolean;
    revision: number;
    showUnsyncedBanner: boolean;
    sync(options?: Partial<SyncOptions>): Promise<SyncResult>;
    discardPendingChanges(): Promise<void>;
    dismissUnsyncedBanner(): void;
}

const SyncContext = createContext<SyncContextValue | undefined>(undefined);
const SYNC_WATCHDOG_MS = 60_000;

/**
 * Authenticated sync state provider. Mounted directly inside `DataProvider` and
 * outside `AppStateProvider`/`ProjectManagerProvider` so it owns the single
 * sync action, the browser lifecycle triggers, and the per-owner cross-tab
 * storage listener. `ownerId` is the current user id and scopes the `storage`
 * event listener to this owner's exported staging key.
 *
 * `revision` increments on every same-tab or cross-tab local write so consumer
 * contexts can reread their staged views. `status`/`error` coalesce around the
 * underlying coordinator promise: automatic triggers update the UI state but
 * never create unhandled promise rejections.
 */
export const SyncProvider: React.FC<{ ownerId: string; children: React.ReactNode }> = ({ ownerId, children }) => {
    const data = useData();
    const [status, setStatus] = useState<SyncContextValue["status"]>("idle");
    const [error, setError] = useState<string | null>(null);
    const [errorKind, setErrorKind] = useState<SyncContextValue["errorKind"]>(null);
    const [pendingCount, setPendingCount] = useState(() => data.pendingCount());
    const [initialized, setInitialized] = useState(() => data.isInitialized());
    const [revision, setRevision] = useState(0);
    const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Captured once at mount: pending work from a previous visit is the backstop
    // banner; edits made during the current visit only drive the button badge.
    const [showUnsyncedBanner, setShowUnsyncedBanner] = useState(() => data.pendingCount() > 0);

    const sync = useCallback(async (options?: Partial<SyncOptions>): Promise<SyncResult> => {
        const opts: SyncOptions = {
            reason: options?.reason ?? "manual",
            ...(options?.bestEffort !== undefined ? { bestEffort: options.bestEffort } : {}),
        };
        setStatus("syncing");
        if (watchdogRef.current !== null) clearTimeout(watchdogRef.current);
        const watchdog = setTimeout(() => {
            setError("Sync timed out. You can retry; your local changes are safe.");
            setErrorKind("sync");
            setStatus("error");
        }, SYNC_WATCHDOG_MS);
        watchdogRef.current = watchdog;
        try {
            const result = await data.sync(opts);
            setPendingCount(result.pendingCount);
            setInitialized(result.initialized);
            // A successful clean sync retires the previous-visit backstop banner.
            if (result.pendingCount === 0) setShowUnsyncedBanner(false);
            setError(null);
            setErrorKind(null);
            setStatus("success");
            return result;
        } catch (err) {
            const authFailure =
                err instanceof DataAccessAuthError ||
                (err instanceof Error && err.name === "DataAccessAuthError");
            setErrorKind(authFailure ? "auth" : "sync");
            setError(err instanceof Error ? err.message : String(err));
            setStatus("error");
            throw err;
        } finally {
            if (watchdogRef.current === watchdog) {
                clearTimeout(watchdog);
                watchdogRef.current = null;
            }
        }
    }, [data]);

    useEffect(() => () => {
        if (watchdogRef.current !== null) clearTimeout(watchdogRef.current);
    }, []);

    // Bootstrap once on authenticated mount. StrictMode effect replay shares the
    // coordinator's in-flight promise, so this never produces overlapping pushes.
    useEffect(() => {
        void sync({ reason: "bootstrap" }).catch(() => undefined);
    }, [sync]);

    // Centralized focus/visibility triggers. A visible tab always syncs, even
    // with no local changes, because the attempt also pulls remote changes.
    useEffect(() => {
        const onFocus = () => {
            void sync({ reason: "focus" }).catch(() => undefined);
        };
        const onVisibility = () => {
            if (document.visibilityState === "visible") {
                void sync({ reason: "visibility" }).catch(() => undefined);
            }
        };
        window.addEventListener("focus", onFocus);
        document.addEventListener("visibilitychange", onVisibility);
        return () => {
            window.removeEventListener("focus", onFocus);
            document.removeEventListener("visibilitychange", onVisibility);
        };
    }, [sync]);

    // Web-only best-effort pagehide. No service workers, Background Sync,
    // beforeunload blocking, or delivery guarantee; the persisted pending state
    // and the next-visit banner are the recovery path.
    useEffect(() => {
        if (isTauri()) return;
        const onPageHide = () => {
            void sync({ reason: "pagehide", bestEffort: true }).catch(() => undefined);
        };
        window.addEventListener("pagehide", onPageHide);
        return () => {
            window.removeEventListener("pagehide", onPageHide);
        };
    }, [sync]);

    // Tauri close handshake: while authenticated, expose the pending-count and
    // close-sync capability to the root close provider. Unregister on sign-out
    // so a close action can never touch the previous owner's store. The close
    // sync returns the resulting pending count so the provider can prove the
    // exit is actually clean (edits made while the sync ran stay pending).
    const tauriClose = useTauriClose();
    useEffect(() => {
        const handler: CloseSyncHandler = {
            pendingCount: () => data.pendingCount(),
            syncForClose: async () => {
                const result = await sync({ reason: "close" });
                return result.pendingCount;
            },
        };
        tauriClose.registerCloseSyncHandler(handler);
        return () => {
            tauriClose.unregisterCloseSyncHandler();
        };
    }, [tauriClose, data, sync]);

    // Cross-tab refresh only: another tab writing this owner's staging key
    // reloads the local view and bumps the revision but never auto-syncs.
    // `localStorage.clear()` (event.key === null) reloads only the current
    // local view as uninitialized; PM UI and GoTrue auth keys are ignored.
    useEffect(() => {
        const onStorage = (event: StorageEvent) => {
            if (event.key === null) {
                data.reloadFromStorage();
                return;
            }
            const eventOwner = stagingOwnerId(event.key);
            if (eventOwner === null || eventOwner !== ownerId) return;
            data.reloadFromStorage();
        };
        window.addEventListener("storage", onStorage);
        return () => {
            window.removeEventListener("storage", onStorage);
        };
    }, [data, ownerId]);

    // Same-tab local writes refresh pending/initialized state, bump the
    // revision for consumer contexts, and let a new edit supersede a stale
    // success display while retaining the new pending count.
    useEffect(() => {
        return data.subscribe(() => {
            setPendingCount(data.pendingCount());
            setInitialized(data.isInitialized());
            setRevision((value) => value + 1);
            setStatus((prev) => (prev === "success" ? "idle" : prev));
        });
    }, [data]);

    const dismissUnsyncedBanner = useCallback(() => setShowUnsyncedBanner(false), []);

    const discardPendingChanges = useCallback(async (): Promise<void> => {
        await data.discardPendingChanges();
        setShowUnsyncedBanner(false);
        setError(null);
        setErrorKind(null);
        setStatus("idle");
    }, [data]);

    const value: SyncContextValue = {
        status,
        error,
        errorKind,
        pendingCount,
        initialized,
        revision,
        showUnsyncedBanner,
        sync,
        discardPendingChanges,
        dismissUnsyncedBanner,
    };

    return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
};

export function useSync(): SyncContextValue {
    const ctx = useContext(SyncContext);
    if (!ctx) throw new Error("useSync must be inside SyncProvider");
    return ctx;
}
