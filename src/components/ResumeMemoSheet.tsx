import { useEffect, useId, useRef, useState } from "react";
import type { ResumeNote } from "../lib/resume";

export interface ResumeMemoSheetProps {
    mode: "leave" | "switch";
    outgoing: { taskId: string; taskName: string; memo: ResumeNote | null; alreadyCaptured: boolean };
    incoming?: { taskId: string; taskName: string; memo: ResumeNote | null };
    onSave: (taskId: string, input: { whereIAm: string; nextAction: string; blocker?: string }) => Promise<void>;
    onDismiss: () => void;
    error?: string | null;
}

export function ResumeMemoSheet({ mode, outgoing, incoming, onSave, onDismiss, error }: ResumeMemoSheetProps) {
    const headingId = useId();
    const dialogRef = useRef<HTMLDivElement>(null);
    const closeRef = useRef(onDismiss);
    closeRef.current = onDismiss;
    const [editing, setEditing] = useState(mode !== "switch" || !outgoing.alreadyCaptured);
    const [whereIAm, setWhereIAm] = useState(outgoing.memo?.whereIAm ?? "");
    const [nextAction, setNextAction] = useState(outgoing.memo?.nextAction ?? "");
    const [blocker, setBlocker] = useState(outgoing.memo?.blocker ?? "");
    const [pending, setPending] = useState(false);
    const submitting = useRef(false);
    useEffect(() => {
        const invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const dialog = dialogRef.current;
        dialog?.focus();
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") { event.preventDefault(); closeRef.current(); }
            if (event.key !== "Tab" || !dialog) return;
            const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]), input:not(:disabled), [tabindex="0"]'));
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
                event.preventDefault(); last?.focus();
            } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
                event.preventDefault(); first?.focus();
            }
        };
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("keydown", onKey);
            if (invoker?.isConnected) invoker.focus();
        };
    }, []);

    const submit = async () => {
        if (submitting.current) return;
        submitting.current = true;
        setPending(true);
        try { await onSave(outgoing.taskId, { whereIAm, nextAction, blocker }); }
        finally { submitting.current = false; setPending(false); }
    };
    const memoText = (memo: ResumeNote) => <dl className="space-y-2 break-words">
        <div><dt className="text-neutral-400">Where I am</dt><dd>{memo.whereIAm}</dd></div>
        <div><dt className="text-neutral-400">Next action</dt><dd>{memo.nextAction}</dd></div>
        {memo.blocker && <div><dt className="text-neutral-400">Open question or blocker (optional)</dt><dd>{memo.blocker}</dd></div>}
    </dl>;
    return <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={headingId}
        className="fixed inset-0 z-50 flex min-w-0 items-center justify-center p-4"
        onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing && !editing && event.target === event.currentTarget) {
                event.preventDefault(); onDismiss();
            }
        }}>
        <button type="button" tabIndex={-1} aria-label="Close resume memo backdrop" className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onDismiss} />
        <div className="app-scrollbar relative z-10 max-h-[85vh] w-full min-w-0 max-w-xl overflow-y-auto rounded-2xl border border-neutral-700 bg-neutral-950 p-5 text-neutral-200 shadow-2xl">
            <h2 id={headingId} className="mb-4 break-words text-lg font-semibold">What were you doing in {outgoing.taskName}?</h2>
            {editing ? <form onSubmit={(event) => { event.preventDefault(); void submit(); }} className="min-w-0 space-y-3">
                {([
                    ["Where I am", whereIAm, setWhereIAm],
                    ["Next action", nextAction, setNextAction],
                    ["Open question or blocker (optional)", blocker, setBlocker],
                ] as const).map(([label, value, setValue], index) => <label key={label} htmlFor={`${headingId}-${index}`} className="block text-sm">
                    {label}
                    <input id={`${headingId}-${index}`} type="text" value={value}
                        onChange={(event) => setValue(Array.from(event.target.value).slice(0, 140).join(""))}
                        onKeyDown={(event) => {
                            if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); }
                        }}
                        className="mt-1 block w-full min-w-0 rounded border border-neutral-600 bg-neutral-900 px-3 py-2" />
                </label>)}
                {error && <p className="text-sm text-red-300">{error}</p>}
                <div className="flex flex-wrap gap-2">
                    <button type="submit" disabled={pending} className="rounded bg-indigo-600 px-3 py-2 disabled:opacity-50">{pending ? "Saving…" : "Save note"}</button>
                    <button type="button" onClick={onDismiss} className="rounded border border-neutral-600 px-3 py-2">Skip</button>
                </div>
            </form> : <section aria-label={`${outgoing.taskName} saved note`}>
                {outgoing.memo && memoText(outgoing.memo)}
                <div className="mt-3 flex gap-2">
                    <button type="button" onClick={() => setEditing(true)} className="rounded border border-neutral-600 px-3 py-2">Edit</button>
                    <button type="button" onClick={onDismiss} className="rounded bg-indigo-600 px-3 py-2">Continue</button>
                </div>
            </section>}
            {mode === "switch" && incoming && <section aria-label={`${incoming.taskName} incoming note`} className="mt-5 min-w-0 border-t border-neutral-700 pt-4">
                <h3 className="mb-2 break-words font-semibold">{incoming.taskName}</h3>
                {incoming.memo ? memoText(incoming.memo) : <p>Starting fresh — no note yet.</p>}
            </section>}
        </div>
    </div>;
}
