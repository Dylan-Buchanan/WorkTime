export interface PublicAppEnv {
    supabaseUrl: string;
    supabaseAnonKey: string;
    publicAppUrl?: string;
}

function readString(env: Record<string, string | boolean | undefined>, key: string): string {
    const value = env[key];
    return typeof value === "string" ? value.trim() : "";
}

function validateUrl(value: string, message: string): URL {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Error(message);
    }
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) {
        throw new Error(message);
    }
    return url;
}

function validateOriginUrl(value: string, message: string): string {
    const url = validateUrl(value.replace(/\/+$/, ""), message);
    if (url.pathname !== "/" || url.search || url.hash) throw new Error(message);
    return value;
}

export function readPublicAppEnv(
    env: Record<string, string | boolean | undefined>,
    options: { requirePublicAppUrl?: boolean } = {},
): PublicAppEnv {
    const supabaseUrl = readString(env, "VITE_SUPABASE_URL");
    if (!supabaseUrl) throw new Error("Missing VITE_SUPABASE_URL configuration");

    const supabaseAnonKey = readString(env, "VITE_SUPABASE_ANON_KEY");
    if (!supabaseAnonKey) throw new Error("Missing VITE_SUPABASE_ANON_KEY configuration");

    validateOriginUrl(supabaseUrl, "Supabase URL must be a valid HTTP or HTTPS URL");

    const configuredPublicAppUrl = readString(env, "VITE_PUBLIC_APP_URL");
    if (!configuredPublicAppUrl && options.requirePublicAppUrl) {
        throw new Error("Missing VITE_PUBLIC_APP_URL configuration");
    }

    return {
        supabaseUrl,
        supabaseAnonKey,
        publicAppUrl: configuredPublicAppUrl
            ? validateOriginUrl(configuredPublicAppUrl, "VITE_PUBLIC_APP_URL must be a valid HTTP or HTTPS URL").replace(/\/+$/, "")
            : undefined,
    };
}
