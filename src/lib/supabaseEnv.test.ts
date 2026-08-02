import { describe, expect, it } from "vitest";
import { readPublicAppEnv } from "./supabaseEnv";

const valid = {
    VITE_SUPABASE_URL: " https://example.supabase.co/ ",
    VITE_SUPABASE_ANON_KEY: " anon-key ",
    VITE_PUBLIC_APP_URL: " https://worktime.pages.dev/// ",
};

describe("readPublicAppEnv", () => {
    it("requires public Supabase values and normalizes them", () => {
        expect(readPublicAppEnv(valid, { requirePublicAppUrl: true })).toEqual({
            supabaseUrl: "https://example.supabase.co/",
            supabaseAnonKey: "anon-key",
            publicAppUrl: "https://worktime.pages.dev",
        });
        expect(() => readPublicAppEnv({ ...valid, VITE_SUPABASE_URL: "   " })).toThrow("Missing VITE_SUPABASE_URL configuration");
        expect(() => readPublicAppEnv({ ...valid, VITE_SUPABASE_ANON_KEY: "" })).toThrow("Missing VITE_SUPABASE_ANON_KEY configuration");
    });

    it("validates HTTP(S) URLs and production public URL requirements", () => {
        expect(readPublicAppEnv({ ...valid, VITE_PUBLIC_APP_URL: undefined }).publicAppUrl).toBeUndefined();
        expect(() => readPublicAppEnv({ ...valid, VITE_PUBLIC_APP_URL: undefined }, { requirePublicAppUrl: true })).toThrow("Missing VITE_PUBLIC_APP_URL configuration");
        expect(() => readPublicAppEnv({ ...valid, VITE_SUPABASE_URL: "file:///tmp/supabase" })).toThrow("Supabase URL must be a valid HTTP or HTTPS URL");
        expect(() => readPublicAppEnv({ ...valid, VITE_PUBLIC_APP_URL: "tauri://localhost" })).toThrow("VITE_PUBLIC_APP_URL must be a valid HTTP or HTTPS URL");
    });

    it("rejects URLs with a path, query, or hash since they must be bare origins", () => {
        expect(() => readPublicAppEnv({ ...valid, VITE_PUBLIC_APP_URL: "https://worktime.pages.dev/app" })).toThrow("VITE_PUBLIC_APP_URL must be a valid HTTP or HTTPS URL");
        expect(() => readPublicAppEnv({ ...valid, VITE_PUBLIC_APP_URL: "https://worktime.pages.dev/?utm_source=x" })).toThrow("VITE_PUBLIC_APP_URL must be a valid HTTP or HTTPS URL");
        expect(() => readPublicAppEnv({ ...valid, VITE_SUPABASE_URL: "https://example.supabase.co/project" })).toThrow("Supabase URL must be a valid HTTP or HTTPS URL");
    });
});
