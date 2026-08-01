import { createClient } from "@supabase/supabase-js";
import { supabaseAuthStorageKey } from "./supabaseAuthStorage";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl?.trim()) {
    throw new Error("Missing VITE_SUPABASE_URL configuration");
}

if (!supabaseAnonKey?.trim()) {
    throw new Error("Missing VITE_SUPABASE_ANON_KEY configuration");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { storageKey: supabaseAuthStorageKey(supabaseUrl) },
});
