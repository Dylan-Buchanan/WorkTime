import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthPageLayout } from "./AuthPageLayout";
import { useAuth } from "../../auth/AuthContext";
import { AuthActionError } from "../../auth/authErrors";

function isEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function SignupPage(): React.JSX.Element {
    const { signUp } = useAuth();
    const navigate = useNavigate();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [inviteCode, setInviteCode] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState(false);

    async function submit(event: React.FormEvent) {
        event.preventDefault();
        if (pending) return;
        setError(null);
        if (!isEmail(email) || password.length < 6 || !inviteCode.trim()) {
            setError("Enter a valid email, a password of at least 6 characters, and an invite code.");
            return;
        }
        setPending(true);
        try {
            await signUp({ email, password, inviteCode });
            navigate("/", { replace: true });
        } catch (cause) {
            setError(cause instanceof AuthActionError ? cause.message : "Unable to create your account.");
            setPassword("");
            setInviteCode("");
        } finally {
            setPending(false);
        }
    }

    return (
        <AuthPageLayout title="Create an account">
            <form onSubmit={submit} className="space-y-4">
                <label className="block text-sm text-neutral-300">Email<input className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
                <label className="block text-sm text-neutral-300">Password<input className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100" type="password" autoComplete="new-password" required minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
                <label className="block text-sm text-neutral-300">Invite code<input className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100" type="password" autoComplete="off" required value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} /></label>
                {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
                <button className="w-full rounded-md bg-neutral-100 px-4 py-2 font-medium text-neutral-950 disabled:cursor-not-allowed disabled:opacity-50" type="submit" disabled={pending}>{pending ? "Creating account…" : "Create account"}</button>
            </form>
            <p className="mt-5 text-center text-sm text-neutral-400">Already have an account? <Link className="underline hover:text-neutral-100" to="/login">Sign in</Link></p>
        </AuthPageLayout>
    );
}
