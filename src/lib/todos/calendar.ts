const LOCAL_DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function localDateAtNoon(year: number, month: number, day: number): Date {
    return new Date(year, month, day, 12, 0, 0, 0);
}

export function localDateParts(date: Date): [number, number, number] {
    if (Number.isNaN(date.getTime())) throw new RangeError("Invalid todo date");
    return [date.getFullYear(), date.getMonth(), date.getDate()];
}

export function localDateKey(date: Date): string {
    const [year, month, day] = localDateParts(date);
    return `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function localDateFromKey(key: string): Date {
    const match = LOCAL_DATE_KEY_PATTERN.exec(key);
    if (!match) throw new RangeError(`Invalid todo date: ${key}`);

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = localDateAtNoon(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        throw new RangeError(`Invalid todo date: ${key}`);
    }
    return date;
}

export function addLocalDays(date: Date, days: number): Date {
    if (!Number.isInteger(days)) throw new RangeError("Todo date shifts must be whole days");
    const [year, month, day] = localDateParts(date);
    const shifted = localDateAtNoon(year, month, day);
    shifted.setDate(shifted.getDate() + days);
    return shifted;
}

export function daysInMonth(year: number, month: number): number {
    return localDateAtNoon(year, month + 1, 0).getDate();
}

export function isLeapYear(year: number): boolean {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function compareLocalDates(left: Date, right: Date): number {
    const leftParts = localDateParts(left);
    const rightParts = localDateParts(right);
    for (let index = 0; index < leftParts.length; index += 1) {
        if (leftParts[index] !== rightParts[index]) return leftParts[index] > rightParts[index] ? 1 : -1;
    }
    return 0;
}

