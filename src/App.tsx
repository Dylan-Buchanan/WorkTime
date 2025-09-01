import React from "react";
import "./App.css";
import { TaskPanel } from "./components/TaskPanel";
import { TimerPanel } from "./components/TimerPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import {
    BrowserRouter,
    Routes,
    Route,
    Link,
    useLocation,
} from "react-router-dom";
import { useSounds } from "./hooks/useSounds";
import { ProjectManagerProvider } from "./state/ProjectManagerContext";
import { ProjectManagerPage } from "./components/ProjectManager/ProjectManagerPage";
import { AppStateProvider } from "./state/AppStateContext";
import AnalyticsPage from "./components/AnalyticsPage";

const App: React.FC = () => {
    return (
        <BrowserRouter>
            <ProjectManagerProvider>
                <AppStateProvider>
                    <div className="flex flex-col h-screen bg-neutral-950 text-neutral-200 text-xs">
                        <TopNav />
                        <div className="flex-1 min-h-0">
                            <Routes>
                                <Route path="/" element={<MainLayout />} />
                                <Route
                                    path="/projects"
                                    element={<ProjectManagerPage />}
                                />
                                <Route
                                    path="/analytics"
                                    element={<AnalyticsPage />}
                                />
                            </Routes>
                        </div>
                    </div>
                </AppStateProvider>
            </ProjectManagerProvider>
        </BrowserRouter>
    );
};

const TopNav: React.FC = () => {
    const { play } = useSounds();
    const loc = useLocation();
    const base = "px-2 py-1 rounded transition-colors";
    const linkClass = (active: boolean) =>
        `${base} ${
            active
                ? "bg-neutral-800 text-neutral-100"
                : "hover:bg-neutral-800/60"
        }`;
    const handleClick = (to: string) => {
        if (loc.pathname !== to) play("pressSide");
    };
    return (
        <div className="flex gap-2 px-3 py-2 border-b border-neutral-800 text-[11px] bg-neutral-950/70 backdrop-blur">
            <Link
                to="/"
                onClick={() => handleClick("/")}
                onMouseEnter={() => play("hover")}
                className={linkClass(loc.pathname === "/")}
            >
                Timer
            </Link>
            <Link
                to="/projects"
                onClick={() => handleClick("/projects")}
                onMouseEnter={() => play("hover")}
                className={linkClass(loc.pathname.startsWith("/projects"))}
            >
                Projects
            </Link>
            <Link
                to="/analytics"
                onClick={() => handleClick("/analytics")}
                onMouseEnter={() => play("hover")}
                className={linkClass(loc.pathname.startsWith("/analytics"))}
            >
                Analytics
            </Link>
        </div>
    );
};

const MainLayout: React.FC = () => (
    <div className="flex h-full">
        <aside className="w-72 border-r border-neutral-800 p-3 flex flex-col gap-6 overflow-y-auto bg-neutral-900/30 backdrop-blur-sm">
            <TaskPanel />
            <SettingsPanel />
        </aside>
        <main className="flex-1 flex items-center justify-center p-4 min-h-0">
            <TimerPanel />
        </main>
    </div>
);

export default App;
