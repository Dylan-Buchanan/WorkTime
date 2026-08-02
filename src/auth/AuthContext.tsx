import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Session, SupabaseClient, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { readPublicAppEnv } from "../lib/supabaseEnv";
import { AuthActionError, invalidFields, mapAuthError } from "./authErrors";

export interface SignUpInput {
    email: string;
    password: string;
    inviteCode: string;
}

export interface AuthContextValue {
    session: Session | null;
    user: User | null;
    loading: boolean;
    recoveringPassword: boolean;
    signIn(email: string, password: string): Promise<void>;
    signUp(input: SignUpInput): Promise<void>;
    signOut(): Promise<void>;
    resetPassword(email: string): Promise<void>;
    updatePassword(password: string): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function validEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function AuthProvider({ children, client = supabase }: { children: React.ReactNode; client?: SupabaseClient }): React.JSX.Element {
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(true);
    const [recoveringPassword, setRecoveringPassword] = useState(false);
    const mounted = useRef(true);
    const eventSequence = useRef(0);

    useEffect(() => {
        mounted.current = true;
        const { data } = client.auth.onAuthStateChange((event, nextSession) => {
            eventSequence.current += 1;
            if (!mounted.current) return;
            setSession(nextSession);
            if (event === "PASSWORD_RECOVERY") setRecoveringPassword(true);
            else if (event === "SIGNED_OUT" || (event === "INITIAL_SESSION" && !nextSession)) setRecoveringPassword(false);
            setLoading(false);
        });

        void client.auth.getSession().then(({ data: result }) => {
            if (!mounted.current || eventSequence.current > 0) return;
            setSession(result.session);
            setLoading(false);
        }).catch(() => {
            if (mounted.current) {
                setSession(null);
                setLoading(false);
            }
        });

        return () => {
            mounted.current = false;
            data.subscription.unsubscribe();
        };
    }, [client]);

    const signIn = useCallback(async (email: string, password: string) => {
        const normalizedEmail = email.trim();
        if (!validEmail(normalizedEmail) || !password) throw invalidFields();
        const { error } = await client.auth.signInWithPassword({ email: normalizedEmail, password });
        if (error) throw mapAuthError(error, "signIn");
    }, [client]);

    const signUp = useCallback(async ({ email, password, inviteCode }: SignUpInput) => {
        const normalizedEmail = email.trim();
        const normalizedInviteCode = inviteCode.trim();
        if (!validEmail(normalizedEmail) || password.length < 6 || !normalizedInviteCode) throw invalidFields();
        const response = await client.functions.invoke("invite-signup", {
            body: { email: normalizedEmail, password, inviteCode: normalizedInviteCode },
        });
        if (response.error) throw mapAuthError(response.error, "inviteSignup");
        const { error } = await client.auth.signInWithPassword({ email: normalizedEmail, password });
        if (error) throw mapAuthError(error, "signIn");
    }, [client]);

    const signOut = useCallback(async () => {
        const { error } = await client.auth.signOut();
        if (error) throw mapAuthError(error);
        if (mounted.current) setRecoveringPassword(false);
    }, [client]);

    const resetPassword = useCallback(async (email: string) => {
        const normalizedEmail = email.trim();
        if (!validEmail(normalizedEmail)) throw invalidFields();
        const { publicAppUrl } = readPublicAppEnv(import.meta.env);
        const origin = publicAppUrl ?? (typeof window !== "undefined" ? window.location.origin : "");
        const { error } = await client.auth.resetPasswordForEmail(normalizedEmail, { redirectTo: `${origin.replace(/\/+$/, "")}/reset-password` });
        if (error) throw mapAuthError(error, "recovery");
    }, [client]);

    const updatePassword = useCallback(async (password: string) => {
        if (password.length < 6) throw invalidFields();
        if (!session || !recoveringPassword) throw new AuthActionError("INVALID_RECOVERY");
        const { error } = await client.auth.updateUser({ password });
        if (error) throw mapAuthError(error, "recovery");
        if (mounted.current) setRecoveringPassword(false);
    }, [client, recoveringPassword, session]);

    const value = useMemo(() => ({ session, user: session?.user ?? null, loading, recoveringPassword, signIn, signUp, signOut, resetPassword, updatePassword }), [session, loading, recoveringPassword, signIn, signUp, signOut, resetPassword, updatePassword]);
    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
    const value = useContext(AuthContext);
    if (!value) throw new Error("useAuth must be inside AuthProvider");
    return value;
}
