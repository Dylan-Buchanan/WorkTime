export function supabaseAuthStorageKey(url: string): string {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error("Supabase URL must be a valid HTTP or HTTPS URL");
    }
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname) {
        throw new Error("Supabase URL must be a valid HTTP or HTTPS URL");
    }
    return `sb-${parsed.hostname.split(".")[0]}-auth-token`;
}
