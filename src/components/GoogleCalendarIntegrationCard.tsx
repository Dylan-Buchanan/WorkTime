import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronDown, RefreshCw, X } from "lucide-react";
import type {
    GoogleCalendarChoice,
    GoogleCalendarDataAccess,
    GoogleCalendarEvent,
    GoogleCalendarSettings,
} from "../lib/data/GoogleCalendarDataAccess";
import { consumeGoogleCalendarOAuthReturn } from "../lib/integrations";

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

export const GoogleCalendarIntegrationCard = ({
    dataAccess,
    navigateTo = (url) => window.location.assign(url),
}: GoogleCalendarIntegrationCardProps) => {
    const [settings, setSettings] = useState<GoogleCalendarSettings | null>(null);
    const [calendars, setCalendars] = useState<GoogleCalendarChoice[]>([]);
    const [events, setEvents] = useState<GoogleCalendarEvent[]>([]);
    const [eventsLoading, setEventsLoading] = useState(false);
    const [selected, setSelected] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [open, setOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const now = new Date();
    const week = currentWeek(now);

    const loadEvents = useCallback(async () => {
        const days = currentWeek();
        const timeMax = new Date(days[6]);
        timeMax.setDate(timeMax.getDate() + 1);
        setEventsLoading(true);
        try { setEvents(await dataAccess.fetchEvents({ timeMin: days[0].toISOString(), timeMax: timeMax.toISOString() })); }
        catch (reason) { setError(message(reason)); }
        finally { setEventsLoading(false); }
    }, [dataAccess]);

    const loadCalendars = useCallback(async () => {
        setBusy(true);
        setError(null);
        try { setCalendars(await dataAccess.listCalendars()); }
        catch (reason) { setError(message(reason)); }
        finally { setBusy(false); }
    }, [dataAccess]);

    useEffect(() => {
        let active = true;
        const returned = consumeGoogleCalendarOAuthReturn();
        if (returned?.errorCode) setNotice(`Google authorization did not complete (${returned.errorCode}).`);
        else if (returned?.connected) setNotice("Google Calendar connected.");
        void dataAccess.loadSettings().then((value) => {
            if (!active) return;
            setSettings(value);
            setSelected(value?.selectedCalendarIds ?? []);
            setLoading(false);
            if (value) {
                void loadCalendars();
                void loadEvents();
            }
        }).catch((reason) => {
            if (!active) return;
            setError(message(reason));
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

    async function connect() {
        setBusy(true);
        setError(null);
        try {
            const returnTo = `${window.location.origin}${window.location.pathname}`;
            navigateTo(await dataAccess.beginAuthorization({ scopeLevel: "readonly", returnTo }));
        } catch (reason) {
            setError(message(reason));
            setBusy(false);
        }
    }

    async function saveSelection() {
        setBusy(true);
        setError(null);
        setNotice(null);
        try {
            await dataAccess.updateSelectedCalendars(selected);
            const next = await dataAccess.loadSettings();
            setSettings(next);
            setSelected(next?.selectedCalendarIds ?? []);
            setNotice("Calendar selection saved.");
            setOpen(false);
            await loadEvents();
        } catch (reason) { setError(message(reason)); }
        finally { setBusy(false); }
    }

    async function disconnect() {
        if (!window.confirm("Disconnect Google Calendar? Existing WorkTime calendar events will remain in Google.")) return;
        setBusy(true);
        setError(null);
        try {
            await dataAccess.disconnect();
            setSettings(null);
            setCalendars([]);
            setEvents([]);
            setSelected([]);
            setNotice("Google Calendar disconnected. Existing Google events were left in place.");
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
                        {settings && <span className="rounded-full border border-emerald-800 bg-emerald-950/40 px-2 py-0.5 text-[9px] text-emerald-300">
                            {settings.scopeLevel === "schedule" ? "Connected — can schedule" : "Connected — read only"}
                        </span>}
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-neutral-400">Selected calendars shape your Start-of-Day budget. WorkTime schedules a task only when you explicitly push it.</p>
                </div>
                {settings && <button type="button" aria-label="Disconnect Google Calendar" onClick={() => void disconnect()} disabled={busy} className="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-50"><X size={15} /></button>}
            </div>

            {loading ? <p role="status" className="mt-5 text-[10px] text-neutral-500">Loading Google Calendar…</p> : !settings ? (
                <div className="mt-auto border-t border-neutral-800 pt-4">
                    <button type="button" onClick={() => void connect()} disabled={busy} className="rounded bg-neutral-100 px-3 py-1.5 text-[10px] font-medium text-neutral-950 disabled:opacity-50">{busy ? "Opening Google…" : "Connect read only"}</button>
                </div>
            ) : (
                <div className="mt-4 border-t border-neutral-800 pt-3">
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
                                            return (
                                                <article key={event.id} data-past={eventPassed || undefined} className={`rounded border px-1.5 py-1 ${eventPassed ? "border-neutral-800 bg-neutral-950/70 opacity-55" : "border-neutral-700 bg-neutral-900"}`}>
                                                    <p className={`truncate text-[9px] font-medium ${eventPassed ? "text-neutral-500 line-through decoration-neutral-700" : "text-neutral-200"}`} title={event.title}>{event.title}</p>
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
                    <div ref={rootRef} className="relative">
                        <button
                            type="button"
                            onClick={() => setOpen((value) => !value)}
                            aria-haspopup="dialog"
                            aria-expanded={open}
                            aria-controls="google-calendar-picker"
                            disabled={busy}
                            className="mt-3 flex w-full items-center justify-between gap-2 rounded border border-neutral-700 bg-neutral-950/60 px-2.5 py-2 text-[10px] text-neutral-200 hover:bg-neutral-800/60 disabled:opacity-50"
                        >
                            <span className="flex min-w-0 items-center gap-2">
                                <CalendarDays aria-hidden="true" size={12} className="shrink-0 text-neutral-500" />
                                <span className="truncate">Busy-time calendars</span>
                            </span>
                            <span className="flex shrink-0 items-center gap-1.5 text-neutral-400">
                                <span className="rounded-full border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-[9px]">{selected.length} of 50</span>
                                <ChevronDown aria-hidden="true" size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
                            </span>
                        </button>
                        {open && (
                            <div id="google-calendar-picker" className="absolute left-0 right-0 top-full z-10 mt-1 rounded-lg border border-neutral-700 bg-neutral-900 p-1.5 shadow-xl">
                                <div className="flex items-center justify-between gap-2 px-1 pb-1.5">
                                    <p className="text-[10px] font-medium text-neutral-300">Select calendars for busy time</p>
                                    <button type="button" onClick={() => void loadCalendars()} disabled={busy} aria-label="Refresh calendar list" className="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-100 disabled:opacity-50"><RefreshCw size={11} /></button>
                                </div>
                                <div className="max-h-40 overflow-y-auto pr-0.5">
                                    {calendars.length === 0 ? <p className="px-2 py-3 text-[10px] text-neutral-500">No readable calendars found.</p> : calendars.map((calendar) => (
                                        <label key={calendar.id} className="flex min-w-0 cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[10px] hover:bg-neutral-800/70">
                                            <input type="checkbox" checked={selected.includes(calendar.id)} onChange={() => toggle(calendar.id)} disabled={busy || (!selected.includes(calendar.id) && selected.length >= 50)} />
                                            <span className="truncate">{calendar.summary}{calendar.primary ? " (primary)" : ""}</span>
                                        </label>
                                    ))}
                                </div>
                                <div className="mt-1.5 flex items-center justify-end gap-2 border-t border-neutral-800 pt-1.5">
                                    <button type="button" onClick={() => { setOpen(false); setSelected(settings.selectedCalendarIds); }} disabled={busy} className="rounded px-2 py-1 text-[10px] text-neutral-400 hover:text-neutral-100 disabled:opacity-50">Cancel</button>
                                    <button type="button" onClick={() => void saveSelection()} disabled={busy} className="rounded bg-neutral-100 px-3 py-1 text-[10px] font-medium text-neutral-950 disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
            {notice && <p role="status" className="mt-3 text-[10px] text-emerald-300">{notice}</p>}
            {error && <p role="alert" className="mt-3 text-[10px] text-red-300">{error}</p>}
        </article>
    );
};
