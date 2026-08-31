import { describe, expect, it, vi } from "vitest";
import { consumeGoogleCalendarOAuthReturn, parseGoogleCalendarOAuthReturn } from "./googleCalendarOAuthReturn";

describe("Google Calendar OAuth return", () => {
    it("parses a validated pending task without accepting unrelated title data", () => {
        const url = new URL("https://worktime.test/projects?google_calendar=connected&google_calendar_scope=schedule&pending_task_id=task-1&pending_scheduled_start=2026-08-29T14%3A00%3A00.000Z&title=secret");
        expect(parseGoogleCalendarOAuthReturn(url)).toEqual({
            connected: true,
            scopeLevel: "schedule",
            errorCode: null,
            pendingTaskId: "task-1",
            pendingScheduledStart: "2026-08-29T14:00:00.000Z",
        });
    });

    it("drops incomplete pending metadata and removes only integration query keys", () => {
        const replace = vi.fn();
        const result = consumeGoogleCalendarOAuthReturn(
            "https://worktime.test/projects?keep=yes&google_calendar_error=OAUTH_ACCESS_DENIED&pending_task_id=task-1#section",
            replace,
        );
        expect(result).toMatchObject({ errorCode: "OAUTH_ACCESS_DENIED", pendingTaskId: null, pendingScheduledStart: null });
        expect(replace).toHaveBeenCalledWith("/projects?keep=yes#section");
    });
});
