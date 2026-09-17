import React from "react";
import { formatClock, freeUntil, nextDue } from "../../lib/pets";
import type { PetDaySchedule } from "../../lib/pets";
import { PET_ACTIVITY_META } from "./petShared";

interface PetHeroStatusProps {
    name: string;
    schedule: PetDaySchedule;
    now: Date;
}

const RING_RADIUS = 52;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
/** Countdown horizon in minutes; the ring is full when nothing is due within it. */
const RING_HORIZON_MINUTES = 120;

function urgency(minutesLeft: number): "red" | "amber" | "calm" {
    if (minutesLeft <= 10) return "red";
    if (minutesLeft <= 30) return "amber";
    return "calm";
}

const RING_COLORS: Record<"red" | "amber" | "calm", string> = {
    red: "#ef4444",
    amber: "#f59e0b",
    calm: "#38bdf8",
};

/**
 * Hero status: a countdown ring to the next obligation of any kind (amber to
 * red as it approaches, pausing while the pet naps because the engine pushes
 * paused due times forward) plus the status sentence beneath. Both are pure
 * presentations of engine state; edge cases come from `nextDue`/`freeUntil`.
 */
export const PetHeroStatus: React.FC<PetHeroStatusProps> = ({ name, schedule, now }) => {
    const due = nextDue(schedule);
    const upcoming = freeUntil(schedule);

    const minutesLeft = due ? (due.at.getTime() - now.getTime()) / 60_000 : null;
    const overdue = due !== null && due.overdueMinutes > 0;
    const level = minutesLeft === null ? "calm" : urgency(Math.max(0, minutesLeft));
    const color = overdue || (minutesLeft !== null && minutesLeft <= 0) ? RING_COLORS.red : RING_COLORS[level];
    const fill =
        minutesLeft === null
            ? 0
            : Math.min(1, Math.max(0, (overdue ? 0 : minutesLeft) / RING_HORIZON_MINUTES));

    const icon = schedule.napping
        ? "💤"
        : due
          ? PET_ACTIVITY_META[due.activityType].icon
          : "🎉";

    let centerTime = "—";
    if (minutesLeft !== null) {
        centerTime = overdue
            ? `${Math.ceil(due!.overdueMinutes)}m over`
            : `${Math.max(0, Math.ceil(minutesLeft))}m`;
    }

    const parts: string[] = [];
    if (schedule.napping) parts.push(`${name}'s napping`);
    if (due) {
        if (overdue) {
            parts.push(`${due.label.toLowerCase()} was due ${Math.round(due.overdueMinutes)} min ago`);
        } else {
            parts.push(`next ${due.label.toLowerCase()} ~${formatClock(due.at)}, ~${Math.max(0, Math.ceil(minutesLeft!))} min free`);
        }
    } else if (!schedule.napping) {
        parts.push(`${name}'s all caught up for today`);
    } else {
        parts.push("nothing else due today");
    }
    if (!overdue && upcoming !== null && due !== null && upcoming.getTime() !== due.at.getTime()) {
        parts.push(`then free until ${formatClock(upcoming)}`);
    }
    const sentence = parts.join(" — ");

    return (
        <section
            aria-label="Pet status"
            className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4"
        >
            <div className="relative h-32 w-32" role="img" aria-label={`Countdown to ${due ? due.label.toLowerCase() : "nothing due"}`}>
                <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
                    <circle cx="60" cy="60" r={RING_RADIUS} fill="none" stroke="#262626" strokeWidth="8" />
                    <circle
                        cx="60"
                        cy="60"
                        r={RING_RADIUS}
                        fill="none"
                        stroke={color}
                        strokeWidth="8"
                        strokeLinecap="round"
                        strokeDasharray={RING_CIRCUMFERENCE}
                        strokeDashoffset={RING_CIRCUMFERENCE * (1 - fill)}
                        style={{ transition: "stroke-dashoffset 0.5s linear, stroke 0.5s linear" }}
                    />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span aria-hidden="true" className="text-xl leading-none">{icon}</span>
                    <span className="text-sm font-semibold text-neutral-100">{centerTime}</span>
                </div>
            </div>
            <p className="text-center text-xs text-neutral-300">{sentence}</p>
        </section>
    );
};
