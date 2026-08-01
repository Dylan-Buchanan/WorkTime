import { execSync } from "node:child_process";
import { createClient, type SupabaseClient, type Session } from "@supabase/supabase-js";

export interface LocalSupabaseConfig { url: string; anonKey: string; serviceRoleKey: string; }

let cachedConfig: LocalSupabaseConfig | null = null;
export function localSupabaseConfig(): LocalSupabaseConfig {
    if (cachedConfig) return cachedConfig;
    if (process.env.TEST_SUPABASE_URL && process.env.TEST_SUPABASE_ANON_KEY && process.env.TEST_SUPABASE_SERVICE_ROLE_KEY) {
        cachedConfig = { url: process.env.TEST_SUPABASE_URL, anonKey: process.env.TEST_SUPABASE_ANON_KEY, serviceRoleKey: process.env.TEST_SUPABASE_SERVICE_ROLE_KEY };
        return cachedConfig;
    }
    const output = execSync("npx supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const values: Record<string, string> = {};
    for (const line of output.split(/\r?\n/)) {
        const match = line.match(/^([A-Z_]+)=(.*)$/);
        if (match) values[match[1]] = match[2].replace(/^"|"$/g, "");
    }
    if (!values.API_URL || !values.ANON_KEY || !values.SERVICE_ROLE_KEY) throw new Error("Start the local Supabase stack before running integration/e2e tests");
    cachedConfig = { url: values.API_URL, anonKey: values.ANON_KEY, serviceRoleKey: values.SERVICE_ROLE_KEY };
    return cachedConfig;
}

export interface LocalUser { admin: SupabaseClient; client: SupabaseClient; userId: string; session: Session; cleanup: () => Promise<void>; }

export async function createLocalUser(): Promise<LocalUser> {
    const config = localSupabaseConfig();
    const admin = createClient(config.url, config.serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const email = `worktime-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
    const password = "WorkTime-test-123";
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error(created.error?.message ?? "Unable to create local test user");
    const client = createClient(config.url, config.anonKey, { auth: { persistSession: false } });
    const signedIn = await client.auth.signInWithPassword({ email, password });
    if (signedIn.error || !signedIn.data.session) throw new Error(signedIn.error?.message ?? "Unable to sign in local test user");
    let cleaned = false;
    return {
        admin, client, userId: created.data.user.id, session: signedIn.data.session,
        cleanup: async () => {
            if (cleaned) return;
            cleaned = true;
            await client.auth.signOut();
            await admin.auth.admin.deleteUser(created.data.user!.id);
        },
    };
}
