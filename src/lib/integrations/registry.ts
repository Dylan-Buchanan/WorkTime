export type IntegrationAuthFlow = "oauth2" | "api-token";

export type IntegrationIcon = "calendar" | "github" | "shortcut";

export interface IntegrationDefinition {
    id: string;
    name: string;
    description: string;
    icon: IntegrationIcon;
    authFlow: IntegrationAuthFlow;
    isPlaceholder: boolean;
}

export const integrationRegistry = [
    {
        id: "google-calendar",
        name: "Google Calendar",
        description: "Bring calendar events into WorkTime and keep focused work visible on your schedule.",
        icon: "calendar",
        authFlow: "oauth2",
        isPlaceholder: false,
    },
    {
        id: "github",
        name: "GitHub",
        description: "Connect issues and pull requests to the tasks and projects you manage in WorkTime.",
        icon: "github",
        authFlow: "oauth2",
        isPlaceholder: false,
    },
    {
        id: "shortcut",
        name: "Shortcut",
        description: "Link stories and iterations to projects so planned work stays aligned with your team.",
        icon: "shortcut",
        authFlow: "api-token",
        isPlaceholder: false,
    },
] as const satisfies readonly IntegrationDefinition[];
