import React from "react";
import { Navigate, Outlet } from "react-router-dom";
import { AuthLoading } from "./RequireAuth";
import { useAuth } from "./AuthContext";

export function RedirectIfAuthenticated(): React.JSX.Element {
    const { loading, session } = useAuth();
    if (loading) return <AuthLoading />;
    if (session) return <Navigate to="/" replace />;
    return <Outlet />;
}
