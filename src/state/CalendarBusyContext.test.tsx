import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    GoogleCalendarIntegrationError,
    type GoogleCalendarBusyResult,
    type GoogleCalendarDataAccess,
} from "../lib/data/GoogleCalendarDataAccess";
import { InMemoryDataAccess } from "../lib/data/InMemoryDataAccess";
import { resolvePetScheduleDay } from "../lib/pets/schedule";
import { makeAppState } from "../test/mockTauri";
import { AppStateProvider } from "./AppStateContext";
import { CalendarBusyProvider, useCalendarBusy, type CalendarBusyContextValue } from "./CalendarBusyContext";
import { DataProvider } from "./DataContext";
import { SyncProvider } from "./SyncContext";
import { TauriCloseProvider } from "./TauriCloseContext";

vi.mock("../lib/supabase", () => ({ supabase: {} }));

const OWNER = "owner-1";
const NOW = new Date(2026, 8, 17, 12, 0, 0, 0);
const REFRESHED_AT = new Date(NOW.getTime() + 60_000).toISOString();
const BUSY = { start: new Date(NOW.getTime() + 3_600_000).toISOString(), end: new Date(NOW.getTime() + 5_400_000).toISOString() };

type BusyAccess = Pick<GoogleCalendarDataAccess, "fetchBusyIntervals">;

function busyResult(overrides: Partial<GoogleCalendarBusyResult> = {}): GoogleCalendarBusyResult {
    return {
        intervals: [BUSY],
        refreshedAt: REFRESHED_AT,
        sources: [{ connectionId: "connection-1", accountEmail: null, calendarCount: 1, busyMinutes: 30, errorCode: null }],
        ...overrides,
    };
}

function createAccess() {
    return { fetchBusyIntervals: vi.fn<BusyAccess["fetchBusyIntervals"]>() };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

let captured: CalendarBusyContextValue | null = null;

function Probe() {
    const value = useCalendarBusy();
    captured = value;
    return <div data-testid="status">{value.snapshot.status}</div>;
}

function wrap(data: InMemoryDataAccess, access: BusyAccess) {
    return (
        <TauriCloseProvider>
            <DataProvider dataAccess={data}>
                <SyncProvider ownerId={OWNER}>
                    <AppStateProvider>
                        <CalendarBusyProvider dataAccess={access}><Probe /></CalendarBusyProvider>
                    </AppStateProvider>
                </SyncProvider>
            </DataProvider>
        </TauriCloseProvider>
    );
}

async function advance(ms: number): Promise<void> {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

async function withSettings(startOfDay: string, endOfDay: string): Promise<InMemoryDataAccess> {
    const data = new InMemoryDataAccess(makeAppState());
    await data.updateSettings({ ...makeAppState().settings, start_of_day: startOfDay, end_of_day: endOfDay });
    return data;
}

describe("CalendarBusyProvider", () => {
    beforeEach(() => {
        localStorage.clear();
        captured = null;
        vi.useFakeTimers({ shouldAdvanceTime: true });
        vi.setSystemTime(NOW);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("fetches exactly once on mount for non-default day edges", async () => {
        const data = await withSettings("07:00", "22:00");
        const access = createAccess();
        access.fetchBusyIntervals.mockResolvedValue(busyResult());
        render(wrap(data, access));

        await waitFor(() => expect(access.fetchBusyIntervals).toHaveBeenCalledTimes(1));
        const expected = resolvePetScheduleDay(new Date(), "07:00", "22:00");
        expect(access.fetchBusyIntervals).toHaveBeenCalledWith({
            timeMin: expected.dayStart.toISOString(),
            timeMax: expected.dayEnd.toISOString(),
        });
        expect(expected.dayStart.getHours()).toBe(7);
        expect(expected.dayEnd.getHours()).toBe(22);
    });

    it("resolves an overnight day edge pair and fetches once on mount", async () => {
        vi.setSystemTime(new Date(2026, 8, 17, 23, 0, 0, 0));
        const data = await withSettings("20:00", "08:00");
        const access = createAccess();
        access.fetchBusyIntervals.mockResolvedValue(busyResult());
        render(wrap(data, access));

        await waitFor(() => expect(access.fetchBusyIntervals).toHaveBeenCalledTimes(1));
        const expected = resolvePetScheduleDay(new Date(), "20:00", "08:00");
        expect(access.fetchBusyIntervals).toHaveBeenCalledWith({
            timeMin: expected.dayStart.toISOString(),
            timeMax: expected.dayEnd.toISOString(),
        });
        expect(expected.dayStart.getDate()).toBe(17);
        expect(expected.dayEnd.getDate()).toBe(18);
    });

    it("does not fetch from the one-second app tick or re-renders", async () => {
        const data = await withSettings("07:00", "22:00");
        const access = createAccess();
        access.fetchBusyIntervals.mockResolvedValue(busyResult());
        render(wrap(data, access));
        await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ok"));

        await advance(5_000);
        expect(access.fetchBusyIntervals).toHaveBeenCalledTimes(1);
    });

    it("refetches once on window focus and once on manual refresh", async () => {
        const data = await withSettings("07:00", "22:00");
        const access = createAccess();
        access.fetchBusyIntervals.mockResolvedValue(busyResult());
        render(wrap(data, access));
        await waitFor(() => expect(access.fetchBusyIntervals).toHaveBeenCalledTimes(1));

        await act(async () => { window.dispatchEvent(new Event("focus")); });
        await waitFor(() => expect(access.fetchBusyIntervals).toHaveBeenCalledTimes(2));

        await act(async () => { captured!.refresh(); });
        await waitFor(() => expect(access.fetchBusyIntervals).toHaveBeenCalledTimes(3));
    });

    it("refetches once with the new range when an app-settings edge changes", async () => {
        const data = await withSettings("07:00", "22:00");
        const access = createAccess();
        access.fetchBusyIntervals.mockResolvedValue(busyResult());
        render(wrap(data, access));
        await waitFor(() => expect(access.fetchBusyIntervals).toHaveBeenCalledTimes(1));

        await act(async () => {
            await data.updateSettings({ ...makeAppState().settings, start_of_day: "07:00", end_of_day: "21:00" });
        });
        await waitFor(() => expect(access.fetchBusyIntervals).toHaveBeenCalledTimes(2));

        const expected = resolvePetScheduleDay(new Date(), "07:00", "21:00");
        expect(access.fetchBusyIntervals).toHaveBeenLastCalledWith({
            timeMin: expected.dayStart.toISOString(),
            timeMax: expected.dayEnd.toISOString(),
        });
        expect(expected.dayEnd.getHours()).toBe(21);
    });

    it("refetches exactly once across the schedule-day rollover", async () => {
        vi.setSystemTime(new Date(2026, 8, 17, 6, 30, 0, 0));
        const data = await withSettings("07:00", "22:00");
        const access = createAccess();
        access.fetchBusyIntervals.mockResolvedValue(busyResult());
        render(wrap(data, access));
        await waitFor(() => expect(access.fetchBusyIntervals).toHaveBeenCalledTimes(1));

        vi.setSystemTime(new Date(2026, 8, 17, 7, 0, 10, 0));
        await advance(60_000);
        await waitFor(() => expect(access.fetchBusyIntervals).toHaveBeenCalledTimes(2));

        const expected = resolvePetScheduleDay(new Date(), "07:00", "22:00");
        expect(access.fetchBusyIntervals).toHaveBeenLastCalledWith({
            timeMin: expected.dayStart.toISOString(),
            timeMax: expected.dayEnd.toISOString(),
        });

        await advance(60_000);
        expect(access.fetchBusyIntervals).toHaveBeenCalledTimes(2);
    });

    it("keeps the last good intervals on failure and exposes unavailable with no reconnect action", async () => {
        const data = await withSettings("07:00", "22:00");
        const access = createAccess();
        access.fetchBusyIntervals
            .mockResolvedValueOnce(busyResult())
            .mockRejectedValueOnce(new GoogleCalendarIntegrationError("GOOGLE_TOKEN_INVALID", "token expired"));
        render(wrap(data, access));
        await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ok"));
        expect(captured!.snapshot.intervals).toEqual([BUSY]);
        expect(captured!.snapshot.refreshedAt).toBe(REFRESHED_AT);

        await act(async () => { captured!.refresh(); });
        await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("unavailable"));
        expect(captured!.snapshot.intervals).toEqual([BUSY]);
        expect(captured!.snapshot.refreshedAt).toBe(REFRESHED_AT);
        expect(screen.queryByRole("button")).toBeNull();
        expect(screen.queryByRole("link")).toBeNull();
    });

    it("reports empty when Google Calendar is not configured", async () => {
        const data = await withSettings("07:00", "22:00");
        const access = createAccess();
        access.fetchBusyIntervals.mockRejectedValue(new GoogleCalendarIntegrationError("GOOGLE_CALENDAR_NOT_CONFIGURED", "not connected"));
        render(wrap(data, access));

        await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("empty"));
        expect(captured!.snapshot.intervals).toEqual([]);
    });

    it("reports empty when every consulted source has no selected calendars", async () => {
        const data = await withSettings("07:00", "22:00");
        const access = createAccess();
        access.fetchBusyIntervals.mockResolvedValue(busyResult({
            intervals: [],
            sources: [{ connectionId: "connection-1", accountEmail: null, calendarCount: 0, busyMinutes: 0, errorCode: null }],
        }));
        render(wrap(data, access));

        await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("empty"));
        expect(captured!.snapshot.intervals).toEqual([]);
    });

    it("keeps a partial source failure as ok with the returned intervals", async () => {
        const data = await withSettings("07:00", "22:00");
        const access = createAccess();
        access.fetchBusyIntervals.mockResolvedValue(busyResult({
            sources: [
                { connectionId: "connection-1", accountEmail: null, calendarCount: 2, busyMinutes: 0, errorCode: "GOOGLE_TOKEN_INVALID" },
                { connectionId: "connection-2", accountEmail: null, calendarCount: 1, busyMinutes: 30, errorCode: null },
            ],
        }));
        render(wrap(data, access));

        await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ok"));
        expect(captured!.snapshot.intervals).toEqual([BUSY]);
    });

    it("applies only the newest request when a slow response settles after a newer one", async () => {
        const data = await withSettings("07:00", "22:00");
        const access = createAccess();
        const slow = deferred<GoogleCalendarBusyResult>();
        const fast = deferred<GoogleCalendarBusyResult>();
        access.fetchBusyIntervals.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);
        render(wrap(data, access));
        await waitFor(() => expect(access.fetchBusyIntervals).toHaveBeenCalledTimes(1));

        await act(async () => { captured!.refresh(); });
        await waitFor(() => expect(access.fetchBusyIntervals).toHaveBeenCalledTimes(2));

        const newer = busyResult({
            intervals: [{ start: "2026-09-17T14:00:00.000Z", end: "2026-09-17T14:30:00.000Z" }],
            refreshedAt: "2026-09-17T12:00:02.000Z",
        });
        await act(async () => { fast.resolve(newer); await fast.promise; });
        await waitFor(() => expect(captured!.snapshot.refreshedAt).toBe(newer.refreshedAt));

        await act(async () => {
            slow.resolve(busyResult({
                intervals: [{ start: "2026-09-17T09:00:00.000Z", end: "2026-09-17T09:30:00.000Z" }],
                refreshedAt: "2026-09-17T12:00:01.000Z",
            }));
            await slow.promise;
        });

        expect(captured!.snapshot.intervals).toEqual(newer.intervals);
        expect(captured!.snapshot.refreshedAt).toBe(newer.refreshedAt);
        expect(captured!.snapshot.status).toBe("ok");
    });

    it("ignores a stale rejection after a newer success", async () => {
        const data = await withSettings("07:00", "22:00");
        const access = createAccess();
        const slow = deferred<GoogleCalendarBusyResult>();
        const fast = deferred<GoogleCalendarBusyResult>();
        access.fetchBusyIntervals.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);
        render(wrap(data, access));
        await waitFor(() => expect(access.fetchBusyIntervals).toHaveBeenCalledTimes(1));

        await act(async () => { captured!.refresh(); });
        await waitFor(() => expect(access.fetchBusyIntervals).toHaveBeenCalledTimes(2));

        const newer = busyResult({
            intervals: [{ start: "2026-09-17T15:00:00.000Z", end: "2026-09-17T15:30:00.000Z" }],
            refreshedAt: "2026-09-17T12:00:03.000Z",
        });
        await act(async () => { fast.resolve(newer); await fast.promise; });
        await waitFor(() => expect(captured!.snapshot.refreshedAt).toBe(newer.refreshedAt));

        await act(async () => {
            slow.reject(new GoogleCalendarIntegrationError("GOOGLE_TOKEN_INVALID", "stale failure"));
            await Promise.resolve();
        });

        expect(captured!.snapshot.status).toBe("ok");
        expect(captured!.snapshot.intervals).toEqual(newer.intervals);
        expect(captured!.snapshot.refreshedAt).toBe(newer.refreshedAt);
    });

    it("keeps snapshot and refresh identity stable across a parent re-render", async () => {
        const data = await withSettings("07:00", "22:00");
        const access = createAccess();
        access.fetchBusyIntervals.mockResolvedValue(busyResult());
        const view = render(wrap(data, access));
        await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ok"));

        const firstSnapshot = captured!.snapshot;
        const firstRefresh = captured!.refresh;
        view.rerender(wrap(data, access));

        expect(captured!.snapshot).toBe(firstSnapshot);
        expect(captured!.refresh).toBe(firstRefresh);
        expect(access.fetchBusyIntervals).toHaveBeenCalledTimes(1);
    });

    it("returns the documented default outside any provider without throwing", () => {
        render(<Probe />);

        expect(captured!.snapshot.status).toBe("empty");
        expect(captured!.snapshot.intervals).toEqual([]);
        expect(captured!.snapshot.refreshedAt).toBeNull();
        expect(captured!.snapshot.dayStart.getTime()).toBe(0);
        expect(captured!.snapshot.dayEnd.getTime()).toBe(0);
        expect(() => captured!.refresh()).not.toThrow();
    });
});
