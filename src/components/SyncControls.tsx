import React from "react";
import { useSync } from "../state/SyncContext";

/**
 * Global authenticated sync controls: an accessible "Sync data" button with a
 * pending-change badge and an adjacent live region exposing idle/syncing/
 * success/error states. Auth failures tell the user to reauthenticate and
 * retry without claiming staged data was lost.
 */
export const SyncControls: React.FC = () => {
    const { status, error, errorKind, pendingCount, sync } = useSync();
    const handleSync = () => {
        void sync({ reason: "manual" }).catch(() => undefined);
    };

    let statusText: string;
    if (status === "syncing") {
        statusText = "Syncing…";
    } else if (status === "success") {
        statusText = "Synced";
    } else if (status === "error") {
        statusText =
            errorKind === "auth"
                ? "Sync error: please reauthenticate and retry. Your local changes are safe."
                : `Sync failed: ${error ?? "unknown error"}. Your local changes are safe.`;
    } else {
        statusText = "Ready";
    }

    return (
        <div className="flex items-center gap-2">
            <button
                type="button"
                onClick={handleSync}
                disabled={status === "syncing"}
                aria-label={`Sync data${pendingCount > 0 ? ` (${pendingCount} pending changes)` : ""}`}
                className="relative rounded px-2 py-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 disabled:opacity-50"
            >
                Sync data
                {pendingCount > 0 && (
                    <span
                        data-testid="pending-badge"
                        className="ml-1 rounded-full bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-950"
                    >
                        {pendingCount}
                    </span>
                )}
            </button>
            <span role="status" aria-live="polite" data-testid="sync-status" className="text-neutral-500">
                {statusText}
            </span>
        </div>
    );
};

/**
 * Backstop banner for the authenticated shell: "Unsynced changes from your
 * previous visit" with "Sync now" and dismiss controls. It is a backstop, not
 * a success guarantee — dismissal never clears staged data.
 */
export const UnsyncedBanner: React.FC = () => {
    const { showUnsyncedBanner, sync, dismissUnsyncedBanner } = useSync();
    if (!showUnsyncedBanner) return null;
    return (
        <div
            role="region"
            aria-label="Unsynced changes"
            data-testid="unsynced-banner"
            className="flex items-center gap-3 border-b border-amber-900/60 bg-amber-950/40 px-3 py-2 text-[11px] text-amber-200"
        >
            <span className="font-medium">Unsynced changes from your previous visit</span>
            <button
                type="button"
                onClick={() => {
                    void sync({ reason: "manual" }).catch(() => undefined);
                }}
                className="rounded bg-amber-600 px-2 py-0.5 text-neutral-950 hover:bg-amber-500"
            >
                Sync now
            </button>
            <button
                type="button"
                onClick={dismissUnsyncedBanner}
                className="rounded px-2 py-0.5 text-amber-300 hover:bg-amber-900/60"
            >
                Dismiss
            </button>
        </div>
    );
};

export default SyncControls;
