import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { GoogleCalendarBusyResult, GoogleCalendarDataAccess } from "../lib/data/GoogleCalendarDataAccess";
import { GoogleCalendarIntegrationError, SupabaseGoogleCalendarDataAccess } from "../lib/data/GoogleCalendarDataAccess";
import { resolvePetScheduleDay } from "../lib/pets/schedule";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthContext";
import { useAppState } from "./AppStateContext";

export type CalendarBusyStatus = "loading" | "ok" | "empty" | "unavailable";

export interface CalendarBusySnapshot {
    /** Raw busy intervals (ISO strings) returned for [dayStart, dayEnd]; never persisted. */
    intervals: ReadonlyArray<{ start: string; end: string }>;
    /** refreshedAt of the last SUCCESSFUL fetch, or null if none yet. */
    refreshedAt: string | null;
    status: CalendarBusyStatus;
    /** Resolved schedule-day window of the request that produced `intervals`. */
    dayStart: Date;
    dayEnd: Date;
}

export interface CalendarBusyContextValue {
    snapshot: CalendarBusySnapshot;
    /** Manual refresh; the deck's refresh control calls this. Stable identity. */
    refresh(): void;
}

type BusyDataAccess = Pick<GoogleCalendarDataAccess, "fetchBusyIntervals">;

const ROLLOVER_CHECK_MS = 30_000;

const LOADING_SNAPSHOT: CalendarBusySnapshot = {
    intervals: [],
    refreshedAt: null,
    status: "loading",
    dayStart: new Date(0),
    dayEnd: new Date(0),
};

const DEFAULT_SNAPSHOT: CalendarBusySnapshot = {
    intervals: [],
    refreshedAt: null,
    status: "empty",
    dayStart: new Date(0),
    dayEnd: new Date(0),
};

const noop = () => undefined;
const DEFAULT_VALUE: CalendarBusyContextValue = { snapshot: DEFAULT_SNAPSHOT, refresh: noop };

const CalendarBusyContext = createContext<CalendarBusyContextValue | undefined>(undefined);

/** No connection is silent; a connection with no selected calendars is silent too. */
function classifyResult(result: GoogleCalendarBusyResult): CalendarBusyStatus {
    const sources = result.sources;
    if (!sources || sources.length === 0) return "ok";
    if (sources.every((source) => source.errorCode !== null)) return "unavailable";
    if (sources.every((source) => source.calendarCount === 0 && source.errorCode === null)) return "empty";
    return "ok";
}

const CalendarBusySnapshotProvider: React.FC<{
    children: React.ReactNode;
    dataAccess: BusyDataAccess;
}> = ({ children, dataAccess }) => {
    const app = useAppState();
    const ready = app.state !== null || app.error !== null;
    const [snapshot, setSnapshot] = useState<CalendarBusySnapshot>(LOADING_SNAPSHOT);
    const sequenceRef = useRef(0);
    const requestedWindowRef = useRef<{ dayStart: Date; dayEnd: Date } | null>(null);
    const lastEdgeKeyRef = useRef<string | null>(null);
    const mountedRef = useRef(true);
    const readyRef = useRef(ready);
    const settingsRef = useRef(app.state?.settings);
    const dataAccessRef = useRef(dataAccess);
    readyRef.current = ready;
    settingsRef.current = app.state?.settings;
    dataAccessRef.current = dataAccess;

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    const applyResult = useCallback((result: GoogleCalendarBusyResult, window: { dayStart: Date; dayEnd: Date }) => {
        const status = classifyResult(result);
        setSnapshot((previous) => {
            if (status === "unavailable") return { ...previous, status };
            return {
                intervals: status === "empty" ? [] : result.intervals,
                refreshedAt: result.refreshedAt,
                status,
                dayStart: window.dayStart,
                dayEnd: window.dayEnd,
            };
        });
    }, []);

    const applyFailure = useCallback((error: unknown) => {
        if (error instanceof GoogleCalendarIntegrationError && error.code === "GOOGLE_CALENDAR_NOT_CONFIGURED") {
            setSnapshot((previous) => previous.status === "empty" && previous.intervals.length === 0
                ? previous
                : { ...previous, intervals: [], status: "empty" });
            return;
        }
        // Keep the last good intervals, refreshedAt and window: clearing on error
        // would visibly un-shift the deck.
        setSnapshot((previous) => previous.status === "unavailable" ? previous : { ...previous, status: "unavailable" });
    }, []);

    const issueFetch = useCallback(() => {
        if (!readyRef.current) return;
        const window = resolvePetScheduleDay(
            new Date(),
            settingsRef.current?.start_of_day,
            settingsRef.current?.end_of_day,
        );
        const requestId = ++sequenceRef.current;
        requestedWindowRef.current = window;
        dataAccessRef.current.fetchBusyIntervals({
            timeMin: window.dayStart.toISOString(),
            timeMax: window.dayEnd.toISOString(),
        }).then(
            (result) => {
                if (!mountedRef.current || requestId !== sequenceRef.current) return;
                applyResult(result, window);
            },
            (error: unknown) => {
                if (!mountedRef.current || requestId !== sequenceRef.current) return;
                applyFailure(error);
            },
        );
    }, [applyFailure, applyResult]);

    const edgeKey = `${app.state ? "state" : app.error ? "error" : "pending"}:${app.state?.settings.start_of_day ?? ""}:${app.state?.settings.end_of_day ?? ""}`;

    // Wait for settings (or their failure) before the one mount fetch, and treat
    // an edge change as a new request. The key also absorbs effect replays.
    useEffect(() => {
        if (!ready) return;
        if (lastEdgeKeyRef.current === edgeKey) return;
        lastEdgeKeyRef.current = edgeKey;
        issueFetch();
    }, [ready, edgeKey, issueFetch]);

    useEffect(() => {
        const onFocus = () => issueFetch();
        window.addEventListener("focus", onFocus);
        return () => window.removeEventListener("focus", onFocus);
    }, [issueFetch]);

    // Coarse rollover check: compare the resolved window only; never set state
    // from the check itself.
    useEffect(() => {
        if (!ready) return;
        const check = () => {
            const current = requestedWindowRef.current;
            if (!readyRef.current || !current) return;
            const next = resolvePetScheduleDay(
                new Date(),
                settingsRef.current?.start_of_day,
                settingsRef.current?.end_of_day,
            );
            if (next.dayStart.getTime() !== current.dayStart.getTime()
                || next.dayEnd.getTime() !== current.dayEnd.getTime()) {
                issueFetch();
            }
        };
        const id = setInterval(check, ROLLOVER_CHECK_MS);
        return () => clearInterval(id);
    }, [ready, issueFetch]);

    const refresh = useCallback(() => issueFetch(), [issueFetch]);
    const value = useMemo(() => ({ snapshot, refresh }), [snapshot, refresh]);

    return <CalendarBusyContext.Provider value={value}>{children}</CalendarBusyContext.Provider>;
};

const SessionCalendarBusyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { session } = useAuth();
    const dataAccess = useMemo(
        () => new SupabaseGoogleCalendarDataAccess(supabase, session!.user.id),
        [session?.user.id],
    );
    return <CalendarBusySnapshotProvider dataAccess={dataAccess}>{children}</CalendarBusySnapshotProvider>;
};

// The production path needs the authenticated session; tests can supply their
// own access without mounting AuthProvider.
export const CalendarBusyProvider: React.FC<{
    children: React.ReactNode;
    /** Test seam. When omitted, the provider builds its own SupabaseGoogleCalendarDataAccess(supabase, session.user.id) via useAuth, memoised on the user id, exactly like ProjectManagerRoute. */
    dataAccess?: BusyDataAccess;
}> = ({ children, dataAccess }) => {
    if (dataAccess) {
        return <CalendarBusySnapshotProvider dataAccess={dataAccess}>{children}</CalendarBusySnapshotProvider>;
    }
    return <SessionCalendarBusyProvider>{children}</SessionCalendarBusyProvider>;
};

/** Outside a provider returns a module-level constant: status "empty", intervals [], refreshedAt null, dayStart = dayEnd = new Date(0), refresh = no-op. Never throws. */
export function useCalendarBusy(): CalendarBusyContextValue {
    return useContext(CalendarBusyContext) ?? DEFAULT_VALUE;
}
