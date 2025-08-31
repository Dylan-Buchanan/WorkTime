import React, { useState } from "react";
import { useAppState } from "../state/AppStateContext";
import { Settings } from "../state/types";
import { useSounds } from "../hooks/useSounds";

export const SettingsPanel: React.FC = () => {
    const { state, updateSettings } = useAppState();
    const { play } = useSounds();
    const s = state?.settings;
    const [local, setLocal] = useState<Settings | null>(s || null);
    React.useEffect(() => {
        setLocal(s || null);
    }, [s]);
    if (!local) return null;
    const onChange = (k: keyof Settings, v: number) =>
        setLocal({ ...local, [k]: v });
    return (
        <div style={{ marginTop: 24 }}>
            <h3>Settings</h3>
            {(
                [
                    "work_minutes",
                    "short_break_minutes",
                    "long_break_minutes",
                    "segment_length",
                ] as (keyof Settings)[]
            ).map((key) => (
                <label key={key} style={{ display: "block", marginBottom: 4 }}>
                    {key.replace(/_/g, " ")}
                    <input
                        type="number"
                        min={1}
                        value={local[key]}
                        onChange={(e) => onChange(key, Number(e.target.value))}
                        style={{ width: 60, marginLeft: 8 }}
                    />
                </label>
            ))}
            <button
                onMouseEnter={() => play("hover")}
                onClick={() => {
                    updateSettings(local);
                    play("pressSide");
                }}
            >
                Save
            </button>
        </div>
    );
};
