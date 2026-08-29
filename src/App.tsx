import React, { lazy, Suspense, useEffect, useMemo, useState } from "react";
import "./App.css";
import { Link, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { BrowserRouter } from "react-router-dom";
import { TaskPanel } from "./components/TaskPanel";
import { TimerPanel } from "./components/TimerPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { useSounds } from "./hooks/useSounds";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { ProjectManagerProvider, usePM } from "./state/ProjectManagerContext";
import { HabitProvider } from "./state/HabitContext";
import { AppStateProvider } from "./state/AppStateContext";
import StateSyncBridge from "./state/StateSyncBridge";
import { SyncProvider } from "./state/SyncContext";
import { SyncControls, UnsyncedBanner } from "./components/SyncControls";
import ErrorBoundary from "./components/ErrorBoundary";
import { DataProvider } from "./state/DataContext";
import { createDefaultDataAccess } from "./lib/data/defaultDataAccess";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { AuthLoading, RequireAuth } from "./auth/RequireAuth";
import { RedirectIfAuthenticated } from "./auth/RedirectIfAuthenticated";
import { TauriCloseProvider } from "./state/TauriCloseContext";
import { AgentApprovalProvider } from "./state/AgentApprovalContext";
import { TodoProvider } from "./state/TodoContext";
import { SupabaseShortcutDataAccess } from "./lib/data/ShortcutDataAccess";
import { supabase } from "./lib/supabase";

// Route-level code splitting: heavy pages (recharts, @dnd-kit, date-fns) are
// only downloaded when their route is visited, keeping the entry chunk small.
const ProjectManagerPage = lazy(() =>
    import("./components/ProjectManager/ProjectManagerPage").then((m) => ({ default: m.ProjectManagerPage })),
);
const AnalyticsPage = lazy(() => import("./components/AnalyticsPage"));
const HabitsPage = lazy(() => import("./components/HabitsPage").then((m) => ({ default: m.HabitsPage })));
const TodosPage = lazy(() => import("./components/TodosPage").then((m) => ({ default: m.TodosPage })));
const WeekOverviewPage = lazy(() =>
    import("./components/WeekOverviewPage").then((m) => ({ default: m.WeekOverviewPage })),
);
const IntegrationsPage = lazy(() =>
    import("./components/IntegrationsPage").then((m) => ({ default: m.IntegrationsPage })),
);
const LoginPage = lazy(() => import("./components/auth/LoginPage").then((m) => ({ default: m.LoginPage })));
const SignupPage = lazy(() => import("./components/auth/SignupPage").then((m) => ({ default: m.SignupPage })));
const ResetPasswordPage = lazy(() =>
    import("./components/auth/ResetPasswordPage").then((m) => ({ default: m.ResetPasswordPage })),
);

const RouteLoadingFallback: React.FC = () => (
    <div className="flex h-full min-h-0 items-center justify-center text-xs text-neutral-500" role="status">
        Loading…
    </div>
);

const App: React.FC = () => (
    <BrowserRouter>
        <AuthProvider>
            <TauriCloseProvider>
                <Suspense fallback={<RouteLoadingFallback />}>
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
                        <Route path="/todos" element={<TodosPage />} />
                        <Route path="/week" element={<WeekOverviewPage />} />
                        <Route path="/integrations" element={<ErrorBoundary><ShortcutIntegrationsRoute /></ErrorBoundary>} />
                    </Route>
                </Route>
                <Route path="*" element={<UnknownRoute />} />
                </Routes>
                </Suspense>
            </TauriCloseProvider>
        </AuthProvider>
    </BrowserRouter>
);

const ShortcutIntegrationsRoute: React.FC = () => {
    const { session } = useAuth();
    const { state, createTask } = usePM();
    const dataAccess = useMemo(
        () => new SupabaseShortcutDataAccess(supabase, session!.user.id),
        [session?.user.id],
    );
    const currentTasks = useMemo(() => Object.values(state.tasks), [state.tasks]);
    const projects = useMemo(() => Object.values(state.projects), [state.projects]);
    return <IntegrationsPage shortcut={{ dataAccess, currentTasks, projects, createTask }} />;
};

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
                        <AgentApprovalProvider>
                            <HabitProvider>
                                <TodoProvider>
                                    <StateSyncBridge />
                                    <div className="flex flex-col h-screen overflow-hidden bg-neutral-950 text-neutral-200 text-xs">
                                        <TopNav />
                                        <UnsyncedBanner />
                                        <div className="flex-1 min-h-0"><Outlet /></div>
                                    </div>
                                </TodoProvider>
                            </HabitProvider>
                        </AgentApprovalProvider>
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
    const base = "px-3 py-2 sm:px-2 sm:py-1 rounded transition-colors";
    const linkClass = (active: boolean) => `${base} ${active ? "bg-neutral-800 text-neutral-100" : "hover:bg-neutral-800/60"}`;
    const handleClick = (to: string) => { if (loc.pathname !== to) play("pressSide"); };

    async function handleSignOut() {
        if (signingOut) return;
        setError(null);
        setSigningOut(true);
        try { await signOut(); } catch { setError("Unable to sign out. Please try again."); } finally { setSigningOut(false); }
    }

    return (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 border-b border-neutral-800 text-[11px] bg-neutral-950/70 backdrop-blur">
            <Link to="/" onClick={() => handleClick("/")} onMouseEnter={() => play("hover")} className={linkClass(loc.pathname === "/")}>Timer</Link>
            <Link to="/projects" onClick={() => handleClick("/projects")} onMouseEnter={() => play("hover")} className={linkClass(loc.pathname.startsWith("/projects"))}>Projects</Link>
            <Link to="/analytics" onClick={() => handleClick("/analytics")} onMouseEnter={() => play("hover")} className={linkClass(loc.pathname.startsWith("/analytics"))}>Analytics</Link>
            <Link to="/habits" onClick={() => handleClick("/habits")} onMouseEnter={() => play("hover")} className={linkClass(loc.pathname.startsWith("/habits"))}>Habits</Link>
            <Link to="/todos" onClick={() => handleClick("/todos")} onMouseEnter={() => play("hover")} className={linkClass(loc.pathname.startsWith("/todos"))}>To-dos</Link>
            <Link to="/week" onClick={() => handleClick("/week")} onMouseEnter={() => play("hover")} className={linkClass(loc.pathname.startsWith("/week"))}>Week</Link>
            <Link to="/integrations" onClick={() => handleClick("/integrations")} onMouseEnter={() => play("hover")} className={linkClass(loc.pathname.startsWith("/integrations"))}>Integrations</Link>
            <div className="ml-auto flex flex-wrap items-center gap-2">
                {error && <span role="alert" className="text-red-300">{error}</span>}
                <SyncControls />
                <button type="button" onClick={handleSignOut} disabled={signingOut} className="rounded px-3 py-2 sm:px-2 sm:py-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 disabled:opacity-50">{signingOut ? "Signing out…" : "Sign out"}</button>
            </div>
        </div>
    );
};

const MainLayout: React.FC = () => {
    const isDesktop = useMediaQuery("(min-width: 1024px)");
    const [panelOpen, setPanelOpen] = useState(false);
    useEffect(() => {
        if (isDesktop) setPanelOpen(false);
    }, [isDesktop]);

    if (isDesktop) {
        return (
        <div className="flex h-full">
                <aside className="app-scrollbar w-72 border-r border-neutral-800 p-3 flex flex-col gap-6 overflow-y-auto bg-neutral-900/30 backdrop-blur-sm"><TaskPanel /><SettingsPanel /></aside>
                <main className="flex-1 flex min-w-0 min-h-0 overflow-y-auto"><TimerPanel /></main>
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2">
                <button
                    type="button"
                    onClick={() => setPanelOpen(true)}
                    aria-expanded={panelOpen}
                    aria-controls="timer-side-panel-drawer"
                    className="rounded bg-neutral-800 px-3 py-2 text-[11px] font-medium text-neutral-200 hover:bg-neutral-700"
                >
                    Tasks & Settings
                </button>
            </div>
            <main className="flex-1 flex p-4 min-h-0 overflow-y-auto"><TimerPanel /></main>
            {panelOpen && (
                <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Tasks and settings">
                    <div className="absolute inset-0 bg-black/60" onClick={() => setPanelOpen(false)} />
                    <div id="timer-side-panel-drawer" className="absolute inset-y-0 left-0 flex w-80 max-w-[85vw] flex-col border-r border-neutral-800 bg-neutral-950 shadow-2xl">
                        <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Tasks & Settings</span>
                            <button
                                type="button"
                                onClick={() => setPanelOpen(false)}
                                className="rounded bg-neutral-800 px-3 py-2 text-[11px] text-neutral-200 hover:bg-neutral-700"
                            >
                                Close
                            </button>
                        </div>
                        <div className="app-scrollbar flex flex-1 flex-col gap-6 overflow-y-auto p-3"><TaskPanel /><SettingsPanel /></div>
                    </div>
                </div>
            )}
        </div>
    );
};

const UnknownRoute: React.FC = () => {
    const { loading, session } = useAuth();
    const location = useLocation();
    if (loading) return <AuthLoading />;
    if (!session) return <Navigate to="/login" replace state={{ from: location }} />;
    return <Navigate to="/" replace />;
};

export default App;
