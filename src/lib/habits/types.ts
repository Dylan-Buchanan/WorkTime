import type { HabitFrequency } from "../../state/types";

export type { Habit, HabitCompletion, HabitFrequency } from "../../state/types";

export type HabitWindow = "day" | "week" | "month" | "year";
export type HabitWindowInput = HabitWindow | "7" | "30" | "365";

export interface HabitGridCell {
    bucket: string;
    checked: boolean;
    checkable: boolean;
    row: number;
    column: number;
}

export interface HabitGrid {
    columns: 7;
    rows: number;
    cells: HabitGridCell[];
}

export interface NewHabitInput {
    name: string;
    description?: string;
    color: string;
    frequency: HabitFrequency;
    position?: number;
}
