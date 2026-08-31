import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type {
    GoogleCalendarDataAccess,
    GoogleCalendarPushInput,
    GoogleCalendarSettings,
    GoogleCalendarTaskLink,
} from "../../lib/data/GoogleCalendarDataAccess";
import { GoogleCalendarIntegrationError } from "../../lib/data/GoogleCalendarDataAccess";
import type { GoogleCalendarOAuthReturn } from "../../lib/integrations";
import type { PMTask } from "../../state/types";

export interface GoogleCalendarTaskSectionProps {
    task: PMTask;
    workMinutes: number;
    dataAccess: GoogleCalendarDataAccess;
    resume?: GoogleCalendarOAuthReturn | null;
    onResumeConsumed?: () => void;
    navigateTo?: (url: string) => void;
}

function localDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function localTime(date: Date): string {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function suggestedStart(task: PMTask): Date {
    const now = new Date();
    const result = new Date(now.getTime());
    result.setSeconds(0, 0);
    result.setMinutes(Math.ceil((result.getMinutes() + 1) / 30) * 30);
    if (task.dueDate) {
        const [year, month, day] = task.dueDate.split("-").map(Number);
        if (year && month && day) result.setFullYear(year, month - 1, day);
    }
    return result;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Google Calendar operation failed.";
}

export const GoogleCalendarTaskSection = ({
    task,
    workMinutes,
    dataAccess,
    resume,
    onResumeConsumed = () => undefined,
    navigateTo = (url) => window.location.assign(url),
}: GoogleCalendarTaskSectionProps) => {
    const initial = useMemo(() => suggestedStart(task), [task.id]);
    const [dateDraft, setDateDraft] = useState(() => localDate(initial));
    const [timeDraft, setTimeDraft] = useState(() => localTime(initial));
    const [settings, setSettings] = useState<GoogleCalendarSettings | null>(null);
    const [link, setLink] = useState<GoogleCalendarTaskLink | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [conflict, setConflict] = useState<{ action: "push" | "resync"; input: GoogleCalendarPushInput; intervals: Array<{ start: string; end: string }> } | null>(null);
    const resumedRef = useRef<string | null>(null);

    useEffect(() => {
        const value = suggestedStart(task);
        setDateDraft(localDate(value));
        setTimeDraft(localTime(value));
        setConflict(null);
        setError(null);
        setNotice(null);
    }, [task.id]);

    const reload = async () => {
        const [nextSettings, nextLink] = await Promise.all([dataAccess.loadSettings(), dataAccess.loadTaskLink(task.id)]);
        setSettings(nextSettings);
        setLink(nextLink);
        if (nextLink) {
            const start = new Date(nextLink.scheduledStart);
            setDateDraft(localDate(start));
            setTimeDraft(localTime(start));
        }
        return { settings: nextSettings, link: nextLink };
    };

    useEffect(() => {
        let active = true;
        setLoading(true);
        void Promise.all([dataAccess.loadSettings(), dataAccess.loadTaskLink(task.id)]).then(([nextSettings, nextLink]) => {
            if (!active) return;
            setSettings(nextSettings);
            setLink(nextLink);
            if (nextLink) {
                const start = new Date(nextLink.scheduledStart);
                setDateDraft(localDate(start));
                setTimeDraft(localTime(start));
            }
            setLoading(false);
        }).catch((reason) => {
            if (!active) return;
            setError(errorMessage(reason));
            setLoading(false);
        });
        return () => { active = false; };
    }, [dataAccess, task.id]);

    function buildInput(scheduledStart?: string): GoogleCalendarPushInput | null {
        const estimate = Number(task.estimatePomos);
        const start = scheduledStart ? new Date(scheduledStart) : new Date(`${dateDraft}T${timeDraft}:00`);
        if (!task.title.trim()) { setError("Give the task a title before scheduling it."); return null; }
        if (!Number.isInteger(estimate) || estimate <= 0) { setError("Set a whole-pomodoro estimate before scheduling."); return null; }
        if (!Number.isInteger(workMinutes) || workMinutes <= 0) { setError("Work-session minutes are invalid."); return null; }
        if (Number.isNaN(start.getTime())) { setError("Choose a valid date and time."); return null; }
        return { taskId: task.id, title: task.title, scheduledStart: start.toISOString(), estimatePomos: estimate, workMinutes };
    }

    async function write(action: "push" | "resync", input: GoogleCalendarPushInput, allowConflict = false) {
        setBusy(true);
        setError(null);
        setNotice(null);
        setConflict(null);
        try {
            const next = action === "push"
                ? await dataAccess.pushTask({ ...input, allowConflict })
                : await dataAccess.resyncTask({ ...input, allowConflict });
            setLink(next);
            setNotice(action === "push" ? "Task scheduled in Google Calendar." : "Google Calendar event resynced.");
        } catch (reason) {
            if (reason instanceof GoogleCalendarIntegrationError && reason.code === "CALENDAR_CONFLICT") {
                setConflict({ action, input, intervals: reason.conflicts });
            } else setError(errorMessage(reason));
            throw reason;
        } finally { setBusy(false); }
    }

    async function push() {
        const input = buildInput();
        if (!input) return;
        setError(null);
        if (settings?.scopeLevel === "readonly") {
            setBusy(true);
            try {
                const returnTo = `${window.location.origin}${window.location.pathname}`;
                navigateTo(await dataAccess.beginAuthorization({
                    scopeLevel: "schedule",
                    returnTo,
                    pendingTaskId: task.id,
                    pendingScheduledStart: input.scheduledStart,
                }));
            } catch (reason) { setError(errorMessage(reason)); setBusy(false); }
            return;
        }
        try { await write("push", input); } catch { /* feedback is already rendered */ }
    }

    async function resync() {
        const input = buildInput(link?.scheduledStart);
        if (!input) return;
        try { await write("resync", input); } catch { /* feedback is already rendered */ }
    }

    async function unpush() {
        setBusy(true);
        setError(null);
        try {
            await dataAccess.unpushTask(task.id);
            setLink(null);
            setNotice("Task removed from Google Calendar.");
        } catch (reason) { setError(errorMessage(reason)); }
        finally { setBusy(false); }
    }

    useEffect(() => {
        if (!resume?.connected || !resume.pendingTaskId || !resume.pendingScheduledStart || resume.pendingTaskId !== task.id) return;
        const key = `${resume.pendingTaskId}:${resume.pendingScheduledStart}`;
        if (resumedRef.current === key) return;
        resumedRef.current = key;
        void (async () => {
            try {
                const refreshed = await reload();
                if (refreshed.settings?.scopeLevel !== "schedule") throw new Error("Google scheduling permission was not granted.");
                const input = buildInput(resume.pendingScheduledStart!);
                if (!input) throw new Error("The pending task can no longer be scheduled.");
                await write("push", input);
            } catch (reason) {
                if (!(reason instanceof GoogleCalendarIntegrationError && reason.code === "CALENDAR_CONFLICT")) setError(errorMessage(reason));
            } finally { onResumeConsumed(); }
        })();
    // The callback object is intentionally consumed once by its stable values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resume?.connected, resume?.pendingTaskId, resume?.pendingScheduledStart, task.id]);

    if (loading) return <p role="status" className="text-[10px] text-neutral-500">Loading Google Calendar status…</p>;
    if (!settings) return <p className="text-[10px] text-neutral-500">Connect Google Calendar in <Link to="/integrations" className="text-violet-300 underline">Integrations</Link> to schedule focus time.</p>;

    const outOfSync = link && (link.estimatePomos !== Number(task.estimatePomos) || link.workMinutes !== workMinutes);
    return (
        <div className="space-y-2 rounded border border-neutral-800 bg-neutral-950/40 p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <p className="text-[10px] font-medium text-neutral-300">Google focus time</p>
                    <p className="text-[9px] text-neutral-500">{settings.scopeLevel === "schedule" ? "Connected — can schedule" : "Connected — read only"}</p>
                </div>
                {link && <span className={`rounded px-2 py-0.5 text-[9px] ${outOfSync ? "bg-amber-950 text-amber-300" : "bg-emerald-950 text-emerald-300"}`}>{outOfSync ? "Out of sync" : "Scheduled"}</span>}
            </div>
            {settings.selectedCalendarIds.length === 0 && <p className="text-[9px] text-amber-300">Select busy-time calendars in Integrations for conflict warnings and planner shaping.</p>}
            <div className="flex flex-wrap items-center gap-2">
                <input aria-label="Focus date" type="date" value={dateDraft} onChange={(event) => setDateDraft(event.target.value)} disabled={busy || Boolean(link)} className="rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-[10px]" />
                <input aria-label="Focus time" type="time" value={timeDraft} onChange={(event) => setTimeDraft(event.target.value)} disabled={busy || Boolean(link)} className="rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-[10px]" />
                {!link ? <button type="button" onClick={() => void push()} disabled={busy} className="rounded bg-violet-700 px-2.5 py-1 text-[10px] text-white disabled:opacity-50">{busy ? "Scheduling…" : "Push to Google"}</button> : (
                    <>
                        <button type="button" onClick={() => void resync()} disabled={busy} className="rounded bg-neutral-800 px-2.5 py-1 text-[10px] disabled:opacity-50">Resync</button>
                        <button type="button" onClick={() => void unpush()} disabled={busy} className="rounded border border-neutral-700 px-2.5 py-1 text-[10px] text-neutral-400 disabled:opacity-50">Unpush</button>
                    </>
                )}
            </div>
            {conflict && <div role="alert" className="rounded border border-amber-800 bg-amber-950/30 p-2 text-[9px] text-amber-200">
                <p>This focus block overlaps busy time: {conflict.intervals.map((value) => `${new Date(value.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}–${new Date(value.end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`).join(", ")}</p>
                <button type="button" disabled={busy} onClick={() => void write(conflict.action, conflict.input, true).catch(() => undefined)} className="mt-1 rounded bg-amber-800 px-2 py-1 text-[9px] text-white">{conflict.action === "push" ? "Push anyway" : "Resync anyway"}</button>
            </div>}
            {notice && <p role="status" className="text-[9px] text-emerald-300">{notice}</p>}
            {error && <p role="alert" className="text-[9px] text-red-300">{error}</p>}
        </div>
    );
};
