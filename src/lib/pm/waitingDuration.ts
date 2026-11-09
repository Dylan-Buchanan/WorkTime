/** Point-in-time elapsed wait; callers choose when to render a fresh value. */
export function formatWaitingDuration(sinceIso: string, nowMs: number): string {
    const elapsedMs = nowMs - Date.parse(sinceIso);
    const minutes = Number.isFinite(elapsedMs) ? Math.max(0, Math.floor(elapsedMs / 60_000)) : 0;
    if (minutes < 1) return "<1 minute";
    if (minutes >= 1440) {
        const days = Math.floor(minutes / 1440);
        return `${days} ${days === 1 ? "day" : "days"}`;
    }
    if (minutes >= 60) {
        const hours = Math.floor(minutes / 60);
        const remainder = minutes % 60;
        return `${hours} ${hours === 1 ? "hour" : "hours"} ${remainder} ${remainder === 1 ? "minute" : "minutes"}`;
    }
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}
