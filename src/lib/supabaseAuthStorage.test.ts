import { describe, expect, it } from "vitest";
import { supabaseAuthStorageKey } from "./supabaseAuthStorage";

describe("supabaseAuthStorageKey", () => {
    it("matches supabase-js v2 storage keys", () => {
        expect(supabaseAuthStorageKey("http://127.0.0.1:54321")).toBe("sb-127-auth-token");
        expect(supabaseAuthStorageKey("https://project.supabase.co")).toBe("sb-project-auth-token");
    });

    it("rejects malformed or non-http URLs", () => {
        expect(() => supabaseAuthStorageKey("not a url")).toThrow();
        expect(() => supabaseAuthStorageKey("file:///tmp/supabase")).toThrow();
    });
});
