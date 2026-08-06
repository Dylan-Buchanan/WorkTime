import React, { useEffect, useState } from "react";
import { Bot, ChevronDown, RotateCcw, Settings2, Sparkles, X } from "lucide-react";
import { Link } from "react-router-dom";
import { getAgentApiKey, subscribeToAgentApiKey } from "../../lib/agent/apiKey";
import { type AgentMode, useAgentApproval } from "../../state/AgentApprovalContext";
import { AgentApprovalCard } from "./AgentApprovalCard";

const MODES: { id: AgentMode; label: string; description: string }[] = [
    { id: "start-of-day", label: "Start of Day", description: "Prioritize and shape today's plan" },
    { id: "end-of-day", label: "End of Day", description: "Review progress and prepare tomorrow" },
    { id: "chat", label: "Chat", description: "Plan through a focused conversation" },
];

export const AgentPanel: React.FC = () => {
    const agent = useAgentApproval();
    const [open, setOpen] = useState(false);
    const [hasKey, setHasKey] = useState(() => Boolean(getAgentApiKey()));
    const [confirmationToken, setConfirmationToken] = useState<string | null>(null);
    const [conflictCount, setConflictCount] = useState(0);
    const [revertMessage, setRevertMessage] = useState<string | null>(null);
    useEffect(() => subscribeToAgentApiKey((key) => setHasKey(Boolean(key))), []);
    useEffect(() => { if (agent.status === "reviewing" || agent.status === "replanning") setOpen(true); }, [agent.status]);

    const handleRevert = () => {
        const result = agent.revert(confirmationToken ?? undefined);
        if (result.status === "conflicts") {
            setConfirmationToken(result.confirmationToken);
            setConflictCount(result.conflicts.length);
            return;
        }
        setConfirmationToken(null);
        setConflictCount(0);
        setRevertMessage(result.status === "reverted" ? "Agent changes reverted." : result.status === "no-snapshot" ? "No agent snapshot is available." : "The snapshot project no longer exists.");
    };

    if (!open) {
        return <button type="button" onClick={() => setOpen(true)} className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border border-violet-400/30 bg-violet-600 px-4 py-3 font-medium text-white shadow-2xl hover:bg-violet-500" aria-label="Open planning agent"><Sparkles size={16} />Plan with agent</button>;
    }

    return (
        <section aria-label="Planning agent" className="fixed bottom-5 right-5 z-40 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-950/95 shadow-2xl backdrop-blur">
            <header className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2.5">
                <span className="rounded-lg bg-violet-500/15 p-1.5 text-violet-300"><Bot size={16} /></span>
                <div><div className="font-semibold text-neutral-100">Planning agent</div><div className="text-[10px] text-neutral-500">Changes stay under your control</div></div>
                <button type="button" onClick={() => setOpen(false)} className="ml-auto rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200" aria-label="Close planning agent"><ChevronDown size={16} /></button>
            </header>

            <div className="max-h-[70vh] overflow-y-auto p-3">
                {!hasKey ? (
                    <div className="rounded-xl border border-dashed border-neutral-700 p-4 text-center">
                        <Settings2 className="mx-auto text-violet-300" size={22} />
                        <h2 className="mt-2 font-semibold text-neutral-100">Set up your agent</h2>
                        <p className="mt-1 text-[11px] leading-relaxed text-neutral-400">Add your own OpenAI or DeepSeek API key in Timer settings. It stays in this browser or desktop webview.</p>
                        <Link to="/" className="mt-3 inline-flex rounded-lg bg-neutral-800 px-3 py-2 text-neutral-100 hover:bg-neutral-700">Open settings</Link>
                    </div>
                ) : agent.currentChange && ["reviewing", "replanning", "error"].includes(agent.status) ? (
                    <>
                        <div className="mb-2 flex items-center justify-between text-[10px] text-neutral-400"><span>Change {agent.currentIndex + 1} of {agent.changes.length}</span><span>{agent.approvedChanges.length} approved</span></div>
                        <div className="mb-3 h-1 overflow-hidden rounded bg-neutral-800"><div className="h-full bg-violet-500 transition-all" style={{ width: `${((agent.currentIndex + 1) / Math.max(agent.changes.length, 1)) * 100}%` }} /></div>
                        {agent.summary && <p className="mb-3 text-[11px] text-neutral-400">{agent.summary}</p>}
                        <AgentApprovalCard change={agent.currentChange} busy={agent.status === "replanning"} onApprove={() => void agent.approveCurrent()} onReject={() => void agent.rejectCurrent()} />
                        {agent.status === "replanning" && <div role="status" className="mt-2 text-center text-[11px] text-violet-300">Re-planning around approved changes…</div>}
                        {agent.error && <div role="alert" className="mt-2 rounded-lg bg-red-950/50 p-2 text-[11px] text-red-300">{agent.error} You can retry this decision.</div>}
                    </>
                ) : (
                    <>
                        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Choose a mode</div>
                        <div className="space-y-2">
                            {MODES.map((mode) => <button key={mode.id} type="button" onClick={() => agent.selectMode(mode.id)} className={`w-full rounded-xl border p-3 text-left transition-colors ${agent.mode === mode.id ? "border-violet-500 bg-violet-500/10" : "border-neutral-800 bg-neutral-900 hover:border-neutral-700"}`}><div className="font-medium text-neutral-100">{mode.label}</div><div className="mt-0.5 text-[10px] text-neutral-500">{mode.description}</div></button>)}
                        </div>
                        {agent.mode && <p role="status" className="mt-3 rounded-lg bg-neutral-900 p-2 text-[11px] text-neutral-400">{MODES.find((mode) => mode.id === agent.mode)?.label} selected. The workflow will present each proposed change here for approval.</p>}
                    </>
                )}

                {agent.showRevert && (
                    <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                        <div className="flex items-start gap-2"><RotateCcw size={15} className="mt-0.5 text-amber-300" /><div className="flex-1"><div className="font-medium text-amber-100">Review complete</div><p className="mt-0.5 text-[10px] text-amber-200/70">Approved changes are saved. You can restore the pre-workflow snapshot.</p></div><button type="button" onClick={agent.dismissRevert} aria-label="Dismiss revert banner" className="text-amber-200/60 hover:text-amber-100"><X size={14} /></button></div>
                        {confirmationToken && <p role="alert" className="mt-2 text-[10px] text-amber-200">{conflictCount} task {conflictCount === 1 ? "has" : "have"} changed since the snapshot. Confirm to overwrite those edits.</p>}
                        <button type="button" onClick={handleRevert} className="mt-2 rounded-lg border border-amber-400/30 px-2.5 py-1.5 text-[11px] text-amber-100 hover:bg-amber-400/10">{confirmationToken ? "Confirm revert" : "Revert agent changes"}</button>
                    </div>
                )}
                {revertMessage && <div role="status" className="mt-2 text-[11px] text-neutral-300">{revertMessage}</div>}
            </div>
        </section>
    );
};
