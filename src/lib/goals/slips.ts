import type { Goal, GoalCheckIn } from "../../state/types";
import type { LocalDateKey } from "../todos/types";
import { compareLocalDates, localDateFromKey, localDateKey } from "../todos/calendar";
import { isGoalDateKey } from "./factories";
import type { PeriodBounds } from "./periods";

export type LifecycleDateProjection = (iso: string) => LocalDateKey;
export interface SlipSummary {
    readonly goalId: string;
    readonly consecutiveSlips: number;
    readonly escalated: boolean;
    readonly slippedPeriods: readonly LocalDateKey[];
    readonly lastCleanPeriod: LocalDateKey | null;
    readonly latestPeriod: LocalDateKey | null;
}
export interface GoalSeriesPoint {
    readonly periodStart: LocalDateKey;
    readonly value: number;
}
export interface GoalSparkline {
    readonly goalId: string;
    readonly kind: "status";
    readonly points: readonly GoalSeriesPoint[];
}
export interface GoalMetricSnapshot {
    readonly label: string;
    readonly current: number;
    readonly target: number;
    readonly unit: string;
    readonly source: "manual" | "liftingtracker";
    readonly overridePinned: boolean;
}

const LIST_PREFIX = /^(?:[-*+]|\d+[.)])\s+/;
const CHECKBOX_PREFIX = /^\[([ xX])\]\s+/;
const LINE_BREAK = /\r\n|\r|\n/;

export function normalizeSlipText(value: string): string {
    return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function completedLines(did: string): Set<string> {
    const lines = new Set<string>();
    for (const raw of did.split(LINE_BREAK)) {
        let line = raw.trimStart();
        const list = LIST_PREFIX.exec(line);
        if (list) line = line.slice(list[0].length);
        const checkbox = CHECKBOX_PREFIX.exec(line);
        if (checkbox) {
            // An unchecked box disqualifies the line entirely.
            if (checkbox[1] === " ") continue;
            line = line.slice(checkbox[0].length);
        }
        const normalized = normalizeSlipText(line);
        if (normalized) lines.add(normalized);
    }
    return lines;
}

export function unmetPlannedItems(
    previous: GoalCheckIn,
    current: GoalCheckIn,
): { text: string; dueDate: LocalDateKey | null }[] {
    if (previous.goalId !== current.goalId) return [];
    const lines = completedLines(current.did);
    const unmet: { text: string; dueDate: LocalDateKey | null }[] = [];
    for (const item of previous.planned) {
        const text = normalizeSlipText(item.text);
        if (!text) continue;
        if (!lines.has(text)) unmet.push({ text: item.text, dueDate: item.dueDate });
    }
    return unmet;
}

export function isSlipTransition(previous: GoalCheckIn, current: GoalCheckIn): boolean {
    return unmetPlannedItems(previous, current).length > 0;
}

function cloneCheckIn(row: GoalCheckIn): GoalCheckIn {
    return {
        ...row,
        planned: row.planned.map(item => ({ text: item.text, dueDate: item.dueDate })),
        evidenceTaskIds: [...row.evidenceTaskIds],
    };
}

function isLaterRow(candidate: GoalCheckIn, existing: GoalCheckIn): boolean {
    if (candidate.updatedAt !== existing.updatedAt) return candidate.updatedAt > existing.updatedAt;
    return candidate.id < existing.id;
}

function compareCheckIns(left: GoalCheckIn, right: GoalCheckIn): number {
    if (left.periodStart !== right.periodStart) return left.periodStart < right.periodStart ? -1 : 1;
    if (left.goalId !== right.goalId) return left.goalId < right.goalId ? -1 : 1;
    if (left.updatedAt !== right.updatedAt) return left.updatedAt < right.updatedAt ? -1 : 1;
    if (left.id !== right.id) return left.id < right.id ? -1 : 1;
    return 0;
}

export function normalizeCheckInHistory(checkIns: readonly GoalCheckIn[]): GoalCheckIn[] {
    const retained = new Map<string, GoalCheckIn>();
    for (const row of checkIns) {
        const key = `${row.goalId}\u0000${row.periodStart}`;
        const existing = retained.get(key);
        if (!existing || isLaterRow(row, existing)) retained.set(key, cloneCheckIn(row));
    }
    return [...retained.values()].sort(compareCheckIns);
}

function validatedThrough(throughPeriodStart?: LocalDateKey): LocalDateKey | undefined {
    if (throughPeriodStart !== undefined) localDateFromKey(throughPeriodStart);
    return throughPeriodStart;
}

function filteredHistory(
    goalId: string,
    checkIns: readonly GoalCheckIn[],
    throughPeriodStart?: LocalDateKey,
): GoalCheckIn[] {
    const through = validatedThrough(throughPeriodStart);
    return normalizeCheckInHistory(checkIns).filter(row =>
        row.goalId === goalId && (through === undefined || row.periodStart <= through));
}

export function slipSummary(
    goalId: string,
    checkIns: readonly GoalCheckIn[],
    throughPeriodStart?: LocalDateKey,
): SlipSummary {
    const rows = filteredHistory(goalId, checkIns, throughPeriodStart);
    if (rows.length === 0) {
        return {
            goalId,
            consecutiveSlips: 0,
            escalated: false,
            slippedPeriods: [],
            lastCleanPeriod: null,
            latestPeriod: null,
        };
    }
    let consecutiveSlips = 0;
    const slippedPeriods: LocalDateKey[] = [];
    let lastCleanPeriod: LocalDateKey | null = null;
    for (let index = rows.length - 1; index > 0; index -= 1) {
        if (!isSlipTransition(rows[index - 1], rows[index])) {
            lastCleanPeriod = rows[index].periodStart;
            break;
        }
        consecutiveSlips += 1;
        slippedPeriods.push(rows[index].periodStart);
    }
    slippedPeriods.reverse();
    return {
        goalId,
        consecutiveSlips,
        escalated: consecutiveSlips >= 2,
        slippedPeriods,
        lastCleanPeriod,
        latestPeriod: rows[rows.length - 1].periodStart,
    };
}

function compareKeys(left: LocalDateKey, right: LocalDateKey): number {
    return compareLocalDates(localDateFromKey(left), localDateFromKey(right));
}

const defaultProjection: LifecycleDateProjection = iso => {
    const key = localDateKey(new Date(iso));
    if (!isGoalDateKey(key)) throw new RangeError("Invalid goal lifecycle date");
    return key;
};

export function isGoalIncludedInPeriod(
    goal: Goal,
    period: PeriodBounds,
    localDateOf: LifecycleDateProjection = defaultProjection,
): boolean {
    localDateFromKey(period.periodStart);
    localDateFromKey(period.periodEnd);
    const createdOn = localDateOf(goal.createdAt);
    localDateFromKey(createdOn);
    if (compareKeys(createdOn, period.periodEnd) >= 0) return false;
    if (goal.lifecycle === "active") return true;
    if (goal.lifecycle === "dropped") return false;
    if (!goal.achievedAt) return false;
    const achievedOn = localDateOf(goal.achievedAt);
    localDateFromKey(achievedOn);
    return compareKeys(achievedOn, period.periodStart) >= 0;
}

export const STATUS_SERIES_VALUES: Readonly<Record<GoalCheckIn["statusPill"], number>> = {
    blocked: 0,
    "at-risk": 1,
    "on-track": 2,
};

export function buildSparkline(
    goalId: string,
    checkIns: readonly GoalCheckIn[],
    throughPeriodStart?: LocalDateKey,
): GoalSparkline | null {
    const rows = filteredHistory(goalId, checkIns, throughPeriodStart);
    if (rows.length < 2) return null;
    return {
        goalId,
        kind: "status",
        points: rows.map(row => ({ periodStart: row.periodStart, value: STATUS_SERIES_VALUES[row.statusPill] })),
    };
}

export function metricSnapshot(goal: Goal): GoalMetricSnapshot | null {
    if (!goal.metric) return null;
    const { label, current, target, unit, source, overridePinned } = goal.metric;
    return { label, current, target, unit, source, overridePinned };
}
