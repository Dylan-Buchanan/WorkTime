import React, { useEffect, useState } from "react";
import { isEndOfDayTime } from "../lib/settings";

type Period = "AM" | "PM";

interface TimeOfDayInputProps {
    id: string;
    label: string;
    value: string;
    onChange(value: string): void;
}

function displayParts(value: string): { hour: string; minute: string; period: Period } {
    const [hour24, minute] = value.split(":").map(Number);
    return {
        hour: String(hour24 % 12 || 12),
        minute: String(minute).padStart(2, "0"),
        period: hour24 >= 12 ? "PM" : "AM",
    };
}

function toTwentyFourHour(hour: number, period: Period): number {
    return hour % 12 + (period === "PM" ? 12 : 0);
}

export const TimeOfDayInput: React.FC<TimeOfDayInputProps> = ({ id, label, value, onChange }) => {
    const safeValue = isEndOfDayTime(value) ? value : "22:00";
    const displayed = displayParts(safeValue);
    const [hourDraft, setHourDraft] = useState(displayed.hour);
    const [minuteDraft, setMinuteDraft] = useState(displayed.minute);
    const [period, setPeriod] = useState<Period>(displayed.period);

    useEffect(() => {
        const next = displayParts(safeValue);
        setHourDraft(next.hour);
        setMinuteDraft(next.minute);
        setPeriod(next.period);
    }, [safeValue]);

    const commit = (hour: number, minute: number, nextPeriod: Period) => {
        const hour24 = toTwentyFourHour(hour, nextPeriod);
        onChange(`${String(hour24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
    };

    const commitHour = (draft: string) => {
        const parsed = Number(draft);
        if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 12) {
            setHourDraft(String(parsed));
            commit(parsed, Number(minuteDraft), period);
            return;
        }
        setHourDraft(displayParts(safeValue).hour);
    };

    const commitMinute = (draft: string) => {
        const parsed = Number(draft);
        if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 59) {
            const padded = String(parsed).padStart(2, "0");
            setMinuteDraft(padded);
            commit(Number(hourDraft), parsed, period);
            return;
        }
        setMinuteDraft(displayParts(safeValue).minute);
    };

    const choosePeriod = (nextPeriod: Period) => {
        setPeriod(nextPeriod);
        commit(Number(hourDraft), Number(minuteDraft), nextPeriod);
    };

    const inputClass = "w-11 rounded-md border border-neutral-700 bg-neutral-950/70 px-2 py-2 text-center text-sm font-semibold tabular-nums text-neutral-100 shadow-inner shadow-black/20 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/25";

    return (
        <fieldset id={id} className="col-span-2 rounded-lg border border-neutral-700/80 bg-neutral-900/70 p-3 shadow-sm shadow-black/20">
            <legend className="px-1 text-[10px] font-medium uppercase tracking-wide text-neutral-400">{label}</legend>
            <div className="flex items-center gap-2">
                <label className="flex flex-col gap-1 text-[9px] uppercase tracking-wide text-neutral-500">
                    <span>Hour</span>
                    <input
                        aria-label={`${label} hour`}
                        className={inputClass}
                        inputMode="numeric"
                        maxLength={2}
                        value={hourDraft}
                        onChange={(event) => setHourDraft(event.target.value.replace(/\D/g, "").slice(0, 2))}
                        onBlur={() => commitHour(hourDraft)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") {
                                event.preventDefault();
                                commitHour(hourDraft);
                            }
                        }}
                    />
                </label>
                <span className="mt-4 text-lg font-semibold text-neutral-500" aria-hidden>:</span>
                <label className="flex flex-col gap-1 text-[9px] uppercase tracking-wide text-neutral-500">
                    <span>Minute</span>
                    <input
                        aria-label={`${label} minute`}
                        className={inputClass}
                        inputMode="numeric"
                        maxLength={2}
                        value={minuteDraft}
                        onChange={(event) => setMinuteDraft(event.target.value.replace(/\D/g, "").slice(0, 2))}
                        onBlur={() => commitMinute(minuteDraft)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") {
                                event.preventDefault();
                                commitMinute(minuteDraft);
                            }
                        }}
                    />
                </label>
                <div className="ml-auto mt-4 flex rounded-md border border-neutral-700 bg-neutral-950/70 p-0.5" aria-label={`${label} period`}>
                    {(["AM", "PM"] as const).map((option) => (
                        <button
                            key={option}
                            type="button"
                            aria-pressed={period === option}
                            onClick={() => choosePeriod(option)}
                            className={`rounded px-2.5 py-1.5 text-[10px] font-semibold transition ${
                                period === option
                                    ? "bg-indigo-600 text-white shadow-sm"
                                    : "text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
                            }`}
                        >
                            {option}
                        </button>
                    ))}
                </div>
            </div>
            <p className="mt-2 text-[9px] leading-relaxed text-neutral-600">Type the time directly, then choose AM or PM.</p>
        </fieldset>
    );
};
