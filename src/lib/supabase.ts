import { createClient } from "@supabase/supabase-js";
import { supabaseAuthStorageKey } from "./supabaseAuthStorage";
import { readPublicAppEnv } from "./supabaseEnv";

const { supabaseUrl, supabaseAnonKey } = readPublicAppEnv(import.meta.env);

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        storageKey: supabaseAuthStorageKey(supabaseUrl),
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
    },
});
