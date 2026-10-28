import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, RefreshCw, X } from "lucide-react";
import type {
    GoogleCalendarChoice,
    GoogleCalendarConnection,
    GoogleCalendarDataAccess,
    GoogleCalendarEvent,
} from "../lib/data/GoogleCalendarDataAccess";
import { GoogleCalendarIntegrationError } from "../lib/data/GoogleCalendarDataAccess";
import { consumeGoogleCalendarOAuthReturn, googleAccountInitial, googleAccountLabel } from "../lib/integrations";

export interface GoogleCalendarIntegrationCardProps {
    dataAccess: GoogleCalendarDataAccess;
    navigateTo?: (url: string) => void;
}

function message(error: unknown): string {
    return error instanceof Error ? error.message : "Google Calendar request failed.";
}

function currentWeek(now = new Date()): Date[] {
    const monday = new Date(now);
    const day = monday.getDay();
    monday.setDate(monday.getDate() - (day === 0 ? 6 : day - 1));
    monday.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, index) => {
        const date = new Date(monday);
        date.setDate(monday.getDate() + index);
        return date;
    });
}

function dayKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function eventDayKey(event: GoogleCalendarEvent): string {
    if (event.allDay) return event.start.slice(0, 10);
    return dayKey(new Date(event.start));
}

function eventTime(event: GoogleCalendarEvent): string {
    if (event.allDay) return "All day";
    const format = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
    return `${format.format(new Date(event.start))}–${format.format(new Date(event.end))}`;
}

function eventHasPassed(event: GoogleCalendarEvent, now: Date): boolean {
    return event.allDay
        ? event.end.slice(0, 10) <= dayKey(now)
        : new Date(event.end).getTime() <= now.getTime();
}

function eventAccountLabel(event: GoogleCalendarEvent, connections: GoogleCalendarConnection[]): string {
    const connection = event.connectionId
        ? connections.find((value) => value.connectionId === event.connectionId)
        : undefined;
    const connectionEmail = connection?.accountEmail?.trim();
    if (connectionEmail) return connectionEmail;
    // A read can backfill a legacy connection's identity after the connection
    // list was loaded, so the event's attribution may be newer than the snapshot.
    const eventEmail = event.accountEmail?.trim();
    if (eventEmail) return eventEmail;
    const primary = connection?.primaryCalendarId?.trim();
    if (primary) return primary;
    return event.connectionId ? "Unknown account" : "Unidentified";
}

const CHIP_CLASSES = [
    "border-sky-700 bg-sky-950/70 text-sky-200",
    "border-amber-700 bg-amber-950/70 text-amber-200",
    "border-violet-700 bg-violet-950/70 text-violet-200",
    "border-emerald-700 bg-emerald-950/70 text-emerald-200",
    "border-rose-700 bg-rose-950/70 text-rose-200",
];

function chipClass(connectionId?: string): string {
    if (!connectionId) return "border-neutral-700 bg-neutral-900 text-neutral-300";
    let hash = 0;
    for (let index = 0; index < connectionId.length; index += 1) {
        hash = (hash * 31 + connectionId.charCodeAt(index)) | 0;
    }
    return CHIP_CLASSES[Math.abs(hash) % CHIP_CLASSES.length];
}

export const GoogleCalendarIntegrationCard = ({
    dataAccess,
    navigateTo = (url) => window.location.assign(url),
}: GoogleCalendarIntegrationCardProps) => {
    const [connections, setConnections] = useState<GoogleCalendarConnection[]>([]);
    const [editingConnectionId, setEditingConnectionId] = useState<string | null>(null);
    const [calendars, setCalendars] = useState<GoogleCalendarChoice[]>([]);
    const [events, setEvents] = useState<GoogleCalendarEvent[]>([]);
    const [sourceErrors, setSourceErrors] = useState<Record<string, string | null>>({});
    const [eventsLoading, setEventsLoading] = useState(false);
    const [selected, setSelected] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [open, setOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [errorCode, setErrorCode] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const schedulingConnection = connections.find((connection) => connection.isSchedulingTarget) ?? null;
    const editingConnection = connections.find((connection) => connection.connectionId === editingConnectionId) ?? null;
    const visibleCalendars = editingConnection
        ? calendars.filter((calendar) => calendar.connectionId === editingConnection.connectionId
            || (!calendar.connectionId && connections.length === 1))
        : [];
    const reconnectFallback = schedulingConnection ?? connections[0] ?? null;
    // A global token failure means the server could not prepare any credential,
    // so it returns no per-source attribution. Keep an account-specific
    // reconnect action available rather than forcing the fallback account.
    const tokenFailureWithoutAttribution = errorCode === "GOOGLE_TOKEN_INVALID"
        && !Object.values(sourceErrors).includes("GOOGLE_TOKEN_INVALID");
    const now = new Date();
    const week = currentWeek(now);

    const loadEvents = useCallback(async () => {
        const days = currentWeek();
        const timeMax = new Date(days[6]);
        timeMax.setDate(timeMax.getDate() + 1);
        setEventsLoading(true);
        setError(null);
        setErrorCode(null);
        try { setEvents(await dataAccess.fetchEvents({ timeMin: days[0].toISOString(), timeMax: timeMax.toISOString() })); }
        catch (reason) {
            setError(message(reason));
            setErrorCode(reason instanceof GoogleCalendarIntegrationError ? reason.code : null);
        }
        finally { setEventsLoading(false); }
    }, [dataAccess]);

    const loadCalendars = useCallback(async () => {
        setBusy(true);
        setError(null);
        setErrorCode(null);
        try {
            const result = await dataAccess.listCalendars();
            setCalendars(result.calendars);
            setSourceErrors(Object.fromEntries(result.sources.map((source) => [source.connectionId, source.errorCode])));
        } catch (reason) {
            setError(message(reason));
            setErrorCode(reason instanceof GoogleCalendarIntegrationError ? reason.code : null);
        }
        finally { setBusy(false); }
    }, [dataAccess]);

    useEffect(() => {
        let active = true;
        const returned = consumeGoogleCalendarOAuthReturn();
        if (returned?.errorCode === "GOOGLE_ACCOUNT_LIMIT_REACHED") setNotice("Google Calendar already has 5 connected accounts. Disconnect one before adding another.");
        else if (returned?.errorCode) setNotice(`Google authorization did not complete (${returned.errorCode}).`);
        else if (returned?.connected) setNotice("Google Calendar connected.");
        void dataAccess.loadConnections().then(async (accounts) => {
            if (!active) return;
            setConnections(accounts);
            setLoading(false);
            if (returned?.connected && returned.connectionId) {
                const account = accounts.find((value) => value.connectionId === returned.connectionId);
                if (account) setNotice(`Google Calendar connected: ${googleAccountLabel(account)}.`);
            }
            if (accounts.length > 0) await Promise.all([loadCalendars(), loadEvents()]);
        }).catch((reason) => {
            if (!active) return;
            setError(message(reason));
            setErrorCode(reason instanceof GoogleCalendarIntegrationError ? reason.code : null);
            setLoading(false);
        });
        return () => { active = false; };
    }, [dataAccess, loadCalendars, loadEvents]);

    useEffect(() => {
        if (!open) return;
        const onPointerDown = (event: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") setOpen(false);
        };
        document.addEventListener("mousedown", onPointerDown);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("mousedown", onPointerDown);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [open]);

    async function connect(account?: GoogleCalendarConnection) {
        setBusy(true);
        setError(null);
        setErrorCode(null);
        try {
            const returnTo = `${window.location.origin}${window.location.pathname}`;
            navigateTo(await dataAccess.beginAuthorization({
                scopeLevel: account?.scopeLevel ?? "readonly",
                ...(account ? { connectionId: account.connectionId } : {}),
                returnTo,
            }));
        } catch (reason) {
            setError(message(reason));
            setErrorCode(reason instanceof GoogleCalendarIntegrationError ? reason.code : null);
            setBusy(false);
        }
    }

    async function saveSelection() {
        if (!editingConnection) {
            setError("Choose a Google account before saving calendars.");
            return;
        }
        setBusy(true);
        setError(null);
        setErrorCode(null);
        setNotice(null);
        try {
            await dataAccess.updateSelectedCalendars(editingConnection.connectionId, selected);
            const accounts = await dataAccess.loadConnections();
            setConnections(accounts);
            const updated = accounts.find((connection) => connection.connectionId === editingConnection.connectionId);
            setSelected(updated?.selectedCalendarIds ?? []);
            setNotice("Calendar selection saved.");
            setOpen(false);
            await loadEvents();
        } catch (reason) {
            setError(message(reason));
            setErrorCode(reason instanceof GoogleCalendarIntegrationError ? reason.code : null);
        }
        finally { setBusy(false); }
    }

    async function refreshAccounts() {
        const accounts = await dataAccess.loadConnections();
        setConnections(accounts);
        setEditingConnectionId(null);
        setSelected([]);
        setOpen(false);
        if (accounts.length > 0) {
            await loadCalendars();
            await loadEvents();
        } else {
            setCalendars([]);
            setEvents([]);
            setSourceErrors({});
        }
    }

    async function disconnect(connectionId?: string) {
        if (!window.confirm(connectionId
            ? "Disconnect this Google account? Existing WorkTime calendar events will remain in Google."
            : "Disconnect ALL Google accounts? Existing WorkTime calendar events will remain in Google.")) return;
        setBusy(true);
        setError(null);
        setErrorCode(null);
        try {
            await dataAccess.disconnect(connectionId);
            await refreshAccounts();
            setNotice(connectionId
                ? "Google account disconnected. Existing Google events were left in place."
                : "Google accounts disconnected. Existing Google events were left in place.");
        } catch (reason) { setError(message(reason)); }
        finally { setBusy(false); }
    }

    async function switchTarget(connectionId: string) {
        const label = googleAccountLabel(connections.find((connection) => connection.connectionId === connectionId));
        setBusy(true);
        setError(null);
        setErrorCode(null);
        setNotice(null);
        try {
            await dataAccess.setSchedulingConnection(connectionId);
            await refreshAccounts();
            setNotice(`Focus events now use ${label}.`);
        }
        catch (reason) { setError(message(reason)); }
        finally { setBusy(false); }
    }

    async function openPicker(connectionId: string) {
        if (open && editingConnectionId === connectionId) { setOpen(false); return; }
        setBusy(true);
        setError(null);
        setErrorCode(null);
        try {
            const accounts = await dataAccess.loadConnections();
            setConnections(accounts);
            const account = accounts.find((value) => value.connectionId === connectionId);
            if (!account) throw new Error("Google account was disconnected. Refresh and try again.");
            setEditingConnectionId(account.connectionId);
            setSelected(account.selectedCalendarIds);
            setOpen(true);
        } catch (reason) { setError(message(reason)); }
        finally { setBusy(false); }
    }

    const toggle = (id: string) => setSelected((current) => current.includes(id)
        ? current.filter((value) => value !== id)
        : current.length < 50 ? [...current, id] : current);

    return (
        <article aria-labelledby="integration-google-calendar-title" className="flex min-h-52 flex-col rounded-lg border border-neutral-800 bg-neutral-900/60 p-4 sm:col-span-2">
            <div className="flex items-start gap-3">
                <span className="rounded-lg border border-neutral-700 bg-neutral-950 p-2 text-neutral-300"><CalendarDays aria-hidden="true" size={20} /></span>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <h2 id="integration-google-calendar-title" className="text-sm font-semibold text-neutral-100">Google Calendar</h2>
                        {connections.length > 0 && <span className="rounded-full border border-neutral-700 bg-neutral-950/60 px-2 py-0.5 text-[9px] text-neutral-300">
                            {connections.length} account{connections.length === 1 ? "" : "s"}
                        </span>}
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-neutral-400">Busy-time calendars from every connected account shape your Start-of-Day budget. WorkTime schedules a task only when you explicitly push it.</p>
                </div>
                {connections.length > 0 && <button type="button" aria-label="Disconnect all Google accounts" onClick={() => void disconnect()} disabled={busy} className="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-50"><X size={15} /></button>}
            </div>

            {loading ? <p role="status" className="mt-5 text-[10px] text-neutral-500">Loading Google Calendar…</p> : connections.length === 0 ? (
                <div className="mt-auto border-t border-neutral-800 pt-4">
                    <p className="mb-2 text-[10px] text-neutral-500">No Google accounts are connected.</p>
                    <button type="button" onClick={() => void connect()} disabled={busy} className="rounded bg-neutral-100 px-3 py-1.5 text-[10px] font-medium text-neutral-950 disabled:opacity-50">{busy ? "Opening Google…" : "Connect read only"}</button>
                </div>
            ) : (
                <div className="mt-4 border-t border-neutral-800 pt-3">
                    {!schedulingConnection && <p role="status" className="mb-2 text-[10px] text-amber-300">Choose a Google account for focus events.</p>}
                    <div ref={rootRef}>
                        <ul aria-label="Connected Google accounts" className="mb-3 space-y-2 text-[10px] text-neutral-300">
                            {connections.map((account) => {
                                const label = googleAccountLabel(account);
                                const sourceError = sourceErrors[account.connectionId];
                                const invalidToken = sourceError === "GOOGLE_TOKEN_INVALID";
                                const canReconnect = invalidToken || tokenFailureWithoutAttribution;
                                const pickerOpen = open && editingConnectionId === account.connectionId;
                                return <li key={account.connectionId} className="rounded-md border border-neutral-800 bg-neutral-950/40 p-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <input
                                            type="radio"
                                            name="google-focus-events"
                                            checked={account.isSchedulingTarget}
                                            onChange={() => void switchTarget(account.connectionId)}
                                            disabled={busy}
                                            aria-label={`Use ${label} for focus events`}
                                            className="h-3 w-3 accent-violet-500"
                                        />
                                        <span className="min-w-0 truncate font-medium text-neutral-200">{label}</span>
                                        <span className="rounded-full border border-emerald-800 bg-emerald-950/40 px-2 py-0.5 text-[9px] text-emerald-300">
                                            {account.scopeLevel === "schedule" ? "Connected — can schedule" : "Connected — read only"}
                                        </span>
                                        {account.isSchedulingTarget && <span className="rounded-full border border-violet-800 bg-violet-950/40 px-2 py-0.5 text-[9px] text-violet-200">Focus events</span>}
                                        <button type="button" disabled={busy} onClick={() => void openPicker(account.connectionId)} aria-expanded={pickerOpen} aria-controls={`google-calendar-picker-${account.connectionId}`} className="rounded border border-neutral-700 px-2 py-1 text-[9px] text-neutral-200 hover:bg-neutral-800 disabled:opacity-50">
                                            Busy-time calendars ({account.selectedCalendarIds.length} of 50)
                                        </button>
                                        {canReconnect && <button type="button" disabled={busy} onClick={() => void connect(account)} aria-label={`Reconnect ${label}`} className="rounded border border-amber-700 px-2 py-1 text-[9px] text-amber-200 hover:bg-amber-950/40 disabled:opacity-50">Reconnect</button>}
                                        <button type="button" disabled={busy} onClick={() => void disconnect(account.connectionId)} aria-label={`Disconnect ${label}`} className="ml-auto rounded border border-neutral-700 px-2 py-1 text-[9px] text-neutral-400 hover:bg-neutral-800 disabled:opacity-50">Disconnect</button>
                                    </div>
                                    {sourceError && <p role="status" className={`mt-1 text-[9px] ${invalidToken ? "text-amber-300" : "text-red-300"}`}>
                                        {invalidToken
                                            ? `Google Calendar access for ${label} needs reconnection.`
                                            : `Google Calendar access for ${label} failed (${sourceError}).`}
                                    </p>}
                                    {pickerOpen && <div id={`google-calendar-picker-${account.connectionId}`} role="group" aria-label={`Busy-time calendars for ${label}`} className="mt-2 rounded-lg border border-neutral-700 bg-neutral-900 p-1.5">
                                        <div className="flex items-center justify-between gap-2 px-1 pb-1.5">
                                            <p className="text-[10px] font-medium text-neutral-300">Busy-time calendars for {label}</p>
                                            <button type="button" onClick={() => void loadCalendars()} disabled={busy} aria-label="Refresh calendar list" className="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-100 disabled:opacity-50"><RefreshCw size={11} /></button>
                                        </div>
                                        <div className="max-h-40 overflow-y-auto pr-0.5">
                                            {visibleCalendars.length === 0 ? <p className="px-2 py-3 text-[10px] text-neutral-500">No readable calendars found.</p> : visibleCalendars.map((calendar) => (
                                                <label key={`${calendar.connectionId ?? ""}:${calendar.id}`} className="flex min-w-0 cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[10px] hover:bg-neutral-800/70">
                                                    <input type="checkbox" checked={selected.includes(calendar.id)} onChange={() => toggle(calendar.id)} disabled={busy || (!selected.includes(calendar.id) && selected.length >= 50)} />
                                                    <span className="truncate">{calendar.summary}{calendar.primary ? " (primary)" : ""}</span>
                                                </label>
                                            ))}
                                        </div>
                                        <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-neutral-800 pt-1.5">
                                            <span className="text-[9px] text-neutral-500">{selected.length} of 50 selected</span>
                                            <div className="flex items-center gap-2">
                                                <button type="button" onClick={() => { setOpen(false); setSelected(editingConnection?.selectedCalendarIds ?? []); }} disabled={busy} className="rounded px-2 py-1 text-[10px] text-neutral-400 hover:text-neutral-100 disabled:opacity-50">Cancel</button>
                                                <button type="button" onClick={() => void saveSelection()} disabled={busy} className="rounded bg-neutral-100 px-3 py-1 text-[10px] font-medium text-neutral-950 disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
                                            </div>
                                        </div>
                                    </div>}
                                </li>;
                            })}
                        </ul>
                    </div>
                    <div className="mb-3">
                        <button type="button" disabled={busy || connections.length >= 5} onClick={() => void connect()} aria-describedby={connections.length >= 5 ? "google-calendar-account-cap" : undefined} className="text-[10px] text-neutral-200 disabled:opacity-50">Add Google account</button>
                        {connections.length >= 5 && <p id="google-calendar-account-cap" className="mt-1 text-[9px] text-neutral-500">Google Calendar supports up to 5 accounts. Disconnect one to add another.</p>}
                    </div>
                    <div className="mb-3 flex items-center justify-between gap-2">
                        <div>
                            <p className="text-[10px] font-medium text-neutral-200">This week</p>
                            <p className="text-[9px] text-neutral-500">{week[0].toLocaleDateString(undefined, { month: "short", day: "numeric" })}–{week[6].toLocaleDateString(undefined, { month: "short", day: "numeric" })}</p>
                        </div>
                        <button type="button" onClick={() => void loadEvents()} disabled={eventsLoading || busy} aria-label="Refresh this week's calendar" className="rounded p-1.5 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-100 disabled:opacity-50">
                            <RefreshCw aria-hidden="true" size={12} className={eventsLoading ? "animate-spin" : ""} />
                        </button>
                    </div>
                    <div aria-label="Current week calendar" className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-7">
                        {week.map((date) => {
                            const dateEvents = events.filter((event) => eventDayKey(event) === dayKey(date));
                            const today = dayKey(date) === dayKey(now);
                            const passed = dayKey(date) < dayKey(now);
                            return (
                                <section key={dayKey(date)} aria-label={date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })} data-past={passed || undefined} className={`min-h-24 rounded-md border p-1.5 ${today ? "border-sky-800 bg-sky-950/20" : passed ? "border-neutral-900 bg-neutral-950/20 opacity-60" : "border-neutral-800 bg-neutral-950/40"}`}>
                                    <div className="mb-1.5 flex items-baseline justify-between gap-1">
                                        <span className={`text-[9px] font-semibold uppercase tracking-wide ${today ? "text-sky-300" : "text-neutral-400"}`}>{date.toLocaleDateString(undefined, { weekday: "short" })}</span>
                                        <span className="text-[9px] text-neutral-600">{date.getDate()}</span>
                                    </div>
                                    <div className="space-y-1">
                                        {dateEvents.map((event) => {
                                            const eventPassed = eventHasPassed(event, now);
                                            const label = eventAccountLabel(event, connections);
                                            return (
                                                <article key={`${event.connectionId ?? ""}:${event.id}`} data-past={eventPassed || undefined} title={`${event.title} — ${label}`} className={`rounded border px-1.5 py-1 ${eventPassed ? "border-neutral-800 bg-neutral-950/70 opacity-55" : "border-neutral-700 bg-neutral-900"}`}>
                                                    <div className="flex items-start justify-between gap-1">
                                                        <p className={`min-w-0 truncate text-[9px] font-medium ${eventPassed ? "text-neutral-500 line-through decoration-neutral-700" : "text-neutral-200"}`} title={event.title}>{event.title}</p>
                                                        <span aria-label={`Google account ${label}`} title={`Google account: ${label}`} className={`shrink-0 rounded-full border px-1 text-[8px] font-semibold leading-4 ${chipClass(event.connectionId)}`}>{googleAccountInitial(label)}</span>
                                                    </div>
                                                    <p className={`mt-0.5 truncate text-[8px] ${eventPassed ? "text-neutral-700" : "text-neutral-500"}`}>{eventTime(event)}</p>
                                                </article>
                                            );
                                        })}
                                        {!eventsLoading && dateEvents.length === 0 && <p className="pt-1 text-center text-[8px] text-neutral-700">No events</p>}
                                    </div>
                                </section>
                            );
                        })}
                    </div>
                    {eventsLoading && <p role="status" className="mt-2 text-[9px] text-neutral-500">Loading this week…</p>}
                </div>
            )}
            {notice && <p role="status" className="mt-3 text-[10px] text-emerald-300">{notice}</p>}
            {error && <div className="mt-3 text-[10px] text-red-300">
                <p role="alert">{error}</p>
                {errorCode === "GOOGLE_TOKEN_INVALID" && <button type="button" onClick={() => void connect(reconnectFallback ?? undefined)} disabled={busy} className="mt-1 underline underline-offset-2 disabled:opacity-50">{busy ? "Opening Google…" : "Reconnect"}</button>}
            </div>}
        </article>
    );
};
