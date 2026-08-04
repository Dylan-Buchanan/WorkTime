import type { Habit, HabitCompletion, HabitFrequency } from "../../state/types";
import { getWindowBuckets, isHabitCellCheckable, isHabitCompleted } from "./windows";
import type { HabitGrid, HabitWindowInput } from "./types";

export function deriveGrid(
    habit: Pick<Habit, "id" | "frequency"> | HabitFrequency,
    completions: readonly Pick<HabitCompletion, "habitId" | "bucket">[],
    now: Date,
    window: HabitWindowInput = "year",
): HabitGrid {
    const frequency = typeof habit === "string" ? habit : habit.frequency;
    const habitId = typeof habit === "string" ? null : habit.id;
    const buckets = getWindowBuckets(window, frequency, now);
    const cells = buckets.map((bucket, index) => ({
        bucket,
        checked: habitId !== null && isHabitCompleted(completions, habitId, bucket),
        checkable: isHabitCellCheckable(frequency, bucket, now),
        row: Math.floor(index / 7),
        column: index % 7,
    }));
    return { columns: 7, rows: Math.ceil(cells.length / 7), cells };
}

export function derive365Grid(
    habit: Pick<Habit, "id" | "frequency"> | HabitFrequency,
    completions: readonly Pick<HabitCompletion, "habitId" | "bucket">[],
    now: Date,
): HabitGrid {
    return deriveGrid(habit, completions, now, "year");
}

export function get365Grid(
    habit: Pick<Habit, "id" | "frequency"> | HabitFrequency,
    completions: readonly Pick<HabitCompletion, "habitId" | "bucket">[],
    now: Date,
): HabitGrid {
    return derive365Grid(habit, completions, now);
}

