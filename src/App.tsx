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
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            height: "100vh",
                        }}
                    >
                        <TopNav />
                        <div style={{ flex: 1, minHeight: 0 }}>
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
    const linkStyle: React.CSSProperties = {
        textDecoration: "none",
        padding: "4px 8px",
        borderRadius: 4,
    };
    const activeStyle: React.CSSProperties = {
        background: "#222",
        fontWeight: 600,
    };
    const handleClick = (to: string) => {
        if (loc.pathname !== to) play("pressSide");
    };
    return (
        <div
            style={{
                display: "flex",
                gap: 12,
                padding: "8px 12px",
                borderBottom: "1px solid #333",
                fontSize: 12,
            }}
        >
            <Link
                to="/"
                onClick={() => handleClick("/")}
                onMouseEnter={() => play("hover")}
                style={{
                    ...linkStyle,
                    ...(loc.pathname === "/" ? activeStyle : {}),
                }}
            >
                Timer
            </Link>
            <Link
                to="/projects"
                onClick={() => handleClick("/projects")}
                onMouseEnter={() => play("hover")}
                style={{
                    ...linkStyle,
                    ...(loc.pathname.startsWith("/projects")
                        ? activeStyle
                        : {}),
                }}
            >
                Projects
            </Link>
            <Link
                to="/analytics"
                onClick={() => handleClick("/analytics")}
                onMouseEnter={() => play("hover")}
                style={{
                    ...linkStyle,
                    ...(loc.pathname.startsWith("/analytics")
                        ? activeStyle
                        : {}),
                }}
            >
                Analytics
            </Link>
        </div>
    );
};

const MainLayout: React.FC = () => (
    <div style={{ display: "flex", flexDirection: "row", height: "100%" }}>
        <div
            style={{
                width: 300,
                borderRight: "1px solid #333",
                padding: 12,
                overflowY: "auto",
            }}
        >
            <TaskPanel />
            <SettingsPanel />
        </div>
        <div
            style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
            }}
        >
            <TimerPanel />
        </div>
    </div>
);

export default App;
