import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ShortcutSettings } from "../lib/data/ShortcutDataAccess";
import { ShortcutIntegrationError } from "../lib/data/ShortcutDataAccess";
import type { PMTask, Project } from "../state/types";
import { ShortcutIntegrationCard } from "./ShortcutIntegrationCard";

const connected: ShortcutSettings = {
    teamName: "Data Thinkers",
    includedStatuses: ["Ready"],
    defaultProjectId: "project-1",
    lastSyncedAt: null,
    updatedAt: "2026-08-12T10:00:00.000Z",
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

const newStory = {
    id: 1,
    app_url: "https://app.shortcut.com/acme/story/1",
    name: "New story",
    description: "Build the new flow",
    estimate: 3,
    deadline: "2026-08-20T00:00:00Z",
    workflow_state_id: 1,
    status_name: "Ready",
    completed: false,
    archived: false,
    story_type: "feature" as const,
    labels: [],
};

function fakeAccess(settings: ShortcutSettings | null = connected) {
    return {
        loadSettings: vi.fn().mockResolvedValue(settings),
        connect: vi.fn().mockResolvedValue(undefined),
        updatePreferences: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockResolvedValue(undefined),
        sync: vi.fn().mockResolvedValue({ stories: [newStory], syncedAt: "2026-08-12T12:00:00.000Z" }),
    };
}

function createdTask(title = "Created"): PMTask {
    return {
        id: "task-1", title, projectId: null, status: "Backlog", priority: "Medium",
        timeSpentMinutes: 0, tags: [], links: [], checklist: [], sortOrder: 0,
        isArchived: false, createdAt: "2026-08-12T12:00:00.000Z", updatedAt: "2026-08-12T12:00:00.000Z", relatedTo: [],
    };
}

describe("ShortcutIntegrationCard", () => {
    it("connects with a token and default included statuses", async () => {
        const user = userEvent.setup();
        const access = fakeAccess(null);
        render(<ShortcutIntegrationCard dataAccess={access} currentTasks={[]} projects={projects} createTask={vi.fn()} />);

        await user.type(await screen.findByLabelText("Shortcut API token"), "secret-token");
        await user.type(screen.getByLabelText("Team"), "Data Thinkers");
        await user.click(screen.getByRole("button", { name: "Connect" }));

        await waitFor(() => expect(access.connect).toHaveBeenCalledWith({
            token: "secret-token",
            teamName: "Data Thinkers",
            includedStatuses: ["In Discovery", "Ready for Dev", "In Dev"],
            defaultProjectId: null,
        }));
        expect(await screen.findByText("Connected")).toBeInTheDocument();
        expect(screen.queryByLabelText("Shortcut API token")).not.toBeInTheDocument();
    });

    it("saves public preferences and disconnects", async () => {
        const user = userEvent.setup();
        const access = fakeAccess();
        render(<ShortcutIntegrationCard dataAccess={access} currentTasks={[]} projects={projects} createTask={vi.fn()} />);

        const team = await screen.findByLabelText("Team");
        await user.clear(team);
        await user.type(team, "Platform");
        await user.clear(screen.getByLabelText("Included statuses"));
        await user.type(screen.getByLabelText("Included statuses"), "Ready, In Dev");
        await user.selectOptions(screen.getByLabelText("Default project"), "project-2");
        await user.click(screen.getByRole("button", { name: "Save settings" }));
        await waitFor(() => expect(access.updatePreferences).toHaveBeenCalledWith({
            teamName: "Platform",
            includedStatuses: ["Ready", "In Dev"],
            defaultProjectId: "project-2",
        }));

        await user.click(screen.getByRole("button", { name: "Disconnect" }));
        await waitFor(() => expect(access.disconnect).toHaveBeenCalledOnce());
        expect(await screen.findByRole("button", { name: "Connect" })).toBeDisabled();
    });

    it("previews without creating, then confirms through the PM callback", async () => {
        const user = userEvent.setup();
        const access = fakeAccess();
        const createTask = vi.fn().mockResolvedValue(createdTask("New story"));
        render(<ShortcutIntegrationCard dataAccess={access} currentTasks={[]} projects={projects} createTask={createTask} />);

        await user.click(await screen.findByRole("button", { name: "Sync now" }));
        const dialog = await screen.findByRole("dialog", { name: "Shortcut sync preview" });
        expect(within(dialog).getByText("New story")).toBeInTheDocument();
        expect(within(dialog).getByText("Due 2026-08-20")).toBeInTheDocument();
        expect(within(dialog).getByLabelText("Project for New story")).toHaveValue("project-1");
        expect(createTask).not.toHaveBeenCalled();
        await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
        expect(screen.queryByRole("dialog", { name: "Shortcut sync preview" })).not.toBeInTheDocument();
        expect(createTask).not.toHaveBeenCalled();

        await user.click(screen.getByRole("button", { name: "Sync now" }));
        await user.selectOptions(await screen.findByLabelText("Project for New story"), "project-2");
        await user.click(await screen.findByRole("button", { name: "Create 1 task" }));
        await waitFor(() => expect(createTask).toHaveBeenCalledWith("New story", expect.objectContaining({
            status: "Backlog",
            priority: "Medium",
            estimatePomos: 8,
            dueDate: "2026-08-20",
            projectId: "project-2",
            links: [newStory.app_url],
        })));
        expect(await screen.findByLabelText("Shortcut sync result")).toHaveTextContent("Created 1");
        expect(screen.getByText(/Last synced:/)).not.toHaveTextContent("Never");
    });

    it("removes selected tasks from the preview before creating", async () => {
        const user = userEvent.setup();
        const access = fakeAccess();
        access.sync.mockResolvedValue({
            stories: [
                newStory,
                { ...newStory, id: 2, app_url: "https://app.shortcut.com/acme/story/2", name: "Keep this story" },
            ],
            syncedAt: "2026-08-12T12:00:00.000Z",
        });
        const createTask = vi.fn().mockResolvedValue(createdTask());
        render(<ShortcutIntegrationCard dataAccess={access} currentTasks={[]} projects={projects} createTask={createTask} />);

        await user.click(await screen.findByRole("button", { name: "Sync now" }));
        const dialog = await screen.findByRole("dialog", { name: "Shortcut sync preview" });
        await user.click(within(dialog).getByRole("button", { name: "Remove New story from import" }));

        expect(within(dialog).queryByText("New story")).not.toBeInTheDocument();
        expect(within(dialog).getByText("Keep this story")).toBeInTheDocument();
        await user.click(within(dialog).getByRole("button", { name: "Create 1 task" }));

        await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));
        expect(createTask).toHaveBeenCalledWith("Keep this story", expect.anything());
        expect(createTask).not.toHaveBeenCalledWith("New story", expect.anything());
    });

    it("reports a partial task-creation failure and keeps the preview open", async () => {
        const user = userEvent.setup();
        const access = fakeAccess();
        access.sync.mockResolvedValue({
            stories: [newStory, { ...newStory, id: 2, app_url: "https://app.shortcut.com/acme/story/2", name: "Second story" }],
            syncedAt: "2026-08-12T12:00:00.000Z",
        });
        const createTask = vi.fn().mockResolvedValueOnce(createdTask()).mockRejectedValueOnce(new Error("write failed"));
        render(<ShortcutIntegrationCard dataAccess={access} currentTasks={[]} projects={projects} createTask={createTask} />);

        await user.click(await screen.findByRole("button", { name: "Sync now" }));
        await user.click(await screen.findByRole("button", { name: "Create 2 tasks" }));

        expect(await screen.findByRole("alert")).toHaveTextContent("Created 1 task before task creation failed");
        expect(screen.getByRole("dialog", { name: "Shortcut sync preview" })).toBeInTheDocument();
    });

    it("surfaces invalid-token recovery and rate-limit guidance", async () => {
        const user = userEvent.setup();
        const access = fakeAccess();
        access.sync.mockRejectedValueOnce(new ShortcutIntegrationError("SHORTCUT_TOKEN_INVALID", "invalid"));
        render(<ShortcutIntegrationCard dataAccess={access} currentTasks={[]} projects={projects} createTask={vi.fn()} />);

        await user.click(await screen.findByRole("button", { name: "Sync now" }));
        const invalidAlert = await screen.findByRole("alert");
        expect(invalidAlert).toHaveTextContent("invalid or has been revoked");
        await user.click(within(invalidAlert).getByRole("button", { name: "Reconnect" }));
        expect(screen.getByLabelText("Shortcut API token")).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Cancel" }));
        access.sync.mockRejectedValueOnce(new ShortcutIntegrationError("SHORTCUT_RATE_LIMITED", "limited", 12));
        await user.click(screen.getByRole("button", { name: "Sync now" }));
        expect(await screen.findByRole("alert")).toHaveTextContent("Try again in 12 seconds");
    });
});
