import type { SupabaseClient } from "@supabase/supabase-js";
import type { LinearIssuePayload } from "../engine/linearClassification";

export interface LinearSettings {
    /** Null means every accessible team. */
    teamKey: string | null;
    /** Status names are stored but filtered in the frontend, not in linear-sync. */
    includedStatuses: string[];
    defaultProjectId: string | null;
    lastSyncedAt: string | null;
    updatedAt: string;
}

export interface LinearSyncResult {
    issues: LinearIssuePayload[];
    /** Sorted, distinct workflow-state names discovered during the sync. */
    states: string[];
    /** True when issues or state names hit the backend page cap. */
    truncated: boolean;
    syncedAt: string;
}

export interface LinearConnectionInput {
    token: string;
    teamKey: string;
    includedStatuses: string[];
    defaultProjectId: string | null;
}

export interface LinearPreferencesInput {
    teamKey: string;
    includedStatuses: string[];
    defaultProjectId: string | null;
}

export type LinearIntegrationErrorCode =
    | "INVALID_SETTINGS"
    | "LINEAR_NOT_CONFIGURED"
    | "LINEAR_TOKEN_INVALID"
    | "LINEAR_RATE_LIMITED"
    | "LINEAR_TEAM_NOT_FOUND"
    | "LINEAR_UPSTREAM_ERROR"
    | "LINEAR_INVALID_RESPONSE"
    | "NETWORK_ERROR"
    | "UNKNOWN_ERROR";

export class LinearIntegrationError extends Error {
    readonly code: LinearIntegrationErrorCode;
    readonly retryAfterSeconds?: number;

    constructor(code: LinearIntegrationErrorCode, message: string, retryAfterSeconds?: number) {
        super(message);
        this.name = "LinearIntegrationError";
        this.code = code;
        this.retryAfterSeconds = retryAfterSeconds;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

export interface LinearDataAccess {
    loadSettings(): Promise<LinearSettings | null>;
    connect(input: LinearConnectionInput): Promise<void>;
    updatePreferences(input: LinearPreferencesInput): Promise<void>;
    disconnect(): Promise<void>;
    sync(): Promise<LinearSyncResult>;
}

interface LinearSettingsRow {
    team_key: string | null;
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

/**
 * The six documented Linear sync codes. Handler-only failures such as
 * `AUTH_REQUIRED` or `SYNC_FAILED` are intentionally not allowlisted here;
 * `supabase/README.md` requires this exact set, and anything else falls back to
 * a transport error.
 */
const FUNCTION_ERROR_CODES = new Set<LinearIntegrationErrorCode>([
    "LINEAR_NOT_CONFIGURED",
    "LINEAR_TOKEN_INVALID",
    "LINEAR_RATE_LIMITED",
    "LINEAR_TEAM_NOT_FOUND",
    "LINEAR_UPSTREAM_ERROR",
    "LINEAR_INVALID_RESPONSE",
]);

function normalizePreferences(input: LinearPreferencesInput): LinearPreferencesInput {
    // A blank team key is valid and means every accessible team.
    const teamKey = input.teamKey.trim();
    const includedStatuses = input.includedStatuses.map((status) => status.trim()).filter(Boolean);
    const defaultProjectId = input.defaultProjectId?.trim() || null;
    return {
        teamKey,
        includedStatuses: [...new Set(includedStatuses)],
        defaultProjectId,
    };
}

function transportError(message: string, cause: unknown): LinearIntegrationError {
    if (cause instanceof LinearIntegrationError) return cause;
    return new LinearIntegrationError("NETWORK_ERROR", message);
}

/**
 * The RPCs raise message-based exceptions rather than structured codes, so the
 * only way to surface the backend's token guidance is to inspect the message.
 */
function rpcError(message: string, fallback: string): LinearIntegrationError {
    if (message.includes("LINEAR_TOKEN_INVALID")) {
        const detail = message
            .slice(message.indexOf("LINEAR_TOKEN_INVALID") + "LINEAR_TOKEN_INVALID".length)
            .replace(/^:\s*/, "")
            .trim();
        return new LinearIntegrationError(
            "LINEAR_TOKEN_INVALID",
            detail || "Enter a valid Linear personal API key.",
        );
    }
    if (message.includes("LINEAR_NOT_CONFIGURED")) {
        return new LinearIntegrationError("LINEAR_NOT_CONFIGURED", "Linear is not connected.");
    }
    return new LinearIntegrationError("UNKNOWN_ERROR", fallback);
}

async function mapFunctionError(error: unknown): Promise<LinearIntegrationError> {
    const candidate = error as { message?: unknown; context?: { json?: () => Promise<unknown> } } | null;
    let body: FunctionErrorBody = {};
    try {
        const parsed = await candidate?.context?.json?.();
        if (parsed && typeof parsed === "object") body = parsed as FunctionErrorBody;
    } catch {
        // A non-JSON response is treated as a transport/upstream failure.
    }
    const code = typeof body.code === "string" && FUNCTION_ERROR_CODES.has(body.code as LinearIntegrationErrorCode)
        ? body.code as LinearIntegrationErrorCode
        : "NETWORK_ERROR";
    const message = typeof body.error === "string"
        ? body.error
        : typeof candidate?.message === "string" && candidate.message
          ? candidate.message
          : "Unable to reach Linear.";
    const retry = typeof body.retry_after_seconds === "number" && Number.isFinite(body.retry_after_seconds)
        ? Math.max(0, Math.ceil(body.retry_after_seconds))
        : undefined;
    return new LinearIntegrationError(code, message, retry);
}

function isIssue(value: unknown): value is LinearIssuePayload {
    if (!value || typeof value !== "object") return false;
    const issue = value as Record<string, unknown>;
    const state = issue.state;
    return typeof issue.id === "string"
        && typeof issue.identifier === "string" && issue.identifier.trim() !== ""
        && typeof issue.title === "string"
        && typeof issue.description === "string"
        && typeof issue.url === "string"
        && (issue.dueDate === null || typeof issue.dueDate === "string")
        && typeof issue.priority === "number"
        && Number.isInteger(issue.priority)
        && issue.priority >= 0
        && issue.priority <= 4
        && !!state && typeof state === "object"
        && typeof (state as Record<string, unknown>).name === "string";
}

export class SupabaseLinearDataAccess implements LinearDataAccess {
    constructor(
        private readonly client: SupabaseClient,
        private readonly ownerId: string,
    ) {}

    async loadSettings(): Promise<LinearSettings | null> {
        let response;
        try {
            response = await this.client
                .from("linear_settings")
                .select("team_key, included_statuses, default_project_id, last_synced_at, updated_at")
                .eq("owner_id", this.ownerId)
                .maybeSingle();
        } catch (error) {
            throw transportError("Unable to load Linear settings.", error);
        }
        if (response.error) throw new LinearIntegrationError("UNKNOWN_ERROR", "Unable to load Linear settings.");
        if (!response.data) return null;
        const row = response.data as LinearSettingsRow;
        if (
            (row.team_key !== null && typeof row.team_key !== "string")
            || !Array.isArray(row.included_statuses)
            || (row.default_project_id !== null && typeof row.default_project_id !== "string")
            || typeof row.updated_at !== "string"
        ) {
            throw new LinearIntegrationError("UNKNOWN_ERROR", "Linear settings returned an invalid response.");
        }
        return {
            teamKey: typeof row.team_key === "string" ? row.team_key : null,
            includedStatuses: row.included_statuses.filter((value): value is string => typeof value === "string"),
            defaultProjectId: typeof row.default_project_id === "string" ? row.default_project_id : null,
            lastSyncedAt: typeof row.last_synced_at === "string" ? row.last_synced_at : null,
            updatedAt: row.updated_at,
        };
    }

    async connect(input: LinearConnectionInput): Promise<void> {
        const token = input.token.trim();
        if (!token) throw new LinearIntegrationError("INVALID_SETTINGS", "Enter a Linear personal API key.");
        const preferences = normalizePreferences(input);
        let response;
        try {
            response = await this.client.rpc("save_linear_settings", {
                p_linear_token: token,
                p_team_key: preferences.teamKey || null,
                p_included_statuses: preferences.includedStatuses,
                p_default_project_id: preferences.defaultProjectId,
            });
        } catch (error) {
            throw transportError("Unable to save Linear settings.", error);
        }
        if (response.error) {
            throw rpcError(String(response.error.message ?? ""), "Unable to save Linear settings.");
        }
    }

    async updatePreferences(input: LinearPreferencesInput): Promise<void> {
        const preferences = normalizePreferences(input);
        let response;
        try {
            response = await this.client.rpc("update_linear_preferences", {
                p_team_key: preferences.teamKey || null,
                p_included_statuses: preferences.includedStatuses,
                p_default_project_id: preferences.defaultProjectId,
            });
        } catch (error) {
            throw transportError("Unable to save Linear settings.", error);
        }
        if (response.error) {
            throw rpcError(String(response.error.message ?? ""), "Unable to save Linear settings.");
        }
    }

    async disconnect(): Promise<void> {
        let response;
        try {
            response = await this.client.from("linear_settings").delete().eq("owner_id", this.ownerId);
        } catch (error) {
            throw transportError("Unable to disconnect Linear.", error);
        }
        if (response.error) throw new LinearIntegrationError("UNKNOWN_ERROR", "Unable to disconnect Linear.");
    }

    async sync(): Promise<LinearSyncResult> {
        let response;
        try {
            response = await this.client.functions.invoke("linear-sync", { method: "POST" });
        } catch (error) {
            throw transportError("Unable to reach Linear.", error);
        }
        if (response.error) throw await mapFunctionError(response.error);
        const data = response.data as {
            issues?: unknown;
            states?: unknown;
            truncated?: unknown;
            synced_at?: unknown;
        } | null;
        if (
            !data
            || !Array.isArray(data.issues) || !data.issues.every(isIssue)
            || !Array.isArray(data.states) || !data.states.every((state) => typeof state === "string")
            || typeof data.truncated !== "boolean"
            || typeof data.synced_at !== "string"
        ) {
            throw new LinearIntegrationError("LINEAR_INVALID_RESPONSE", "Linear returned an invalid response.");
        }
        return {
            issues: data.issues as LinearIssuePayload[],
            states: data.states as string[],
            truncated: data.truncated,
            syncedAt: data.synced_at,
        };
    }
}
