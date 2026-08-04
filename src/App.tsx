import React, { useEffect, useMemo, useState } from "react";
import "./App.css";
import { Link, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { BrowserRouter } from "react-router-dom";
import { TaskPanel } from "./components/TaskPanel";
import { TimerPanel } from "./components/TimerPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { useSounds } from "./hooks/useSounds";
import { ProjectManagerProvider } from "./state/ProjectManagerContext";
import { HabitProvider } from "./state/HabitContext";
import { ProjectManagerPage } from "./components/ProjectManager/ProjectManagerPage";
import { AppStateProvider } from "./state/AppStateContext";
import AnalyticsPage from "./components/AnalyticsPage";
import StateSyncBridge from "./state/StateSyncBridge";
import { SyncProvider } from "./state/SyncContext";
import { SyncControls, UnsyncedBanner } from "./components/SyncControls";
import ErrorBoundary from "./components/ErrorBoundary";
import { DataProvider } from "./state/DataContext";
import { createDefaultDataAccess } from "./lib/data/defaultDataAccess";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { AuthLoading, RequireAuth } from "./auth/RequireAuth";
import { RedirectIfAuthenticated } from "./auth/RedirectIfAuthenticated";
import { LoginPage } from "./components/auth/LoginPage";
import { SignupPage } from "./components/auth/SignupPage";
import { ResetPasswordPage } from "./components/auth/ResetPasswordPage";
import { TauriCloseProvider } from "./state/TauriCloseContext";
import { HabitsPage } from "./components/HabitsPage";

const App: React.FC = () => (
    <BrowserRouter>
        <AuthProvider>
            <TauriCloseProvider>
                <Routes>
                <Route element={<RedirectIfAuthenticated />}>
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/signup" element={<SignupPage />} />
                </Route>
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route element={<RequireAuth />}>
                    <Route element={<AuthenticatedShell />}>
                        <Route path="/" element={<MainLayout />} />
                        <Route path="/projects" element={<ErrorBoundary><ProjectManagerPage /></ErrorBoundary>} />
                        <Route path="/analytics" element={<AnalyticsPage />} />
                        <Route path="/habits" element={<HabitsPage />} />
                    </Route>
                </Route>
                <Route path="*" element={<UnknownRoute />} />
                </Routes>
            </TauriCloseProvider>
        </AuthProvider>
    </BrowserRouter>
);

const AuthenticatedShell: React.FC = () => {
    const { session } = useAuth();
    // The shell only renders behind RequireAuth, so the session is present. A
    // user change produces a fresh owner-scoped graph; never reuse one across
    // owners. Public auth routes never construct this graph.
    const dataAccess = useMemo(
        () => createDefaultDataAccess(session!.user.id),
        [session?.user.id],
    );
    return (
        <DataProvider dataAccess={dataAccess}>
            <SyncProvider ownerId={session!.user.id}>
                <AppStateProvider>
                    <ProjectManagerProvider>
                        <HabitProvider>
                            <StateSyncBridge />
                            <div className="flex flex-col h-screen bg-neutral-950 text-neutral-200 text-xs">
                                <TopNav />
                                <UnsyncedBanner />
                                <div className="flex-1 min-h-0"><Outlet /></div>
                            </div>
                        </HabitProvider>
                    </ProjectManagerProvider>
                </AppStateProvider>
            </SyncProvider>
        </DataProvider>
    );
};

const TopNav: React.FC = () => {
    const { play } = useSounds();
    const { signOut } = useAuth();
    const loc = useLocation();
    const [signingOut, setSigningOut] = useState(false);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => { setError(null); }, [loc.pathname]);
    const base = "px-2 py-1 rounded transition-colors";
    const linkClass = (active: boolean) => `${base} ${active ? "bg-neutral-800 text-neutral-100" : "hover:bg-neutral-800/60"}`;
    const handleClick = (to: string) => { if (loc.pathname !== to) play("pressSide"); };

    async function handleSignOut() {
        if (signingOut) return;
        setError(null);
        setSigningOut(true);
        try { await signOut(); } catch { setError("Unable to sign out. Please try again."); } finally { setSigningOut(false); }
    }

    return (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-neutral-800 text-[11px] bg-neutral-950/70 backdrop-blur">
            <Link to="/" onClick={() => handleClick("/")} onMouseEnter={() => play("hover")} className={linkClass(loc.pathname === "/")}>Timer</Link>
            <Link to="/projects" onClick={() => handleClick("/projects")} onMouseEnter={() => play("hover")} className={linkClass(loc.pathname.startsWith("/projects"))}>Projects</Link>
            <Link to="/analytics" onClick={() => handleClick("/analytics")} onMouseEnter={() => play("hover")} className={linkClass(loc.pathname.startsWith("/analytics"))}>Analytics</Link>
            <Link to="/habits" onClick={() => handleClick("/habits")} onMouseEnter={() => play("hover")} className={linkClass(loc.pathname.startsWith("/habits"))}>Habits</Link>
            <div className="ml-auto flex items-center gap-2">
                {error && <span role="alert" className="text-red-300">{error}</span>}
                <SyncControls />
                <button type="button" onClick={handleSignOut} disabled={signingOut} className="rounded px-2 py-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 disabled:opacity-50">{signingOut ? "Signing out…" : "Sign out"}</button>
            </div>
        </div>
    );
};

const MainLayout: React.FC = () => (
    <div className="flex h-full">
        <aside className="w-72 border-r border-neutral-800 p-3 flex flex-col gap-6 overflow-y-auto bg-neutral-900/30 backdrop-blur-sm"><TaskPanel /><SettingsPanel /></aside>
        <main className="flex-1 flex items-center justify-center p-4 min-h-0"><TimerPanel /></main>
    </div>
);

const UnknownRoute: React.FC = () => {
    const { loading, session } = useAuth();
    const location = useLocation();
    if (loading) return <AuthLoading />;
    if (!session) return <Navigate to="/login" replace state={{ from: location }} />;
    return <Navigate to="/" replace />;
};

export default App;
