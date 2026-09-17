import React from "react";

export type ToastTone = "neutral" | "success" | "warning" | "danger";

export interface ToastAction {
    label: string;
    onAction: () => void | Promise<void>;
}

export interface ToastRecord {
    id: string;
    message: string;
    action: ToastAction | null;
    tone: ToastTone;
    durationMs: number;
}

const TONE_CLASSES: Record<ToastTone, string> = {
    neutral: "border-neutral-700 bg-neutral-900 text-neutral-100",
    success: "border-emerald-800 bg-emerald-950 text-emerald-100",
    warning: "border-amber-800 bg-amber-950 text-amber-100",
    danger: "border-red-800 bg-red-950 text-red-100",
};

export interface ToastViewportProps {
    toasts: ToastRecord[];
    onDismiss: (id: string) => void;
    onAction: (toast: ToastRecord) => void;
}

/**
 * Small presentational viewport for the shared toast subsystem. The provider
 * owns timing and dismissal; this only renders the current stack so the same
 * mechanism can back pet-log undo (Issue C) and overdue alerts (Issue F).
 */
export const ToastViewport: React.FC<ToastViewportProps> = ({ toasts, onDismiss, onAction }) => {
    if (toasts.length === 0) return null;
    return (
        <div
            role="status"
            aria-live="polite"
            className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-end gap-2 p-3 sm:inset-x-auto sm:right-0"
        >
            {toasts.map((toast) => (
                <div
                    key={toast.id}
                    data-testid="toast"
                    className={`pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded border px-3 py-2 text-[11px] shadow-lg ${TONE_CLASSES[toast.tone]}`}
                >
                    <span className="flex-1" data-testid="toast-message">{toast.message}</span>
                    {toast.action && (
                        <button
                            type="button"
                            onClick={() => onAction(toast)}
                            className="rounded px-2 py-1 font-medium text-white hover:underline"
                        >
                            {toast.action.label}
                        </button>
                    )}
                    <button
                        type="button"
                        aria-label="Dismiss notification"
                        onClick={() => onDismiss(toast.id)}
                        className="rounded px-1 text-neutral-400 hover:text-neutral-100"
                    >
                        ×
                    </button>
                </div>
            ))}
        </div>
    );
};
