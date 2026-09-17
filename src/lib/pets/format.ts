function pad(value: number): string {
    return String(value).padStart(2, "0");
}

/** Formats a Date as local 24-hour HH:mm without touching UTC. */
export function formatClock(date: Date): string {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Formats minutes-from-local-midnight as 24-hour HH:mm, wrapping at midnight. */
export function formatMinuteOfDay(minute: number): string {
    const wrapped = ((Math.trunc(minute) % 1440) + 1440) % 1440;
    return `${pad(Math.floor(wrapped / 60))}:${pad(wrapped % 60)}`;
}

/** Formats a signed whole-minute delta, e.g. "+40m" or "-15m". */
export function formatDeltaMinutes(deltaMinutes: number): string {
    const rounded = Math.round(deltaMinutes);
    return `${rounded >= 0 ? "+" : ""}${rounded}m`;
}
