import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GoogleCalendarDataAccess } from "../lib/data/GoogleCalendarDataAccess";
import { GoogleCalendarIntegrationCard } from "./GoogleCalendarIntegrationCard";

function access(overrides: Partial<GoogleCalendarDataAccess> = {}): GoogleCalendarDataAccess {
    return {
        loadSettings: vi.fn().mockResolvedValue(null),
        beginAuthorization: vi.fn().mockResolvedValue("https://accounts.google.com/o/oauth2/v2/auth?state=safe"),
        listCalendars: vi.fn().mockResolvedValue([]),
        updateSelectedCalendars: vi.fn().mockResolvedValue(undefined),
        fetchEvents: vi.fn().mockResolvedValue([]),
        fetchBusyIntervals: vi.fn(), loadTaskLink: vi.fn(), pushTask: vi.fn(), resyncTask: vi.fn(), unpushTask: vi.fn(),
        disconnect: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

beforeEach(() => window.history.replaceState({}, "", "/integrations"));
afterEach(() => vi.useRealTimers());

describe("GoogleCalendarIntegrationCard", () => {
    it("starts a read-only same-window connection", async () => {
        const dataAccess = access();
        const navigateTo = vi.fn();
        render(<GoogleCalendarIntegrationCard dataAccess={dataAccess} navigateTo={navigateTo} />);
        fireEvent.click(await screen.findByRole("button", { name: "Connect read only" }));
        await waitFor(() => expect(dataAccess.beginAuthorization).toHaveBeenCalledWith(expect.objectContaining({ scopeLevel: "readonly" })));
        expect(navigateTo).toHaveBeenCalledWith(expect.stringContaining("accounts.google.com"));
    });

    it("shows the connection tier and saves selected calendars from the picker dropdown", async () => {
        const settings = {
            scopeLevel: "schedule" as const, selectedCalendarIds: ["primary"], worktimeCalendarId: null,
            connectedAt: "2026-08-29T12:00:00.000Z", updatedAt: "2026-08-29T12:00:00.000Z",
        };
        const dataAccess = access({
            loadSettings: vi.fn().mockResolvedValue(settings),
            listCalendars: vi.fn().mockResolvedValue([
                { id: "primary", summary: "Personal", primary: true, selected: true, accessRole: "owner" },
                { id: "team", summary: "Team", primary: false, selected: true, accessRole: "reader" },
            ]),
        });
        render(<GoogleCalendarIntegrationCard dataAccess={dataAccess} />);
        expect(await screen.findByText("Connected — can schedule")).toBeInTheDocument();
        expect(screen.queryByLabelText(/Team/)).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: /busy-time calendars/i }));
        fireEvent.click(await screen.findByLabelText(/Team/));
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() => expect(dataAccess.updateSelectedCalendars).toHaveBeenCalledWith(["primary", "team"]));
        expect(screen.queryByRole("button", { name: /upgrade/i })).not.toBeInTheDocument();
    });

    it("shows event names and time periods in the current week", async () => {
        const settings = {
            scopeLevel: "readonly" as const, selectedCalendarIds: ["primary"], worktimeCalendarId: null,
            connectedAt: "2026-08-29T12:00:00.000Z", updatedAt: "2026-08-29T12:00:00.000Z",
        };
        const start = new Date();
        start.setHours(9, 0, 0, 0);
        const end = new Date(start);
        end.setHours(10, 30);
        const dataAccess = access({
            loadSettings: vi.fn().mockResolvedValue(settings),
            fetchEvents: vi.fn().mockResolvedValue([
                { id: "primary:event-1", title: "Team planning", start: start.toISOString(), end: end.toISOString(), allDay: false },
            ]),
        });

        render(<GoogleCalendarIntegrationCard dataAccess={dataAccess} />);

        expect(await screen.findByText("Team planning")).toBeInTheDocument();
        expect(screen.getByLabelText("Current week calendar")).toBeInTheDocument();
        expect(screen.getByText(/9:00.*10:30/)).toBeInTheDocument();
        expect(dataAccess.fetchEvents).toHaveBeenCalledWith(expect.objectContaining({ timeMin: expect.any(String), timeMax: expect.any(String) }));
    });

    it("visually mutes past days and events", async () => {
        vi.setSystemTime(new Date("2026-09-02T12:00:00"));
        const settings = {
            scopeLevel: "readonly" as const, selectedCalendarIds: ["primary"], worktimeCalendarId: null,
            connectedAt: "2026-08-29T12:00:00.000Z", updatedAt: "2026-08-29T12:00:00.000Z",
        };
        const start = new Date("2026-09-02T09:00:00");
        const end = new Date("2026-09-02T10:00:00");
        const dataAccess = access({
            loadSettings: vi.fn().mockResolvedValue(settings),
            fetchEvents: vi.fn().mockResolvedValue([
                { id: "primary:past", title: "Finished meeting", start: start.toISOString(), end: end.toISOString(), allDay: false },
            ]),
        });

        render(<GoogleCalendarIntegrationCard dataAccess={dataAccess} />);

        const eventTitle = await screen.findByText("Finished meeting");
        expect(eventTitle).toHaveClass("line-through");
        expect(eventTitle.closest("article")).toHaveAttribute("data-past", "true");
        expect(screen.getAllByRole("region").some((day) => day.getAttribute("data-past") === "true")).toBe(true);
    });

    it("closes the picker without saving when Escape is pressed", async () => {
        const settings = {
            scopeLevel: "readonly" as const, selectedCalendarIds: ["primary"], worktimeCalendarId: null,
            connectedAt: "2026-08-29T12:00:00.000Z", updatedAt: "2026-08-29T12:00:00.000Z",
        };
        const dataAccess = access({
            loadSettings: vi.fn().mockResolvedValue(settings),
            listCalendars: vi.fn().mockResolvedValue([
                { id: "primary", summary: "Personal", primary: true, selected: true, accessRole: "owner" },
            ]),
        });
        render(<GoogleCalendarIntegrationCard dataAccess={dataAccess} />);
        await screen.findByText("Connected — read only");
        fireEvent.click(screen.getByRole("button", { name: /busy-time calendars/i }));
        expect(await screen.findByLabelText(/Personal/)).toBeInTheDocument();
        fireEvent.keyDown(document, { key: "Escape" });
        expect(screen.queryByLabelText(/Personal/)).not.toBeInTheDocument();
        expect(dataAccess.updateSelectedCalendars).not.toHaveBeenCalled();
    });
});
