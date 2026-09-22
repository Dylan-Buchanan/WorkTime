import React, { useEffect, useRef, useState } from "react";

type Period = "AM" | "PM";

interface PetTimePickerProps {
    value: string;
    onChange(value: string): void;
    label?: string;
}

const HOURS = Array.from({ length: 12 }, (_, index) => String(index + 1));
const MINUTES = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, "0"));

function displayParts(value: string): { hour: string; minute: string; period: Period } {
    const [hour24, minute] = value.split(":").map(Number);
    return {
        hour: String(hour24 % 12 || 12),
        minute: String(minute).padStart(2, "0"),
        period: hour24 >= 12 ? "PM" : "AM",
    };
}

interface TimeDropdownProps {
    label: string;
    value: string;
    options: string[];
    onChange(value: string): void;
}

/**
 * Small listbox popover with a keyboard-friendly, app-styled scrollbar. The
 * native `<select>` popup renders an OS scrollbar that ignores the dark theme,
 * so the hour/minute pickers own their scroll container instead.
 */
const TimeDropdown: React.FC<TimeDropdownProps> = ({ label, value, options, onChange }) => {
    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(() => Math.max(0, options.indexOf(value)));
    const rootRef = useRef<HTMLDivElement>(null);
    const activeOptionRef = useRef<HTMLButtonElement>(null);
    const listboxId = React.useId();

    useEffect(() => {
        setActiveIndex(Math.max(0, options.indexOf(value)));
    }, [value, options]);

    useEffect(() => {
        if (!open) return;
        const closeOnOutsideClick = (event: MouseEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", closeOnOutsideClick);
        return () => document.removeEventListener("mousedown", closeOnOutsideClick);
    }, [open]);

    useEffect(() => {
        const option = activeOptionRef.current;
        if (open && option && typeof option.scrollIntoView === "function") {
            option.scrollIntoView({ block: "nearest" });
        }
    }, [activeIndex, open]);

    const choose = (nextValue: string) => {
        onChange(nextValue);
        setOpen(false);
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
        if (event.key === "Escape") {
            setOpen(false);
            return;
        }
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (open) choose(options[activeIndex]);
            else setOpen(true);
            return;
        }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            if (!open) {
                setOpen(true);
                return;
            }
            if (event.key === "Home") setActiveIndex(0);
            else if (event.key === "End") setActiveIndex(options.length - 1);
            else setActiveIndex((current) => Math.max(0, Math.min(options.length - 1, current + (event.key === "ArrowDown" ? 1 : -1))));
        }
    };

    return (
        <div ref={rootRef} className="relative">
            <button
                type="button"
                role="combobox"
                aria-label={label}
                aria-expanded={open}
                aria-controls={listboxId}
                onClick={() => setOpen((current) => !current)}
                onKeyDown={handleKeyDown}
                className={`min-w-10 rounded border bg-neutral-900 px-2 py-1 text-center text-xs font-medium tabular-nums text-neutral-100 outline-none transition hover:border-neutral-500 focus:ring-2 focus:ring-indigo-500/25 ${open ? "border-indigo-500" : "border-neutral-700"}`}
            >
                {value}
            </button>
            {open && (
                <div
                    id={listboxId}
                    role="listbox"
                    aria-label={`${label} options`}
                    className="app-scrollbar absolute left-0 top-full z-30 mt-1 max-h-44 min-w-full overflow-y-auto rounded-lg border border-neutral-700 bg-neutral-950 p-1 shadow-xl shadow-black/40"
                >
                    {options.map((option, index) => {
                        const selected = option === value;
                        const active = index === activeIndex;
                        return (
                            <button
                                ref={active ? activeOptionRef : undefined}
                                key={option}
                                type="button"
                                role="option"
                                aria-selected={selected}
                                onMouseEnter={() => setActiveIndex(index)}
                                onClick={() => choose(option)}
                                className={`block w-full rounded-md px-2.5 py-1 text-center text-xs tabular-nums transition ${selected ? "bg-indigo-600 text-white" : active ? "bg-neutral-800 text-neutral-100" : "text-neutral-300 hover:bg-neutral-800"}`}
                            >
                                {option}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

/**
 * Click-first time selector for the pet schedule forms: a 12-hour dropdown, a
 * minute dropdown covering every minute, and an AM/PM toggle. Unlike the native
 * time input, every value is reachable in one or two clicks and selections are
 * never skipped by fast scrolling.
 */
export const PetTimePicker: React.FC<PetTimePickerProps> = ({ value, onChange, label = "Time" }) => {
    const { hour, minute, period } = displayParts(value);

    const commit = (nextHour: string, nextMinute: string, nextPeriod: Period) => {
        const hour24 = (Number(nextHour) % 12) + (nextPeriod === "PM" ? 12 : 0);
        onChange(`${String(hour24).padStart(2, "0")}:${nextMinute}`);
    };

    return (
        <div className="flex flex-col gap-1 text-[11px] text-neutral-400">
            <span>{label}</span>
            <div className="flex items-center gap-1">
                <TimeDropdown
                    label={`${label} hour`}
                    value={hour}
                    options={HOURS}
                    onChange={(next) => commit(next, minute, period)}
                />
                <span className="text-neutral-500" aria-hidden>:</span>
                <TimeDropdown
                    label={`${label} minute`}
                    value={minute}
                    options={MINUTES}
                    onChange={(next) => commit(hour, next, period)}
                />
                <div className="ml-1 flex rounded border border-neutral-700 bg-neutral-900 p-0.5" aria-label={`${label} period`}>
                    {(["AM", "PM"] as const).map((option) => (
                        <button
                            key={option}
                            type="button"
                            aria-pressed={period === option}
                            onClick={() => commit(hour, minute, option)}
                            className={`rounded px-2 py-0.5 text-[11px] font-medium transition ${
                                period === option
                                    ? "bg-neutral-100 text-neutral-900"
                                    : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
                            }`}
                        >
                            {option}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};
