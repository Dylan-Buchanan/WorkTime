import { describe, expect, it } from "vitest";
import { googleAccountInitial, googleAccountLabel } from "./googleCalendarAccount";

describe("Google Calendar account labels", () => {
    it("prefers the email, then the primary calendar id, then a neutral label", () => {
        expect(googleAccountLabel({ accountEmail: "a@example.com", primaryCalendarId: "primary" })).toBe("a@example.com");
        expect(googleAccountLabel({ accountEmail: null, primaryCalendarId: "primary" })).toBe("primary");
        expect(googleAccountLabel({ accountEmail: "  ", primaryCalendarId: null })).toBe("Unidentified");
        expect(googleAccountLabel(null)).toBe("Unidentified");
    });

    it("derives a stable visible initial from the label", () => {
        expect(googleAccountInitial("a@example.com")).toBe("A");
        expect(googleAccountInitial("Unidentified")).toBe("U");
        expect(googleAccountInitial("   ")).toBe("?");
    });
});
