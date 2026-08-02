import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AuthPageLayout } from "./AuthPageLayout";
import { useAuth } from "../../auth/AuthContext";
import { AuthActionError } from "../../auth/authErrors";

function isEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function destinationFrom(state: unknown): string {
    const from = (state as { from?: { pathname?: string; search?: string; hash?: string } } | null)?.from;
    if (!from?.pathname || !from.pathname.startsWith("/") || from.pathname.startsWith("//")) return "/";
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    if (new URL(from.pathname, origin).origin !== origin) return "/";
    return `${from.pathname}${from.search ?? ""}${from.hash ?? ""}`;
}

export function LoginPage(): React.JSX.Element {
    const { signIn, resetPassword } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(() => location.state?.passwordReset ? "Your password has been updated. You can sign in now." : null);
    const [pending, setPending] = useState(false);

    async function submit(event: React.FormEvent) {
        event.preventDefault();
        if (pending) return;
        setError(null);
        setNotice(null);
        setPending(true);
        try {
            await signIn(email, password);
            navigate(destinationFrom(location.state), { replace: true });
        } catch (cause) {
            setError(cause instanceof AuthActionError ? cause.message : "Unable to sign in. Please try again.");
        } finally {
            setPending(false);
        }
    }

    async function forgotPassword() {
        setError(null);
        setNotice(null);
        if (!isEmail(email)) {
            setError("Enter your email address first.");
            return;
        }
        setPending(true);
        try {
            await resetPassword(email);
            setNotice("If an account matches that email, a password-reset link will be sent.");
        } catch (cause) {
            setError(cause instanceof AuthActionError ? cause.message : "Unable to request a password reset.");
        } finally {
            setPending(false);
        }
    }

    return (
        <AuthPageLayout title="Sign in">
            <form onSubmit={submit} className="space-y-4">
                <label className="block text-sm text-neutral-300">Email<input className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
                <label className="block text-sm text-neutral-300">Password<input className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
                {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
                {notice && <p role="status" className="text-sm text-emerald-300">{notice}</p>}
                <button className="w-full rounded-md bg-neutral-100 px-4 py-2 font-medium text-neutral-950 disabled:cursor-not-allowed disabled:opacity-50" type="submit" disabled={pending}>{pending ? "Working…" : "Sign in"}</button>
            </form>
            <div className="mt-5 flex items-center justify-between text-sm">
                <button type="button" className="text-neutral-400 underline hover:text-neutral-100 disabled:opacity-50" onClick={forgotPassword} disabled={pending}>Forgot password?</button>
                <Link className="text-neutral-400 underline hover:text-neutral-100" to="/signup">Create account</Link>
            </div>
        </AuthPageLayout>
    );
}
