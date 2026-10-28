import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { GoogleCalendarConnection, GoogleCalendarDataAccess, GoogleCalendarTaskLink } from "../../lib/data/GoogleCalendarDataAccess";
import { GoogleCalendarIntegrationError } from "../../lib/data/GoogleCalendarDataAccess";
import type { GoogleCalendarOAuthReturn } from "../../lib/integrations";
import type { PMTask } from "../../state/types";
import { GoogleCalendarTaskSection } from "./GoogleCalendarTaskSection";

const task: PMTask = {
    id: "task-1", title: "Write launch brief", projectId: "project-1", status: "Next", priority: "High",
    dueDate: "2026-08-30", estimatePomos: 2, timeSpentMinutes: 0, tags: [], links: [], checklist: [],
    sortOrder: 0, isArchived: false, createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-29T00:00:00Z", relatedTo: [],
};

const linked: GoogleCalendarTaskLink = {
    connectionId: "scheduling-connection",
    taskId: "task-1", calendarId: "calendar-1", eventId: "event-1",
    scheduledStart: "2026-08-30T14:00:00.000Z", scheduledEnd: "2026-08-30T14:50:00.000Z",
    estimatePomos: 2, workMinutes: 25, updatedAt: "2026-08-29T12:00:00.000Z",
};

function connection(connectionId: string, overrides: Partial<GoogleCalendarConnection> = {}): GoogleCalendarConnection {
    return {
        connectionId,
        accountId: "sub",
        accountEmail: `${connectionId}@example.com`,
        primaryCalendarId: "primary",
        isSchedulingTarget: false,
        identitySource: "userinfo",
        scopeLevel: "schedule",
        selectedCalendarIds: ["primary"],
        worktimeCalendarId: "calendar-1",
        connectedAt: "2026-08-29T12:00:00.000Z",
        updatedAt: "2026-08-29T12:00:00.000Z",
        ...overrides,
    };
}

function access(connections: GoogleCalendarConnection[], overrides: Partial<GoogleCalendarDataAccess> = {}): GoogleCalendarDataAccess {
    return {
        loadConnections: vi.fn().mockResolvedValue(connections), setSchedulingConnection: vi.fn(),
        beginAuthorization: vi.fn().mockResolvedValue("https://accounts.google.com/o/oauth2/v2/auth?state=safe"),
        listCalendars: vi.fn().mockResolvedValue({ calendars: [], sources: [] }),
        updateSelectedCalendars: vi.fn(), fetchEvents: vi.fn(), fetchBusyIntervals: vi.fn(),
        loadTaskLink: vi.fn().mockResolvedValue(null), pushTask: vi.fn().mockResolvedValue(linked),
        resyncTask: vi.fn().mockResolvedValue(linked), unpushTask: vi.fn().mockResolvedValue(undefined), disconnect: vi.fn(),
        ...overrides,
    };
}

describe("GoogleCalendarTaskSection", () => {
    it("lazily upgrades readonly scheduling access while preserving task ID/start but not title", async () => {
        const dataAccess = access([connection("scheduling-connection", { isSchedulingTarget: true, scopeLevel: "readonly" })]);
        const navigateTo = vi.fn();
        render(<MemoryRouter><GoogleCalendarTaskSection task={task} workMinutes={25} dataAccess={dataAccess} navigateTo={navigateTo} /></MemoryRouter>);
        fireEvent.click(await screen.findByRole("button", { name: "Push to Google" }));
        await waitFor(() => expect(dataAccess.beginAuthorization).toHaveBeenCalledOnce());
        expect(dataAccess.beginAuthorization).toHaveBeenCalledWith(expect.objectContaining({ scopeLevel: "schedule", connectionId: "scheduling-connection", pendingTaskId: "task-1", pendingScheduledStart: expect.any(String) }));
        expect(dataAccess.beginAuthorization).not.toHaveBeenCalledWith(expect.objectContaining({ title: expect.anything() }));
        expect(dataAccess.pushTask).not.toHaveBeenCalled();
        expect(navigateTo).toHaveBeenCalledOnce();
    });

    it("requires an explicit override after an interval-only conflict", async () => {
        const pushTask = vi.fn()
            .mockRejectedValueOnce(new GoogleCalendarIntegrationError("CALENDAR_CONFLICT", "Busy", undefined, [{ start: "2026-08-30T14:00:00Z", end: "2026-08-30T14:30:00Z" }]))
            .mockResolvedValueOnce(linked);
        const dataAccess = access([connection("scheduling-connection", { isSchedulingTarget: true })], { pushTask });
        render(<MemoryRouter><GoogleCalendarTaskSection task={task} workMinutes={25} dataAccess={dataAccess} /></MemoryRouter>);
        fireEvent.click(await screen.findByRole("button", { name: "Push to Google" }));
        expect(await screen.findByRole("button", { name: "Push anyway" })).toBeInTheDocument();
        expect(pushTask).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole("button", { name: "Push anyway" }));
        await waitFor(() => expect(pushTask).toHaveBeenCalledTimes(2));
        expect(pushTask.mock.calls[1][0]).toMatchObject({ allowConflict: true, title: "Write launch brief" });
    });

    it("offers an in-place reconnect on the scheduling account after an invalid-token task operation", async () => {
        const dataAccess = access([connection("scheduling-connection", { isSchedulingTarget: true })], {
            pushTask: vi.fn().mockRejectedValue(new GoogleCalendarIntegrationError("GOOGLE_TOKEN_INVALID", "Google Calendar must be reconnected")),
        });
        const navigateTo = vi.fn();
        render(<MemoryRouter><GoogleCalendarTaskSection task={task} workMinutes={25} dataAccess={dataAccess} navigateTo={navigateTo} /></MemoryRouter>);

        fireEvent.click(await screen.findByRole("button", { name: "Push to Google" }));
        const alert = await screen.findByRole("alert");
        expect(alert).toHaveTextContent("Google Calendar must be reconnected");
        fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));

        await waitFor(() => expect(dataAccess.beginAuthorization).toHaveBeenCalledWith(expect.objectContaining({ scopeLevel: "schedule", connectionId: "scheduling-connection" })));
        expect(dataAccess.disconnect).not.toHaveBeenCalled();
        expect(navigateTo).toHaveBeenCalledOnce();
    });

    it("surfaces estimate drift and resyncs only on request", async () => {
        const dataAccess = access([connection("scheduling-connection", { isSchedulingTarget: true })], { loadTaskLink: vi.fn().mockResolvedValue({ ...linked, estimatePomos: 1 }) });
        render(<MemoryRouter><GoogleCalendarTaskSection task={task} workMinutes={25} dataAccess={dataAccess} /></MemoryRouter>);
        expect(await screen.findByText("Out of sync")).toBeInTheDocument();
        expect(dataAccess.resyncTask).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole("button", { name: "Resync" }));
        await waitFor(() => expect(dataAccess.resyncTask).toHaveBeenCalledWith(expect.objectContaining({ estimatePomos: 2, workMinutes: 25 })));
    });

    it("attributes a link to a non-target account and unpushes it without re-homing the target", async () => {
        const dataAccess = access([
            connection("scheduling-connection", { isSchedulingTarget: true }),
            connection("link-owner"),
        ], { loadTaskLink: vi.fn().mockResolvedValue({ ...linked, connectionId: "link-owner" }) });
        render(<MemoryRouter><GoogleCalendarTaskSection task={task} workMinutes={25} dataAccess={dataAccess} /></MemoryRouter>);

        expect(await screen.findByText("Event owned by link-owner@example.com.")).toBeInTheDocument();
        expect(screen.getByText(/Focus events use scheduling-connection@example.com/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Unpush" }));
        await waitFor(() => expect(dataAccess.unpushTask).toHaveBeenCalledWith("task-1"));
        expect(dataAccess.setSchedulingConnection).not.toHaveBeenCalled();
    });

    it("reconnects the link owner when ownership differs from the scheduling account", async () => {
        const dataAccess = access([
            connection("scheduling-connection", { isSchedulingTarget: true }),
            connection("link-owner", { scopeLevel: "readonly" }),
        ], {
            loadTaskLink: vi.fn().mockResolvedValue({ ...linked, connectionId: "link-owner" }),
            resyncTask: vi.fn().mockRejectedValue(new GoogleCalendarIntegrationError("GOOGLE_TOKEN_INVALID", "Google Calendar must be reconnected")),
        });
        const navigateTo = vi.fn();
        render(<MemoryRouter><GoogleCalendarTaskSection task={task} workMinutes={25} dataAccess={dataAccess} navigateTo={navigateTo} /></MemoryRouter>);

        fireEvent.click(await screen.findByRole("button", { name: "Resync" }));
        fireEvent.click(await screen.findByRole("button", { name: "Reconnect" }));
        await waitFor(() => expect(dataAccess.beginAuthorization).toHaveBeenCalledWith(expect.objectContaining({ scopeLevel: "readonly", connectionId: "link-owner" })));
        expect(navigateTo).toHaveBeenCalledOnce();
    });

    it("resumes a pending push exactly once against the advertised scheduling account", async () => {
        const pushTask = vi.fn().mockResolvedValue(linked);
        const dataAccess = access([connection("scheduling-connection", { isSchedulingTarget: true })], { pushTask });
        const onResumeConsumed = vi.fn();
        const resume: GoogleCalendarOAuthReturn = {
            connectionId: "scheduling-connection", connected: true, scopeLevel: "schedule", errorCode: null,
            pendingTaskId: "task-1", pendingScheduledStart: "2026-08-30T14:00:00.000Z",
        };
        render(<MemoryRouter><GoogleCalendarTaskSection task={task} workMinutes={25} dataAccess={dataAccess} resume={resume} onResumeConsumed={onResumeConsumed} /></MemoryRouter>);

        await waitFor(() => expect(pushTask).toHaveBeenCalledTimes(1));
        expect(pushTask).toHaveBeenCalledWith(expect.objectContaining({ taskId: "task-1", scheduledStart: "2026-08-30T14:00:00.000Z" }));
        expect(dataAccess.beginAuthorization).not.toHaveBeenCalled();
        await waitFor(() => expect(onResumeConsumed).toHaveBeenCalledOnce());
    });

    it("refuses to resume when the advertised account is no longer the scheduling account", async () => {
        const pushTask = vi.fn().mockResolvedValue(linked);
        const dataAccess = access([connection("different-connection", { isSchedulingTarget: true })], { pushTask });
        const onResumeConsumed = vi.fn();
        const resume: GoogleCalendarOAuthReturn = {
            connectionId: "advertised-connection", connected: true, scopeLevel: "schedule", errorCode: null,
            pendingTaskId: "task-1", pendingScheduledStart: "2026-08-30T14:00:00.000Z",
        };
        render(<MemoryRouter><GoogleCalendarTaskSection task={task} workMinutes={25} dataAccess={dataAccess} resume={resume} onResumeConsumed={onResumeConsumed} /></MemoryRouter>);

        expect(await screen.findByText("The Google account used for focus events changed. Push the task again.")).toBeInTheDocument();
        expect(pushTask).not.toHaveBeenCalled();
        await waitFor(() => expect(onResumeConsumed).toHaveBeenCalledOnce());
    });

    it("tells the user to choose an account when none is connected", async () => {
        render(<MemoryRouter><GoogleCalendarTaskSection task={task} workMinutes={25} dataAccess={access([])} /></MemoryRouter>);
        expect(await screen.findByText(/Connect a Google account in/)).toBeInTheDocument();
    });
});
