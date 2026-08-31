import type { ReactNode } from "react";
import { CalendarDays, GitPullRequest, Milestone, type LucideIcon } from "lucide-react";
import {
    integrationRegistry,
    type IntegrationAuthFlow,
    type IntegrationDefinition,
    type IntegrationIcon,
} from "../lib/integrations";
import { ShortcutIntegrationCard, type ShortcutIntegrationCardProps } from "./ShortcutIntegrationCard";
import { GoogleCalendarIntegrationCard, type GoogleCalendarIntegrationCardProps } from "./GoogleCalendarIntegrationCard";

const ICONS: Record<IntegrationIcon, LucideIcon> = {
    calendar: CalendarDays,
    github: GitPullRequest,
    shortcut: Milestone,
};

const AUTH_FLOW_LABELS: Record<IntegrationAuthFlow, string> = {
    oauth2: "OAuth 2.0",
    "api-token": "API token",
};

export interface IntegrationsPageProps {
    integrations?: readonly IntegrationDefinition[];
    renderActions?: (integration: IntegrationDefinition) => ReactNode;
    shortcut?: ShortcutIntegrationCardProps;
    googleCalendar?: GoogleCalendarIntegrationCardProps;
}

export const IntegrationsPage = ({
    integrations = integrationRegistry,
    renderActions,
    shortcut,
    googleCalendar,
}: IntegrationsPageProps) => (
    <div className="flex h-full min-h-0 flex-col">
        <header className="border-b border-neutral-800 bg-neutral-950/80 px-4 py-3 backdrop-blur">
            <h1 className="text-base font-semibold">Integrations</h1>
            <p className="text-[10px] text-neutral-500">Connect WorkTime with the tools that support your day.</p>
        </header>

        <main className="app-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
            <div className="mx-auto max-w-6xl">
                <section className="grid gap-3 sm:grid-cols-2" aria-label="Available integrations">
                    {integrations.map((integration) => integration.id === "shortcut" && shortcut ? (
                        <ShortcutIntegrationCard key={integration.id} {...shortcut} />
                    ) : integration.id === "google-calendar" && googleCalendar ? (
                        <GoogleCalendarIntegrationCard key={integration.id} {...googleCalendar} />
                    ) : (
                        <IntegrationCard key={integration.id} integration={integration} actions={renderActions?.(integration)} />
                    ))}
                </section>
            </div>
        </main>
    </div>
);

const IntegrationCard = ({
    integration,
    actions,
}: {
    integration: IntegrationDefinition;
    actions?: ReactNode;
}) => {
    const Icon = ICONS[integration.icon];

    return (
        <article
            aria-labelledby={`integration-${integration.id}-title`}
            className={`flex min-h-52 flex-col rounded-lg border p-4 ${integration.isPlaceholder ? "border-amber-900/60 bg-amber-950/10" : "border-neutral-800 bg-neutral-900/60"}`}
        >
            <div className="flex items-start gap-3">
                <span className="rounded-lg border border-neutral-700 bg-neutral-950 p-2 text-neutral-300">
                    <Icon aria-hidden="true" size={20} strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <h2 id={`integration-${integration.id}-title`} className="text-sm font-semibold text-neutral-100">
                            {integration.name}
                        </h2>
                        {integration.isPlaceholder && (
                            <span className="rounded-full border border-amber-700/60 bg-amber-500/10 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide text-amber-300">
                                Coming soon
                            </span>
                        )}
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-neutral-400">{integration.description}</p>
                </div>
            </div>

            <div className="mt-auto flex items-end justify-between gap-3 border-t border-neutral-800/80 pt-4">
                <div>
                    <p className="text-[9px] uppercase tracking-wide text-neutral-600">Authentication</p>
                    <p className="mt-0.5 text-[10px] text-neutral-400">{AUTH_FLOW_LABELS[integration.authFlow]}</p>
                </div>
                {integration.isPlaceholder ? (
                    <button type="button" disabled className="cursor-not-allowed rounded border border-neutral-800 px-3 py-1.5 text-[10px] text-neutral-600">
                        Connect
                    </button>
                ) : (
                    <div aria-label={`${integration.name} connection controls`}>
                        {actions ?? <span className="text-[10px] text-neutral-500">Not connected</span>}
                    </div>
                )}
            </div>
        </article>
    );
};
