import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { IntegrationDefinition } from "../lib/integrations";
import { IntegrationsPage } from "./IntegrationsPage";

describe("IntegrationsPage", () => {
    it("renders registry entries as clearly disabled coming-soon integrations", () => {
        render(<IntegrationsPage />);

        expect(screen.getByRole("heading", { name: "Integrations" })).toBeInTheDocument();
        const list = screen.getByRole("region", { name: "Available integrations" });
        for (const name of ["Google Calendar", "Shortcut", "GitHub"]) {
            const card = within(list).getByRole("article", { name });
            expect(within(card).getByText("Coming soon")).toBeInTheDocument();
            expect(within(card).getByRole("button", { name: "Connect" })).toBeDisabled();
        }
        expect(within(list).getAllByText("OAuth 2.0")).toHaveLength(2);
        expect(within(list).getByText("API token")).toBeInTheDocument();
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
