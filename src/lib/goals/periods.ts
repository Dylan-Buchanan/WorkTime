import type { GoalCadence, Weekday } from "../../state/types";
import type { LocalDateKey } from "../todos/types";
import { addLocalDays, localDateAtNoon, localDateFromKey, localDateKey } from "../todos/calendar";
import { normalizeGoalCadence } from "./cadence";
import { isGoalDateKey } from "./factories";

export type GoalMonthKey = `${number}-${number}`;
export interface PeriodBounds {
    readonly periodStart: LocalDateKey;
    readonly periodEnd: LocalDateKey;
}
export interface GoalPeriod extends PeriodBounds {
    readonly monthKey: GoalMonthKey;
}
export interface GoalGridInput {
    readonly cadence: GoalCadence;
    readonly cadenceAnchorAt: LocalDateKey;
    readonly createdOn: LocalDateKey;
    readonly isArchived: boolean;
    readonly lastBuiltPeriodStart: LocalDateKey | null;
}

function dateKey(date: Date): LocalDateKey {
    const key = localDateKey(date);
    if (!isGoalDateKey(key)) throw new RangeError("Invalid goal date");
    return key;
}

// The nominal month owns this boundary, including dates snapped into the prior month.
function monthlyBoundary(year: number, month: number, weekday: Weekday): Date {
    const first = localDateAtNoon(year, month, 1);
    const day = first.getDay();
    const shift = day === 1 || day === 2
        ? -((day - weekday + 7) % 7)
        : (weekday - day + 7) % 7;
    return addLocalDays(first, shift);
}

export function resolveCadenceAnchorAt(rule: GoalCadence, after: LocalDateKey): LocalDateKey {
    const cadence = normalizeGoalCadence(rule);
    const date = localDateFromKey(after);
    if (cadence.kind === "every-n-weeks") {
        const days = (cadence.weekday - date.getDay() + 7) % 7 || 7;
        return dateKey(addLocalDays(date, days));
    }
    // Include adjacent nominal months: next month's boundary can precede its 1st.
    for (let month = date.getMonth() - 1; ; month += 1) {
        const boundary = dateKey(monthlyBoundary(date.getFullYear(), month, cadence.weekday));
        if (boundary > after) return boundary;
    }
}
