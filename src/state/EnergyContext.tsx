import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type JSX } from "react";
import { composeEnergyEntry, resolveEnergyPrefill, type EnergyPrefill } from "../lib/energy";
import { DEFAULT_START_OF_DAY } from "../lib/settings";
import { useAppState } from "./AppStateContext";
import { useData } from "./DataContext";
import type { EnergyEntry, EnergyRatingPatch } from "./types";

export interface EnergyContextValue {
    entries: Record<string, EnergyEntry>;
    prefillFor: (atIso: string) => EnergyPrefill;
    armStart: (explicit: EnergyRatingPatch) => () => void;
    setRating: (workWindowId: string, patch: EnergyRatingPatch) => Promise<boolean>;
    error: string | null;
    clearError: () => void;
}

const EnergyContext = createContext<EnergyContextValue | undefined>(undefined);

export function EnergyProvider({ children }: { children: ReactNode }): JSX.Element {
    const app = useAppState();
    const data = useData();
    const latest = useRef(app);
    useLayoutEffect(() => { latest.current = app; });
    const [entries, setEntries] = useState<Record<string, EnergyEntry>>({});
    const [error, setError] = useState<string | null>(null);
    const mounted = useRef(false);
    const readSequence = useRef(0);
    const armed = useRef<{ explicit: EnergyRatingPatch } | null>(null);
    const queue = useRef<Array<() => Promise<void>>>([]);
    const serial = useRef(Promise.resolve());
    const scheduled = useRef<ReturnType<typeof setTimeout> | null>(null);
    const report = useCallback((failure: unknown) => {
        if (mounted.current) setError(failure instanceof Error ? failure.message : String(failure));
    }, []);
    // A write that settles successfully retires the previous failure so the
    // TimerPanel error line never keeps showing a stale energy error.
    const clearFailure = useCallback(() => { if (mounted.current) setError(null); }, []);
    const reload = useCallback(async () => {
        const sequence = ++readSequence.current;
        const all = await data.loadEnergyEntries();
        if (mounted.current && sequence === readSequence.current)
            setEntries(Object.fromEntries(all.map(row => [row.work_window_id, row])));
    }, [data]);
    const schedule = useCallback(() => {
        if (scheduled.current !== null) return;
        scheduled.current = setTimeout(() => {
            scheduled.current = null;
            for (const job of queue.current.splice(0)) {
                serial.current = serial.current.then(job).catch(report);
            }
        }, 0);
    }, [report]);

    useEffect(() => {
        mounted.current = true;
        void reload().catch(report);
        const unsubscribeData = data.subscribe(() => { void reload().catch(report); });
        // Reconciliation/hydration starts publish no transition: those windows
        // intentionally get no row. Never backfill them from timer state.
        const unsubscribeTimer = app.subscribeTimerTransitions(event => {
            if (event.type !== "enter" || (event.reason !== "start" && event.reason !== "break-end")) return;
            const windowId = event.windowId;
            const explicit = event.reason === "start" ? { ...armed.current?.explicit } : {};
            if (event.reason === "start") armed.current = null;
            // Reserve the create before any subsequent setRating; the listener
            // only enqueues and schedules, and never calls data synchronously.
            queue.current.push(async () => {
                try {
                    const all = await data.loadEnergyEntries();
                    const prefill = resolveEnergyPrefill(windowId, all,
                        latest.current.state?.settings.start_of_day ?? DEFAULT_START_OF_DAY);
                    await data.createEnergyEntry(composeEnergyEntry({
                        workWindowId: windowId, prefill, explicit, now: new Date().toISOString(),
                    }));
                    // Inserted or duplicate no-op both count as a successful write.
                    clearFailure();
                    await reload();
                } catch (failure) { report(failure); }
            });
            schedule();
        });
        return () => {
            mounted.current = false;
            ++readSequence.current;
            unsubscribeTimer();
            unsubscribeData();
        };
    }, [app.subscribeTimerTransitions, clearFailure, data, reload, report, schedule]);

    const armStart = useCallback((explicit: EnergyRatingPatch) => {
        const token = { explicit: { ...explicit } };
        armed.current = token;
        return () => { if (armed.current === token) armed.current = null; };
    }, []);
    const setRating = useCallback((workWindowId: string, patch: EnergyRatingPatch): Promise<boolean> => {
        const snapshot = { ...patch };
        return new Promise(resolve => {
            queue.current.push(async () => {
                try {
                    const written = await data.setEnergyRating(workWindowId, snapshot, new Date().toISOString());
                    if (written) clearFailure();
                    await reload();
                    resolve(written);
                } catch (failure) {
                    report(failure);
                    resolve(false);
                }
            });
            schedule();
        });
    }, [clearFailure, data, reload, report, schedule]);
    const prefillFor = useCallback((atIso: string) => resolveEnergyPrefill(atIso, Object.values(entries),
        latest.current.state?.settings.start_of_day ?? DEFAULT_START_OF_DAY), [entries]);
    const clearError = useCallback(() => setError(null), []);

    return <EnergyContext.Provider value={{ entries, prefillFor, armStart, setRating, error, clearError }}>
        {children}
    </EnergyContext.Provider>;
}

export function useOptionalEnergy(): EnergyContextValue | undefined { return useContext(EnergyContext); }
export function useEnergy(): EnergyContextValue {
    const value = useOptionalEnergy();
    if (!value) throw new Error("useEnergy must be used within EnergyProvider");
    return value;
}
