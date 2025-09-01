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
    const fields: (keyof Settings)[] = [
        "work_minutes",
        "short_break_minutes",
        "long_break_minutes",
        "segment_length",
    ];
    return (
        <div className="space-y-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                Settings
            </h3>
            <div className="grid grid-cols-2 gap-3">
                {fields.map((key) => (
                    <label
                        key={key}
                        className="flex flex-col gap-1 text-[10px] font-medium text-neutral-400"
                    >
                        <span>{key.replace(/_/g, " ")}</span>
                        <input
                            type="number"
                            min={1}
                            value={local[key]}
                            onChange={(e) =>
                                onChange(key, Number(e.target.value))
                            }
                            className="bg-neutral-800/60 border border-neutral-700 rounded px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                    </label>
                ))}
            </div>
            <button
                onMouseEnter={() => play("hover")}
                onClick={() => {
                    updateSettings(local);
                    play("pressSide");
                }}
                className="w-full mt-2 px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-[11px] font-medium tracking-wide"
            >
                Save
            </button>
        </div>
    );
};
