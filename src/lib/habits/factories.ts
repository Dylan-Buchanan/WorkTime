import type { Habit, HabitCompletion } from "../../state/types";
import type { NewHabitInput } from "./types";

export function createHabit(input: NewHabitInput, now: Date, id: string): Habit {
    return {
        id,
        name: input.name,
        description: input.description ?? "",
        color: input.color,
        frequency: input.frequency,
        position: input.position ?? 0,
        isArchived: false,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
    };
}

export function createHabitCompletion(habitId: string, bucket: string, now: Date, id: string): HabitCompletion {
    return {
        id,
        habitId,
        bucket,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
    };
}

