import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { LinearSettings } from "../lib/data/LinearDataAccess";
import { LinearIntegrationError } from "../lib/data/LinearDataAccess";
import type { PMTask, Project } from "../state/types";
import { LinearIntegrationCard } from "./LinearIntegrationCard";

const connected: LinearSettings = {
    teamKey: "ENG",
    includedStatuses: ["In Progress"],
    defaultProjectId: "project-1",
    lastSyncedAt: null,
    updatedAt: "2026-10-26T10:00:00.000Z",
};

const projects: Project[] = [
    {
        id: "project-1", name: "Alpha", color: "#111111", workableStart: "09:00", workableEnd: "17:00",
        workableDays: [1, 2, 3, 4, 5], isArchived: false, sortOrder: 0,
        createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
    },
    {
        id: "project-2", name: "Beta", color: "#222222", workableStart: "09:00", workableEnd: "17:00",
        workableDays: [1, 2, 3, 4, 5], isArchived: false, sortOrder: 1,
        createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
    },
];

const newIssue = {
    id: "issue-1",
    identifier: "ENG-123",
    title: "New issue",
    description: "Build the new flow",
    url: "https://linear.app/acme/issue/ENG-123/new-issue",
    dueDate: "2026-08-20T00:00:00Z",
    priority: 2,
    state: { name: "In Progress" },
};

function fakeAccess(settings: LinearSettings | null = connected) {
    return {
        loadSettings: vi.fn().mockResolvedValue(settings),
        connect: vi.fn().mockResolvedValue(undefined),
        updatePreferences: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockResolvedValue(undefined),
        sync: vi.fn().mockResolvedValue({
            issues: [newIssue],
            states: ["Backlog", "In Progress", "Done"],
            truncated: false,
            syncedAt: "2026-10-26T12:00:00.000Z",
        }),
    };
}

function createdTask(title = "Created"): PMTask {
    return {
        id: "task-1", title, projectId: null, status: "Backlog", priority: "Medium",
        timeSpentMinutes: 0, tags: [], links: [], checklist: [], sortOrder: 0,
        isArchived: false, createdAt: "2026-10-26T12:00:00.000Z", updatedAt: "2026-10-26T12:00:00.000Z", relatedTo: [],
    };
}

describe("LinearIntegrationCard", () => {
    it("loads the saved connection into the form", async () => {
        const access = fakeAccess();
        render(<LinearIntegrationCard dataAccess={access} currentTasks={[]} projects={projects} createTask={vi.fn()} />);

        expect(await screen.findByLabelText("Team key")).toHaveValue("ENG");
        expect(screen.getByLabelText("Included statuses")).toHaveValue("In Progress");
        expect(screen.getByLabelText("Default project")).toHaveValue("project-1");
        expect(screen.getByText("Connected")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Sync now" })).toBeEnabled();
    });

    it("connects with a token while leaving the team key blank for all teams", async () => {
        const user = userEvent.setup();
        const access = fakeAccess(null);
        render(<LinearIntegrationCard dataAccess={access} currentTasks={[]} projects={projects} createTask={vi.fn()} />);

        await user.type(await screen.findByLabelText("Linear API token"), "secret-token");
        expect(screen.getByLabelText("Team key")).toHaveValue("");
        expect(screen.getByLabelText("Included statuses")).toHaveValue("");
        await user.click(screen.getByRole("button", { name: "Connect" }));

        await waitFor(() => expect(access.connect).toHaveBeenCalledWith({
            token: "secret-token",
            teamKey: "",
            includedStatuses: [],
            defaultProjectId: null,
        }));
        expect(await screen.findByText("Connected")).toBeInTheDocument();
        expect(screen.queryByLabelText("Linear API token")).not.toBeInTheDocument();
    });

    it("saves preferences and disconnects without requiring a team key", async () => {
        const user = userEvent.setup();
        const access = fakeAccess();
        render(<LinearIntegrationCard dataAccess={access} currentTasks={[]} projects={projects} createTask={vi.fn()} />);

        const teamKey = await screen.findByLabelText("Team key");
        await user.clear(teamKey);
        await user.type(teamKey, "PLAT");
        await user.clear(screen.getByLabelText("Included statuses"));
        await user.type(screen.getByLabelText("Included statuses"), "Todo, In Progress");
        await user.selectOptions(screen.getByLabelText("Default project"), "project-2");
        await user.click(screen.getByRole("button", { name: "Save settings" }));
        await waitFor(() => expect(access.updatePreferences).toHaveBeenCalledWith({
            teamKey: "PLAT",
            includedStatuses: ["Todo", "In Progress"],
            defaultProjectId: "project-2",
        }));

        await user.click(screen.getByRole("button", { name: "Disconnect" }));
        await waitFor(() => expect(access.disconnect).toHaveBeenCalledOnce());
        expect(await screen.findByRole("button", { name: "Connect" })).toBeDisabled();
    });

    it("previews without creating, then confirms through the PM callback", async () => {
        const user = userEvent.setup();
        const access = fakeAccess();
        const createTask = vi.fn().mockResolvedValue(createdTask("New issue"));
        render(<LinearIntegrationCard dataAccess={access} currentTasks={[]} projects={projects} createTask={createTask} />);

        await user.click(await screen.findByRole("button", { name: "Sync now" }));
        const dialog = await screen.findByRole("dialog", { name: "Linear sync preview" });
        expect(within(dialog).getByText("New issue")).toBeInTheDocument();
        expect(within(dialog).getByText("Due 2026-08-20")).toBeInTheDocument();
        expect(within(dialog).getByText("linear:ENG-123")).toBeInTheDocument();
        expect(within(dialog).getByLabelText("Project for New issue")).toHaveValue("project-1");
        expect(within(dialog).getByText("Assigned issues")).toBeInTheDocument();
        expect(createTask).not.toHaveBeenCalled();
        await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
        expect(screen.queryByRole("dialog", { name: "Linear sync preview" })).not.toBeInTheDocument();
        expect(createTask).not.toHaveBeenCalled();

        await user.click(screen.getByRole("button", { name: "Sync now" }));
        await user.selectOptions(await screen.findByLabelText("Project for New issue"), "project-2");
        await user.click(await screen.findByRole("button", { name: "Create 1 task" }));
        await waitFor(() => expect(createTask).toHaveBeenCalledWith("New issue", expect.objectContaining({
            status: "Backlog",
            priority: "High",
            dueDate: "2026-08-20",
            projectId: "project-2",
            tags: ["linear:ENG-123"],
            links: [newIssue.url],
        })));
        const options = createTask.mock.calls[0]?.[1] as Partial<PMTask>;
        expect(options).not.toHaveProperty("estimatePomos");
        expect(await screen.findByLabelText("Linear sync result")).toHaveTextContent("Created 1");
        expect(screen.getByText(/Last synced:/)).not.toHaveTextContent("Never");
    });

    it("shows discovered state names as toggleable hints", async () => {
        const user = userEvent.setup();
        const access = fakeAccess();
        render(<LinearIntegrationCard dataAccess={access} currentTasks={[]} projects={projects} createTask={vi.fn()} />);

        expect(screen.queryByLabelText("Discovered Linear states")).not.toBeInTheDocument();
        await user.click(await screen.findByRole("button", { name: "Sync now" }));
        await user.click(await screen.findByRole("button", { name: "Cancel" }));

        const hints = screen.getByLabelText("Discovered Linear states");
        expect(within(hints).getByRole("button", { name: "In Progress" })).toHaveAttribute("aria-pressed", "true");
        expect(within(hints).getByRole("button", { name: "Done" })).toHaveAttribute("aria-pressed", "false");

        await user.click(within(hints).getByRole("button", { name: "Done" }));
        expect(screen.getByLabelText("Included statuses")).toHaveValue("In Progress, Done");
        expect(within(hints).getByRole("button", { name: "Done" })).toHaveAttribute("aria-pressed", "true");

        await user.click(within(hints).getByRole("button", { name: "Done" }));
        expect(screen.getByLabelText("Included statuses")).toHaveValue("In Progress");
    });

    it("flags a truncated sync in the preview and after closing it", async () => {
        const user = userEvent.setup();
        const access = fakeAccess();
        access.sync.mockResolvedValue({
            issues: [newIssue],
            states: ["In Progress"],
            truncated: true,
            syncedAt: "2026-10-26T12:00:00.000Z",
        });
        render(<LinearIntegrationCard dataAccess={access} currentTasks={[]} projects={projects} createTask={vi.fn()} />);

        await user.click(await screen.findByRole("button", { name: "Sync now" }));
        const dialog = await screen.findByRole("dialog", { name: "Linear sync preview" });
        expect(within(dialog).getByLabelText("Linear truncation notice")).toHaveTextContent("partial sync");
        await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
        expect(screen.getByLabelText("Linear truncation notice")).toBeInTheDocument();
    });

    it("explains an empty sync using the payload size and counters", async () => {
        const user = userEvent.setup();
        const access = fakeAccess();
        access.sync.mockResolvedValue({
            issues: [],
            states: ["Todo"],
            truncated: false,
            syncedAt: "2026-10-26T12:00:00.000Z",
        });
        render(<LinearIntegrationCard dataAccess={access} currentTasks={[]} projects={projects} createTask={vi.fn()} />);

        await user.click(await screen.findByRole("button", { name: "Sync now" }));
        const dialog = await screen.findByRole("dialog", { name: "Linear sync preview" });
        expect(within(dialog).getByText("No Linear issues are assigned to you in this sync's scope.")).toBeInTheDocument();
        expect(within(dialog).getByRole("button", { name: "Create 0 tasks" })).toBeDisabled();
    });

    it("explains that every issue was already imported", async () => {
        const user = userEvent.setup();
        const access = fakeAccess();
        const currentTasks: PMTask[] = [{
            ...createdTask("Existing"), tags: ["linear:ENG-123"], links: [],
        }];
        render(<LinearIntegrationCard dataAccess={access} currentTasks={currentTasks} projects={projects} createTask={vi.fn()} />);

        await user.click(await screen.findByRole("button", { name: "Sync now" }));
        const dialog = await screen.findByRole("dialog", { name: "Linear sync preview" });
        expect(within(dialog).getByText("Every assigned issue was already imported.")).toBeInTheDocument();
    });

    it("surfaces invalid-token recovery and rate-limit guidance", async () => {
        const user = userEvent.setup();
        const access = fakeAccess();
        access.sync.mockRejectedValueOnce(new LinearIntegrationError("LINEAR_TOKEN_INVALID", "invalid"));
        render(<LinearIntegrationCard dataAccess={access} currentTasks={[]} projects={projects} createTask={vi.fn()} />);

        await user.click(await screen.findByRole("button", { name: "Sync now" }));
        const invalidAlert = await screen.findByRole("alert");
        expect(invalidAlert).toHaveTextContent("invalid or has been revoked");
        await user.click(within(invalidAlert).getByRole("button", { name: "Reconnect" }));
        expect(screen.getByLabelText("Linear API token")).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Cancel" }));
        access.sync.mockRejectedValueOnce(new LinearIntegrationError("LINEAR_RATE_LIMITED", "limited", 12));
        await user.click(screen.getByRole("button", { name: "Sync now" }));
        expect(await screen.findByRole("alert")).toHaveTextContent("Try again in 12 seconds");
    });

    it("reports a partial task-creation failure and keeps the preview open", async () => {
        const user = userEvent.setup();
        const access = fakeAccess();
        access.sync.mockResolvedValue({
            issues: [
                newIssue,
                { ...newIssue, id: "issue-2", identifier: "ENG-124", url: "https://linear.app/acme/issue/ENG-124/second", title: "Second issue" },
            ],
            states: ["In Progress"],
            truncated: false,
            syncedAt: "2026-10-26T12:00:00.000Z",
        });
        const createTask = vi.fn().mockResolvedValueOnce(createdTask()).mockRejectedValueOnce(new Error("write failed"));
        render(<LinearIntegrationCard dataAccess={access} currentTasks={[]} projects={projects} createTask={createTask} />);

        await user.click(await screen.findByRole("button", { name: "Sync now" }));
        await user.click(await screen.findByRole("button", { name: "Create 2 tasks" }));

        expect(await screen.findByRole("alert")).toHaveTextContent("Created 1 task before task creation failed");
        expect(screen.getByRole("dialog", { name: "Linear sync preview" })).toBeInTheDocument();
    });
});
