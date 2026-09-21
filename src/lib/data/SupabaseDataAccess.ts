import type { SupabaseClient } from "@supabase/supabase-js";
import type {
    ActiveTimer, Habit, HabitCompletion, PetActivityRecord, PetFixation, PetNapRecord,
    PetNotableEvent, PetProfile, PetScheduleItem, PetTrainingSkill, PetWeightEntry,
    PomodoroLogEntry, Task,
} from "../../state/types";
import { DataAccessAuthError } from "./DataAccess";
import type { PendingTimerCompletion, SyncSnapshot, TimerStateSlice } from "./staging/types";
import type { PushPlan, SyncRemote } from "./sync/types";
import { completionRpcPayload } from "./sync/timerCompletions";
import { isValidRule } from "../todos";
import type { Todo, TodoCompletion, TodoRule } from "../todos";
import { parsePersistedSettings } from "../settings";

const PAGE_SIZE = 500;
type JsonRecord = Record<string, unknown>;

function clone<T>(value: T): T {
    return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function isRecord(value: unknown): value is JsonRecord {
    return !!value && typeof value === "object" && !Array.isArray(value);
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

function todoRow(todo: Todo, updatedAt?: string) {
    return {
        id: todo.id,
        title: todo.title,
        rule: todo.rule,
        due_date: todo.dueDate,
        estimate: todo.estimate,
        current_task_id: todo.currentTaskId,
        position: todo.position,
        is_archived: todo.isArchived,
        created_at: todo.createdAt,
        updated_at: updatedAt ?? todo.updatedAt,
    };
}

function todoCompletionRow(completion: TodoCompletion) {
    return { id: completion.id, todo_id: completion.todoId, bucket: completion.bucket, created_at: completion.createdAt, updated_at: completion.updatedAt };
}

function petActivityRow(value: PetActivityRecord, updatedAt: string) {
    return { id: value.id, activity_type: value.activityType, occurred_at: value.timestamp, duration_minutes: value.durationMinutes ?? null, created_at: value.createdAt, updated_at: updatedAt };
}
function petProfileRow(value: PetProfile, updatedAt: string) {
    return { id: value.id, name: value.name, birth_date: value.birthDate, created_at: value.createdAt, updated_at: updatedAt };
}
function petScheduleRow(value: PetScheduleItem, updatedAt: string) {
    return { id: value.id, activity_type: value.activityType, label: value.label, flexibility: value.flexibility, priority: value.priority, recurrence: value.recurrence, is_active: value.isActive, created_at: value.createdAt, updated_at: updatedAt };
}
function petNapRow(value: PetNapRecord, updatedAt: string) {
    return { id: value.id, started_at: value.start, ended_at: value.end, created_at: value.createdAt, updated_at: updatedAt };
}
function petWeightRow(value: PetWeightEntry, updatedAt: string) {
    return { id: value.id, measured_at: value.timestamp, weight: value.weight, created_at: value.createdAt, updated_at: updatedAt };
}
function petTrainingSkillRow(value: PetTrainingSkill, updatedAt: string) {
    return { id: value.id, label: value.label, notes: value.notes, status: value.status, resolved_at: value.resolvedAt, created_at: value.createdAt, updated_at: updatedAt };
}
function petFixationRow(value: PetFixation, updatedAt: string) {
    return { id: value.id, label: value.label, notes: value.notes, resolved_at: value.resolvedAt, resolution_note: value.resolutionNote, created_at: value.createdAt, updated_at: updatedAt };
}
function petNotableEventRow(value: PetNotableEvent, updatedAt: string) {
    return { id: value.id, title: value.title, notes: value.notes, occurred_at: value.timestamp, created_at: value.createdAt, updated_at: updatedAt };
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

    private validateTodo(row: any): Todo {
        if (
            !row || typeof row.id !== "string" || typeof row.title !== "string" ||
            (row.rule !== null && !isValidRule(row.rule as TodoRule)) ||
            (row.due_date !== null && typeof row.due_date !== "string") ||
            (row.estimate !== undefined && typeof row.estimate !== "number") ||
            (row.current_task_id !== undefined && row.current_task_id !== null && typeof row.current_task_id !== "string") ||
            typeof row.position !== "number" || typeof row.is_archived !== "boolean" ||
            typeof row.created_at !== "string" || typeof row.updated_at !== "string"
        ) {
            this.fail("todos", new Error(`invalid to-do row for ${row?.id ?? "unknown"}`));
        }
        return {
            id: row.id, title: row.title, rule: clone(row.rule), dueDate: row.due_date,
            estimate: Number.isFinite(row.estimate) ? Math.max(1, Math.trunc(row.estimate)) : 1,
            currentTaskId: typeof row.current_task_id === "string" ? row.current_task_id : null,
            position: row.position, isArchived: row.is_archived,
            createdAt: row.created_at, updatedAt: row.updated_at,
        };
    }

    private validateTodoCompletion(row: any): TodoCompletion {
        if (!row || typeof row.id !== "string" || typeof row.todo_id !== "string" || typeof row.bucket !== "string" ||
            typeof row.created_at !== "string" || typeof row.updated_at !== "string") {
            this.fail("todo_completions", new Error(`invalid to-do completion row for ${row?.id ?? "unknown"}`));
        }
        return { id: row.id, todoId: row.todo_id, bucket: row.bucket, createdAt: row.created_at, updatedAt: row.updated_at };
    }

    private validPetBase(table: string, row: any): void {
        if (!row || typeof row.id !== "string" || typeof row.created_at !== "string" || typeof row.updated_at !== "string") {
            this.fail(table, new Error(`invalid row for ${row?.id ?? "unknown"}`));
        }
    }

    private validatePetActivity(row: any): PetActivityRecord {
        this.validPetBase("pet_activity_records", row);
        if (!["potty", "training", "playtime", "feeding"].includes(row.activity_type) || typeof row.occurred_at !== "string" ||
            (row.duration_minutes !== null && (typeof row.duration_minutes !== "number" || row.duration_minutes < 0))) this.fail("pet_activity_records", new Error(`invalid row for ${row.id}`));
        return { id: row.id, activityType: row.activity_type, timestamp: row.occurred_at, ...(row.duration_minutes === null ? {} : { durationMinutes: row.duration_minutes }), createdAt: row.created_at };
    }
    private validatePetProfile(row: any): PetProfile {
        this.validPetBase("pet_profiles", row);
        if (typeof row.name !== "string" || typeof row.birth_date !== "string") this.fail("pet_profiles", new Error(`invalid row for ${row.id}`));
        return { id: row.id, name: row.name, birthDate: row.birth_date, createdAt: row.created_at, updatedAt: row.updated_at };
    }
    private validatePetSchedule(row: any): PetScheduleItem {
        this.validPetBase("pet_schedule_items", row);
        const recurrence = row.recurrence;
        const validRecurrence = isRecord(recurrence) && ((recurrence.mode === "fixed-time" && typeof recurrence.time === "string" && typeof recurrence.startMinutes === "number" && typeof recurrence.endMinutes === "number") ||
            (recurrence.mode === "interval" && typeof recurrence.minMinutes === "number" && typeof recurrence.maxMinutes === "number"));
        if (!["potty", "training", "playtime", "feeding"].includes(row.activity_type) || typeof row.label !== "string" ||
            !["fixed", "flexible"].includes(row.flexibility) || typeof row.priority !== "number" || typeof row.is_active !== "boolean" || !validRecurrence) this.fail("pet_schedule_items", new Error(`invalid row for ${row.id}`));
        return { id: row.id, activityType: row.activity_type, label: row.label, flexibility: row.flexibility, priority: row.priority, recurrence: clone(recurrence) as unknown as PetScheduleItem["recurrence"], isActive: row.is_active, createdAt: row.created_at, updatedAt: row.updated_at };
    }
    private validatePetNap(row: any): PetNapRecord {
        this.validPetBase("pet_nap_records", row);
        if (typeof row.started_at !== "string" || (row.ended_at !== null && typeof row.ended_at !== "string")) this.fail("pet_nap_records", new Error(`invalid row for ${row.id}`));
        return { id: row.id, start: row.started_at, end: row.ended_at, createdAt: row.created_at, updatedAt: row.updated_at };
    }
    private validatePetWeight(row: any): PetWeightEntry {
        this.validPetBase("pet_weight_entries", row);
        if (typeof row.measured_at !== "string" || typeof row.weight !== "number" || !Number.isFinite(row.weight)) this.fail("pet_weight_entries", new Error(`invalid row for ${row.id}`));
        return { id: row.id, timestamp: row.measured_at, weight: row.weight, createdAt: row.created_at, updatedAt: row.updated_at };
    }
    private validatePetTrainingSkill(row: any): PetTrainingSkill {
        this.validPetBase("pet_training_skills", row);
        if (typeof row.label !== "string" || typeof row.notes !== "string" || !["introduced", "progressing", "reliable"].includes(row.status) || (row.resolved_at !== null && typeof row.resolved_at !== "string")) this.fail("pet_training_skills", new Error(`invalid row for ${row.id}`));
        return { id: row.id, label: row.label, notes: row.notes, status: row.status, resolvedAt: row.resolved_at, createdAt: row.created_at, updatedAt: row.updated_at };
    }
    private validatePetFixation(row: any): PetFixation {
        this.validPetBase("pet_fixations", row);
        if (typeof row.label !== "string" || typeof row.notes !== "string" || typeof row.resolution_note !== "string" || (row.resolved_at !== null && typeof row.resolved_at !== "string")) this.fail("pet_fixations", new Error(`invalid row for ${row.id}`));
        return { id: row.id, label: row.label, notes: row.notes, resolvedAt: row.resolved_at, resolutionNote: row.resolution_note, createdAt: row.created_at, updatedAt: row.updated_at };
    }
    private validatePetNotableEvent(row: any): PetNotableEvent {
        this.validPetBase("pet_notable_events", row);
        if (typeof row.title !== "string" || typeof row.notes !== "string" || typeof row.occurred_at !== "string") this.fail("pet_notable_events", new Error(`invalid row for ${row.id}`));
        return { id: row.id, title: row.title, notes: row.notes, timestamp: row.occurred_at, createdAt: row.created_at, updatedAt: row.updated_at };
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

        const [taskRows, logRows, habitRows, completionRows, todoRows, todoCompletionRows, settingsResponse, timerResponse, pmResponse,
            petActivityRows, petProfileRows, petScheduleRows, petNapRows, petWeightRows, petTrainingRows, petFixationRows, petEventRows] = await Promise.all([
            this.page("tasks", ownerId, [{ column: "id" }]),
            this.page("pomodoro_logs", ownerId, [{ column: "finished_at" }, { column: "id" }]),
            this.page("habits", ownerId, [{ column: "id" }]),
            this.page("habit_completions", ownerId, [{ column: "habit_id" }, { column: "bucket" }, { column: "id" }]),
            this.page("todos", ownerId, [{ column: "id" }]),
            this.page("todo_completions", ownerId, [{ column: "todo_id" }, { column: "bucket" }, { column: "id" }]),
            this.client.from("settings").select("data, updated_at").eq("owner_id", ownerId).maybeSingle(),
            this.client.from("timer_state").select("data, completed, updated_at").eq("owner_id", ownerId).maybeSingle(),
            this.client.from("pm_state").select("data, updated_at").eq("owner_id", ownerId).maybeSingle(),
            this.page("pet_activity_records", ownerId, [{ column: "id" }]),
            this.page("pet_profiles", ownerId, [{ column: "id" }]),
            this.page("pet_schedule_items", ownerId, [{ column: "id" }]),
            this.page("pet_nap_records", ownerId, [{ column: "id" }]),
            this.page("pet_weight_entries", ownerId, [{ column: "id" }]),
            this.page("pet_training_skills", ownerId, [{ column: "id" }]),
            this.page("pet_fixations", ownerId, [{ column: "id" }]),
            this.page("pet_notable_events", ownerId, [{ column: "id" }]),
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

        const todos: SyncSnapshot["todos"] = {};
        for (const row of todoRows) {
            const todo = this.validateTodo(row);
            todos[row.id] = { value: todo, updatedAt: row.updated_at };
        }
        const todoCompletions: SyncSnapshot["todoCompletions"] = {};
        for (const row of todoCompletionRows) {
            const completion = this.validateTodoCompletion(row);
            todoCompletions[row.id] = completion;
        }

        const settingsData = settingsResponse.data?.data;
        const parsedSettings = settingsData === undefined ? null : parsePersistedSettings(settingsData);
        if (settingsData !== undefined && parsedSettings === null) {
            this.fail("settings", new Error(`invalid settings row for ${ownerId}`));
        }
        const timerData = timerResponse.data?.data;
        const timerSlice = timerResponse.data ? this.validateTimerSlice(timerData) : null;
        const pmData = pmResponse.data?.data;
        if (pmData !== undefined && !isRecord(pmData)) {
            this.fail("pm_state", new Error(`invalid PM row for ${ownerId}`));
        }
        const versionedMap = <T>(rows: any[], validate: (row: any) => T): Record<string, { value: T; updatedAt: string }> =>
            Object.fromEntries(rows.map((row) => [row.id, { value: validate(row), updatedAt: row.updated_at }]));
        const profileRow = petProfileRows[0];

        // Absent singleton rows stay `{ value: null, updatedAt: null }` so the
        // merge engine can distinguish "never existed" from default app values.
        const snapshot: SyncSnapshot = {
            tasks,
            logs,
            habits,
            habitCompletions,
            todos,
            todoCompletions,
            settings: {
                value: settingsResponse.data ? clone(parsedSettings) : null,
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
            petActivityRecords: versionedMap(petActivityRows, (row) => this.validatePetActivity(row)),
            petProfile: profileRow ? { value: this.validatePetProfile(profileRow), updatedAt: profileRow.updated_at } : { value: null, updatedAt: null },
            petScheduleItems: versionedMap(petScheduleRows, (row) => this.validatePetSchedule(row)),
            petNapRecords: versionedMap(petNapRows, (row) => this.validatePetNap(row)),
            petWeightEntries: versionedMap(petWeightRows, (row) => this.validatePetWeight(row)),
            petTrainingSkills: versionedMap(petTrainingRows, (row) => this.validatePetTrainingSkill(row)),
            petFixations: versionedMap(petFixationRows, (row) => this.validatePetFixation(row)),
            petNotableEvents: versionedMap(petEventRows, (row) => this.validatePetNotableEvent(row)),
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
        // Keep transport tolerant of an older in-memory plan during a rolling
        // frontend update; omitted new-domain arrays are equivalent to empty.
        const todoCompletionUpserts = plan.todoCompletionUpserts ?? [];
        const todoCompletionTombstones = plan.todoCompletionTombstones ?? [];
        const tombstones = (items: Array<{ id: string; deletedAt: string }> | undefined) =>
            items?.length ? items.map(({ id, deletedAt }) => ({ id, deleted_at: deletedAt })) : null;
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
                ? plan.habitCompletionTombstones.map(({ id, deletedAt, habitId }) => ({
                      id,
                      deleted_at: deletedAt,
                      ...(habitId !== undefined ? { habit_id: habitId } : {}),
                  }))
                : null,
            p_todo_upserts: plan.todoUpserts.length
                ? plan.todoUpserts.map(({ value, updatedAt }) => todoRow(value, updatedAt))
                : null,
            p_todo_tombstones: plan.todoTombstones.length
                ? plan.todoTombstones.map(({ id, deletedAt }) => ({ id, deleted_at: deletedAt }))
                : null,
            p_todo_completion_upserts: todoCompletionUpserts.length
                ? todoCompletionUpserts.map(todoCompletionRow)
                : null,
            p_todo_completion_tombstones: todoCompletionTombstones.length
                ? todoCompletionTombstones.map(({ id, deletedAt, todoId }) => ({ id, deleted_at: deletedAt, ...(todoId !== undefined ? { todo_id: todoId } : {}) }))
                : null,
            p_pet_activity_upserts: plan.petActivityUpserts?.length ? plan.petActivityUpserts.map(({ value, updatedAt }) => petActivityRow(value, updatedAt)) : null,
            p_pet_activity_tombstones: tombstones(plan.petActivityTombstones),
            p_pet_profile_upsert: plan.petProfile ? petProfileRow(plan.petProfile.value, plan.petProfile.updatedAt) : null,
            p_pet_profile_tombstone: plan.petProfileTombstone ? { id: plan.petProfileTombstone.id, deleted_at: plan.petProfileTombstone.deletedAt } : null,
            p_pet_schedule_upserts: plan.petScheduleUpserts?.length ? plan.petScheduleUpserts.map(({ value, updatedAt }) => petScheduleRow(value, updatedAt)) : null,
            p_pet_schedule_tombstones: tombstones(plan.petScheduleTombstones),
            p_pet_nap_upserts: plan.petNapUpserts?.length ? plan.petNapUpserts.map(({ value, updatedAt }) => petNapRow(value, updatedAt)) : null,
            p_pet_nap_tombstones: tombstones(plan.petNapTombstones),
            p_pet_weight_upserts: plan.petWeightUpserts?.length ? plan.petWeightUpserts.map(({ value, updatedAt }) => petWeightRow(value, updatedAt)) : null,
            p_pet_weight_tombstones: tombstones(plan.petWeightTombstones),
            p_pet_training_skill_upserts: plan.petTrainingSkillUpserts?.length ? plan.petTrainingSkillUpserts.map(({ value, updatedAt }) => petTrainingSkillRow(value, updatedAt)) : null,
            p_pet_training_skill_tombstones: tombstones(plan.petTrainingSkillTombstones),
            p_pet_fixation_upserts: plan.petFixationUpserts?.length ? plan.petFixationUpserts.map(({ value, updatedAt }) => petFixationRow(value, updatedAt)) : null,
            p_pet_fixation_tombstones: tombstones(plan.petFixationTombstones),
            p_pet_notable_event_upserts: plan.petNotableEventUpserts?.length ? plan.petNotableEventUpserts.map(({ value, updatedAt }) => petNotableEventRow(value, updatedAt)) : null,
            p_pet_notable_event_tombstones: tombstones(plan.petNotableEventTombstones),
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
