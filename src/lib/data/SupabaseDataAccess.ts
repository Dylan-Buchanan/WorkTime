import type { SupabaseClient } from "@supabase/supabase-js";
import {
    DEFAULT_SETTINGS,
    cloneAppState,
    createTask,
    finalizeTask,
    getState,
    resetAppState,
    setActiveTask,
    setTaskTarget,
    startBreakTimer,
    startWorkTimer,
    stopWorkTimer,
    updateSettings,
    completeTimer as engineCompleteTimer,
    pauseTimer,
    resumeTimer,
    skipBreak,
} from "../engine";
import type { ActiveTimer, AppStateData, PomodoroLogEntry, Settings, Task } from "../../state/types";
import { DataAccessAuthError, type CompleteTimerResult, type DataAccess, type FetchStateResult, type SyncedPMState } from "./DataAccess";

const PAGE_SIZE = 500;
type JsonRecord = Record<string, unknown>;

function clone<T>(value: T): T {
    return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function equal(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

function isRecord(value: unknown): value is JsonRecord {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function timerSlice(state: AppStateData) {
    return { active_task: state.active_task, current_cycle_pomodoros: state.current_cycle_pomodoros, timer: state.timer };
}

function taskRow(ownerId: string, task: Task) {
    return { owner_id: ownerId, id: task.id, name: task.name, target_pomodoros: task.target_pomodoros, completed_pomodoros: task.completed_pomodoros, created_at: task.created_at, completed_at: task.completed_at, break_skips: task.break_skips, archived: task.archived };
}

interface Hydrated {
    state: AppStateData;
    completed: boolean;
    rawTimer: unknown;
}

export interface SupabaseDataAccessOptions {
    now?: () => Date;
    createTaskId?: () => string;
}

export class SupabaseDataAccess implements DataAccess {
    private readonly client: SupabaseClient;
    private readonly now: () => Date;
    private readonly createTaskId: () => string;

    constructor(client: SupabaseClient, options: SupabaseDataAccessOptions = {}) {
        this.client = client;
        this.now = options.now ?? (() => new Date());
        this.createTaskId = options.createTaskId ?? (() => {
            try { return globalThis.crypto.randomUUID(); } catch { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
        });
    }

    private fail(table: string, error: unknown): never {
        let message = error instanceof Error ? error.message : String(error);
        if (!(error instanceof Error) && isRecord(error) && typeof error.message === "string") {
            message = error.message;
        }
        const parts: string[] = [];
        if (isRecord(error)) {
            if (typeof error.code === "string" && error.code) parts.push(`code=${error.code}`);
            if (typeof error.details === "string" && error.details) parts.push(`details=${error.details}`);
            if (typeof error.hint === "string" && error.hint) parts.push(`hint=${error.hint}`);
        }
        const suffix = parts.length ? ` (${parts.join(", ")})` : "";
        throw new Error(`Supabase ${table} query failed: ${message}${suffix}`);
    }

    private async ownerId(): Promise<string> {
        const { data, error } = await this.client.auth.getSession();
        if (error) this.fail("auth", error);
        const id = data.session?.user?.id;
        if (!id) throw new DataAccessAuthError();
        return id;
    }

    private async page(table: string, ownerId: string, order: Array<{ column: string; ascending?: boolean }>): Promise<any[]> {
        const rows: any[] = [];
        for (let from = 0; ; from += PAGE_SIZE) {
            let query: any = this.client.from(table).select("*").eq("owner_id", ownerId);
            for (const item of order) query = query.order(item.column, { ascending: item.ascending ?? true });
            const response = await query.range(from, from + PAGE_SIZE - 1);
            if (response.error) this.fail(table, response.error);
            const chunk = response.data ?? [];
            rows.push(...chunk);
            if (chunk.length < PAGE_SIZE) return rows;
        }
    }

    private validateTask(row: any): Task {
        if (!row || typeof row.id !== "string" || typeof row.name !== "string" || typeof row.created_at !== "string") this.fail("tasks", new Error(`invalid task row for ${row?.id ?? "unknown"}`));
        return {
            id: row.id, name: row.name, target_pomodoros: Number(row.target_pomodoros), completed_pomodoros: Number(row.completed_pomodoros),
            created_at: row.created_at, completed_at: row.completed_at ?? null, break_skips: Number(row.break_skips), archived: Boolean(row.archived),
        };
    }

    private validateTimer(value: unknown): ActiveTimer | null {
        if (value === null || value === undefined) return null;
        if (!isRecord(value) || typeof value.task_id !== "string" || typeof value.started_at !== "string" || typeof value.ends_at !== "string" || !["Work", "ShortBreak", "LongBreak"].includes(String(value.kind))) {
            this.fail("timer_state", new Error("invalid timer JSON"));
        }
        return clone(value) as unknown as ActiveTimer;
    }

    private async hydrate(ownerId: string): Promise<Hydrated> {
        const [taskRows, logRows] = await Promise.all([
            this.page("tasks", ownerId, [{ column: "id" }]),
            this.page("pomodoro_logs", ownerId, [{ column: "finished_at" }, { column: "id" }]),
        ]);
        const tasks: Record<string, Task> = {};
        for (const row of taskRows) tasks[row.id] = this.validateTask(row);
        const logs: PomodoroLogEntry[] = logRows.map((row) => {
            if (!row || typeof row.task_id !== "string" || typeof row.finished_at !== "string") this.fail("pomodoro_logs", new Error(`invalid log row for ${row?.id ?? "unknown"}`));
            return { task_id: row.task_id, duration_minutes: Number(row.duration_minutes), finished_at: row.finished_at, was_break: Boolean(row.was_break), break_skipped: Boolean(row.break_skipped) };
        });

        const settingsResponse = await this.client.from("settings").select("data").eq("owner_id", ownerId).maybeSingle();
        if (settingsResponse.error) this.fail("settings", settingsResponse.error);
        const settings = settingsResponse.data?.data;
        if (settings !== undefined && (!isRecord(settings) || typeof settings.work_minutes !== "number" || typeof settings.short_break_minutes !== "number" || typeof settings.long_break_minutes !== "number" || typeof settings.segment_length !== "number")) this.fail("settings", new Error(`invalid settings row for ${ownerId}`));

        const timerResponse = await this.client.from("timer_state").select("data, completed").eq("owner_id", ownerId).maybeSingle();
        if (timerResponse.error) this.fail("timer_state", timerResponse.error);
        const rawData = timerResponse.data?.data;
        const timerData = isRecord(rawData) ? rawData : {};
        if (rawData !== undefined && !isRecord(rawData)) this.fail("timer_state", new Error(`invalid timer row for ${ownerId}`));
        const rawTimer = timerData.timer ?? null;
        const timer = this.validateTimer(rawTimer);
        const state: AppStateData = {
            tasks, logs, settings: clone((settings as Settings | undefined) ?? DEFAULT_SETTINGS),
            active_task: typeof timerData.active_task === "string" ? timerData.active_task : null,
            current_cycle_pomodoros: typeof timerData.current_cycle_pomodoros === "number" ? timerData.current_cycle_pomodoros : 0,
            timer,
        };
        const maintained = getState(state);
        if (maintained.value) await this.persistTransition(ownerId, state, maintained.state);
        return { state: maintained.state, completed: Boolean(timerResponse.data?.completed ?? false), rawTimer: clone(rawTimer) };
    }

    private async persistTransition(ownerId: string, before: AppStateData, after: AppStateData, newTimerGeneration = false): Promise<void> {
        const changedTasks = Object.values(after.tasks).filter((task) => !before.tasks[task.id] || !equal(before.tasks[task.id], task));
        const newLogs = after.logs.slice(before.logs.length);
        const settingsChanged = !equal(before.settings, after.settings);
        const timerChanged = !equal(timerSlice(before), timerSlice(after)) || newTimerGeneration;
        // The task, log, settings, and timer writes commit in one SQL transaction
        // (persist_transition RPC), so a partial failure cannot leave progress
        // applied against a still-active timer and be double-applied on retry.
        const response = await this.client.rpc("persist_transition", {
            p_tasks: changedTasks.length ? changedTasks.map((task) => taskRow(ownerId, task)) : null,
            p_logs: newLogs.length ? newLogs.map((log) => ({ ...log })) : null,
            p_settings: settingsChanged ? after.settings : null,
            p_timer_data: timerChanged ? timerSlice(after) : null,
            p_timer_new_generation: newTimerGeneration,
        });
        if (response.error) this.fail("persist_transition", response.error);
    }

    private async transition<T>(ownerId: string, command: (state: AppStateData) => { state: AppStateData; value: T }, newTimerGeneration = false) {
        const before = await this.hydrate(ownerId);
        const result = command(before.state);
        await this.persistTransition(ownerId, before.state, result.state, newTimerGeneration);
        return { state: cloneAppState(result.state), value: clone(result.value) };
    }

    async fetchState(): Promise<FetchStateResult> {
        const ownerId = await this.ownerId();
        const loaded = await this.hydrate(ownerId);
        const timer = loaded.state.timer;
        if (timer && !timer.paused && new Date(timer.ends_at).getTime() <= this.now().getTime() && !loaded.completed) {
            const completion = await this.completeHydrated(ownerId, loaded, timer);
            return {
                state: cloneAppState(completion.state), value: cloneAppState(completion.state),
                reconciledTimer: { kind: timer.kind, taskId: timer.task_id, applied: completion.applied },
            };
        }
        return { state: cloneAppState(loaded.state), value: cloneAppState(loaded.state), reconciledTimer: null };
    }

    async createTask(name: string, targetPomodoros: number) { const owner = await this.ownerId(); return this.transition(owner, (s) => createTask(s, name, targetPomodoros, this.now(), this.createTaskId())); }
    async setActiveTask(taskId: string) { const owner = await this.ownerId(); return this.transition(owner, (s) => setActiveTask(s, taskId, this.now())); }
    async startWorkTimer() { const owner = await this.ownerId(); return this.transition(owner, (s) => startWorkTimer(s, this.now()), true); }
    async startBreakTimer() { const owner = await this.ownerId(); return this.transition(owner, (s) => startBreakTimer(s, this.now()), true); }
    async stopWorkTimer() { const owner = await this.ownerId(); return this.transition(owner, (s) => stopWorkTimer(s, this.now())); }
    async pauseTimer() { const owner = await this.ownerId(); return this.transition(owner, (s) => pauseTimer(s, this.now())); }
    async resumeTimer() { const owner = await this.ownerId(); return this.transition(owner, (s) => resumeTimer(s, this.now())); }
    async skipBreak() { const owner = await this.ownerId(); return this.transition(owner, (s) => skipBreak(s, this.now())); }
    async updateSettings(settings: Settings) { const owner = await this.ownerId(); return this.transition(owner, (s) => updateSettings(s, settings)); }
    async finalizeTask(taskId: string) { const owner = await this.ownerId(); return this.transition(owner, (s) => finalizeTask(s, taskId, this.now())); }
    async setTaskTarget(taskId: string, target: number) { const owner = await this.ownerId(); return this.transition(owner, (s) => setTaskTarget(s, taskId, target)); }

    private async completeHydrated(ownerId: string, loaded: Hydrated, expectedTimer?: ActiveTimer): Promise<CompleteTimerResult> {
        if (expectedTimer && !equal(expectedTimer, loaded.state.timer)) return { state: cloneAppState(loaded.state), value: cloneAppState(loaded.state), applied: false };
        if (loaded.completed) return { state: cloneAppState(loaded.state), value: cloneAppState(loaded.state), applied: false };
        const result = engineCompleteTimer(loaded.state, this.now());
        const newLogs = result.state.logs.slice(loaded.state.logs.length);
        let changedTask: Task | null = null;
        for (const task of Object.values(result.state.tasks)) {
            if (!loaded.state.tasks[task.id] || !equal(loaded.state.tasks[task.id], task)) {
                changedTask = task;
                break;
            }
        }
        // The snapshot predicate rejects stale generations, and the timer claim,
        // log insert, and task upsert now commit in one SQL transaction
        // (complete_timer RPC). A failed downstream write rolls back the claim, so
        // a retry can win the race instead of losing the log/task updates.
        const response = await this.client.rpc("complete_timer", {
            p_expected_timer: loaded.rawTimer,
            p_timer_data: timerSlice(result.state),
            p_log: newLogs.length ? newLogs[0] : null,
            p_task: changedTask ? taskRow(ownerId, changedTask) : null,
        });
        if (response.error) this.fail("complete_timer", response.error);
        const applied = response.data?.[0]?.applied === true;
        if (!applied) {
            const latest = await this.hydrate(ownerId);
            return { state: cloneAppState(latest.state), value: cloneAppState(latest.state), applied: false };
        }
        return { state: cloneAppState(result.state), value: cloneAppState(result.state), applied: true };
    }

    async completeTimer(expectedTimer?: ActiveTimer): Promise<CompleteTimerResult> {
        const owner = await this.ownerId();
        const loaded = await this.hydrate(owner);
        return this.completeHydrated(owner, loaded, expectedTimer);
    }

    async resetAppState() {
        const owner = await this.ownerId();
        const result = resetAppState((await this.hydrate(owner)).state);
        const taskDelete = await this.client.from("tasks").delete().eq("owner_id", owner);
        if (taskDelete.error) this.fail("tasks", taskDelete.error);
        const logDelete = await this.client.from("pomodoro_logs").delete().eq("owner_id", owner);
        if (logDelete.error) this.fail("pomodoro_logs", logDelete.error);
        const settings = await this.client.from("settings").upsert({ owner_id: owner, data: result.state.settings });
        if (settings.error) this.fail("settings", settings.error);
        const timer = await this.client.from("timer_state").upsert({ owner_id: owner, data: timerSlice(result.state), completed: false });
        if (timer.error) this.fail("timer_state", timer.error);
        return { state: cloneAppState(result.state), value: cloneAppState(result.value) };
    }

    async savePMState(state: SyncedPMState): Promise<void> {
        const owner = await this.ownerId();
        const response = await this.client.from("pm_state").upsert({ owner_id: owner, data: { projects: clone(state.projects), tasks: clone(state.tasks), meta: clone(state.meta) } });
        if (response.error) this.fail("pm_state", response.error);
    }

    async loadPMState(): Promise<SyncedPMState | null> {
        const owner = await this.ownerId();
        const response = await this.client.from("pm_state").select("data").eq("owner_id", owner).maybeSingle();
        if (response.error) this.fail("pm_state", response.error);
        if (!response.data) return null;
        const data = response.data.data;
        if (!isRecord(data)) this.fail("pm_state", new Error(`invalid PM row for ${owner}`));
        return clone({ projects: data.projects, tasks: data.tasks, meta: data.meta }) as SyncedPMState;
    }
}
