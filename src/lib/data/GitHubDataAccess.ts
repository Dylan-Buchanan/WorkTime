import type { SupabaseClient } from "@supabase/supabase-js";
import type { GithubIssuePayload } from "../engine/githubClassification";

export interface GitHubSettings {
    githubUsername: string;
    lastSyncedAt: string | null;
    updatedAt: string;
}

export interface GitHubAuthorizationResult {
    githubUsername: string;
}

export interface GitHubRepositoryLabel {
    name: string;
    color: string;
    description: string | null;
}

export interface GitHubRepoRow {
    ownerId: string;
    fullName: string;
    selected: boolean;
    projectId: string | null;
    labelFilter: string | null;
    includeClosed: boolean;
    isStale: boolean;
    updatedAt: string;
}

export interface GitHubRepoListResult {
    repos: GitHubRepoRow[];
    labels: Record<string, string[]>;
}

export interface GitHubRepoOptionsInput {
    projectId: string | null;
    labelFilter: string | null;
    includeClosed: boolean;
}

export interface GitHubSyncOptions {
    isStale?: boolean;
}

export interface GitHubSyncRepoContext {
    fullName: string;
    projectId: string | null;
    labelFilter: string | null;
    includeClosed: boolean;
}

export interface GitHubSyncResult {
    issues: GithubIssuePayload[];
    repo: GitHubSyncRepoContext;
    syncedAt: string;
}

export type GitHubIntegrationErrorCode =
    | "AUTH_REQUIRED"
    | "INVALID_REQUEST"
    | "METHOD_NOT_ALLOWED"
    | "GITHUB_NOT_CONFIGURED"
    | "GITHUB_CODE_INVALID"
    | "GITHUB_EXCHANGE_UNAVAILABLE"
    | "GITHUB_UPSTREAM_ERROR"
    | "GITHUB_INVALID_RESPONSE"
    | "GITHUB_TOKEN_INVALID"
    | "GITHUB_RATE_LIMITED"
    | "GITHUB_REPO_NOT_FOUND"
    | "SETTINGS_SAVE_FAILED"
    | "SETTINGS_READ_FAILED"
    | "SETTINGS_DELETE_FAILED"
    | "REPOSITORY_READ_FAILED"
    | "REPOSITORY_WRITE_FAILED"
    | "ENUMERATION_UNAVAILABLE"
    | "ENUMERATION_FAILED"
    | "EXCHANGE_FAILED"
    | "SYNC_UNAVAILABLE"
    | "SYNC_STATE_UPDATE_FAILED"
    | "SYNC_FAILED"
    | "NETWORK_ERROR";

export class GitHubIntegrationError extends Error {
    constructor(
        readonly code: GitHubIntegrationErrorCode,
        message: string,
        readonly retryAfterSeconds?: number,
    ) {
        super(message);
        this.name = "GitHubIntegrationError";
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

export interface GitHubDataAccess {
    beginAuthorization(state: string): Promise<string>;
    completeAuthorization(code: string): Promise<GitHubAuthorizationResult>;
    loadSettings(): Promise<GitHubSettings | null>;
    listRepos(): Promise<GitHubRepoListResult>;
    toggleSelection(repoFullName: string, selected: boolean): Promise<void>;
    updateRepoOptions(repoFullName: string, options: GitHubRepoOptionsInput): Promise<void>;
    sync(repoFullName: string, options?: GitHubSyncOptions): Promise<GitHubSyncResult>;
    disconnect(): Promise<void>;
}

interface GitHubSettingsRow {
    github_username: string;
    last_synced_at: string | null;
    updated_at: string;
}

interface FunctionErrorBody {
    error?: unknown;
    code?: unknown;
    retry_after_seconds?: unknown;
}

const KNOWN_CODES = new Set<GitHubIntegrationErrorCode>([
    "AUTH_REQUIRED",
    "INVALID_REQUEST",
    "METHOD_NOT_ALLOWED",
    "GITHUB_NOT_CONFIGURED",
    "GITHUB_CODE_INVALID",
    "GITHUB_EXCHANGE_UNAVAILABLE",
    "GITHUB_UPSTREAM_ERROR",
    "GITHUB_INVALID_RESPONSE",
    "GITHUB_TOKEN_INVALID",
    "GITHUB_RATE_LIMITED",
    "GITHUB_REPO_NOT_FOUND",
    "SETTINGS_SAVE_FAILED",
    "SETTINGS_READ_FAILED",
    "SETTINGS_DELETE_FAILED",
    "REPOSITORY_READ_FAILED",
    "REPOSITORY_WRITE_FAILED",
    "ENUMERATION_UNAVAILABLE",
    "ENUMERATION_FAILED",
    "EXCHANGE_FAILED",
    "SYNC_UNAVAILABLE",
    "SYNC_STATE_UPDATE_FAILED",
    "SYNC_FAILED",
]);

const REPO_FULL_NAME_PATTERN = /^[^/\s]+\/[^/\s]+$/;

async function mapFunctionError(error: unknown): Promise<GitHubIntegrationError> {
    const candidate = error as { message?: unknown; context?: { json?: () => Promise<unknown> } } | null;
    let body: FunctionErrorBody = {};
    try {
        const parsed = await candidate?.context?.json?.();
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as FunctionErrorBody;
    } catch {
        // Non-JSON function failures are transport errors.
    }
    const code = typeof body.code === "string" && KNOWN_CODES.has(body.code as GitHubIntegrationErrorCode)
        ? body.code as GitHubIntegrationErrorCode
        : "NETWORK_ERROR";
    const message = typeof body.error === "string" && body.error
        ? body.error
        : typeof candidate?.message === "string" && candidate.message
            ? candidate.message
            : "Unable to reach GitHub.";
    const retryAfterSeconds = typeof body.retry_after_seconds === "number"
        && Number.isFinite(body.retry_after_seconds)
        && body.retry_after_seconds >= 0
        ? body.retry_after_seconds
        : undefined;
    return new GitHubIntegrationError(code, message, retryAfterSeconds);
}

function invalidRequest(message: string): GitHubIntegrationError {
    return new GitHubIntegrationError("INVALID_REQUEST", message);
}

function invalidResponse(message: string): GitHubIntegrationError {
    return new GitHubIntegrationError("GITHUB_INVALID_RESPONSE", message);
}

function transportError(message: string, cause: unknown): GitHubIntegrationError {
    if (cause instanceof GitHubIntegrationError) return cause;
    return new GitHubIntegrationError("NETWORK_ERROR", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown): value is string | null {
    return value === null || typeof value === "string";
}

function normalizeRepoFullName(repoFullName: string): string {
    const fullName = repoFullName.trim();
    if (!REPO_FULL_NAME_PATTERN.test(fullName)) {
        throw invalidRequest("A valid repository full_name is required.");
    }
    return fullName;
}

function normalizeOptionalText(value: string | null): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
}

function repositoryLabel(value: unknown): GitHubRepositoryLabel {
    if (!isRecord(value) || Object.keys(value).some((key) => !["name", "color", "description"].includes(key))) {
        throw invalidResponse("GitHub enumeration returned invalid labels.");
    }
    if (
        typeof value.name !== "string"
        || !value.name.trim()
        || typeof value.color !== "string"
        || !/^[0-9a-f]{6}$/i.test(value.color)
        || !nullableString(value.description)
    ) {
        throw invalidResponse("GitHub enumeration returned invalid labels.");
    }
    return { name: value.name, color: value.color.toLowerCase(), description: value.description };
}

function repositoryRow(value: unknown): { row: GitHubRepoRow; labelNames: string[] } {
    const fields = [
        "owner_id", "full_name", "selected", "project_id", "label_filter",
        "include_closed", "is_stale", "updated_at", "labels",
    ];
    if (!isRecord(value) || Object.keys(value).some((key) => !fields.includes(key)) || !Array.isArray(value.labels)) {
        throw invalidResponse("GitHub enumeration returned an invalid response.");
    }
    if (
        typeof value.owner_id !== "string"
        || !value.owner_id
        || typeof value.full_name !== "string"
        || !REPO_FULL_NAME_PATTERN.test(value.full_name)
        || typeof value.selected !== "boolean"
        || !nullableString(value.project_id)
        || !nullableString(value.label_filter)
        || typeof value.include_closed !== "boolean"
        || typeof value.is_stale !== "boolean"
        || typeof value.updated_at !== "string"
        || !value.updated_at
    ) {
        throw invalidResponse("GitHub enumeration returned an invalid response.");
    }
    const labels = value.labels.map(repositoryLabel);
    return {
        row: {
            ownerId: value.owner_id,
            fullName: value.full_name,
            selected: value.selected,
            projectId: value.project_id,
            labelFilter: value.label_filter,
            includeClosed: value.include_closed,
            isStale: value.is_stale,
            updatedAt: value.updated_at,
        },
        labelNames: labels.map((label) => label.name),
    };
}

function syncIssue(value: unknown): GithubIssuePayload {
    if (!isRecord(value)) {
        throw invalidResponse("GitHub sync returned an invalid response.");
    }
    const { number, title, html_url, state, closed, labels } = value;
    if (
        typeof number !== "number"
        || !Number.isInteger(number)
        || number <= 0
        || typeof title !== "string"
        || !title.trim()
        || typeof html_url !== "string"
        || !html_url.trim()
        || typeof closed !== "boolean"
        || !Array.isArray(labels)
        || !labels.every((label) => typeof label === "string" && label.trim())
    ) {
        throw invalidResponse("GitHub sync returned an invalid response.");
    }
    if (state !== "open" && state !== "closed") {
        throw invalidResponse("GitHub sync returned an invalid response.");
    }
    if (closed !== (state === "closed")) {
        throw invalidResponse("GitHub sync returned an invalid response.");
    }
    return {
        number,
        title,
        html_url,
        state,
        closed,
        labels: labels.map((name) => ({ name: name as string })),
    };
}

function syncRepoContext(value: unknown, fullName: string): GitHubSyncRepoContext {
    const fields = ["full_name", "project_id", "label_filter", "include_closed"];
    if (!isRecord(value) || Object.keys(value).some((key) => !fields.includes(key))) {
        throw invalidResponse("GitHub sync returned an invalid response.");
    }
    if (
        typeof value.full_name !== "string"
        || value.full_name !== fullName
        || !nullableString(value.project_id)
        || !nullableString(value.label_filter)
        || typeof value.include_closed !== "boolean"
    ) {
        throw invalidResponse("GitHub sync returned an invalid response.");
    }
    return {
        fullName: value.full_name,
        projectId: value.project_id,
        labelFilter: value.label_filter,
        includeClosed: value.include_closed,
    };
}

export class SupabaseGitHubDataAccess implements GitHubDataAccess {
    constructor(
        private readonly client: SupabaseClient,
        private readonly ownerId: string,
    ) {}

    async beginAuthorization(state: string): Promise<string> {
        const normalizedState = state.trim();
        if (!normalizedState) throw invalidRequest("OAuth state is required.");
        let response;
        try {
            response = await this.client.functions.invoke("github-oauth-exchange", {
                method: "POST",
                body: { action: "start", state: normalizedState },
            });
        } catch {
            throw new GitHubIntegrationError("NETWORK_ERROR", "Unable to begin GitHub authorization.");
        }
        if (response.error) throw await mapFunctionError(response.error);
        const authorizationUrl = (response.data as { authorization_url?: unknown } | null)?.authorization_url;
        let parsed: URL;
        try {
            parsed = new URL(String(authorizationUrl));
        } catch {
            throw invalidResponse("GitHub authorization returned an invalid URL.");
        }
        const redirectUri = parsed.searchParams.getAll("redirect_uri");
        const clientId = parsed.searchParams.getAll("client_id");
        const states = parsed.searchParams.getAll("state");
        const scopes = parsed.searchParams.getAll("scope");
        if (
            parsed.origin !== "https://github.com"
            || parsed.pathname !== "/login/oauth/authorize"
            || parsed.username
            || parsed.password
            || parsed.hash
            || redirectUri.length !== 1
            || !redirectUri[0]
            || clientId.length !== 1
            || !clientId[0]
            || states.length !== 1
            || states[0] !== normalizedState
            || scopes.length !== 1
            || scopes[0] !== "repo"
        ) {
            throw invalidResponse("GitHub authorization returned an untrusted URL.");
        }
        try {
            const callback = new URL(redirectUri[0]);
            if (!['http:', 'https:'].includes(callback.protocol) || callback.username || callback.password || callback.hash) {
                throw new Error("untrusted callback");
            }
        } catch {
            throw invalidResponse("GitHub authorization returned an untrusted URL.");
        }
        return parsed.toString();
    }

    async completeAuthorization(code: string): Promise<GitHubAuthorizationResult> {
        const normalizedCode = code.trim();
        if (!normalizedCode) throw invalidRequest("Authorization code is required.");
        let response;
        try {
            response = await this.client.functions.invoke("github-oauth-exchange", {
                method: "POST",
                body: { action: "exchange", code: normalizedCode },
            });
        } catch {
            throw new GitHubIntegrationError("NETWORK_ERROR", "Unable to complete GitHub authorization.");
        }
        if (response.error) throw await mapFunctionError(response.error);
        if (!response.data || typeof response.data !== "object" || Array.isArray(response.data)) {
            throw invalidResponse("GitHub authorization returned an invalid response.");
        }
        const data = response.data as Record<string, unknown>;
        const githubUsername = typeof data.github_username === "string" ? data.github_username.trim() : "";
        if (!githubUsername || Object.keys(data).some((key) => key !== "github_username")) {
            throw invalidResponse("GitHub authorization returned an invalid response.");
        }
        return { githubUsername };
    }

    async loadSettings(): Promise<GitHubSettings | null> {
        let response;
        try {
            response = await this.client
                .from("github_settings")
                .select("github_username, last_synced_at, updated_at")
                .eq("owner_id", this.ownerId)
                .maybeSingle();
        } catch (error) {
            throw transportError("Unable to load GitHub settings.", error);
        }
        if (response.error) throw new GitHubIntegrationError("SETTINGS_READ_FAILED", "Unable to load GitHub settings.");
        if (!response.data) return null;
        const row = response.data as GitHubSettingsRow;
        if (
            typeof row.github_username !== "string"
            || !row.github_username.trim()
            || !(row.last_synced_at === null || typeof row.last_synced_at === "string")
            || typeof row.updated_at !== "string"
            || !row.updated_at
        ) {
            throw invalidResponse("GitHub settings returned an invalid response.");
        }
        return {
            githubUsername: row.github_username,
            lastSyncedAt: row.last_synced_at,
            updatedAt: row.updated_at,
        };
    }

    async listRepos(): Promise<GitHubRepoListResult> {
        let response;
        try {
            response = await this.client.functions.invoke("github-enumerate-repos", {
                method: "POST",
                body: {},
            });
        } catch {
            throw new GitHubIntegrationError("NETWORK_ERROR", "Unable to enumerate GitHub repositories.");
        }
        if (response.error) throw await mapFunctionError(response.error);
        if (!isRecord(response.data) || Object.keys(response.data).some((key) => key !== "repos") || !Array.isArray(response.data.repos)) {
            throw invalidResponse("GitHub enumeration returned an invalid response.");
        }
        const repos: GitHubRepoRow[] = [];
        const labels: Record<string, string[]> = {};
        for (const entry of response.data.repos) {
            const parsed = repositoryRow(entry);
            repos.push(parsed.row);
            labels[parsed.row.fullName] = parsed.labelNames;
        }
        return { repos, labels };
    }

    async toggleSelection(repoFullName: string, selected: boolean): Promise<void> {
        const fullName = normalizeRepoFullName(repoFullName);
        await this.writeRepoPreferences(fullName, { selected });
    }

    async updateRepoOptions(repoFullName: string, options: GitHubRepoOptionsInput): Promise<void> {
        const fullName = normalizeRepoFullName(repoFullName);
        if (typeof options.includeClosed !== "boolean") {
            throw invalidRequest("Include-closed must be a boolean.");
        }
        await this.writeRepoPreferences(fullName, {
            project_id: normalizeOptionalText(options.projectId),
            label_filter: normalizeOptionalText(options.labelFilter),
            include_closed: options.includeClosed,
        });
    }

    async sync(repoFullName: string, options: GitHubSyncOptions = {}): Promise<GitHubSyncResult> {
        const fullName = normalizeRepoFullName(repoFullName);
        if (options.isStale) {
            throw new GitHubIntegrationError("GITHUB_REPO_NOT_FOUND", "GitHub repository is no longer accessible.");
        }
        let response;
        try {
            response = await this.client.functions.invoke("github-sync", {
                method: "POST",
                body: { full_name: fullName },
            });
        } catch {
            throw new GitHubIntegrationError("NETWORK_ERROR", "Unable to reach GitHub.");
        }
        if (response.error) throw await mapFunctionError(response.error);
        if (
            !isRecord(response.data)
            || Object.keys(response.data).some((key) => !["issues", "repo", "synced_at"].includes(key))
            || !Array.isArray(response.data.issues)
            || typeof response.data.synced_at !== "string"
            || !response.data.synced_at
        ) {
            throw invalidResponse("GitHub sync returned an invalid response.");
        }
        const repo = syncRepoContext(response.data.repo, fullName);
        return {
            issues: response.data.issues.map(syncIssue),
            repo,
            syncedAt: response.data.synced_at,
        };
    }

    async disconnect(): Promise<void> {
        let response;
        try {
            response = await this.client.from("github_settings").delete().eq("owner_id", this.ownerId);
        } catch (error) {
            throw transportError("Unable to disconnect GitHub.", error);
        }
        if (response.error) throw new GitHubIntegrationError("SETTINGS_DELETE_FAILED", "Unable to disconnect GitHub.");
    }

    private async writeRepoPreferences(fullName: string, payload: Record<string, unknown>): Promise<void> {
        let response;
        try {
            response = await this.client
                .from("github_repos")
                .update(payload)
                .eq("owner_id", this.ownerId)
                .eq("full_name", fullName)
                .select();
        } catch (error) {
            throw transportError("Unable to save GitHub repository preferences.", error);
        }
        if (response.error) {
            throw new GitHubIntegrationError("REPOSITORY_WRITE_FAILED", "Unable to save GitHub repository preferences.");
        }
        if (!Array.isArray(response.data) || response.data.length === 0) {
            throw new GitHubIntegrationError("GITHUB_REPO_NOT_FOUND", "GitHub repository was not found.");
        }
    }
}
