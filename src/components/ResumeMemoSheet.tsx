import { useEffect, useId, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import type { ResumeNote } from "../lib/resume";

/** Solid action: keeps white text in both themes because the indigo fill is absolute. */
const PRIMARY_BUTTON = "inline-flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm ring-1 ring-inset ring-white/10 transition-colors hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 active:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60";
const SECONDARY_BUTTON = "inline-flex items-center justify-center rounded-lg border border-neutral-600 bg-neutral-900 px-4 py-2 text-sm font-medium text-neutral-200 transition-colors hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300";

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
        {memo.whereIAm && <div><dt className="text-neutral-400">Where I am</dt><dd>{memo.whereIAm}</dd></div>}
        {memo.nextAction && <div><dt className="text-neutral-400">Next action</dt><dd>{memo.nextAction}</dd></div>}
        {memo.blocker && <div><dt className="text-neutral-400">Open question or blocker (optional)</dt><dd>{memo.blocker}</dd></div>}
    </dl>;
    return <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={headingId}
        className="fixed inset-0 z-50 flex min-w-0 items-center justify-center p-4"
        onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing && !editing && event.target === event.currentTarget) {
                event.preventDefault(); onDismiss();
            }
        }}>
        <button type="button" tabIndex={-1} aria-label="Skip note" className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onDismiss} />
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
                    <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
                        {pending ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Check aria-hidden="true" className="h-4 w-4" />}
                        {pending ? "Saving…" : "Save note"}
                    </button>
                    <button type="button" onClick={onDismiss} className={SECONDARY_BUTTON}>Skip</button>
                </div>
            </form> : <section aria-label={`${outgoing.taskName} saved note`}>
                {outgoing.memo && memoText(outgoing.memo)}
                <div className="mt-3 flex gap-2">
                    <button type="button" onClick={() => setEditing(true)} className={SECONDARY_BUTTON}>Edit</button>
                    <button type="button" onClick={onDismiss} className={PRIMARY_BUTTON}>Continue</button>
                </div>
            </section>}
            {mode === "switch" && incoming && <section aria-label={`${incoming.taskName} incoming note`} className="mt-5 min-w-0 border-t border-neutral-700 pt-4">
                <h3 className="mb-2 break-words font-semibold">{incoming.taskName}</h3>
                {incoming.memo ? memoText(incoming.memo) : <p>Starting fresh — no note yet.</p>}
            </section>}
        </div>
    </div>;
}
