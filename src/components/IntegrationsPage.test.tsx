import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { IntegrationDefinition } from "../lib/integrations";
import type { PMTask } from "../state/types";
import { IntegrationsPage } from "./IntegrationsPage";
import { GithubIntegrationCard } from "./GithubIntegrationCard";
import { LinearIntegrationCard } from "./LinearIntegrationCard";
import { ShortcutIntegrationCard } from "./ShortcutIntegrationCard";

vi.mock("./GithubIntegrationCard", { spy: true });
vi.mock("./LinearIntegrationCard", { spy: true });
vi.mock("./ShortcutIntegrationCard", { spy: true });

describe("IntegrationsPage", () => {
    it("renders every registered integration as implemented", () => {
        render(<IntegrationsPage />);

        expect(screen.getByRole("heading", { name: "Integrations" })).toBeInTheDocument();
        const list = screen.getByRole("region", { name: "Available integrations" });
        for (const name of ["GitHub", "Google Calendar", "Shortcut", "Linear"]) {
            const card = within(list).getByRole("article", { name });
            expect(within(card).queryByText("Coming soon")).not.toBeInTheDocument();
            expect(within(card).getByText("Not connected")).toBeInTheDocument();
        }
        expect(within(list).getAllByText("OAuth 2.0")).toHaveLength(2);
        expect(within(list).getAllByText("API token")).toHaveLength(2);
    });

    it("renders the bound Shortcut workflow in place of the generic card", async () => {
        const dataAccess = {
            loadSettings: vi.fn().mockResolvedValue(null), connect: vi.fn(), updatePreferences: vi.fn(), disconnect: vi.fn(), sync: vi.fn(),
        };
        const shortcut = { dataAccess, currentTasks: [], projects: [], createTask: vi.fn(), updateTask: vi.fn() };
        render(<IntegrationsPage shortcut={shortcut} />);

        expect(await screen.findByLabelText("Shortcut API token")).toBeInTheDocument();
        expect(vi.mocked(ShortcutIntegrationCard).mock.lastCall?.[0]).toMatchObject(shortcut);
        expect(screen.queryByText("Coming soon")).not.toBeInTheDocument();
    });

    it("renders the bound Linear workflow in place of the generic card", async () => {
        const dataAccess = {
            loadSettings: vi.fn().mockResolvedValue(null), connect: vi.fn(), updatePreferences: vi.fn(), disconnect: vi.fn(), sync: vi.fn(),
        };
        const linear = { dataAccess, currentTasks: [], projects: [], createTask: vi.fn(), updateTask: vi.fn() };
        render(<IntegrationsPage linear={linear} />);

        expect(await screen.findByLabelText("Linear API token")).toBeInTheDocument();
        expect(vi.mocked(LinearIntegrationCard).mock.lastCall?.[0]).toMatchObject(linear);
        expect(screen.queryByText("Coming soon")).not.toBeInTheDocument();
    });

    it("renders the bound GitHub workflow in place of the generic card", async () => {
        const dataAccess = {
            beginAuthorization: vi.fn(), completeAuthorization: vi.fn(), loadSettings: vi.fn().mockResolvedValue(null),
            listRepos: vi.fn(), toggleSelection: vi.fn(), updateRepoOptions: vi.fn(), removeRepo: vi.fn(),
            sync: vi.fn(), disconnect: vi.fn(),
        };
        const github = { dataAccess, currentTasks: [], projects: [], createTask: vi.fn(), updateTask: vi.fn() };
        render(<IntegrationsPage github={github} />);

        expect(await screen.findByRole("button", { name: "Connect GitHub" })).toBeEnabled();
        expect(vi.mocked(GithubIntegrationCard).mock.lastCall?.[0]).toMatchObject(github);
        expect(screen.queryByText("Coming soon")).not.toBeInTheDocument();
    });

    it("uses the retained Shortcut story type when a selected task gains a Shortcut link before a Linear attach", async () => {
        const user = userEvent.setup();
        const task: PMTask = {
            id: "task-1", title: "Manual task", projectId: null, status: "Backlog", priority: "Medium",
            timeSpentMinutes: 0, tags: ["manual"], links: [], checklist: [], sortOrder: 0,
            isArchived: false, createdAt: "", updatedAt: "", relatedTo: [],
        };
        const shortcutUrl = "https://app.shortcut.com/acme/story/1";
        const linearUrl = "https://linear.app/acme/issue/ENG-123/new-feature";
        const updatedAt = "2026-11-01T12:00:00.000Z";
        const baseAccess = { connect: vi.fn(), updatePreferences: vi.fn(), disconnect: vi.fn() };
        const shortcutAccess = {
            ...baseAccess,
            loadSettings: vi.fn().mockResolvedValue({
                teamName: "Acme", includedStatuses: ["Ready"], defaultProjectId: null, lastSyncedAt: null, updatedAt,
            }),
            sync: vi.fn().mockResolvedValue({ stories: [{
                id: 1, app_url: shortcutUrl, name: "Shortcut story", description: "", estimate: null,
                deadline: null, workflow_state_id: 1, status_name: "Ready", completed: false,
                archived: false, story_type: "bug", labels: [],
            }], syncedAt: updatedAt }),
        };
        const linearAccess = {
            ...baseAccess,
            loadSettings: vi.fn().mockResolvedValue({
                teamKey: "ENG", includedStatuses: ["Ready"], defaultProjectId: null, lastSyncedAt: null, updatedAt,
            }),
            sync: vi.fn().mockResolvedValue({ issues: [{
                id: "issue-1", identifier: "ENG-123", title: "Linear issue", description: "",
                url: linearUrl, dueDate: null, priority: 0, state: { name: "Ready" },
            }], states: ["Ready"], truncated: false, syncedAt: updatedAt }),
        };
        const updateTask = vi.fn();
        const renderPage = (currentTask: PMTask) => {
            const taskProps = { currentTasks: [currentTask], projects: [], createTask: vi.fn() };
            return <IntegrationsPage
                shortcut={{ ...taskProps, dataAccess: shortcutAccess, updateTask: vi.fn() }}
                linear={{ ...taskProps, dataAccess: linearAccess, updateTask }}
            />;
        };
        const view = render(renderPage(task));
        for (const provider of ["Shortcut", "Linear"]) {
            const card = within(screen.getByRole("article", { name: provider }));
            await user.click(await card.findByRole("button", { name: "Sync now" }));
            const preview = await card.findByRole("dialog", { name: `${provider} sync preview` });
            await user.click(within(preview).getByRole("button", { name: "Cancel" }));
        }
        const linear = within(screen.getByRole("article", { name: "Linear" }));
        await user.click(linear.getByRole("button", { name: "Attach existing issue" }));
        const picker = within(linear.getByRole("dialog", { name: "Attach existing issue" }));
        await user.click(picker.getByRole("button", { name: /ENG-123/ }));
        await user.click(picker.getByRole("button", { name: /Manual task/ }));
        view.rerender(renderPage({ ...task, links: [shortcutUrl, "https://example.test/notes"], tags: ["manual", "bug"] }));
        await user.click(picker.getByRole("button", { name: "Attach issue" }));

        expect(updateTask).toHaveBeenCalledExactlyOnceWith(task.id, {
            links: ["https://example.test/notes", linearUrl],
            tags: ["manual", "linear:ENG-123"],
        });
    });

    it("exposes an action slot for an implemented integration", () => {
        const integration: IntegrationDefinition = {
            id: "test-integration",
            name: "Test Integration",
            description: "An implemented integration used to verify connection controls.",
            icon: "shortcut",
            authFlow: "api-token",
            isPlaceholder: false,
        };
        const renderActions = vi.fn(() => <button type="button">Connect account</button>);

        render(<IntegrationsPage integrations={[integration]} renderActions={renderActions} />);

        const controls = screen.getByLabelText("Test Integration connection controls");
        expect(within(controls).getByRole("button", { name: "Connect account" })).toBeEnabled();
        expect(screen.queryByText("Coming soon")).not.toBeInTheDocument();
        expect(renderActions).toHaveBeenCalledWith(integration);
    });
});
