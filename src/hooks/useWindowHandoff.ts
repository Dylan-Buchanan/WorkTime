import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAppState } from "../state/AppStateContext";
import { usePM } from "../state/ProjectManagerContext";

/** Observe the existing linker; all timer commands use the latest contexts. */
export function useWindowHandoff(onSuccess: () => void) {
    const app = useAppState();
    const pm = usePM();
    const current = useRef({ app, pm, onSuccess });
    useLayoutEffect(() => { current.current = { app, pm, onSuccess }; });
    const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
    const [linkErrors, setLinkErrors] = useState<Record<string, string>>({});
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const operation = useRef(0);
    const joining = useRef(false);
    const pendingId = useRef<string | null>(null);

    const cancel = () => {
        operation.current += 1;
        pendingId.current = null;
        joining.current = false;
        setBusyTaskId(null);
        setError(null);
        setNotice(null);
        setLinkErrors({});
    };
    useEffect(() => () => { operation.current += 1; }, []);

    const join = async (id: string, token: number) => {
        const task = current.current.pm.state.tasks[id];
        if (!task?.appTaskId || joining.current) return;
        joining.current = true;
        pendingId.current = null;
        try {
            const { app: latest } = current.current;
            if (!latest.state) throw new Error("Timer state is still loading. Try again.");
            if (latest.state.timer && latest.state.timer.kind !== "Work") {
                await latest.setActiveTask(task.appTaskId);
                if (operation.current === token) setNotice(`${task.title} is lined up for the next focus window.`);
            } else {
                if (latest.state.timer?.paused) await latest.resumeTimer();
                // Closing during an awaited resume cancels the pending choice.
                if (operation.current !== token) return;
                await current.current.app.startTaskWork(task.appTaskId);
                if (operation.current === token) current.current.onSuccess();
            }
        } catch (err) {
            if (operation.current === token) setError(err instanceof Error ? err.message : String(err));
        } finally {
            if (operation.current === token) {
                joining.current = false;
                setBusyTaskId(null);
            }
        }
    };
    const select = (id: string) => {
        if (pendingId.current || joining.current) return;
        const token = ++operation.current;
        setError(null);
        setNotice(null);
        setBusyTaskId(id);
        if (current.current.pm.state.tasks[id]?.appTaskId) void join(id, token);
        else pendingId.current = id;
    };
    // No polling: linkage and failures arrive through the PM context.
    useEffect(() => {
        if (!busyTaskId || pendingId.current !== busyTaskId) return;
        const failure = pm.linkFailures[busyTaskId];
        if (failure !== undefined) {
            pendingId.current = null;
            setBusyTaskId(null);
        } else if (pm.state.tasks[busyTaskId]?.appTaskId) {
            void join(busyTaskId, operation.current);
        }
    });
    useEffect(() => {
        if (!busyTaskId) return;
        const id = busyTaskId;
        const timeout = window.setTimeout(() => {
            if (pendingId.current !== id) return;
            pendingId.current = null;
            operation.current += 1;
            setLinkErrors((prev) => ({ ...prev, [id]: "Preparing this task timed out after 15 seconds. Please retry." }));
            setBusyTaskId(null);
        }, 15_000);
        return () => window.clearTimeout(timeout);
    }, [busyTaskId]);

    return {
        busyTaskId, error, notice, select, cancel,
        linkErrorOf: (id: string) => linkErrors[id] ?? pm.linkFailures[id],
        linkStateOf: (id: string): "ready" | "preparing" | "failed" => {
            if (linkErrors[id] !== undefined || pm.linkFailures[id] !== undefined) return "failed";
            return pm.state.tasks[id]?.appTaskId ? "ready" : "preparing";
        },
        retry: (id: string) => {
            setLinkErrors((prev) => { const next = { ...prev }; delete next[id]; return next; });
            pm.retryLink(id);
            select(id);
        },
    };
}
