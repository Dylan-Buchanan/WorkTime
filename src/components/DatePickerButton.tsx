import React, { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { addLocalDays, daysInMonth, localDateAtNoon, localDateFromKey, localDateKey } from "../lib/todos";

export type DatePickerButtonProps = {
    id: string;
    label: string;
    /** `""` or a `YYYY-MM-DD` local date key. */
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
};

type CalendarCell = { key: string; day: number };

const WEEKDAYS: Array<{ short: string; long: string }> = [
    { short: "Su", long: "Sunday" },
    { short: "Mo", long: "Monday" },
    { short: "Tu", long: "Tuesday" },
    { short: "We", long: "Wednesday" },
    { short: "Th", long: "Thursday" },
    { short: "Fr", long: "Friday" },
    { short: "Sa", long: "Saturday" },
];

const DISPLAY_DATE: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };
const FULL_DATE: Intl.DateTimeFormatOptions = { weekday: "long", month: "long", day: "numeric", year: "numeric" };
const MONTH_HEADING: Intl.DateTimeFormatOptions = { month: "long", year: "numeric" };

function formatKey(key: string, options: Intl.DateTimeFormatOptions): string | null {
    try {
        return localDateFromKey(key).toLocaleDateString(undefined, options);
    } catch {
        return null;
    }
}

function safeDateFromKey(key: string): Date | null {
    if (!key) return null;
    try {
        return localDateFromKey(key);
    } catch {
        return null;
    }
}

function startOfMonth(year: number, month: number): { year: number; month: number } {
    return { year, month };
}

/** Build a Sunday-first grid of the month, padded with `null` for leading/trailing blanks. */
function buildWeeks(year: number, month: number): Array<Array<CalendarCell | null>> {
    const leading = localDateAtNoon(year, month, 1).getDay();
    const total = daysInMonth(year, month);
    const cells: Array<CalendarCell | null> = Array.from({ length: leading }, () => null);
    for (let day = 1; day <= total; day += 1) {
        const date = localDateAtNoon(year, month, day);
        cells.push({ key: localDateKey(date), day });
    }
    while (cells.length % 7 !== 0) cells.push(null);

    const weeks: Array<Array<CalendarCell | null>> = [];
    for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
    return weeks;
}

/**
 * Compact date trigger plus a themed calendar popover. The control owns only the
 * open/month/focus state; the parent keeps the `YYYY-MM-DD` string, so the
 * to-do draft contract and its validation stay unchanged.
 */
export const DatePickerButton: React.FC<DatePickerButtonProps> = ({ id, label, value, onChange, placeholder = "Pick a date" }) => {
    const now = new Date();
    const [open, setOpen] = useState(false);
    const [view, setView] = useState(() => startOfMonth(now.getFullYear(), now.getMonth()));
    const [focusKey, setFocusKey] = useState(() => localDateKey(now));
    const rootRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const dayRefs = useRef(new Map<string, HTMLButtonElement>());
    const shouldFocusDayRef = useRef(false);
    const popoverId = React.useId();

    const selectedKey = useMemo(() => {
        if (!value) return null;
        return formatKey(value, DISPLAY_DATE) ? value : null;
    }, [value]);

    const months = useMemo(() => buildWeeks(view.year, view.month), [view]);
    const monthLabel = useMemo(
        () => localDateAtNoon(view.year, view.month, 1).toLocaleDateString(undefined, MONTH_HEADING),
        [view],
    );
    const todayKey = localDateKey(now);
    const displayValue = selectedKey ? formatKey(selectedKey, DISPLAY_DATE) ?? placeholder : placeholder;

    const firstKey = localDateKey(localDateAtNoon(view.year, view.month, 1));
    const keyIsInView = (key: string): boolean => {
        const date = safeDateFromKey(key);
        return Boolean(date && date.getFullYear() === view.year && date.getMonth() === view.month);
    };
    const tabStopKey = focusKey && keyIsInView(focusKey) ? focusKey : firstKey;

    // Focus the day cell only when opening the popover or after keyboard
    // navigation; a month-button click must keep focus on that button.
    useEffect(() => {
        if (!open || !shouldFocusDayRef.current) return;
        shouldFocusDayRef.current = false;
        dayRefs.current.get(focusKey)?.focus();
    }, [open, focusKey]);

    useEffect(() => {
        if (!open) return;
        const closeOnOutsideClick = (event: MouseEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", closeOnOutsideClick);
        return () => document.removeEventListener("mousedown", closeOnOutsideClick);
    }, [open]);

    const focusDay = (key: string) => {
        shouldFocusDayRef.current = true;
        setFocusKey(key);
    };

    const setViewFor = (date: Date) => {
        if (date.getFullYear() !== view.year || date.getMonth() !== view.month) {
            setView(startOfMonth(date.getFullYear(), date.getMonth()));
        }
    };

    const closeCalendar = (restoreFocus: boolean) => {
        setOpen(false);
        if (restoreFocus) triggerRef.current?.focus();
    };

    const openCalendar = () => {
        const anchor = safeDateFromKey(value) ?? new Date();
        setView(startOfMonth(anchor.getFullYear(), anchor.getMonth()));
        focusDay(localDateKey(anchor));
        setOpen(true);
    };

    const chooseDay = (key: string) => {
        onChange(key);
        setOpen(false);
        triggerRef.current?.focus();
    };

    const changeMonth = (offset: number) => {
        const next = new Date(view.year, view.month + offset, 1);
        const nextYear = next.getFullYear();
        const nextMonth = next.getMonth();
        setView(startOfMonth(nextYear, nextMonth));

        // Keep the roving tab stop inside the visible grid. Do not move DOM
        // focus, so the chevron remains the active control for repeat clicks.
        const current = safeDateFromKey(focusKey);
        const day = Math.min(current?.getDate() ?? 1, daysInMonth(nextYear, nextMonth));
        setFocusKey(localDateKey(localDateAtNoon(nextYear, nextMonth, day)));
    };

    const handlePopoverKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            closeCalendar(true);
            return;
        }

        const focused = safeDateFromKey(focusKey);
        const current = focused && focused.getFullYear() === view.year && focused.getMonth() === view.month
            ? focused
            : localDateAtNoon(view.year, view.month, 1);
        let next: Date | null = null;
        switch (event.key) {
            case "ArrowLeft": next = addLocalDays(current, -1); break;
            case "ArrowRight": next = addLocalDays(current, 1); break;
            case "ArrowUp": next = addLocalDays(current, -7); break;
            case "ArrowDown": next = addLocalDays(current, 7); break;
            case "Home": next = addLocalDays(current, -current.getDay()); break;
            case "End": next = addLocalDays(current, 6 - current.getDay()); break;
            case "PageUp": next = localDateAtNoon(current.getFullYear(), current.getMonth() - 1, Math.min(current.getDate(), daysInMonth(current.getFullYear(), current.getMonth() - 1))); break;
            case "PageDown": next = localDateAtNoon(current.getFullYear(), current.getMonth() + 1, Math.min(current.getDate(), daysInMonth(current.getFullYear(), current.getMonth() + 1))); break;
            default: return;
        }

        event.preventDefault();
        setViewFor(next);
        focusDay(localDateKey(next));
    };

    return (
        <div ref={rootRef} className="relative block text-[10px] text-neutral-400">
            <label htmlFor={id} className="block">{label}</label>
            <button
                ref={triggerRef}
                id={id}
                type="button"
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-controls={open ? popoverId : undefined}
                aria-describedby={`${id}-value`}
                onClick={() => (open ? closeCalendar(true) : openCalendar())}
                onKeyDown={(event) => {
                    if (event.key === "Escape" && open) {
                        event.preventDefault();
                        closeCalendar(true);
                    }
                }}
                className="mt-1 inline-flex max-w-full items-center gap-1.5 rounded border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-left text-xs text-neutral-200 transition hover:border-neutral-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
            >
                <CalendarDays aria-hidden className="h-3.5 w-3.5 shrink-0 text-neutral-500" />
                <span id={`${id}-value`} className={`truncate ${selectedKey ? "" : "text-neutral-500"}`}>{displayValue}</span>
            </button>

            {open && (
                <div
                    id={popoverId}
                    role="dialog"
                    aria-label={`${label} calendar`}
                    onKeyDown={handlePopoverKeyDown}
                    className="absolute left-0 top-full z-30 mt-1 w-64 rounded-lg border border-neutral-700 bg-neutral-900 p-2 shadow-xl shadow-black/40"
                >
                    <div className="mb-1 flex items-center justify-between gap-1">
                        <button
                            type="button"
                            aria-label="Previous month"
                            onClick={() => changeMonth(-1)}
                            className="grid h-6 w-6 place-items-center rounded border border-transparent text-neutral-400 transition hover:border-neutral-700 hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
                        >
                            <ChevronLeft aria-hidden className="h-3.5 w-3.5" />
                        </button>
                        <span aria-live="polite" className="text-[11px] font-medium text-neutral-100">{monthLabel}</span>
                        <button
                            type="button"
                            aria-label="Next month"
                            onClick={() => changeMonth(1)}
                            className="grid h-6 w-6 place-items-center rounded border border-transparent text-neutral-400 transition hover:border-neutral-700 hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
                        >
                            <ChevronRight aria-hidden className="h-3.5 w-3.5" />
                        </button>
                    </div>

                    <table role="grid" aria-label={`${monthLabel} days`} className="w-full border-collapse text-center">
                        <thead>
                            <tr role="row">
                                {WEEKDAYS.map((weekday) => (
                                    <th key={weekday.short} role="columnheader" scope="col" aria-label={weekday.long} className="pb-1 text-[9px] font-medium text-neutral-500">
                                        {weekday.short}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {months.map((week, weekIndex) => (
                                <tr role="row" key={`week-${weekIndex}`}>
                                    {week.map((cell, dayIndex) => {
                                        if (!cell) return <td key={`blank-${weekIndex}-${dayIndex}`} role="gridcell" aria-disabled="true" className="h-7 p-0.5" />;
                                        const selected = cell.key === selectedKey;
                                        const isToday = cell.key === todayKey;
                                        return (
                                            <td key={cell.key} role="gridcell" aria-selected={selected} className="h-7 p-0.5">
                                                <button
                                                    ref={(element) => {
                                                        if (element) dayRefs.current.set(cell.key, element);
                                                        else dayRefs.current.delete(cell.key);
                                                    }}
                                                    type="button"
                                                    tabIndex={cell.key === tabStopKey ? 0 : -1}
                                                    aria-label={formatKey(cell.key, FULL_DATE) ?? String(cell.day)}
                                                    aria-pressed={selected}
                                                    aria-current={isToday ? "date" : undefined}
                                                    onClick={() => chooseDay(cell.key)}
                                                    className={`h-7 w-full rounded text-[10px] tabular-nums transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 ${
                                                        selected
                                                            ? "bg-indigo-600 font-medium text-white"
                                                            : isToday
                                                              ? "border border-indigo-500/60 text-indigo-200 hover:bg-neutral-800"
                                                              : "text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100"
                                                    }`}
                                                >
                                                    {cell.day}
                                                </button>
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};
