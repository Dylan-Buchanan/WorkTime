import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GoogleCalendarConnection, GoogleCalendarDataAccess } from "../lib/data/GoogleCalendarDataAccess";
import { GoogleCalendarIntegrationError } from "../lib/data/GoogleCalendarDataAccess";
import { GoogleCalendarIntegrationCard } from "./GoogleCalendarIntegrationCard";

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
        worktimeCalendarId: null,
        connectedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

function access(overrides: Partial<GoogleCalendarDataAccess> = {}): GoogleCalendarDataAccess {
    return {
        loadConnections: vi.fn().mockResolvedValue([]), setSchedulingConnection: vi.fn().mockResolvedValue(undefined),
        beginAuthorization: vi.fn().mockResolvedValue("https://accounts.google.com/o/oauth2/v2/auth?state=safe"),
        listCalendars: vi.fn().mockResolvedValue({ calendars: [], sources: [] }),
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
    it("starts a read-only same-window connection when no account exists", async () => {
        const dataAccess = access();
        const navigateTo = vi.fn();
        render(<GoogleCalendarIntegrationCard dataAccess={dataAccess} navigateTo={navigateTo} />);
        expect(await screen.findByText("No Google accounts are connected.")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Connect read only" }));
        await waitFor(() => expect(dataAccess.beginAuthorization).toHaveBeenCalledWith(expect.objectContaining({ scopeLevel: "readonly" })));
        expect(navigateTo).toHaveBeenCalledWith(expect.stringContaining("accounts.google.com"));
    });

    it("renders one reconnect action only for the account whose token is invalid", async () => {
        const a = connection("a", { isSchedulingTarget: true });
        const b = connection("b");
        const dataAccess = access({
            loadConnections: vi.fn().mockResolvedValue([a, b]),
            listCalendars: vi.fn().mockResolvedValue({
                calendars: [], sources: [
                    { connectionId: "a", accountEmail: "a@example.com", calendarCount: 0, busyMinutes: 0, errorCode: "GOOGLE_TOKEN_INVALID" },
                    { connectionId: "b", accountEmail: "b@example.com", calendarCount: 1, busyMinutes: 0, errorCode: null },
                ],
            }),
        });
        const navigateTo = vi.fn();

        render(<GoogleCalendarIntegrationCard dataAccess={dataAccess} navigateTo={navigateTo} />);

        expect(await screen.findByText("Google Calendar access for a@example.com needs reconnection.")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Reconnect b@example.com" })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Reconnect a@example.com" }));
        await waitFor(() => expect(dataAccess.beginAuthorization).toHaveBeenCalledWith(expect.objectContaining({ scopeLevel: "schedule", connectionId: "a" })));
        expect(dataAccess.disconnect).not.toHaveBeenCalled();
        expect(navigateTo).toHaveBeenCalledOnce();
    });

    it("offers per-account reconnect actions when a global token failure hides attribution", async () => {
        const a = connection("a", { isSchedulingTarget: true });
        const b = connection("b");
        const dataAccess = access({
            loadConnections: vi.fn().mockResolvedValue([a, b]),
            listCalendars: vi.fn().mockRejectedValue(new GoogleCalendarIntegrationError("GOOGLE_TOKEN_INVALID", "Google Calendar must be reconnected")),
            fetchEvents: vi.fn().mockRejectedValue(new GoogleCalendarIntegrationError("GOOGLE_TOKEN_INVALID", "Google Calendar must be reconnected")),
        });
        const navigateTo = vi.fn();

        render(<GoogleCalendarIntegrationCard dataAccess={dataAccess} navigateTo={navigateTo} />);

        expect(await screen.findByRole("alert")).toHaveTextContent("Google Calendar must be reconnected");
        expect(screen.getByRole("button", { name: "Reconnect a@example.com" })).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Reconnect b@example.com" }));
        await waitFor(() => expect(dataAccess.beginAuthorization).toHaveBeenCalledWith(expect.objectContaining({ scopeLevel: "schedule", connectionId: "b" })));
        expect(navigateTo).toHaveBeenCalledOnce();
    });

    it("offers a targeted reconnect when a token expires after the calendar list loaded", async () => {
        const a = connection("a", { isSchedulingTarget: true });
        const b = connection("b");
        const fetchEvents = vi.fn()
            .mockResolvedValueOnce([])
            .mockRejectedValue(new GoogleCalendarIntegrationError("GOOGLE_TOKEN_INVALID", "Google Calendar must be reconnected"));
        const dataAccess = access({
            loadConnections: vi.fn().mockResolvedValue([a, b]),
            listCalendars: vi.fn().mockResolvedValue({
                calendars: [], sources: [
                    { connectionId: "a", accountEmail: "a@example.com", calendarCount: 1, busyMinutes: 0, errorCode: null },
                    { connectionId: "b", accountEmail: "b@example.com", calendarCount: 1, busyMinutes: 0, errorCode: null },
                ],
            }),
            fetchEvents,
        });
        const navigateTo = vi.fn();

        render(<GoogleCalendarIntegrationCard dataAccess={dataAccess} navigateTo={navigateTo} />);
        await screen.findByText("b@example.com");
        await waitFor(() => expect(fetchEvents).toHaveBeenCalledOnce());

        fireEvent.click(screen.getByRole("button", { name: "Refresh this week's calendar" }));
        expect(await screen.findByRole("alert")).toHaveTextContent("Google Calendar must be reconnected");
        fireEvent.click(screen.getByRole("button", { name: "Reconnect b@example.com" }));
        await waitFor(() => expect(dataAccess.beginAuthorization).toHaveBeenCalledWith(expect.objectContaining({ scopeLevel: "schedule", connectionId: "b" })));
        expect(navigateTo).toHaveBeenCalledOnce();
    });


    it("shows one scope badge per account and saves a per-account calendar selection", async () => {
        const a = connection("a", { isSchedulingTarget: true });
        const b = connection("b", { scopeLevel: "readonly", selectedCalendarIds: [] });
        const dataAccess = access({
            loadConnections: vi.fn().mockResolvedValue([a, b]),
            listCalendars: vi.fn().mockResolvedValue({
                calendars: [
                    { id: "primary", connectionId: "a", summary: "Shared via A", primary: true, selected: true, accessRole: "owner" },
                    { id: "team", connectionId: "a", summary: "Team", primary: false, selected: false, accessRole: "reader" },
                    { id: "primary", connectionId: "b", summary: "Shared via B", primary: true, selected: true, accessRole: "reader" },
                ],
                sources: [],
            }),
        });
        render(<GoogleCalendarIntegrationCard dataAccess={dataAccess} />);
        expect(await screen.findByText("a@example.com")).toBeInTheDocument();
        expect(screen.getAllByText("Connected — can schedule")).toHaveLength(1);
        expect(screen.getAllByText("Connected — read only")).toHaveLength(1);

        fireEvent.click(screen.getAllByRole("button", { name: /busy-time calendars/i })[0]);
        expect(await screen.findByLabelText(/Shared via A/)).toBeInTheDocument();
        expect(screen.queryByLabelText(/Shared via B/)).not.toBeInTheDocument();
        fireEvent.click(screen.getByLabelText(/Team/));
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() => expect(dataAccess.updateSelectedCalendars).toHaveBeenCalledWith("a", ["primary", "team"]));
        expect(screen.queryByRole("button", { name: /upgrade/i })).not.toBeInTheDocument();
    });

    it("shows event names, times, and an accessible account chip in the current week", async () => {
        const a = connection("a", { isSchedulingTarget: true, scopeLevel: "readonly" });
        const start = new Date();
        start.setHours(9, 0, 0, 0);
        const end = new Date(start);
        end.setHours(10, 30);
        const dataAccess = access({
            loadConnections: vi.fn().mockResolvedValue([a]),
            fetchEvents: vi.fn().mockResolvedValue([
                { id: "primary:event-1", connectionId: "a", accountEmail: "a@example.com", title: "Team planning", start: start.toISOString(), end: end.toISOString(), allDay: false },
            ]),
        });

        render(<GoogleCalendarIntegrationCard dataAccess={dataAccess} />);

        expect(await screen.findByText("Team planning")).toBeInTheDocument();
        expect(screen.getByLabelText("Current week calendar")).toBeInTheDocument();
        expect(screen.getByText(/9:00.*10:30/)).toBeInTheDocument();
        const chip = screen.getByLabelText("Google account a@example.com");
        expect(chip).toHaveTextContent("A");
        expect(chip).toHaveAttribute("title", "Google account: a@example.com");
        expect(screen.getByText("Team planning").closest("article")?.getAttribute("title")).toContain("a@example.com");
        expect(dataAccess.fetchEvents).toHaveBeenCalledWith(expect.objectContaining({ timeMin: expect.any(String), timeMax: expect.any(String) }));
    });

    it("labels legacy account-less events as unidentified instead of inventing provenance", async () => {
        const start = new Date();
        start.setHours(9, 0, 0, 0);
        const end = new Date(start);
        end.setHours(10, 0);
        const dataAccess = access({
            loadConnections: vi.fn().mockResolvedValue([connection("a", { isSchedulingTarget: true })]),
            fetchEvents: vi.fn().mockResolvedValue([
                { id: "primary:legacy", title: "Legacy meeting", start: start.toISOString(), end: end.toISOString(), allDay: false },
            ]),
        });

        render(<GoogleCalendarIntegrationCard dataAccess={dataAccess} />);

        expect(await screen.findByText("Legacy meeting")).toBeInTheDocument();
        expect(screen.getByLabelText("Google account Unidentified")).toHaveTextContent("U");
    });

    it("prefers event identity over an unidentified legacy connection snapshot", async () => {
        const start = new Date();
        start.setHours(9, 0, 0, 0);
        const end = new Date(start);
        end.setHours(10, 0);
        const dataAccess = access({
            loadConnections: vi.fn().mockResolvedValue([connection("legacy", {
                isSchedulingTarget: true, accountId: null, accountEmail: null, primaryCalendarId: null, identitySource: "legacy",
            })]),
            fetchEvents: vi.fn().mockResolvedValue([
                { id: "primary:backfilled", connectionId: "legacy", accountEmail: "backfilled@example.com", title: "Backfilled meeting", start: start.toISOString(), end: end.toISOString(), allDay: false },
            ]),
        });

        render(<GoogleCalendarIntegrationCard dataAccess={dataAccess} />);

        expect(await screen.findByText("Backfilled meeting")).toBeInTheDocument();
        const chip = screen.getByLabelText("Google account backfilled@example.com");
        expect(chip).toHaveTextContent("B");
        expect(screen.getByText("Backfilled meeting").closest("article")?.getAttribute("title")).toContain("backfilled@example.com");
        expect(screen.queryByLabelText("Google account Unidentified")).not.toBeInTheDocument();
    });


    it("visually mutes past days and events", async () => {
        vi.setSystemTime(new Date("2026-09-02T12:00:00"));
        const a = connection("a", { isSchedulingTarget: true, scopeLevel: "readonly" });
        const start = new Date("2026-09-02T09:00:00");
        const end = new Date("2026-09-02T10:00:00");
        const dataAccess = access({
            loadConnections: vi.fn().mockResolvedValue([a]),
            fetchEvents: vi.fn().mockResolvedValue([
                { id: "primary:past", connectionId: "a", title: "Finished meeting", start: start.toISOString(), end: end.toISOString(), allDay: false },
            ]),
        });

        render(<GoogleCalendarIntegrationCard dataAccess={dataAccess} />);

        const eventTitle = await screen.findByText("Finished meeting");
        expect(eventTitle).toHaveClass("line-through");
        expect(eventTitle.closest("article")).toHaveAttribute("data-past", "true");
        expect(screen.getAllByRole("region").some((day) => day.getAttribute("data-past") === "true")).toBe(true);
    });

    it("closes the picker without saving when Escape is pressed", async () => {
        const a = connection("a", { isSchedulingTarget: true, scopeLevel: "readonly" });
        const dataAccess = access({
            loadConnections: vi.fn().mockResolvedValue([a]),
            listCalendars: vi.fn().mockResolvedValue({
                calendars: [{ id: "primary", connectionId: "a", summary: "Personal", primary: true, selected: true, accessRole: "owner" }],
                sources: [],
            }),
        });
        render(<GoogleCalendarIntegrationCard dataAccess={dataAccess} />);
        await screen.findByText("a@example.com");
        fireEvent.click(screen.getByRole("button", { name: /busy-time calendars/i }));
        expect(await screen.findByLabelText(/Personal/)).toBeInTheDocument();
        fireEvent.keyDown(document, { key: "Escape" });
        await waitFor(() => expect(screen.queryByLabelText(/Personal/)).not.toBeInTheDocument());
        expect(dataAccess.updateSelectedCalendars).not.toHaveBeenCalled();
    });

    it("marks exactly one focus-events account and keeps each account selection independent", async () => {
        const a = connection("a", { isSchedulingTarget: true });
        const b = connection("b", { selectedCalendarIds: [] });
        const dataAccess = access({
            loadConnections: vi.fn().mockResolvedValue([a, b]),
            listCalendars: vi.fn().mockResolvedValue({
                calendars: [
                    { id: "shared", connectionId: "a", summary: "Shared via A", primary: false, selected: true, accessRole: "owner" },
                    { id: "shared", connectionId: "b", summary: "Shared via B", primary: false, selected: false, accessRole: "reader" },
                ],
                sources: [],
            }),
        });
        const navigateTo = vi.fn();
        render(<GoogleCalendarIntegrationCard dataAccess={dataAccess} navigateTo={navigateTo} />);
        await screen.findByText("b@example.com");
        expect(screen.getAllByRole("radio").filter((radio) => (radio as HTMLInputElement).checked)).toHaveLength(1);

        fireEvent.click(screen.getAllByRole("button", { name: /busy-time calendars/i })[1]);
        const checkbox = await screen.findByLabelText("Shared via B");
        expect(checkbox).not.toBeChecked();
        expect(screen.queryByLabelText("Shared via A")).not.toBeInTheDocument();
        fireEvent.click(checkbox);
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() => expect(dataAccess.updateSelectedCalendars).toHaveBeenCalledWith("b", ["shared"]));
        await waitFor(() => expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument());

        fireEvent.click(screen.getByRole("radio", { name: "Use b@example.com for focus events" }));
        await waitFor(() => expect(dataAccess.setSchedulingConnection).toHaveBeenCalledWith("b"));
        expect(screen.getByRole("button", { name: "Add Google account" })).toBeEnabled();

        vi.spyOn(window, "confirm").mockReturnValue(true);
        fireEvent.click(screen.getByRole("button", { name: "Disconnect b@example.com" }));
        await waitFor(() => expect(dataAccess.disconnect).toHaveBeenCalledWith("b"));

        fireEvent.click(screen.getByRole("button", { name: "Add Google account" }));
        await waitFor(() => expect(dataAccess.beginAuthorization).toHaveBeenCalledWith({ scopeLevel: "readonly", returnTo: expect.any(String) }));
    });

    it("enforces the 50-calendar cap per account, not across the whole owner", async () => {
        const full = connection("full", { isSchedulingTarget: true, selectedCalendarIds: Array.from({ length: 50 }, (_, index) => `c${index}`) });
        const roomy = connection("roomy", { selectedCalendarIds: [] });
        const dataAccess = access({
            loadConnections: vi.fn().mockResolvedValue([full, roomy]),
            listCalendars: vi.fn().mockResolvedValue({
                calendars: [
                    ...Array.from({ length: 50 }, (_, index) => ({ id: `c${index}`, connectionId: "full", summary: `Full ${index}`, primary: false, selected: true, accessRole: "owner" })),
                    { id: "extra", connectionId: "full", summary: "Full extra", primary: false, selected: false, accessRole: "owner" },
                    { id: "extra", connectionId: "roomy", summary: "Roomy extra", primary: false, selected: false, accessRole: "owner" },
                ],
                sources: [],
            }),
        });
        render(<GoogleCalendarIntegrationCard dataAccess={dataAccess} />);
        await screen.findByText("roomy@example.com");

        fireEvent.click(screen.getAllByRole("button", { name: /busy-time calendars/i })[0]);
        expect(await screen.findByLabelText("Full extra")).toBeDisabled();
        fireEvent.click(screen.getAllByRole("button", { name: /busy-time calendars/i })[1]);
        expect(await screen.findByLabelText("Roomy extra")).toBeEnabled();
    });

    it("disables adding a sixth account and explains the cap", async () => {
        const accounts = Array.from({ length: 5 }, (_, index) => connection(`account-${index}`, { isSchedulingTarget: index === 0 }));
        render(<GoogleCalendarIntegrationCard dataAccess={access({ loadConnections: vi.fn().mockResolvedValue(accounts) })} />);
        expect(await screen.findByText("Google Calendar supports up to 5 accounts. Disconnect one to add another.")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Add Google account" })).toBeDisabled();
    });

    it("refuses to open a picker for an account disconnected in another tab", async () => {
        const old = connection("old", { isSchedulingTarget: true, selectedCalendarIds: [] });
        const current = connection("new", { isSchedulingTarget: true, selectedCalendarIds: [] });
        const dataAccess = access({
            loadConnections: vi.fn().mockResolvedValueOnce([old]).mockResolvedValue([current]),
        });
        render(<GoogleCalendarIntegrationCard dataAccess={dataAccess} />);
        await screen.findByText("old@example.com");
        fireEvent.click(screen.getByRole("button", { name: /busy-time calendars/i }));
        expect(await screen.findByRole("alert")).toHaveTextContent("Google account was disconnected. Refresh and try again.");
        expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    });

    it("explains the account cap when Google rejects a sixth account", async () => {
        window.history.replaceState({}, "", "/integrations?google_calendar_error=GOOGLE_ACCOUNT_LIMIT_REACHED");
        const accounts = Array.from({ length: 5 }, (_, index) => connection(`account-${index}`, { isSchedulingTarget: index === 0 }));
        render(<GoogleCalendarIntegrationCard dataAccess={access({ loadConnections: vi.fn().mockResolvedValue(accounts) })} />);

        expect(await screen.findByRole("button", { name: "Add Google account" })).toBeDisabled();
        expect(screen.getByText("Google Calendar already has 5 connected accounts. Disconnect one before adding another.")).toBeInTheDocument();
        expect(screen.getByText("Google Calendar supports up to 5 accounts. Disconnect one to add another.")).toBeInTheDocument();
    });

    it("names the returned account and strips OAuth keys on the integrations route", async () => {
        window.history.replaceState({}, "", "/integrations?keep=yes&google_calendar=connected&google_calendar_scope=schedule&connection_id=b&account_email=secret%40example.com");
        const dataAccess = access({
            loadConnections: vi.fn().mockResolvedValue([
                connection("a", { isSchedulingTarget: true }),
                connection("b"),
            ]),
        });
        render(<GoogleCalendarIntegrationCard dataAccess={dataAccess} />);

        expect(await screen.findByText("Google Calendar connected: b@example.com.")).toBeInTheDocument();
        expect(window.location.pathname).toBe("/integrations");
        expect(window.location.search).toBe("?keep=yes");
    });

    it("keeps a global invalid-token reconnect on the scheduling account", async () => {
        const a = connection("a", { isSchedulingTarget: true });
        const dataAccess = access({
            loadConnections: vi.fn().mockResolvedValue([a]),
            fetchEvents: vi.fn().mockRejectedValue(new GoogleCalendarIntegrationError("GOOGLE_TOKEN_INVALID", "Google Calendar must be reconnected")),
        });
        const navigateTo = vi.fn();

        render(<GoogleCalendarIntegrationCard dataAccess={dataAccess} navigateTo={navigateTo} />);

        const alert = await screen.findByRole("alert");
        fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
        expect(alert).toHaveTextContent("Google Calendar must be reconnected");
        await waitFor(() => expect(dataAccess.beginAuthorization).toHaveBeenCalledWith(expect.objectContaining({ scopeLevel: "schedule", connectionId: "a" })));
        expect(dataAccess.disconnect).not.toHaveBeenCalled();
        expect(navigateTo).toHaveBeenCalledOnce();
    });
});
