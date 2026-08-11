import React, { useState } from "react";
import { createPortal } from "react-dom";
import { useSync } from "../state/SyncContext";

/**
 * Global authenticated sync controls: an accessible "Sync data" button with a
 * pending-change badge and an adjacent live region exposing idle/syncing/
 * success/error states. Auth failures tell the user to reauthenticate and
 * retry without claiming staged data was lost.
 */
export const SyncControls: React.FC = () => {
    const { status, error, errorKind, pendingCount, sync, discardPendingChanges } = useSync();
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [confirmation, setConfirmation] = useState("");
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const [deleting, setDeleting] = useState(false);
    const confirmationMatches = confirmation.trim().toLowerCase() === "confirm";
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
        <div className="flex flex-wrap items-center gap-2">
            <button
                type="button"
                onClick={handleSync}
                disabled={status === "syncing"}
                aria-label={`Sync data${pendingCount > 0 ? ` (${pendingCount} pending changes)` : ""}`}
                className="relative rounded px-2.5 py-1.5 sm:px-2 sm:py-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 disabled:opacity-50"
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
            <button
                type="button"
                onClick={() => {
                    setDeleteError(null);
                    setShowDeleteConfirm(true);
                }}
                disabled={pendingCount === 0 || status === "syncing"}
                className="rounded px-2.5 py-1.5 sm:px-2 sm:py-1 text-red-400 hover:bg-red-950/50 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
                Delete Changes
            </button>
            <span role="status" aria-live="polite" data-testid="sync-status" className="text-neutral-500">
                {statusText}
            </span>
            {showDeleteConfirm && createPortal(
                <div
                    className="fixed inset-0 z-50 bg-black/70 px-4 backdrop-blur-sm"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="delete-changes-title"
                >
                    <div className="absolute left-1/2 top-1/3 w-80 max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-neutral-700 bg-neutral-900 p-4 text-neutral-200 shadow-xl">
                        <h2 id="delete-changes-title" className="text-sm font-semibold">Delete staged changes?</h2>
                        <p className="mt-2 text-xs leading-relaxed text-neutral-400">
                            This permanently removes all {pendingCount} staged change{pendingCount === 1 ? "" : "s"}
                            {" "}from this device and restores the last synced data. Type <strong className="text-red-400">confirm</strong> to continue.
                        </p>
                        <label className="mt-3 block text-xs text-neutral-300" htmlFor="delete-changes-confirmation">
                            Confirmation
                        </label>
                        <input
                            id="delete-changes-confirmation"
                            autoFocus
                            value={confirmation}
                            onChange={(event) => setConfirmation(event.target.value)}
                            placeholder="Type confirm"
                            className="mt-1 w-full rounded border border-neutral-700 bg-neutral-800/60 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-red-500"
                        />
                        {deleteError && <p role="alert" className="mt-2 text-xs text-red-300">{deleteError}</p>}
                        <div className="mt-4 flex gap-2">
                            <button
                                type="button"
                                disabled={deleting}
                                onClick={() => {
                                    setShowDeleteConfirm(false);
                                    setConfirmation("");
                                    setDeleteError(null);
                                }}
                                className="flex-1 rounded border border-neutral-700 px-3 py-1.5 text-xs hover:bg-neutral-800 disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={!confirmationMatches || deleting || status === "syncing"}
                                onClick={async () => {
                                    if (!confirmationMatches) return;
                                    setDeleting(true);
                                    setDeleteError(null);
                                    try {
                                        await discardPendingChanges();
                                        setShowDeleteConfirm(false);
                                        setConfirmation("");
                                    } catch (discardError) {
                                        setDeleteError(discardError instanceof Error ? discardError.message : String(discardError));
                                    } finally {
                                        setDeleting(false);
                                    }
                                }}
                                className="flex-1 rounded border border-red-500 bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                {deleting ? "Deleting…" : "Delete Changes"}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body,
            )}
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
            className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-900/60 bg-amber-950/40 px-3 py-2 text-[11px] text-amber-200"
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
