import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActiveTimer, Habit, HabitCompletion, PomodoroLogEntry, Settings, Task } from "../../state/types";
import { DataAccessAuthError } from "./DataAccess";
import type { PendingTimerCompletion, SyncSnapshot, TimerStateSlice } from "./staging/types";
import type { PushPlan, SyncRemote } from "./sync/types";
import { completionRpcPayload } from "./sync/timerCompletions";

const PAGE_SIZE = 500;
type JsonRecord = Record<string, unknown>;

function clone<T>(value: T): T {
    return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function isRecord(value: unknown): value is JsonRecord {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function isSettings(value: unknown): value is Settings {
    return (
        isRecord(value) &&
        typeof value.work_minutes === "number" &&
        typeof value.short_break_minutes === "number" &&
        typeof value.long_break_minutes === "number" &&
        typeof value.segment_length === "number"
    );
}

/**
 * Serializes a task into the JSON row shape the staged-sync RPCs expect. The
 * RPCs derive the owner from the caller's JWT and ignore `owner_id`, but it is
 * kept for parity with the legacy row shape. `updated_at` is optional so
 * `complete_timer` keeps its existing now()-default behavior while
 * `apply_staged_sync` task upserts author their exact LWW timestamp.
 */
function taskRow(ownerId: string, task: Task, updatedAt?: string) {
    return {
        owner_id: ownerId,
        id: task.id,
        name: task.name,
        target_pomodoros: task.target_pomodoros,
        completed_pomodoros: task.completed_pomodoros,
        created_at: task.created_at,
        completed_at: task.completed_at,
        break_skips: task.break_skips,
        archived: task.archived,
        updated_at: updatedAt,
    };
}

/**
 * Serializes a habit into the JSON row shape the staged-sync RPC expects. The
 * RPC derives the owner from the caller's JWT and never accepts one. `updated_at`
 * is the transport LWW stamp from the push-plan wrapper; the domain `updatedAt`
 * is used only when no wrapper stamp is supplied.
 */
function habitRow(habit: Habit, updatedAt?: string) {
    return {
        id: habit.id,
        name: habit.name,
        description: habit.description,
        color: habit.color,
        frequency: habit.frequency,
        position: habit.position,
        is_archived: habit.isArchived,
        created_at: habit.createdAt,
        updated_at: updatedAt ?? habit.updatedAt,
    };
}

/**
 * Serializes a habit completion into the JSON row shape the staged-sync RPC
 * expects, mapping the domain `habitId` to the `habit_id` column.
 */
function habitCompletionRow(completion: HabitCompletion) {
    return {
        id: completion.id,
        habit_id: completion.habitId,
        bucket: completion.bucket,
        created_at: completion.createdAt,
        updated_at: completion.updatedAt,
    };
}

/**
 * Authenticated, paginated remote transport used only by the sync coordinator.
 * It no longer owns per-interaction application state: `pull` returns a complete
 * versioned snapshot, timer completions replay through the existing CAS RPCs,
 * ordinary staged changes push through `apply_staged_sync`, and expired
 * sessions refresh explicitly. Every method verifies that the current session
 * belongs to `expectedOwnerId` before touching any table.
 */
export class SupabaseDataAccess implements SyncRemote {
    private readonly client: SupabaseClient;

    constructor(client: SupabaseClient) {
        this.client = client;
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

    /**
     * The session is the transport's auth source; `expectedOwnerId` is a
     * verification value, never forwarded to an RPC/DML owner input. A missing
     * session (even without an SDK error) and an owner mismatch are both hard
     * auth failures the coordinator must surface or retry.
     */
    private async requireSessionOwner(expectedOwnerId: string): Promise<string> {
        const { data, error } = await this.client.auth.getSession();
        if (error) this.fail("auth", error);
        const id = data.session?.user?.id;
        if (!id) throw new DataAccessAuthError("DATA_ACCESS_NO_SESSION");
        if (id !== expectedOwnerId) throw new DataAccessAuthError("DATA_ACCESS_OWNER_MISMATCH");
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
        if (
            !row ||
            typeof row.id !== "string" ||
            typeof row.name !== "string" ||
            typeof row.created_at !== "string" ||
            typeof row.updated_at !== "string"
        ) {
            this.fail("tasks", new Error(`invalid task row for ${row?.id ?? "unknown"}`));
        }
        return {
            id: row.id, name: row.name, target_pomodoros: Number(row.target_pomodoros), completed_pomodoros: Number(row.completed_pomodoros),
            created_at: row.created_at, completed_at: row.completed_at ?? null, break_skips: Number(row.break_skips), archived: Boolean(row.archived),
        };
    }

    private validateLog(row: any): PomodoroLogEntry {
        if (!row || typeof row.id !== "string" || typeof row.task_id !== "string" || typeof row.finished_at !== "string") {
            this.fail("pomodoro_logs", new Error(`invalid log row for ${row?.id ?? "unknown"}`));
        }
        return {
            id: row.id, task_id: row.task_id, duration_minutes: Number(row.duration_minutes), finished_at: row.finished_at,
            was_break: Boolean(row.was_break), break_skipped: Boolean(row.break_skipped),
        };
    }

    private validateHabit(row: any): Habit {
        if (
            !row ||
            typeof row.id !== "string" ||
            typeof row.name !== "string" ||
            typeof row.description !== "string" ||
            typeof row.color !== "string" ||
            !["daily", "weekly", "monthly"].includes(String(row.frequency)) ||
            typeof row.position !== "number" ||
            typeof row.is_archived !== "boolean" ||
            typeof row.created_at !== "string" ||
            typeof row.updated_at !== "string"
        ) {
            this.fail("habits", new Error(`invalid habit row for ${row?.id ?? "unknown"}`));
        }
        return {
            id: row.id,
            name: row.name,
            description: row.description,
            color: row.color,
            frequency: row.frequency,
            position: row.position,
            isArchived: row.is_archived,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }

    private validateHabitCompletion(row: any): HabitCompletion {
        if (
            !row ||
            typeof row.id !== "string" ||
            typeof row.habit_id !== "string" ||
            typeof row.bucket !== "string" ||
            typeof row.created_at !== "string" ||
            typeof row.updated_at !== "string"
        ) {
            this.fail("habit_completions", new Error(`invalid completion row for ${row?.id ?? "unknown"}`));
        }
        return {
            id: row.id,
            habitId: row.habit_id,
            bucket: row.bucket,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }

    private validateTimer(value: unknown): ActiveTimer | null {
        if (value === null || value === undefined) return null;
        if (!isRecord(value) || typeof value.task_id !== "string" || typeof value.started_at !== "string" || typeof value.ends_at !== "string" || !["Work", "ShortBreak", "LongBreak"].includes(String(value.kind))) {
            this.fail("timer_state", new Error("invalid timer JSON"));
        }
        return clone(value) as unknown as ActiveTimer;
    }

    private validateTimerSlice(raw: unknown): TimerStateSlice {
        if (!isRecord(raw)) this.fail("timer_state", new Error("invalid timer JSON"));
        return {
            active_task: typeof raw.active_task === "string" ? raw.active_task : null,
            current_cycle_pomodoros: typeof raw.current_cycle_pomodoros === "number" ? raw.current_cycle_pomodoros : 0,
            timer: this.validateTimer(raw.timer ?? null),
        };
    }

    // ---- SyncRemote transport ---------------------------------------------

    async pull(expectedOwnerId: string): Promise<SyncSnapshot> {
        const ownerId = await this.requireSessionOwner(expectedOwnerId);

        const [taskRows, logRows, habitRows, completionRows, settingsResponse, timerResponse, pmResponse] = await Promise.all([
            this.page("tasks", ownerId, [{ column: "id" }]),
            this.page("pomodoro_logs", ownerId, [{ column: "finished_at" }, { column: "id" }]),
            this.page("habits", ownerId, [{ column: "id" }]),
            this.page("habit_completions", ownerId, [{ column: "habit_id" }, { column: "bucket" }, { column: "id" }]),
            this.client.from("settings").select("data, updated_at").eq("owner_id", ownerId).maybeSingle(),
            this.client.from("timer_state").select("data, completed, updated_at").eq("owner_id", ownerId).maybeSingle(),
            this.client.from("pm_state").select("data, updated_at").eq("owner_id", ownerId).maybeSingle(),
        ]);
        if (settingsResponse.error) this.fail("settings", settingsResponse.error);
        if (timerResponse.error) this.fail("timer_state", timerResponse.error);
        if (pmResponse.error) this.fail("pm_state", pmResponse.error);

        const tasks: SyncSnapshot["tasks"] = {};
        for (const row of taskRows) {
            const task = this.validateTask(row);
            tasks[row.id] = { value: task, updatedAt: row.updated_at };
        }

        const logs: SyncSnapshot["logs"] = {};
        for (const row of logRows) {
            const log = this.validateLog(row);
            logs[row.id] = log;
        }

        const habits: SyncSnapshot["habits"] = {};
        for (const row of habitRows) {
            const habit = this.validateHabit(row);
            habits[row.id] = { value: habit, updatedAt: row.updated_at };
        }

        const habitCompletions: SyncSnapshot["habitCompletions"] = {};
        for (const row of completionRows) {
            const completion = this.validateHabitCompletion(row);
            habitCompletions[row.id] = completion;
        }

        const settingsData = settingsResponse.data?.data;
        if (settingsData !== undefined && !isSettings(settingsData)) {
            this.fail("settings", new Error(`invalid settings row for ${ownerId}`));
        }
        const timerData = timerResponse.data?.data;
        const timerSlice = timerResponse.data ? this.validateTimerSlice(timerData) : null;
        const pmData = pmResponse.data?.data;
        if (pmData !== undefined && !isRecord(pmData)) {
            this.fail("pm_state", new Error(`invalid PM row for ${ownerId}`));
        }

        // Absent singleton rows stay `{ value: null, updatedAt: null }` so the
        // merge engine can distinguish "never existed" from default app values.
        const snapshot: SyncSnapshot = {
            tasks,
            logs,
            habits,
            habitCompletions,
            settings: {
                value: settingsResponse.data ? clone(settingsData) : null,
                updatedAt: settingsResponse.data?.updated_at ?? null,
            },
            timerState: {
                value: timerSlice,
                updatedAt: timerResponse.data?.updated_at ?? null,
                completed: Boolean(timerResponse.data?.completed ?? false),
            },
            pmState: {
                value: pmResponse.data ? clone(pmData) : null,
                updatedAt: pmResponse.data?.updated_at ?? null,
            },
        };
        return clone(snapshot);
    }

    /**
     * Prepares a local-only timer generation for its later CAS replay: persists
     * only the timer slice through the `persist_transition` signature with
     * `p_timer_new_generation=true`, which also resets the server-side
     * completion guard to false. The client completion timestamp LWW-gates the
     * upsert so the install can never overwrite a timer row another tab started
     * after this client's pull.
     */
    async installTimerGeneration(expectedOwnerId: string, entry: PendingTimerCompletion): Promise<void> {
        await this.requireSessionOwner(expectedOwnerId);
        const response = await this.client.rpc("persist_transition", {
            p_tasks: null,
            p_logs: null,
            p_settings: null,
            p_timer_data: clone(entry.expectedTimerState),
            p_timer_new_generation: true,
            p_timer_updated_at: entry.completedAt,
        });
        if (response.error) this.fail("persist_transition", response.error);
    }

    private async completeTimerRpc(ownerId: string, entry: PendingTimerCompletion): Promise<boolean> {
        // The journal's exact expected timer, result timer slice, client-ID
        // log, and changed task map to the unchanged complete_timer signature.
        // The task row carries the client-authored completion timestamp so the
        // server's LWW gate can reject the write when another client updated
        // the task after the local completion was journaled (a delayed offline
        // completion must never erase a newer rename/target/archive edit).
        const payload = completionRpcPayload(entry);
        const response = await this.client.rpc("complete_timer", {
            p_expected_timer: payload.p_expected_timer,
            p_timer_data: payload.p_timer_data,
            p_log: payload.p_log,
            p_task: payload.p_task ? taskRow(ownerId, payload.p_task, entry.completedAt) : null,
        });
        if (response.error) this.fail("complete_timer", response.error);
        return response.data?.[0]?.applied === true;
    }

    /**
     * Replays one journaled completion through the CAS. Returns the RPC's
     * boolean `applied` result so the coordinator can run the winner or loser
     * reconciliation.
     */
    async completeTimer(expectedOwnerId: string, entry: PendingTimerCompletion): Promise<boolean> {
        const ownerId = await this.requireSessionOwner(expectedOwnerId);
        return this.completeTimerRpc(ownerId, entry);
    }

    /**
     * Converts a `PushPlan` into `apply_staged_sync` parameter names exactly.
     * Unchanged singletons are sent as null, empty entity arrays are sent as
     * null, and the full wipe is one request (never split across requests).
     * Unresolved completion-derived rows never appear here: `buildPushPlan`
     * already masks them, and the transport adds nothing to the plan.
     */
    async push(expectedOwnerId: string, plan: PushPlan): Promise<void> {
        const ownerId = await this.requireSessionOwner(expectedOwnerId);
        const response = await this.client.rpc("apply_staged_sync", {
            p_task_upserts: plan.taskUpserts.length
                ? plan.taskUpserts.map(({ value, updatedAt }) => taskRow(ownerId, value, updatedAt))
                : null,
            p_task_tombstones: plan.taskTombstones.length
                ? plan.taskTombstones.map(({ id, deletedAt }) => ({ id, deleted_at: deletedAt }))
                : null,
            p_log_upserts: plan.logUpserts.length ? plan.logUpserts.map((log) => ({ ...log })) : null,
            p_log_tombstones: plan.logTombstones.length
                ? plan.logTombstones.map(({ id, deletedAt }) => ({ id, deleted_at: deletedAt }))
                : null,
            p_habit_upserts: plan.habitUpserts.length
                ? plan.habitUpserts.map(({ value, updatedAt }) => habitRow(value, updatedAt))
                : null,
            p_habit_tombstones: plan.habitTombstones.length
                ? plan.habitTombstones.map(({ id, deletedAt }) => ({ id, deleted_at: deletedAt }))
                : null,
            p_habit_completion_upserts: plan.habitCompletionUpserts.length
                ? plan.habitCompletionUpserts.map(habitCompletionRow)
                : null,
            p_habit_completion_tombstones: plan.habitCompletionTombstones.length
                ? plan.habitCompletionTombstones.map(({ id, deletedAt }) => ({ id, deleted_at: deletedAt }))
                : null,
            p_settings_data: plan.settings?.value ?? null,
            p_settings_updated_at: plan.settings?.updatedAt ?? null,
            p_timer_data: plan.timerState?.value ?? null,
            p_timer_updated_at: plan.timerState?.updatedAt ?? null,
            p_timer_new_generation: plan.timerState?.newGeneration ?? false,
            p_pm_data: plan.pmState?.value ?? null,
            p_pm_updated_at: plan.pmState?.updatedAt ?? null,
            p_full_wipe: plan.fullWipe,
        });
        if (response.error) this.fail("apply_staged_sync", response.error);
    }

    /**
     * Refreshes the GoTrue session explicitly and verifies the refreshed
     * session still belongs to the same owner. A refreshed session belonging to
     * another user must never access or overwrite the original owner's local
     * record, so a mismatch throws instead of returning.
     */
    async refreshSession(expectedOwnerId: string): Promise<void> {
        const { data, error } = await this.client.auth.refreshSession();
        if (error) {
            throw new DataAccessAuthError("DATA_ACCESS_REFRESH_FAILED");
        }
        const id = data.session?.user?.id;
        if (!id) {
            throw new DataAccessAuthError("DATA_ACCESS_REFRESH_FAILED");
        }
        if (id !== expectedOwnerId) {
            throw new DataAccessAuthError("DATA_ACCESS_OWNER_MISMATCH");
        }
    }
}
