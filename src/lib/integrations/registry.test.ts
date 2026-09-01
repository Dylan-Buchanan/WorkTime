import { describe, expect, it } from "vitest";
import { integrationRegistry } from "./registry";

describe("integrationRegistry", () => {
    it("defines the initial integrations with unique stable identifiers", () => {
        expect(integrationRegistry.map((integration) => integration.id)).toEqual([
            "google-calendar",
            "github",
            "shortcut",
        ]);
        expect(new Set(integrationRegistry.map((integration) => integration.id)).size).toBe(integrationRegistry.length);
    });

    it("provides the metadata needed to render every integration", () => {
        for (const integration of integrationRegistry) {
            expect(integration.name).not.toBe("");
            expect(integration.description).not.toBe("");
            expect(["calendar", "github", "shortcut"]).toContain(integration.icon);
            expect(["oauth2", "api-token"]).toContain(integration.authFlow);
        }
        expect(integrationRegistry.filter((integration) => integration.isPlaceholder).map((integration) => integration.id)).toEqual([]);
    });
});
