import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import {
    GitHubIntegrationError,
    SupabaseGitHubDataAccess,
    type GitHubDataAccess,
} from "../../lib/data/GitHubDataAccess";
import {
    buildTauriGitHubOAuthBridge,
    consumeGitHubOAuthState,
    parseGitHubOAuthReturn,
} from "../../lib/integrations/githubOAuthReturn";
import { supabase } from "../../lib/supabase";
import { AuthPageLayout } from "./AuthPageLayout";

interface GithubOAuthCallbackPageProps {
    currentUrl?: () => URL;
    replaceLocation?: (url: string) => void;
    createDataAccess?: (ownerId: string) => Pick<GitHubDataAccess, "completeAuthorization">;
}

type CallbackStatus =
    | { kind: "loading"; message: string }
    | { kind: "error"; message: string; offerLogin?: boolean };

const browserUrl = () => new URL(window.location.href);
const replaceBrowserLocation = (url: string) => window.location.replace(url);
const defaultDataAccess = (ownerId: string) => new SupabaseGitHubDataAccess(supabase, ownerId);

function exchangeErrorMessage(error: unknown): string {
    if (error instanceof GitHubIntegrationError) {
        if (error.code === "GITHUB_CODE_INVALID") {
            return "This GitHub authorization code is invalid or has expired. Return to Integrations and try again.";
        }
        if (["GITHUB_EXCHANGE_UNAVAILABLE", "GITHUB_UPSTREAM_ERROR", "NETWORK_ERROR"].includes(error.code)) {
            return "GitHub could not be reached. Check your connection, then return to Integrations and try again.";
        }
    }
    return "GitHub could not be connected. Return to Integrations and try again.";
}

export function GithubOAuthCallbackPage({
    currentUrl = browserUrl,
    replaceLocation = replaceBrowserLocation,
    createDataAccess = defaultDataAccess,
}: GithubOAuthCallbackPageProps): React.JSX.Element {
    const { loading: authLoading, session } = useAuth();
    const navigate = useNavigate();
    const started = useRef(false);
    const [status, setStatus] = useState<CallbackStatus>({
        kind: "loading",
        message: "Completing GitHub connection…",
    });

    useEffect(() => {
        if (started.current) return;

        let url: URL;
        try {
            url = currentUrl();
        } catch {
            started.current = true;
            setStatus({ kind: "error", message: "The GitHub authorization response is invalid. Return to Integrations and try again." });
            return;
        }

        const bridgeUrl = buildTauriGitHubOAuthBridge(url);
        if (bridgeUrl) {
            started.current = true;
            setStatus({ kind: "loading", message: "Returning to the WorkTime desktop app…" });
            replaceLocation(bridgeUrl);
            return;
        }

        if (authLoading) return;
        started.current = true;

        const response = parseGitHubOAuthReturn(url);
        let stateResult;
        try {
            stateResult = consumeGitHubOAuthState(response.state);
        } catch {
            setStatus({ kind: "error", message: "The pending GitHub authorization could not be read. Return to Integrations and try again." });
            return;
        }
        if (stateResult.status === "invalid") {
            const message = stateResult.reason === "mismatch"
                ? "This GitHub authorization response could not be verified. Return to Integrations and try again."
                : "This GitHub authorization request is missing or has expired. Return to Integrations and try again.";
            setStatus({ kind: "error", message });
            return;
        }

        if (response.error) {
            setStatus({
                kind: "error",
                message: response.error === "access_denied"
                    ? "GitHub connection was cancelled. No changes were made."
                    : "GitHub could not authorize WorkTime. Return to Integrations and try again.",
            });
            return;
        }
        if (!session) {
            setStatus({
                kind: "error",
                message: "Your WorkTime session is unavailable on this surface. Sign in and try connecting GitHub again.",
                offerLogin: true,
            });
            return;
        }
        const code = response.code?.trim();
        if (!code) {
            setStatus({ kind: "error", message: "GitHub did not return an authorization code. Return to Integrations and try again." });
            return;
        }

        void createDataAccess(session.user.id).completeAuthorization(code).then(() => {
            navigate("/integrations", { replace: true });
        }).catch((error: unknown) => {
            setStatus({ kind: "error", message: exchangeErrorMessage(error) });
        });
    }, [authLoading, createDataAccess, currentUrl, navigate, replaceLocation, session]);

    return (
        <AuthPageLayout title="Connect GitHub">
            {status.kind === "loading" ? (
                <p role="status" className="text-center text-sm text-neutral-400">{status.message}</p>
            ) : (
                <div className="space-y-4">
                    <p role="alert" className="text-sm text-red-300">{status.message}</p>
                    <div className="flex flex-wrap gap-2">
                        <Link to="/integrations" className="rounded bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-white">
                            Back to Integrations
                        </Link>
                        {status.offerLogin && (
                            <Link to="/login" className="rounded border border-neutral-700 px-4 py-2 text-sm text-neutral-200 hover:bg-neutral-800">
                                Sign in
                            </Link>
                        )}
                    </div>
                </div>
            )}
        </AuthPageLayout>
    );
}
