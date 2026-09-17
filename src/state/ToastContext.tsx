import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { ToastViewport, type ToastAction, type ToastRecord, type ToastTone } from "../components/ToastViewport";

/** Default undo/correction window for a logged activity. */
export const DEFAULT_TOAST_DURATION_MS = 8000;

export interface ToastOptions {
    action?: ToastAction;
    /** Auto-dismiss window in milliseconds. `0` keeps the toast until dismissed. */
    durationMs?: number;
    tone?: ToastTone;
}

export interface ToastContextValue {
    toasts: ToastRecord[];
    showToast(message: string, options?: ToastOptions): string;
    dismissToast(id: string): void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

/**
 * Minimal shared toast subsystem. It owns the only transient-message surface in
 * the app: pet activity logging uses it for its undo window, and Issue F's
 * overdue alerts must reuse it rather than add a second mechanism.
 */
export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [toasts, setToasts] = useState<ToastRecord[]>([]);
    const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
    const sequenceRef = useRef(0);

    const dismissToast = useCallback((id: string) => {
        const timer = timersRef.current.get(id);
        if (timer !== undefined) {
            clearTimeout(timer);
            timersRef.current.delete(id);
        }
        setToasts((previous) => previous.filter((toast) => toast.id !== id));
    }, []);

    const showToast = useCallback((message: string, options: ToastOptions = {}): string => {
        sequenceRef.current += 1;
        const id = `toast-${sequenceRef.current}`;
        const durationMs = options.durationMs ?? DEFAULT_TOAST_DURATION_MS;
        const record: ToastRecord = {
            id,
            message,
            action: options.action ?? null,
            tone: options.tone ?? "neutral",
            durationMs,
        };
        setToasts((previous) => [...previous, record]);
        if (durationMs > 0) {
            const timer = setTimeout(() => dismissToast(id), durationMs);
            timersRef.current.set(id, timer);
        }
        return id;
    }, [dismissToast]);

    const runAction = useCallback((toast: ToastRecord) => {
        dismissToast(toast.id);
        if (toast.action) void toast.action.onAction();
    }, [dismissToast]);

    useEffect(() => () => {
        for (const timer of timersRef.current.values()) clearTimeout(timer);
        timersRef.current.clear();
    }, []);

    const value: ToastContextValue = { toasts, showToast, dismissToast };

    return (
        <ToastContext.Provider value={value}>
            {children}
            <ToastViewport toasts={toasts} onDismiss={dismissToast} onAction={runAction} />
        </ToastContext.Provider>
    );
};

export function useToast(): ToastContextValue {
    const context = useContext(ToastContext);
    if (!context) throw new Error("useToast must be inside ToastProvider");
    return context;
}
