import React from "react";
import "./App.css";
import { TaskPanel } from "./components/TaskPanel.tsx";
import { TimerPanel } from "./components/TimerPanel.tsx";
import { SettingsPanel } from "./components/SettingsPanel.tsx";
import { AppStateProvider } from "./state/AppStateContext.tsx";

const App: React.FC = () => {
    return (
        <AppStateProvider>
            <div
                style={{
                    display: "flex",
                    flexDirection: "row",
                    height: "100vh",
                }}
            >
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
        </AppStateProvider>
    );
};

export default App;
