export type AuthErrorCode =
    | "INVALID_FIELDS"
    | "INVALID_CREDENTIALS"
    | "INVALID_INVITE"
    | "ACCOUNT_EXISTS"
    | "INVALID_RECOVERY"
    | "AUTH_UNAVAILABLE";

const messages: Record<AuthErrorCode, string> = {
    INVALID_FIELDS: "Check the entered fields and try again.",
    INVALID_CREDENTIALS: "The email or password is incorrect.",
    INVALID_INVITE: "That invite code is invalid.",
    ACCOUNT_EXISTS: "An account already exists for that email.",
    INVALID_RECOVERY: "This password-reset link is invalid or has expired.",
    AUTH_UNAVAILABLE: "Authentication is temporarily unavailable. Please try again.",
};

export class AuthActionError extends Error {
    readonly code: AuthErrorCode;

    constructor(code: AuthErrorCode, message = messages[code]) {
        super(message);
        this.name = "AuthActionError";
        this.code = code;
    }
}

function statusOf(error: unknown): number | undefined {
    if (!error || typeof error !== "object") return undefined;
    const candidate = error as { status?: unknown; context?: { status?: unknown } };
    if (typeof candidate.status === "number") return candidate.status;
    return typeof candidate.context?.status === "number" ? candidate.context.status : undefined;
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message.toLowerCase() : String(error ?? "").toLowerCase();
}

export function mapAuthError(error: unknown, operation: "signIn" | "inviteSignup" | "recovery" | "general" = "general"): AuthActionError {
    if (error instanceof AuthActionError) return error;
    const status = statusOf(error);
    const text = errorText(error);

    if (operation === "inviteSignup") {
        if (status === 403) return new AuthActionError("INVALID_INVITE");
        if (status === 409) return new AuthActionError("ACCOUNT_EXISTS");
        if (status === 400 || text.includes("invalid request") || text.includes("bad request")) return new AuthActionError("INVALID_FIELDS");
        return new AuthActionError("AUTH_UNAVAILABLE");
    }

    if (operation === "signIn" && (status === 400 || status === 401 || /invalid login|invalid credential|invalid password|email or password/.test(text))) {
        return new AuthActionError("INVALID_CREDENTIALS");
    }

    if (operation === "recovery" && (status === 400 || /expired|invalid.*(token|recovery|refresh)/.test(text))) {
        return new AuthActionError("INVALID_RECOVERY");
    }

    return new AuthActionError("AUTH_UNAVAILABLE");
}

export function invalidFields(): AuthActionError {
    return new AuthActionError("INVALID_FIELDS");
}
