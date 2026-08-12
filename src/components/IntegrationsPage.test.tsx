import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { IntegrationDefinition } from "../lib/integrations";
import { IntegrationsPage } from "./IntegrationsPage";

describe("IntegrationsPage", () => {
    it("renders placeholders while identifying Shortcut as implemented", () => {
        render(<IntegrationsPage />);

        expect(screen.getByRole("heading", { name: "Integrations" })).toBeInTheDocument();
        const list = screen.getByRole("region", { name: "Available integrations" });
        for (const name of ["Google Calendar", "GitHub"]) {
            const card = within(list).getByRole("article", { name });
            expect(within(card).getByText("Coming soon")).toBeInTheDocument();
            expect(within(card).getByRole("button", { name: "Connect" })).toBeDisabled();
        }
        const shortcut = within(list).getByRole("article", { name: "Shortcut" });
        expect(within(shortcut).queryByText("Coming soon")).not.toBeInTheDocument();
        expect(within(shortcut).getByText("Not connected")).toBeInTheDocument();
        expect(within(list).getAllByText("OAuth 2.0")).toHaveLength(2);
        expect(within(list).getByText("API token")).toBeInTheDocument();
    });

    it("renders the bound Shortcut workflow in place of the generic card", async () => {
        const dataAccess = {
            loadSettings: vi.fn().mockResolvedValue(null), connect: vi.fn(), updatePreferences: vi.fn(), disconnect: vi.fn(), sync: vi.fn(),
        };
        render(<IntegrationsPage shortcut={{ dataAccess, currentTasks: [], projects: [], createTask: vi.fn() }} />);

        expect(await screen.findByLabelText("Shortcut API token")).toBeInTheDocument();
        expect(screen.getAllByText("Coming soon")).toHaveLength(2);
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
