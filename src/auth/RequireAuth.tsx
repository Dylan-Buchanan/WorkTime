import React from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";

export function AuthLoading(): React.JSX.Element {
    return <div className="min-h-screen flex items-center justify-center bg-neutral-950 text-sm text-neutral-400">Loading WorkTime…</div>;
}

export function RequireAuth(): React.JSX.Element {
    const { loading, session } = useAuth();
    const location = useLocation();
    if (loading) return <AuthLoading />;
    if (!session) return <Navigate to="/login" replace state={{ from: location }} />;
    return <Outlet />;
}
