import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type {
    GitHubRepoListResult,
    GitHubSettings,
    GitHubSyncResult,
} from "../lib/data/GitHubDataAccess";
import { GitHubIntegrationError } from "../lib/data/GitHubDataAccess";
import type { PMTask, Project } from "../state/types";
import { GithubIntegrationCard } from "./GithubIntegrationCard";

const connected: GitHubSettings = {
    githubUsername: "octocat",
    lastSyncedAt: null,
    updatedAt: "2026-08-31T10:00:00.000Z",
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

const repoList: GitHubRepoListResult = {
    repos: [
        {
            ownerId: "owner-1", fullName: "octocat/hello-world", selected: true, projectId: "project-1",
            labelFilter: "bug", includeClosed: false, isStale: false, updatedAt: "2026-08-31T10:00:00.000Z",
        },
        {
            ownerId: "owner-1", fullName: "octocat/gone", selected: true, projectId: null,
            labelFilter: null, includeClosed: false, isStale: true, updatedAt: "2026-08-31T10:00:00.000Z",
        },
    ],
    labels: { "octocat/hello-world": ["bug", "enhancement"], "octocat/gone": [] },
};

const syncResult: GitHubSyncResult = {
    issues: [{
        number: 7,
        title: "Fix sync",
        html_url: "https://github.com/octocat/hello-world/issues/7",
        state: "open",
        closed: false,
        labels: [{ name: "bug" }],
    }],
    repo: { fullName: "octocat/hello-world", projectId: "project-1", labelFilter: "bug", includeClosed: false },
    syncedAt: "2026-08-31T12:00:00.000Z",
};

const authorizationUrl = "https://github.com/login/oauth/authorize?client_id=client-id&redirect_uri=https%3A%2F%2Fworktime.test%2Fauth%2Fgithub%2Fcallback&scope=repo&state=state-123";

function fakeAccess(settings: GitHubSettings | null = connected) {
    return {
        beginAuthorization: vi.fn().mockResolvedValue(authorizationUrl),
        completeAuthorization: vi.fn(),
        loadSettings: vi.fn().mockResolvedValue(settings),
        listRepos: vi.fn().mockResolvedValue(repoList),
        toggleSelection: vi.fn().mockResolvedValue(undefined),
        updateRepoOptions: vi.fn().mockResolvedValue(undefined),
        removeRepo: vi.fn().mockResolvedValue(undefined),
        sync: vi.fn().mockResolvedValue(syncResult),
        disconnect: vi.fn().mockResolvedValue(undefined),
    };
}

function createdTask(title = "Created"): PMTask {
    return {
        id: "task-1", title, projectId: null, status: "Backlog", priority: "Medium",
        timeSpentMinutes: 0, tags: [], links: [], checklist: [], sortOrder: 0,
        isArchived: false, createdAt: "2026-08-31T12:00:00.000Z", updatedAt: "2026-08-31T12:00:00.000Z", relatedTo: [],
    };
}

describe("GithubIntegrationCard", () => {
    it("starts the OAuth authorize redirect from the connect button", async () => {
        const user = userEvent.setup();
        const access = fakeAccess(null);
        const navigateTo = vi.fn();
        render(<GithubIntegrationCard dataAccess={access} currentTasks={[]} projects={projects} createTask={vi.fn()} navigateTo={navigateTo} />);

        await user.click(await screen.findByRole("button", { name: "Connect GitHub" }));

        await waitFor(() => expect(navigateTo).toHaveBeenCalledWith(authorizationUrl));
        expect(access.beginAuthorization).toHaveBeenCalledWith(expect.any(String));
        expect(access.beginAuthorization.mock.calls[0][0]).toMatch(/^[0-9a-f]{32}$/);
    });

    it("loads the connected username and repo rows with per-repo controls", async () => {
        const access = fakeAccess();
        render(<GithubIntegrationCard dataAccess={access} currentTasks={[]} projects={projects} createTask={vi.fn()} />);

        expect(await screen.findByText("Connected")).toBeInTheDocument();
        expect(screen.getByText(/Signed in as/)).toHaveTextContent("octocat");
        expect(screen.getByText(/Last synced:/)).toHaveTextContent("Never");
        expect(screen.getByLabelText("Select octocat/hello-world")).toBeChecked();
        expect(screen.getByLabelText("Project for octocat/hello-world")).toHaveValue("project-1");
        const labelFilter = screen.getByLabelText("Label filter for octocat/hello-world");
        expect(labelFilter).toHaveValue("bug");
        expect(within(labelFilter).getByRole("option", { name: "No filter" })).toBeInTheDocument();
        expect(within(labelFilter).getByRole("option", { name: "enhancement" })).toBeInTheDocument();
        expect(screen.getByLabelText("Include closed issues from octocat/hello-world")).not.toBeChecked();
        expect(screen.getByRole("button", { name: "Sync octocat/hello-world" })).toBeEnabled();
    });

    it("saves per-repo option and selection edits", async () => {
        const user = userEvent.setup();
        const access = fakeAccess();
        render(<GithubIntegrationCard dataAccess={access} currentTasks={[]} projects={projects} createTask={vi.fn()} />);

        await user.selectOptions(await screen.findByLabelText("Project for octocat/hello-world"), "project-2");
        await waitFor(() => expect(access.updateRepoOptions).toHaveBeenCalledWith("octocat/hello-world", {
            projectId: "project-2",
            labelFilter: "bug",
            includeClosed: false,
        }));

        await user.selectOptions(screen.getByLabelText("Label filter for octocat/hello-world"), "");
        await waitFor(() => expect(access.updateRepoOptions).toHaveBeenLastCalledWith("octocat/hello-world", {
            projectId: "project-2",
            labelFilter: null,
            includeClosed: false,
        }));

        await user.click(screen.getByLabelText("Include closed issues from octocat/hello-world"));
        await waitFor(() => expect(access.updateRepoOptions).toHaveBeenLastCalledWith("octocat/hello-world", {
            projectId: "project-2",
            labelFilter: null,
            includeClosed: true,
        }));

        await user.click(screen.getByLabelText("Select octocat/hello-world"));
        await waitFor(() => expect(access.toggleSelection).toHaveBeenCalledWith("octocat/hello-world", false));
    });

    it("previews without creating, then confirms through the PM callback", async () => {
        const user = userEvent.setup();
        const access = fakeAccess();
        const createTask = vi.fn().mockResolvedValue(createdTask("Fix sync"));
        render(<GithubIntegrationCard dataAccess={access} currentTasks={[]} projects={projects} createTask={createTask} />);

        await user.click(await screen.findByRole("button", { name: "Sync octocat/hello-world" }));
        const dialog = await screen.findByRole("dialog", { name: "GitHub sync preview" });
        expect(within(dialog).getByText("Fix sync")).toBeInTheDocument();
        expect(within(dialog).getByText("octocat/hello-world")).toBeInTheDocument();
        expect(within(dialog).getByLabelText("Project for Fix sync")).toHaveValue("project-1");
        expect(createTask).not.toHaveBeenCalled();
        await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
        expect(screen.queryByRole("dialog", { name: "GitHub sync preview" })).not.toBeInTheDocument();
        expect(createTask).not.toHaveBeenCalled();

        await user.click(screen.getByRole("button", { name: "Sync octocat/hello-world" }));
        await user.selectOptions(await screen.findByLabelText("Project for Fix sync"), "project-2");
        await user.click(await screen.findByRole("button", { name: "Create 1 task" }));
        await waitFor(() => expect(createTask).toHaveBeenCalledWith("Fix sync", expect.objectContaining({
            status: "Backlog",
            priority: "Medium",
            description: "",
            tags: ["octocat/hello-world"],
            links: ["https://github.com/octocat/hello-world/issues/7"],
            projectId: "project-2",
        })));
        expect(await screen.findByLabelText("GitHub sync result for octocat/hello-world")).toHaveTextContent("Created 1");
        expect(screen.getByText(/Last synced:/)).not.toHaveTextContent("Never");
    });

    it("removes selected tasks from the preview before creating", async () => {
        const user = userEvent.setup();
        const access = fakeAccess();
        access.sync.mockResolvedValue({
            ...syncResult,
            issues: [
                syncResult.issues[0],
                { ...syncResult.issues[0], number: 8, title: "Keep this issue", html_url: "https://github.com/octocat/hello-world/issues/8" },
            ],
        });
        const createTask = vi.fn().mockResolvedValue(createdTask());
        render(<GithubIntegrationCard dataAccess={access} currentTasks={[]} projects={projects} createTask={createTask} />);

        await user.click(await screen.findByRole("button", { name: "Sync octocat/hello-world" }));
        const dialog = await screen.findByRole("dialog", { name: "GitHub sync preview" });
        await user.click(within(dialog).getByRole("button", { name: "Remove Fix sync from import" }));

        expect(within(dialog).queryByText("Fix sync")).not.toBeInTheDocument();
        expect(within(dialog).getByText("Keep this issue")).toBeInTheDocument();
        await user.click(within(dialog).getByRole("button", { name: "Create 1 task" }));

        await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));
        expect(createTask).toHaveBeenCalledWith("Keep this issue", expect.anything());
        expect(createTask).not.toHaveBeenCalledWith("Fix sync", expect.anything());
    });

    it("shows the empty state when a sync yields nothing new", async () => {
        const user = userEvent.setup();
        const access = fakeAccess();
        access.sync.mockResolvedValue({ ...syncResult, issues: [] });
        const createTask = vi.fn();
        render(<GithubIntegrationCard dataAccess={access} currentTasks={[]} projects={projects} createTask={createTask} />);

        await user.click(await screen.findByRole("button", { name: "Sync octocat/hello-world" }));
        const dialog = await screen.findByRole("dialog", { name: "GitHub sync preview" });
        expect(within(dialog).getByText(/No new tasks to create/)).toBeInTheDocument();
        expect(within(dialog).getByRole("button", { name: "Create 0 tasks" })).toBeDisabled();
        expect(createTask).not.toHaveBeenCalled();
    });

    it("shows the zero-repository empty state", async () => {
        const access = fakeAccess();
        access.listRepos.mockResolvedValue({ repos: [], labels: {} });
        render(<GithubIntegrationCard dataAccess={access} currentTasks={[]} projects={projects} createTask={vi.fn()} />);

        expect(await screen.findByText(/No repositories are tracked yet/)).toBeInTheDocument();
        expect(screen.queryByLabelText("Project for octocat/hello-world")).not.toBeInTheDocument();
    });

    it("reports a partial task-creation failure and keeps the preview open", async () => {
        const user = userEvent.setup();
        const access = fakeAccess();
        access.sync.mockResolvedValue({
            ...syncResult,
            issues: [
                syncResult.issues[0],
                { ...syncResult.issues[0], number: 8, title: "Second issue", html_url: "https://github.com/octocat/hello-world/issues/8" },
            ],
        });
        const createTask = vi.fn().mockResolvedValueOnce(createdTask()).mockRejectedValueOnce(new Error("write failed"));
        render(<GithubIntegrationCard dataAccess={access} currentTasks={[]} projects={projects} createTask={createTask} />);

        await user.click(await screen.findByRole("button", { name: "Sync octocat/hello-world" }));
        await user.click(await screen.findByRole("button", { name: "Create 2 tasks" }));

        expect(await screen.findByRole("alert")).toHaveTextContent("Created 1 task before task creation failed");
        expect(screen.getByRole("dialog", { name: "GitHub sync preview" })).toBeInTheDocument();
    });

    it("surfaces invalid-token recovery and rate-limit guidance", async () => {
        const user = userEvent.setup();
        const access = fakeAccess();
        const navigateTo = vi.fn();
        access.sync.mockRejectedValueOnce(new GitHubIntegrationError("GITHUB_TOKEN_INVALID", "invalid"));
        render(<GithubIntegrationCard dataAccess={access} currentTasks={[]} projects={projects} createTask={vi.fn()} navigateTo={navigateTo} />);

        await user.click(await screen.findByRole("button", { name: "Sync octocat/hello-world" }));
        const invalidAlert = await screen.findByRole("alert");
        expect(invalidAlert).toHaveTextContent("invalid or has been revoked");
        await user.click(within(invalidAlert).getByRole("button", { name: "Reconnect" }));
        await waitFor(() => expect(navigateTo).toHaveBeenCalledWith(authorizationUrl));

        access.sync.mockRejectedValueOnce(new GitHubIntegrationError("GITHUB_RATE_LIMITED", "limited", 12));
        await user.click(screen.getByRole("button", { name: "Sync octocat/hello-world" }));
        expect(await screen.findByRole("alert")).toHaveTextContent("Try again in 12 seconds");
    });

    it("keeps stale repos editable but not syncable, and removable", async () => {
        const user = userEvent.setup();
        const access = fakeAccess();
        render(<GithubIntegrationCard dataAccess={access} currentTasks={[]} projects={projects} createTask={vi.fn()} />);

        expect(await screen.findByText("No longer accessible")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Sync octocat/gone" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Sync octocat/hello-world" })).toBeEnabled();
        expect(screen.getByText(/no longer accessible on GitHub/)).toBeInTheDocument();

        await user.selectOptions(screen.getByLabelText("Project for octocat/gone"), "project-2");
        await waitFor(() => expect(access.updateRepoOptions).toHaveBeenCalledWith("octocat/gone", {
            projectId: "project-2",
            labelFilter: null,
            includeClosed: false,
        }));

        await user.click(screen.getByRole("button", { name: "Remove octocat/gone" }));
        await waitFor(() => expect(access.removeRepo).toHaveBeenCalledWith("octocat/gone"));
        expect(screen.queryByLabelText("Project for octocat/gone")).not.toBeInTheDocument();
        expect(screen.queryByText("No longer accessible")).not.toBeInTheDocument();
    });

    it("disconnects the GitHub connection", async () => {
        const user = userEvent.setup();
        const access = fakeAccess();
        render(<GithubIntegrationCard dataAccess={access} currentTasks={[]} projects={projects} createTask={vi.fn()} />);

        await user.click(await screen.findByRole("button", { name: "Disconnect" }));
        await waitFor(() => expect(access.disconnect).toHaveBeenCalledOnce());
        expect(await screen.findByRole("button", { name: "Connect GitHub" })).toBeEnabled();
        expect(screen.queryByLabelText("Select octocat/hello-world")).not.toBeInTheDocument();
    });
});
