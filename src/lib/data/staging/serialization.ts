/**
 * Key-order-insensitive serialization for persisted values. Supabase stores the
 * singleton JSONB rows and any nested timer/task JSON with its own object key
 * ordering, so a client value compared against a freshly pulled snapshot must
 * not report a spurious difference just because the server reordered keys.
 * Change detection, pending counting, and LWW merges all use this comparison.
 */

/** Sorts object keys recursively so the canonical JSON is independent of insertion order. */
export function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
    }
    if (value !== null && typeof value === "object") {
        const record = value as Record<string, unknown>;
        const keys = Object.keys(record)
            .filter((key) => record[key] !== undefined)
            .sort();
        return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
    }
    if (value === undefined || (typeof value === "number" && Number.isNaN(value))) {
        return "null";
    }
    return JSON.stringify(value);
}

/** Deep equality that ignores object key ordering (values must still match). */
export function deepValuesEqual(a: unknown, b: unknown): boolean {
    return canonicalJson(a) === canonicalJson(b);
}
