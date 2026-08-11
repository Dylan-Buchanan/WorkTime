import React from "react";
import { daysInMonth } from "../lib/todos";
import type { YearlyDate } from "../lib/todos";

export type RecurrenceType = "weekly" | "monthly" | "yearly";

export type SchedulePickerValue = {
    type: RecurrenceType;
    weekdays: number[];
    monthlyDays: number[];
    monthlyLastDayOffset: number | null;
    yearlyDates: YearlyDate[];
};

type SchedulePickerProps = {
    value: SchedulePickerValue;
    preview: string | null;
    onChange: (value: SchedulePickerValue) => void;
};

const WEEKDAYS = [
    { value: 1, label: "Monday", shortLabel: "Mon" },
    { value: 2, label: "Tuesday", shortLabel: "Tue" },
    { value: 3, label: "Wednesday", shortLabel: "Wed" },
    { value: 4, label: "Thursday", shortLabel: "Thu" },
    { value: 5, label: "Friday", shortLabel: "Fri" },
    { value: 6, label: "Saturday", shortLabel: "Sat" },
    { value: 0, label: "Sunday", shortLabel: "Sun" },
];
const MONTHS = Array.from({ length: 12 }, (_, index) => ({
    value: index + 1,
    label: new Date(2024, index, 1).toLocaleDateString(undefined, { month: "long" }),
}));
const MONTHLY_DAYS = Array.from({ length: 31 }, (_, index) => index + 1);

function updateYearlyDate(value: SchedulePickerValue, index: number, patch: Partial<YearlyDate>): SchedulePickerValue {
    return { ...value, yearlyDates: value.yearlyDates.map((date, dateIndex) => dateIndex === index ? { ...date, ...patch } : date) };
}

export const TodoSchedulePicker: React.FC<SchedulePickerProps> = ({ value, preview, onChange }) => (
    <div className="space-y-2 rounded border border-neutral-800 bg-neutral-950/40 p-2">
        <div role="tablist" aria-label="Recurrence type" className="grid grid-cols-3 gap-1">
            {(["weekly", "monthly", "yearly"] as const).map((type) => (
                <button
                    key={type}
                    type="button"
                    role="tab"
                    aria-selected={value.type === type}
                    onClick={() => onChange({ ...value, type })}
                    className={`rounded px-2 py-1.5 text-[10px] capitalize ${value.type === type ? "bg-indigo-600 text-white" : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"}`}
                >
                    {type}
                </button>
            ))}
        </div>

        {value.type === "weekly" && (
            <fieldset>
                <legend className="mb-1 text-[10px] text-neutral-400">Repeat on</legend>
                <div className="flex flex-wrap gap-1">
                    {WEEKDAYS.map((day) => {
                        const checked = value.weekdays.includes(day.value);
                        return <label key={day.value} className={`flex cursor-pointer items-center gap-1 rounded border px-1.5 py-1 text-[10px] ${checked ? "border-indigo-500/70 bg-indigo-500/10 text-indigo-200" : "border-neutral-700 text-neutral-300"}`}>
                            <input
                                type="checkbox"
                                aria-label={day.label}
                                checked={checked}
                                onChange={(event) => onChange({ ...value, weekdays: event.target.checked ? [...value.weekdays, day.value] : value.weekdays.filter((weekday) => weekday !== day.value) })}
                            />
                            {day.shortLabel}
                        </label>;
                    })}
                </div>
            </fieldset>
        )}

        {value.type === "monthly" && <div className="space-y-2">
            <fieldset>
                <legend className="mb-1 text-[10px] text-neutral-400">Days of the month</legend>
                <div className="grid grid-cols-7 gap-1" aria-label="Days of the month">
                    {MONTHLY_DAYS.map((day) => <button
                        key={day}
                        type="button"
                        aria-label={`Day ${day}`}
                        aria-pressed={value.monthlyDays.includes(day)}
                        title={day > 28 ? "Clamped to the last day in shorter months" : undefined}
                        onClick={() => onChange({ ...value, monthlyDays: value.monthlyDays.includes(day) ? value.monthlyDays.filter((selected) => selected !== day) : [...value.monthlyDays, day] })}
                        className={`rounded border px-1 py-1 text-[10px] ${value.monthlyDays.includes(day) ? "border-indigo-500 bg-indigo-600 text-white" : "border-neutral-700 text-neutral-400 hover:bg-neutral-800"}`}
                    >{day}</button>)}
                </div>
                <p className="mt-1 text-[9px] text-neutral-500">Days 29-31 are clamped to the month&apos;s last day when needed.</p>
            </fieldset>
            <label className="block text-[10px] text-neutral-400" htmlFor="todo-last-day-offset">Last-day option
                <select
                    id="todo-last-day-offset"
                    value={value.monthlyLastDayOffset ?? ""}
                    onChange={(event) => onChange({ ...value, monthlyLastDayOffset: event.target.value === "" ? null : Number(event.target.value) })}
                    className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs"
                >
                    <option value="">None</option>
                    {Array.from({ length: 31 }, (_, offset) => <option key={offset} value={offset}>{offset === 0 ? "Last day" : `Last day - ${offset}`}</option>)}
                </select>
            </label>
        </div>}

        {value.type === "yearly" && <div className="space-y-1">
            <span className="block text-[10px] text-neutral-400">Dates each year (mm/dd)</span>
            {value.yearlyDates.map((date, index) => <div key={`${index}-${date.month}-${date.day}`} className="flex items-end gap-1">
                <label className="min-w-0 flex-1 text-[9px] text-neutral-500">Month
                    <select aria-label={`Yearly month ${index + 1}`} value={date.month} onChange={(event) => {
                        const month = Number(event.target.value);
                        const maxDay = daysInMonth(2024, month - 1);
                        onChange(updateYearlyDate(value, index, { month, day: Math.min(date.day, maxDay) }));
                    }} className="mt-0.5 w-full rounded border border-neutral-700 bg-neutral-950 px-1.5 py-1.5 text-xs">
                        {MONTHS.map((month) => <option key={month.value} value={month.value}>{month.label}</option>)}
                    </select>
                </label>
                <label className="w-16 text-[9px] text-neutral-500">Day
                    <input aria-label={`Yearly day ${index + 1}`} type="number" min="1" max={daysInMonth(2024, date.month - 1)} value={date.day} onChange={(event) => onChange(updateYearlyDate(value, index, { day: Number(event.target.value) }))} className="mt-0.5 w-full rounded border border-neutral-700 bg-neutral-950 px-1.5 py-1.5 text-xs" />
                </label>
                {value.yearlyDates.length > 1 && <button type="button" aria-label={`Remove yearly date ${index + 1}`} onClick={() => onChange({ ...value, yearlyDates: value.yearlyDates.filter((_, dateIndex) => dateIndex !== index) })} className="rounded border border-neutral-700 px-2 py-1.5 text-[10px] text-red-300">Remove</button>}
            </div>)}
            <button type="button" onClick={() => onChange({ ...value, yearlyDates: [...value.yearlyDates, { month: 1, day: 1 }] })} className="rounded border border-neutral-700 px-2 py-1 text-[10px] text-neutral-300 hover:bg-neutral-800">Add yearly date</button>
            <p className="text-[9px] text-neutral-500">February 29 is skipped automatically in non-leap years.</p>
        </div>}

        <p aria-live="polite" className="border-t border-neutral-800 pt-2 text-[10px] text-indigo-200">{preview ?? "Choose a recurrence value to see its preview."}</p>
    </div>
);

