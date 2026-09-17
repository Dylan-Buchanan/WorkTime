import type { PetAge, PetAgeUnit } from "./types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SIX_MONTHS = 6;
const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Local-noon date math avoids DST midnight transitions. */
function localNoon(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
}

function assertValidDate(date: Date, label: string): Date {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new RangeError(`Invalid ${label}`);
    return date;
}

function parseBirthDate(value: string | Date): Date {
    if (value instanceof Date) return localNoon(assertValidDate(value, "pet birth date"));
    const match = DATE_KEY_PATTERN.exec(value);
    if (!match) throw new RangeError("Pet birth date must use YYYY-MM-DD format");
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    const date = new Date(year, month, day, 12, 0, 0, 0);
    if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
        throw new RangeError("Invalid pet birth date");
    }
    return date;
}

/** Converts a birth-date input to the persisted timezone-free calendar key. */
export function petBirthDateKey(value: string | Date): string {
    const date = parseBirthDate(value);
    const year = String(date.getFullYear()).padStart(4, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function daysInMonth(year: number, month: number): number {
    return new Date(year, month + 1, 0).getDate();
}

/** Adds calendar months in local terms, clamping the day to the month's end. */
function addLocalMonths(date: Date, months: number): Date {
    const base = localNoon(date);
    const absoluteMonth = base.getMonth() + months;
    const year = base.getFullYear() + Math.floor(absoluteMonth / 12);
    const month = ((absoluteMonth % 12) + 12) % 12;
    const day = Math.min(base.getDate(), daysInMonth(year, month));
    return new Date(year, month, day, 12, 0, 0, 0);
}

function completedMonths(birth: Date, reference: Date): number {
    let months = (reference.getFullYear() - birth.getFullYear()) * 12 + (reference.getMonth() - birth.getMonth());
    if (reference.getTime() < addLocalMonths(birth, months).getTime()) months -= 1;
    return Math.max(0, months);
}

function calendarDaysBetween(earlier: Date, later: Date): number {
    const earlierDay = Date.UTC(earlier.getFullYear(), earlier.getMonth(), earlier.getDate());
    const laterDay = Date.UTC(later.getFullYear(), later.getMonth(), later.getDate());
    return Math.floor((laterDay - earlierDay) / MS_PER_DAY);
}

/**
 * Derives pet age from the birth date. Age is never stored. The display unit is
 * weeks until the six-month birthday (exclusive) and whole months afterwards.
 */
export function derivePetAge(birthDate: string | Date, reference: Date): PetAge {
    const birth = parseBirthDate(birthDate);
    const ref = localNoon(assertValidDate(reference, "pet age reference"));
    const totalDays = Math.max(0, calendarDaysBetween(birth, ref));
    const sixMonthDate = addLocalMonths(birth, SIX_MONTHS);
    const months = completedMonths(birth, ref);
    const unit: PetAgeUnit = ref.getTime() < sixMonthDate.getTime() ? "weeks" : "months";
    return {
        birthDate: birth,
        reference: ref,
        totalDays,
        weeks: Math.floor(totalDays / 7),
        months,
        unit,
        value: unit === "weeks" ? Math.floor(totalDays / 7) : months,
        sixMonthDate,
    };
}

/** Renders a derived age as "1 week", "14 weeks", "1 month", "7 months". */
export function formatPetAge(age: PetAge): string {
    const singular = age.value === 1;
    if (age.unit === "weeks") return `${age.value} ${singular ? "week" : "weeks"}`;
    return `${age.value} ${singular ? "month" : "months"}`;
}

/** Convenience over `derivePetAge` for call sites that only need the label. */
export function formatPetAgeAt(birthDate: string | Date, reference: Date): string {
    return formatPetAge(derivePetAge(birthDate, reference));
}
