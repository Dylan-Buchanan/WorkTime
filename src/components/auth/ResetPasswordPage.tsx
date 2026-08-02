import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthPageLayout } from "./AuthPageLayout";
import { useAuth } from "../../auth/AuthContext";
import { AuthActionError } from "../../auth/authErrors";

export function ResetPasswordPage(): React.JSX.Element {
    const { loading, session, recoveringPassword, updatePassword, signOut } = useAuth();
    const navigate = useNavigate();
    const [checking, setChecking] = useState(true);
    const [newPassword, setNewPassword] = useState("");
    const [confirmation, setConfirmation] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState(false);

    useEffect(() => {
        if (loading) return;
        const timer = window.setTimeout(() => setChecking(false), 0);
        return () => window.clearTimeout(timer);
    }, [loading, recoveringPassword, session]);

    useEffect(() => {
        if (!checking && !pending && session && !recoveringPassword) navigate("/", { replace: true });
    }, [checking, navigate, pending, recoveringPassword, session]);

    async function submit(event: React.FormEvent) {
        event.preventDefault();
        if (pending) return;
        setError(null);
        if (newPassword.length < 6 || newPassword !== confirmation) {
            setError(newPassword.length < 6 ? "Your password must be at least 6 characters." : "The passwords do not match.");
            return;
        }
        setPending(true);
        try {
            await updatePassword(newPassword);
            await signOut();
            setNewPassword("");
            setConfirmation("");
            navigate("/login", { replace: true, state: { passwordReset: true } });
        } catch (cause) {
            setError(cause instanceof AuthActionError ? cause.message : "Unable to update your password.");
        } finally {
            setPending(false);
        }
    }

    if (loading || checking) return <AuthPageLayout title="Checking reset link"><p className="text-center text-sm text-neutral-400">Checking your password-reset link…</p></AuthPageLayout>;
    if (!session || !recoveringPassword) return <AuthPageLayout title="Reset link unavailable"><p className="text-center text-sm text-neutral-400">This password-reset link is invalid or has expired.</p><p className="mt-5 text-center text-sm"><Link className="underline" to="/login">Return to sign in</Link></p></AuthPageLayout>;

    return (
        <AuthPageLayout title="Choose a new password">
            <form onSubmit={submit} className="space-y-4">
                <label className="block text-sm text-neutral-300">New password<input className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100" type="password" autoComplete="new-password" required minLength={6} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
                <label className="block text-sm text-neutral-300">Confirm new password<input className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100" type="password" autoComplete="new-password" required minLength={6} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
                {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
                <button className="w-full rounded-md bg-neutral-100 px-4 py-2 font-medium text-neutral-950 disabled:opacity-50" type="submit" disabled={pending}>{pending ? "Updating…" : "Update password"}</button>
            </form>
        </AuthPageLayout>
    );
}
