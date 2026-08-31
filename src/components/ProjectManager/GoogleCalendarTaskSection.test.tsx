import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { GoogleCalendarDataAccess, GoogleCalendarTaskLink } from "../../lib/data/GoogleCalendarDataAccess";
import { GoogleCalendarIntegrationError } from "../../lib/data/GoogleCalendarDataAccess";
import type { PMTask } from "../../state/types";
import { GoogleCalendarTaskSection } from "./GoogleCalendarTaskSection";

const task: PMTask = {
    id: "task-1", title: "Write launch brief", projectId: "project-1", status: "Next", priority: "High",
    dueDate: "2026-08-30", estimatePomos: 2, timeSpentMinutes: 0, tags: [], links: [], checklist: [],
    sortOrder: 0, isArchived: false, createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-29T00:00:00Z", relatedTo: [],
};

const linked: GoogleCalendarTaskLink = {
    taskId: "task-1", calendarId: "calendar-1", eventId: "event-1",
    scheduledStart: "2026-08-30T14:00:00.000Z", scheduledEnd: "2026-08-30T14:50:00.000Z",
    estimatePomos: 2, workMinutes: 25, updatedAt: "2026-08-29T12:00:00.000Z",
};

function access(scopeLevel: "readonly" | "schedule", overrides: Partial<GoogleCalendarDataAccess> = {}): GoogleCalendarDataAccess {
    return {
        loadSettings: vi.fn().mockResolvedValue({
            scopeLevel, selectedCalendarIds: ["primary"], worktimeCalendarId: "calendar-1",
            connectedAt: "2026-08-29T12:00:00.000Z", updatedAt: "2026-08-29T12:00:00.000Z",
        }),
        beginAuthorization: vi.fn().mockResolvedValue("https://accounts.google.com/o/oauth2/v2/auth?state=safe"),
        listCalendars: vi.fn(), updateSelectedCalendars: vi.fn(), fetchEvents: vi.fn(), fetchBusyIntervals: vi.fn(),
        loadTaskLink: vi.fn().mockResolvedValue(null), pushTask: vi.fn().mockResolvedValue(linked),
        resyncTask: vi.fn().mockResolvedValue(linked), unpushTask: vi.fn().mockResolvedValue(undefined), disconnect: vi.fn(),
        ...overrides,
    };
}

describe("GoogleCalendarTaskSection", () => {
    it("lazily upgrades readonly access while preserving task ID/start but not title", async () => {
        const dataAccess = access("readonly");
        const navigateTo = vi.fn();
        render(<MemoryRouter><GoogleCalendarTaskSection task={task} workMinutes={25} dataAccess={dataAccess} navigateTo={navigateTo} /></MemoryRouter>);
        fireEvent.click(await screen.findByRole("button", { name: "Push to Google" }));
        await waitFor(() => expect(dataAccess.beginAuthorization).toHaveBeenCalledOnce());
        expect(dataAccess.beginAuthorization).toHaveBeenCalledWith(expect.objectContaining({ scopeLevel: "schedule", pendingTaskId: "task-1", pendingScheduledStart: expect.any(String) }));
        expect(dataAccess.beginAuthorization).not.toHaveBeenCalledWith(expect.objectContaining({ title: expect.anything() }));
        expect(dataAccess.pushTask).not.toHaveBeenCalled();
        expect(navigateTo).toHaveBeenCalledOnce();
    });

    it("requires an explicit override after an interval-only conflict", async () => {
        const pushTask = vi.fn()
            .mockRejectedValueOnce(new GoogleCalendarIntegrationError("CALENDAR_CONFLICT", "Busy", undefined, [{ start: "2026-08-30T14:00:00Z", end: "2026-08-30T14:30:00Z" }]))
            .mockResolvedValueOnce(linked);
        const dataAccess = access("schedule", { pushTask });
        render(<MemoryRouter><GoogleCalendarTaskSection task={task} workMinutes={25} dataAccess={dataAccess} /></MemoryRouter>);
        fireEvent.click(await screen.findByRole("button", { name: "Push to Google" }));
        expect(await screen.findByRole("button", { name: "Push anyway" })).toBeInTheDocument();
        expect(pushTask).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole("button", { name: "Push anyway" }));
        await waitFor(() => expect(pushTask).toHaveBeenCalledTimes(2));
        expect(pushTask.mock.calls[1][0]).toMatchObject({ allowConflict: true, title: "Write launch brief" });
    });

    it("surfaces estimate drift and resyncs only on request", async () => {
        const dataAccess = access("schedule", { loadTaskLink: vi.fn().mockResolvedValue({ ...linked, estimatePomos: 1 }) });
        render(<MemoryRouter><GoogleCalendarTaskSection task={task} workMinutes={25} dataAccess={dataAccess} /></MemoryRouter>);
        expect(await screen.findByText("Out of sync")).toBeInTheDocument();
        expect(dataAccess.resyncTask).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole("button", { name: "Resync" }));
        await waitFor(() => expect(dataAccess.resyncTask).toHaveBeenCalledWith(expect.objectContaining({ estimatePomos: 2, workMinutes: 25 })));
    });
});
