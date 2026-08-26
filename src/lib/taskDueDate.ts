const ISO_DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/;

/**
 * Normalize external or persisted task due dates to the YYYY-MM-DD value
 * required by PMTask and native date inputs. Date-time inputs retain their
 * source calendar date instead of being shifted through the local timezone.
 */
export function normalizeTaskDueDate(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    const match = ISO_DATE_PREFIX.exec(trimmed);
    if (!match) return undefined;
    if (trimmed.length > 10 && Number.isNaN(Date.parse(trimmed))) return undefined;

    const dateKey = `${match[1]}-${match[2]}-${match[3]}`;
    const parsed = new Date(`${dateKey}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== dateKey) {
        return undefined;
    }
    return dateKey;
}
