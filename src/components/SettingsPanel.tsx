import React, { useState } from "react";
import { useAppState } from "../state/AppStateContext";
import { Settings } from "../state/types";
import { useSounds } from "../hooks/useSounds";
import {
    clearAgentApiKey,
    AGENT_PROVIDER_OPTIONS,
    getAgentApiKey,
    getAgentProvider,
    setAgentApiKey,
    setAgentProvider,
    subscribeToAgentApiKey,
    subscribeToAgentProvider,
} from "../lib/agent";

export const SettingsPanel: React.FC = () => {
    const { state, updateSettings, resetAll } = useAppState();
    const { play } = useSounds();
    const s = state?.settings;
    const [local, setLocal] = useState<Settings | null>(s || null);
    const [showReset, setShowReset] = useState(false);
    const [confirm, setConfirm] = useState("");
    const [agentApiKey, setAgentApiKeyDraft] = useState(() => getAgentApiKey() ?? "");
    const [hasAgentApiKey, setHasAgentApiKey] = useState(() => Boolean(getAgentApiKey()));
    const [agentProvider, setAgentProviderChoice] = useState(() => getAgentProvider());
    const [agentSaveStatus, setAgentSaveStatus] = useState<"success" | "error" | null>(null);
    const [agentSaveMessage, setAgentSaveMessage] = useState("");
    React.useEffect(() => {
        setLocal(s || null);
    }, [s]);
    React.useEffect(() => subscribeToAgentApiKey((next) => {
        setAgentApiKeyDraft(next ?? "");
        setHasAgentApiKey(Boolean(next));
    }), []);
    React.useEffect(() => subscribeToAgentProvider(setAgentProviderChoice), []);
    const onChange = (k: keyof Settings, v: number) =>
        setLocal((prev) => (prev ? { ...prev, [k]: v } : prev));
    const fields: (keyof Settings)[] = [
        "work_minutes",
        "short_break_minutes",
        "long_break_minutes",
        "segment_length",
    ];
    return (
        <div className="space-y-3 relative">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                Settings
            </h3>
            {local ? (
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
                                className="bg-neutral-800/60 border border-neutral-700 rounded px-2 py-1.5 sm:py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                        </label>
                    ))}
                </div>
            ) : (
                <div className="text-[11px] text-neutral-500 py-4">
                    Loading…
                </div>
            )}
            {local && (
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
            )}
            <div className="pt-1 border-t border-neutral-800" />
            <div className="space-y-2">
                <div>
                    <h4 className="text-[11px] font-semibold text-neutral-300">
                        Agent API key
                    </h4>
                    <p className="text-[10px] text-neutral-500 leading-relaxed">
                        Stored only in this browser or Tauri webview. Enter it once per surface.
                    </p>
                </div>
                <label className="sr-only" htmlFor="agent-api-key">
                    Agent API key
                </label>
                <label className="flex flex-col gap-1 text-[10px] font-medium text-neutral-400" htmlFor="agent-provider">
                    <span>Provider</span>
                    <select
                        id="agent-provider"
                        value={agentProvider}
                        onChange={(event) => {
                            setAgentProviderChoice(event.target.value as typeof agentProvider);
                            setAgentSaveStatus(null);
                        }}
                        className="bg-neutral-800/60 border border-neutral-700 rounded px-2 py-1.5 sm:py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    >
                        {AGENT_PROVIDER_OPTIONS.map((provider) => (
                            <option key={provider.id} value={provider.id}>
                                {provider.label}
                            </option>
                        ))}
                    </select>
                    <span className="font-normal text-neutral-600">
                        {AGENT_PROVIDER_OPTIONS.find((provider) => provider.id === agentProvider)?.baseUrl}
                    </span>
                </label>
                <input
                    id="agent-api-key"
                    type="password"
                    autoComplete="off"
                    value={agentApiKey}
                    onChange={(event) => {
                        setAgentApiKeyDraft(event.target.value);
                        setAgentSaveStatus(null);
                    }}
                    placeholder="sk-…"
                    className="w-full bg-neutral-800/60 border border-neutral-700 rounded px-2 py-1.5 sm:py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <div className="flex gap-2">
                    <button
                        type="button"
                        onMouseEnter={() => play("hover")}
                        onClick={() => {
                            try {
                                setAgentProvider(agentProvider);
                                setAgentApiKey(agentApiKey);
                                setAgentSaveStatus("success");
                                setAgentSaveMessage("API key saved locally for the selected provider.");
                                play("pressSide");
                            } catch {
                                setAgentSaveStatus("error");
                                setAgentSaveMessage("Unable to save the API key locally. Check browser storage permissions and try again.");
                            }
                        }}
                        className="flex-1 px-2 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-[11px] font-medium"
                    >
                        Save API key
                    </button>
                    <button
                        type="button"
                        disabled={!hasAgentApiKey}
                        onMouseEnter={() => hasAgentApiKey && play("hover")}
                        onClick={() => {
                            try {
                                clearAgentApiKey();
                                setAgentSaveStatus("success");
                                setAgentSaveMessage("API key cleared from this surface.");
                                play("pressSide");
                            } catch {
                                setAgentSaveStatus("error");
                                setAgentSaveMessage("Unable to clear the API key from local storage. Try again.");
                            }
                        }}
                        className="px-2 py-1.5 rounded border border-neutral-700 bg-neutral-800/60 hover:bg-neutral-800 text-[11px] text-neutral-300 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        Clear
                    </button>
                </div>
                {agentSaveStatus && (
                    <p
                        role="status"
                        aria-live="polite"
                        className={agentSaveStatus === "success" ? "text-[10px] text-emerald-400" : "text-[10px] text-red-400"}
                    >
                        {agentSaveMessage}
                    </p>
                )}
            </div>
            <div className="pt-1 border-t border-neutral-800" />
            <button
                type="button"
                onMouseEnter={() => play("hover")}
                onClick={() => {
                    play("pressSide");
                    setShowReset(true);
                }}
                className="w-full px-3 py-1.5 rounded bg-neutral-800/60 hover:bg-neutral-800 border border-neutral-700 text-[11px] text-red-400 font-medium tracking-wide"
            >
                Reset All Data
            </button>
            {showReset && (
                <div className="fixed inset-0 z-40 flex items-center justify-center">
                    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" />
                    <div className="relative w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-neutral-700 bg-neutral-900/95 p-4 shadow-xl space-y-3 text-[11px]">
                        <h4 className="text-neutral-200 font-semibold text-xs">
                            Confirm Data Reset
                        </h4>
                        <p className="text-neutral-400 leading-relaxed">
                            This will delete all timer tasks, logs, settings and
                            timer state. Your projects and estimates will be
                            kept. Type{" "}
                            <span className="text-red-400 font-semibold">
                                yes
                            </span>{" "}
                            to enable the delete button.
                        </p>
                        <input
                            autoFocus
                            value={confirm}
                            onChange={(e) => setConfirm(e.target.value)}
                            placeholder="type yes to confirm"
                            className="w-full bg-neutral-800/60 border border-neutral-700 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-red-500 placeholder:text-neutral-600"
                        />
                        <div className="flex gap-2 pt-1">
                            <button
                                type="button"
                                onMouseEnter={() => play("hover")}
                                onClick={() => {
                                    play("pressSide");
                                    setShowReset(false);
                                    setConfirm("");
                                }}
                                className="flex-1 px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600 text-neutral-200"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={
                                    confirm.trim().toLowerCase() !== "yes"
                                }
                                onMouseEnter={() =>
                                    confirm.trim().toLowerCase() === "yes" &&
                                    play("hover")
                                }
                                onClick={async () => {
                                    if (confirm.trim().toLowerCase() !== "yes")
                                        return;
                                    play("pressSide");
                                    await resetAll();
                                    setShowReset(false);
                                    setConfirm("");
                                }}
                                className={`flex-1 px-2 py-1 rounded font-semibold border text-white transition-colors ${
                                    confirm.trim().toLowerCase() === "yes"
                                        ? "bg-red-600 hover:bg-red-500 active:bg-red-700 border-red-500"
                                        : "bg-neutral-800 border-neutral-700 opacity-40 cursor-not-allowed"
                                }`}
                            >
                                Delete Data
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
