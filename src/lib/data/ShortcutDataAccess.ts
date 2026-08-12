import type { SupabaseClient } from "@supabase/supabase-js";
import type { ShortcutStoryPayload } from "../engine/shortcutClassification";

export const DEFAULT_SHORTCUT_INCLUDED_STATUSES = [
    "In Discovery",
    "Ready for Dev",
    "In Dev",
] as const;

export interface ShortcutSettings {
    teamName: string;
    includedStatuses: string[];
    defaultProjectId: string | null;
    lastSyncedAt: string | null;
    updatedAt: string;
}

export interface ShortcutSyncResult {
    stories: ShortcutStoryPayload[];
    syncedAt: string;
}

export interface ShortcutConnectionInput {
    token: string;
    teamName: string;
    includedStatuses: string[];
    defaultProjectId: string | null;
}

export interface ShortcutPreferencesInput {
    teamName: string;
    includedStatuses: string[];
    defaultProjectId: string | null;
}

export type ShortcutIntegrationErrorCode =
    | "INVALID_SETTINGS"
    | "SHORTCUT_NOT_CONFIGURED"
    | "SHORTCUT_TOKEN_INVALID"
    | "SHORTCUT_RATE_LIMITED"
    | "SHORTCUT_UPSTREAM_ERROR"
    | "SHORTCUT_INVALID_RESPONSE"
    | "NETWORK_ERROR"
    | "UNKNOWN_ERROR";

export class ShortcutIntegrationError extends Error {
    readonly code: ShortcutIntegrationErrorCode;
    readonly retryAfterSeconds?: number;

    constructor(code: ShortcutIntegrationErrorCode, message: string, retryAfterSeconds?: number) {
        super(message);
        this.name = "ShortcutIntegrationError";
        this.code = code;
        this.retryAfterSeconds = retryAfterSeconds;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

export interface ShortcutDataAccess {
    loadSettings(): Promise<ShortcutSettings | null>;
    connect(input: ShortcutConnectionInput): Promise<void>;
    updatePreferences(input: ShortcutPreferencesInput): Promise<void>;
    disconnect(): Promise<void>;
    sync(): Promise<ShortcutSyncResult>;
}

interface ShortcutSettingsRow {
    team_name: string;
    included_statuses: string[];
    default_project_id: string | null;
    last_synced_at: string | null;
    updated_at: string;
}

interface FunctionErrorBody {
    error?: unknown;
    code?: unknown;
    retry_after_seconds?: unknown;
}

const FUNCTION_ERROR_CODES = new Set<ShortcutIntegrationErrorCode>([
    "SHORTCUT_NOT_CONFIGURED",
    "SHORTCUT_TOKEN_INVALID",
    "SHORTCUT_RATE_LIMITED",
    "SHORTCUT_UPSTREAM_ERROR",
    "SHORTCUT_INVALID_RESPONSE",
]);

function normalizePreferences(input: ShortcutPreferencesInput): ShortcutPreferencesInput {
    const teamName = input.teamName.trim();
    const includedStatuses = input.includedStatuses.map((status) => status.trim()).filter(Boolean);
    if (!teamName) throw new ShortcutIntegrationError("INVALID_SETTINGS", "Enter a Shortcut team name.");
    const defaultProjectId = input.defaultProjectId?.trim() || null;
    return { teamName, includedStatuses: [...new Set(includedStatuses)], defaultProjectId };
}

function transportError(message: string, cause: unknown): ShortcutIntegrationError {
    if (cause instanceof ShortcutIntegrationError) return cause;
    return new ShortcutIntegrationError("NETWORK_ERROR", message);
}

async function mapFunctionError(error: unknown): Promise<ShortcutIntegrationError> {
    const candidate = error as { message?: unknown; context?: { json?: () => Promise<unknown> } } | null;
    let body: FunctionErrorBody = {};
    try {
        const parsed = await candidate?.context?.json?.();
        if (parsed && typeof parsed === "object") body = parsed as FunctionErrorBody;
    } catch {
        // A non-JSON response is treated as a transport/upstream failure.
    }
    const code = typeof body.code === "string" && FUNCTION_ERROR_CODES.has(body.code as ShortcutIntegrationErrorCode)
        ? body.code as ShortcutIntegrationErrorCode
        : "NETWORK_ERROR";
    const message = typeof body.error === "string"
        ? body.error
        : typeof candidate?.message === "string" && candidate.message
          ? candidate.message
          : "Unable to reach Shortcut.";
    const retry = typeof body.retry_after_seconds === "number" && Number.isFinite(body.retry_after_seconds)
        ? Math.max(0, Math.ceil(body.retry_after_seconds))
        : undefined;
    return new ShortcutIntegrationError(code, message, retry);
}

function isStory(value: unknown): value is ShortcutStoryPayload {
    if (!value || typeof value !== "object") return false;
    const story = value as Record<string, unknown>;
    return typeof story.id === "number"
        && typeof story.app_url === "string"
        && typeof story.name === "string"
        && typeof story.description === "string"
        && typeof story.status_name === "string"
        && typeof story.archived === "boolean"
        && Array.isArray(story.labels);
}

export class SupabaseShortcutDataAccess implements ShortcutDataAccess {
    constructor(
        private readonly client: SupabaseClient,
        private readonly ownerId: string,
    ) {}

    async loadSettings(): Promise<ShortcutSettings | null> {
        let response;
        try {
            response = await this.client
                .from("shortcut_settings")
                .select("team_name, included_statuses, default_project_id, last_synced_at, updated_at")
                .eq("owner_id", this.ownerId)
                .maybeSingle();
        } catch (error) {
            throw transportError("Unable to load Shortcut settings.", error);
        }
        if (response.error) throw new ShortcutIntegrationError("UNKNOWN_ERROR", "Unable to load Shortcut settings.");
        if (!response.data) return null;
        const row = response.data as ShortcutSettingsRow;
        if (
            typeof row.team_name !== "string"
            || !Array.isArray(row.included_statuses)
            || (row.default_project_id !== null && typeof row.default_project_id !== "string")
            || typeof row.updated_at !== "string"
        ) {
            throw new ShortcutIntegrationError("UNKNOWN_ERROR", "Shortcut settings returned an invalid response.");
        }
        return {
            teamName: row.team_name,
            includedStatuses: row.included_statuses.filter((value): value is string => typeof value === "string"),
            defaultProjectId: typeof row.default_project_id === "string" ? row.default_project_id : null,
            lastSyncedAt: typeof row.last_synced_at === "string" ? row.last_synced_at : null,
            updatedAt: row.updated_at,
        };
    }

    async connect(input: ShortcutConnectionInput): Promise<void> {
        const token = input.token.trim();
        const preferences = normalizePreferences(input);
        if (!token) throw new ShortcutIntegrationError("INVALID_SETTINGS", "Enter a Shortcut API token.");
        let response;
        try {
            response = await this.client.rpc("save_shortcut_settings", {
                p_shortcut_token: token,
                p_team_name: preferences.teamName,
                p_included_statuses: preferences.includedStatuses,
                p_default_project_id: preferences.defaultProjectId,
            });
        } catch (error) {
            throw transportError("Unable to save Shortcut settings.", error);
        }
        if (response.error) throw new ShortcutIntegrationError("UNKNOWN_ERROR", "Unable to save Shortcut settings.");
    }

    async updatePreferences(input: ShortcutPreferencesInput): Promise<void> {
        const preferences = normalizePreferences(input);
        let response;
        try {
            response = await this.client.rpc("update_shortcut_preferences", {
                p_team_name: preferences.teamName,
                p_included_statuses: preferences.includedStatuses,
                p_default_project_id: preferences.defaultProjectId,
            });
        } catch (error) {
            throw transportError("Unable to save Shortcut settings.", error);
        }
        if (response.error) {
            const message = String(response.error.message ?? "");
            if (message.includes("SHORTCUT_NOT_CONFIGURED")) {
                throw new ShortcutIntegrationError("SHORTCUT_NOT_CONFIGURED", "Shortcut is not connected.");
            }
            throw new ShortcutIntegrationError("UNKNOWN_ERROR", "Unable to save Shortcut settings.");
        }
    }

    async disconnect(): Promise<void> {
        let response;
        try {
            response = await this.client.from("shortcut_settings").delete().eq("owner_id", this.ownerId);
        } catch (error) {
            throw transportError("Unable to disconnect Shortcut.", error);
        }
        if (response.error) throw new ShortcutIntegrationError("UNKNOWN_ERROR", "Unable to disconnect Shortcut.");
    }

    async sync(): Promise<ShortcutSyncResult> {
        let response;
        try {
            response = await this.client.functions.invoke("shortcut-sync", { method: "POST" });
        } catch (error) {
            throw transportError("Unable to reach Shortcut.", error);
        }
        if (response.error) throw await mapFunctionError(response.error);
        const data = response.data as { stories?: unknown; synced_at?: unknown } | null;
        if (!data || !Array.isArray(data.stories) || !data.stories.every(isStory) || typeof data.synced_at !== "string") {
            throw new ShortcutIntegrationError("SHORTCUT_INVALID_RESPONSE", "Shortcut returned an invalid response.");
        }
        return { stories: data.stories, syncedAt: data.synced_at };
    }
}
