import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { SupabaseDataAccess } from "../src/lib/data/SupabaseDataAccess";
import { defaultAppState } from "../src/lib/engine";
import type { PushPlan } from "../src/lib/data/sync/types";
import { createLocalUser, localSupabaseConfig, type LocalUser } from "../tests/supabase/localSupabase";

// The tasks/pomodoro_logs primary keys are the global `id`, so these fixed ids
// must not overlap with other integration files (which use 2xxx/3xxx bases).
const TASK_ID = "00000000-0000-4000-8000-100000000001";
const LOG_ID = "00000000-0000-4000-8000-100000000002";
const HABIT_ID = "00000000-0000-4000-8000-100000000003";
const COMPLETION_ID = "00000000-0000-4000-8000-100000000004";
const TODO_ID = "00000000-0000-4000-8000-100000000006";
const PET_PROFILE_ID = "00000000-0000-4000-8000-100000000010";
const PET_ACTIVITY_ID = "00000000-0000-4000-8000-100000000011";
const PET_VALID_DIRECT_ACTIVITY_ID = "00000000-0000-4000-8000-100000000018";
const PET_BAD_ACTIVITY_IDS = [
    "00000000-0000-4000-8000-100000000019",
    "00000000-0000-4000-8000-100000000020",
    "00000000-0000-4000-8000-100000000021",
];
const PET_SCHEDULE_ID = "00000000-0000-4000-8000-100000000012";
const PET_NAP_ID = "00000000-0000-4000-8000-100000000013";
const PET_WEIGHT_ID = "00000000-0000-4000-8000-100000000014";
const PET_SKILL_ID = "00000000-0000-4000-8000-100000000015";
const PET_FIXATION_ID = "00000000-0000-4000-8000-100000000016";
const PET_EVENT_ID = "00000000-0000-4000-8000-100000000017";
const FOREIGN_OWNER = "ffffffff-ffff-4000-8000-ffffffffffff";
const EARLIER = "2025-12-01T00:00:00.000Z";
const T0 = "2026-01-01T00:00:00.000Z";
const LATER = "2026-02-01T00:00:00.000Z";

const PM_STATE = { projects: {}, tasks: {}, meta: { initializedAt: T0 } };

let user: LocalUser | null = null;
afterEach(async () => { await user?.cleanup(); user = null; });

function emptyPlan(): PushPlan {
    return {
        baseRevision: 1,
        taskUpserts: [],
        taskTombstones: [],
        logUpserts: [],
        logTombstones: [],
        habitUpserts: [],
        habitTombstones: [],
        habitCompletionUpserts: [],
        habitCompletionTombstones: [],
        todoUpserts: [],
        todoTombstones: [],
        todoCompletionUpserts: [],
        todoCompletionTombstones: [],
        petActivityUpserts: [], petActivityTombstones: [], petProfile: null, petProfileTombstone: null,
        petScheduleUpserts: [], petScheduleTombstones: [], petNapUpserts: [], petNapTombstones: [],
        petWeightUpserts: [], petWeightTombstones: [], petTrainingSkillUpserts: [], petTrainingSkillTombstones: [],
        petFixationUpserts: [], petFixationTombstones: [], petNotableEventUpserts: [], petNotableEventTombstones: [],
        settings: null,
        timerState: null,
        pmState: null,
        fullWipe: false,
        acknowledged: {
            taskUpserts: {},
            taskTombstones: {},
            logUpserts: {},
            logTombstones: {},
            habitUpserts: {},
            habitTombstones: {},
            habitCompletionUpserts: {},
            habitCompletionTombstones: {},
            todoUpserts: {},
            todoTombstones: {},
            todoCompletionUpserts: {},
            todoCompletionTombstones: {},
            petActivityUpserts: {}, petActivityTombstones: {}, petProfile: null, petProfileTombstone: null,
            petScheduleUpserts: {}, petScheduleTombstones: {}, petNapUpserts: {}, petNapTombstones: {},
            petWeightUpserts: {}, petWeightTombstones: {}, petTrainingSkillUpserts: {}, petTrainingSkillTombstones: {},
            petFixationUpserts: {}, petFixationTombstones: {}, petNotableEventUpserts: {}, petNotableEventTombstones: {},
            settings: null,
            timerState: null,
            pmState: null,
            fullWipe: null,
        },
    };
}

function habit(id: string, name: string, updatedAt = T0) {
    return { id, name, description: "A habit", color: "#ff0000", frequency: "weekly" as const, position: 2, isArchived: false, createdAt: T0, updatedAt };
}

function completion(id: string, habitId: string, bucket = "2026-01-02") {
    return { id, habitId, bucket, createdAt: T0, updatedAt: T0 };
}

function todo(id = TODO_ID) {
    return { id, title: "Pushed to-do", rule: { type: "weekly" as const, weekdays: [1, 3] },
        dueDate: "2026-01-07" as const, estimate: 1, currentTaskId: null, position: 1, isArchived: false, createdAt: T0, updatedAt: T0 };
}

// PostgREST serializes timestamptz columns with an offset (+00:00) rather than
// the "Z" the client authored, so compare timestamps by instant.
const epoch = (value: string | null): number | null => (value === null ? null : new Date(value).getTime());

describe("SupabaseDataAccess transport", () => {
    it("requires an authenticated session before pulling", async () => {
        const config = localSupabaseConfig();
        const anon = createClient(config.url, config.anonKey, { auth: { persistSession: false } });
        await expect(new SupabaseDataAccess(anon).pull(FOREIGN_OWNER)).rejects.toMatchObject({
            name: "DataAccessAuthError",
            code: "DATA_ACCESS_NO_SESSION",
        });
    });

    it("returns an empty versioned snapshot for a fresh owner", async () => {
        user = await createLocalUser();
        const snapshot = await new SupabaseDataAccess(user.client).pull(user.userId);
        expect(snapshot.tasks).toEqual({});
        expect(snapshot.logs).toEqual({});
        expect(snapshot.habits).toEqual({});
        expect(snapshot.habitCompletions).toEqual({});
        expect(snapshot.todos).toEqual({});
        expect(snapshot.settings).toEqual({ value: null, updatedAt: null });
        expect(snapshot.timerState).toEqual({ value: null, updatedAt: null, completed: false });
        expect(snapshot.pmState).toEqual({ value: null, updatedAt: null });
    });

    it("rejects a session that does not match the expected owner", async () => {
        user = await createLocalUser();
        await expect(new SupabaseDataAccess(user.client).pull(FOREIGN_OWNER)).rejects.toMatchObject({
            name: "DataAccessAuthError",
            code: "DATA_ACCESS_OWNER_MISMATCH",
        });
    });

    it("round-trips a push plan through pull and replays idempotently", async () => {
        user = await createLocalUser();
        const remote = new SupabaseDataAccess(user.client);
        const task = {
            id: TASK_ID, name: "Pushed task", target_pomodoros: 2, completed_pomodoros: 0,
            created_at: T0, completed_at: null, break_skips: 0, archived: false,
        };
        const log = { id: LOG_ID, task_id: TASK_ID, duration_minutes: 25, finished_at: "2026-01-01T00:26:00.000Z", was_break: false, break_skipped: false };
        const settings = { work_minutes: 30, short_break_minutes: 6, long_break_minutes: 24, segment_length: 3, end_of_day: "18:30" };
        const timerSlice = { active_task: TASK_ID, current_cycle_pomodoros: 1, timer: null };
        const pushedHabit = habit(HABIT_ID, "Pushed habit");
        const pushedCompletion = completion(COMPLETION_ID, HABIT_ID);
        const pushedTodo = todo();
        const plan: PushPlan = {
            ...emptyPlan(),
            taskUpserts: [{ value: task, updatedAt: T0 }],
            logUpserts: [log],
            habitUpserts: [{ value: pushedHabit, updatedAt: T0 }],
            habitCompletionUpserts: [pushedCompletion],
            todoUpserts: [{ value: pushedTodo, updatedAt: T0 }],
            settings: { value: settings, updatedAt: T0 },
            timerState: { value: timerSlice, updatedAt: T0, newGeneration: false },
            pmState: { value: PM_STATE, updatedAt: T0 },
        };

        await remote.push(user.userId, plan);

        const first = await remote.pull(user.userId);
        const pulledTask = first.tasks[TASK_ID].value;
        expect(pulledTask.id).toBe(task.id);
        expect(pulledTask.name).toBe(task.name);
        expect(pulledTask.target_pomodoros).toBe(task.target_pomodoros);
        expect(pulledTask.completed_pomodoros).toBe(task.completed_pomodoros);
        expect(epoch(pulledTask.created_at)).toBe(epoch(task.created_at));
        expect(pulledTask.completed_at).toBe(task.completed_at);
        expect(pulledTask.break_skips).toBe(task.break_skips);
        expect(pulledTask.archived).toBe(task.archived);
        expect(epoch(first.tasks[TASK_ID].updatedAt)).toBe(epoch(T0));
        const pulledLog = first.logs[LOG_ID];
        expect(pulledLog).toBeDefined();
        expect(pulledLog.id).toBe(log.id);
        expect(pulledLog.task_id).toBe(log.task_id);
        expect(pulledLog.duration_minutes).toBe(log.duration_minutes);
        expect(epoch(pulledLog.finished_at)).toBe(epoch(log.finished_at));
        expect(pulledLog.was_break).toBe(log.was_break);
        expect(pulledLog.break_skipped).toBe(log.break_skipped);
        const pulledHabit = first.habits[HABIT_ID].value;
        expect(pulledHabit.id).toBe(pushedHabit.id);
        expect(pulledHabit.name).toBe(pushedHabit.name);
        expect(pulledHabit.description).toBe(pushedHabit.description);
        expect(pulledHabit.color).toBe(pushedHabit.color);
        expect(pulledHabit.frequency).toBe(pushedHabit.frequency);
        expect(pulledHabit.position).toBe(pushedHabit.position);
        expect(pulledHabit.isArchived).toBe(pushedHabit.isArchived);
        expect(epoch(pulledHabit.createdAt)).toBe(epoch(pushedHabit.createdAt));
        expect(epoch(pulledHabit.updatedAt)).toBe(epoch(T0));
        expect(epoch(first.habits[HABIT_ID].updatedAt)).toBe(epoch(T0));
        const pulledCompletion = first.habitCompletions[COMPLETION_ID];
        expect(pulledCompletion).toBeDefined();
        expect(pulledCompletion.id).toBe(pushedCompletion.id);
        expect(pulledCompletion.habitId).toBe(pushedCompletion.habitId);
        expect(pulledCompletion.bucket).toBe(pushedCompletion.bucket);
        expect(epoch(pulledCompletion.createdAt)).toBe(epoch(pushedCompletion.createdAt));
        expect(epoch(pulledCompletion.updatedAt)).toBe(epoch(pushedCompletion.updatedAt));
        expect(first.todos[TODO_ID].value).toMatchObject({
            id: TODO_ID, title: pushedTodo.title, rule: pushedTodo.rule, dueDate: pushedTodo.dueDate,
        });
        expect(first.settings.value).toEqual(settings);
        expect(epoch(first.settings.updatedAt)).toBe(epoch(T0));
        expect(first.timerState.value).toEqual(timerSlice);
        expect(epoch(first.timerState.updatedAt)).toBe(epoch(T0));
        expect(first.timerState.completed).toBe(false);
        expect(first.pmState.value).toEqual(PM_STATE);
        expect(epoch(first.pmState.updatedAt)).toBe(epoch(T0));

        // Replaying the same plan creates no duplicate tasks, logs, habits, or
        // completion rows.
        await remote.push(user.userId, plan);
        const logs = await user.client.from("pomodoro_logs").select("id");
        expect(logs.error).toBeNull();
        expect(logs.data).toHaveLength(1);
        const tasks = await user.client.from("tasks").select("id");
        expect(tasks.error).toBeNull();
        expect(tasks.data).toHaveLength(1);
        const habits = await user.client.from("habits").select("id");
        expect(habits.error).toBeNull();
        expect(habits.data).toHaveLength(1);
        const completions = await user.client.from("habit_completions").select("id");
        expect(completions.error).toBeNull();
        expect(completions.data).toHaveLength(1);
        expect((await user.client.from("todos").select("id")).data).toHaveLength(1);
        expect((await user.client.from("settings").select("owner_id")).data).toHaveLength(1);
        expect((await user.client.from("timer_state").select("owner_id")).data).toHaveLength(1);
        expect((await user.client.from("pm_state").select("owner_id")).data).toHaveLength(1);
    });

    it("applies habit tombstones and completion identity through the staged-sync RPC", async () => {
        user = await createLocalUser();
        const remote = new SupabaseDataAccess(user.client);
        const pushedHabit = habit(HABIT_ID, "Tombstone habit");
        const pushedCompletion = completion(COMPLETION_ID, HABIT_ID);
        const plan: PushPlan = {
            ...emptyPlan(),
            habitUpserts: [{ value: pushedHabit, updatedAt: T0 }],
            habitCompletionUpserts: [pushedCompletion],
        };

        await remote.push(user.userId, plan);
        await remote.push(user.userId, plan);
        expect((await user.client.from("habits").select("id")).data).toHaveLength(1);
        expect((await user.client.from("habit_completions").select("id")).data).toHaveLength(1);

        // The (habit_id, bucket) identity makes a replay with another client id
        // idempotent and preserves the first completion identity.
        await remote.push(user.userId, {
            ...emptyPlan(),
            habitCompletionUpserts: [completion("00000000-0000-4000-8000-100000000005", HABIT_ID)],
        });
        const replayed = await user.client.from("habit_completions").select("id").single();
        expect(replayed.error).toBeNull();
        expect(replayed.data!.id).toBe(COMPLETION_ID);

        await remote.push(user.userId, {
            ...emptyPlan(),
            habitTombstones: [{ id: HABIT_ID, deletedAt: LATER }],
            habitCompletionTombstones: [{ id: COMPLETION_ID, deletedAt: LATER }],
        });
        expect((await user.client.from("habits").select("id")).data).toHaveLength(0);
        expect((await user.client.from("habit_completions").select("id")).data).toHaveLength(0);
        const pulled = await remote.pull(user.userId);
        expect(pulled.habits).toEqual({});
        expect(pulled.habitCompletions).toEqual({});
    });

    it("enforces owner RLS for to-do reads and writes", async () => {
        user = await createLocalUser();
        const other = await createLocalUser();
        try {
            await new SupabaseDataAccess(user.client).push(user.userId, {
                ...emptyPlan(), todoUpserts: [{ value: todo(), updatedAt: T0 }],
            });
            expect((await other.client.from("todos").select("id")).data).toEqual([]);
            const spoof = await other.client.from("todos").insert({
                id: "00000000-0000-4000-8000-100000000007", owner_id: user.userId,
                title: "Spoofed", position: 0, is_archived: false,
            });
            expect(spoof.error).not.toBeNull();
            expect((await user.client.from("todos").select("id")).data).toHaveLength(1);
        } finally {
            await other.cleanup();
        }
    });

    it("refreshes an active session and rejects a refresh without a session", async () => {
        user = await createLocalUser();
        const remote = new SupabaseDataAccess(user.client);
        await expect(remote.refreshSession(user.userId)).resolves.toBeUndefined();

        const config = localSupabaseConfig();
        const anon = createClient(config.url, config.anonKey, { auth: { persistSession: false } });
        await expect(new SupabaseDataAccess(anon).refreshSession(FOREIGN_OWNER)).rejects.toMatchObject({
            name: "DataAccessAuthError",
            code: "DATA_ACCESS_REFRESH_FAILED",
        });
    });

    it("applies a full wipe while preserving an independent PM upsert and habit rows", async () => {
        user = await createLocalUser();
        const remote = new SupabaseDataAccess(user.client);
        const seed: PushPlan = {
            ...emptyPlan(),
            taskUpserts: [{ value: { id: TASK_ID, name: "Pre-wipe task", target_pomodoros: 2, completed_pomodoros: 1, created_at: T0, completed_at: null, break_skips: 0, archived: false }, updatedAt: T0 }],
            logUpserts: [{ id: LOG_ID, task_id: TASK_ID, duration_minutes: 25, finished_at: "2026-01-01T00:26:00.000Z", was_break: false, break_skipped: false }],
            habitUpserts: [{ value: habit(HABIT_ID, "Survivor habit"), updatedAt: T0 }],
            habitCompletionUpserts: [completion(COMPLETION_ID, HABIT_ID)],
            settings: { value: { work_minutes: 40, short_break_minutes: 7, long_break_minutes: 30, segment_length: 5, end_of_day: "20:00" }, updatedAt: T0 },
            timerState: { value: { active_task: TASK_ID, current_cycle_pomodoros: 3, timer: null }, updatedAt: T0, newGeneration: false },
        };
        await remote.push(user.userId, seed);

        const defaults = defaultAppState();
        const wipePlan: PushPlan = {
            ...emptyPlan(),
            fullWipe: true,
            settings: { value: { ...defaults.settings }, updatedAt: LATER },
            timerState: { value: { active_task: null, current_cycle_pomodoros: 0, timer: null }, updatedAt: LATER, newGeneration: true },
            pmState: { value: PM_STATE, updatedAt: LATER },
        };
        await remote.push(user.userId, wipePlan);

        const snapshot = await remote.pull(user.userId);
        expect(snapshot.tasks).toEqual({});
        expect(snapshot.logs).toEqual({});
        expect(snapshot.settings.value).toEqual(defaults.settings);
        expect(snapshot.timerState.value).toEqual({ active_task: null, current_cycle_pomodoros: 0, timer: null });
        expect(epoch(snapshot.timerState.updatedAt)).toBe(epoch(LATER));
        expect(snapshot.timerState.completed).toBe(false);
        expect(snapshot.pmState.value).toEqual(PM_STATE);
        // Habits and completions survive the wipe untouched.
        expect(snapshot.habits[HABIT_ID].value.name).toBe("Survivor habit");
        expect(epoch(snapshot.habits[HABIT_ID].updatedAt)).toBe(epoch(T0));
        expect(snapshot.habitCompletions[COMPLETION_ID].id).toBe(COMPLETION_ID);
    });

    it("round-trips pet rows, applies LWW tombstones, and preserves pets across a full wipe", async () => {
        user = await createLocalUser();
        const remote = new SupabaseDataAccess(user.client);
        await remote.push(user.userId, {
            ...emptyPlan(),
            petProfile: {
                value: { id: PET_PROFILE_ID, name: "Whitney", birthDate: "2026-07-10", createdAt: T0, updatedAt: T0 },
                updatedAt: T0,
            },
            petActivityUpserts: [{
                value: { id: PET_ACTIVITY_ID, activityType: "training", timestamp: T0, skillIds: [PET_SKILL_ID, "unknown-skill"], createdAt: T0 },
                updatedAt: T0,
            }],
            petScheduleUpserts: [{ value: { id: PET_SCHEDULE_ID, activityType: "feeding", label: "Breakfast", flexibility: "fixed", priority: 0, recurrence: { mode: "fixed-time", time: "08:00", startMinutes: 480, endMinutes: 510 }, isActive: true, createdAt: T0, updatedAt: T0 }, updatedAt: T0 }],
            petNapUpserts: [{ value: { id: PET_NAP_ID, start: T0, end: null, createdAt: T0, updatedAt: T0 }, updatedAt: T0 }],
            petWeightUpserts: [{ value: { id: PET_WEIGHT_ID, timestamp: T0, weight: 5.25, createdAt: T0, updatedAt: T0 }, updatedAt: T0 }],
            petTrainingSkillUpserts: [{ value: { id: PET_SKILL_ID, label: "Sit", notes: "", status: "progressing", resolvedAt: null, createdAt: T0, updatedAt: T0 }, updatedAt: T0 }],
            petFixationUpserts: [{ value: { id: PET_FIXATION_ID, label: "Shoes", notes: "", resolvedAt: null, resolutionNote: "", createdAt: T0, updatedAt: T0 }, updatedAt: T0 }],
            petNotableEventUpserts: [{ value: { id: PET_EVENT_ID, title: "First walk", notes: "", timestamp: T0, createdAt: T0, updatedAt: T0 }, updatedAt: T0 }],
        });
        let snapshot = await remote.pull(user.userId);
        expect(snapshot.petProfile.value?.name).toBe("Whitney");
        expect(snapshot.petActivityRecords[PET_ACTIVITY_ID].value).toMatchObject({
            activityType: "training",
            skillIds: [PET_SKILL_ID, "unknown-skill"],
        });
        const validTags = await user.client.from("pet_activity_records").insert({
            id: PET_VALID_DIRECT_ACTIVITY_ID,
            owner_id: user.userId,
            activity_type: "training",
            occurred_at: T0,
            skill_ids: ["sit"],
            created_at: T0,
            updated_at: T0,
        });
        expect(validTags.error).toBeNull();
        const malformedSkillIds: unknown[] = [["sit", 1], [["sit"]], ["sit", ["stay"]]];
        for (const [index, skillIds] of malformedSkillIds.entries()) {
            const malformedTags = await user.client.from("pet_activity_records").insert({
                id: PET_BAD_ACTIVITY_IDS[index],
                owner_id: user.userId,
                activity_type: "training",
                occurred_at: T0,
                skill_ids: skillIds,
                created_at: T0,
                updated_at: T0,
            });
            expect(malformedTags.error).toMatchObject({ code: "23514" });
            expect(malformedTags.error?.message).toMatch(/pet_activity_records_skill_ids_check/);
        }
        expect(snapshot.petScheduleItems[PET_SCHEDULE_ID].value.label).toBe("Breakfast");
        expect(snapshot.petNapRecords[PET_NAP_ID].value.end).toBeNull();
        expect(snapshot.petWeightEntries[PET_WEIGHT_ID].value.weight).toBe(5.25);
        expect(snapshot.petTrainingSkills[PET_SKILL_ID].value.status).toBe("progressing");
        expect(snapshot.petFixations[PET_FIXATION_ID].value.label).toBe("Shoes");
        expect(snapshot.petNotableEvents[PET_EVENT_ID].value.title).toBe("First walk");

        await remote.push(user.userId, {
            ...emptyPlan(),
            petProfile: {
                value: { id: PET_PROFILE_ID, name: "Stale profile", birthDate: "2026-07-10", createdAt: T0, updatedAt: T0 },
                updatedAt: EARLIER,
            },
            petActivityUpserts: [{
                value: { id: PET_ACTIVITY_ID, activityType: "training", timestamp: T0, skillIds: ["stale"], createdAt: T0 },
                updatedAt: EARLIER,
            }],
            petScheduleUpserts: [{ value: { id: PET_SCHEDULE_ID, activityType: "feeding", label: "Stale breakfast", flexibility: "fixed", priority: 0, recurrence: { mode: "fixed-time", time: "08:00", startMinutes: 480, endMinutes: 510 }, isActive: true, createdAt: T0, updatedAt: T0 }, updatedAt: EARLIER }],
            petNapUpserts: [{ value: { id: PET_NAP_ID, start: T0, end: T0, createdAt: T0, updatedAt: T0 }, updatedAt: EARLIER }],
            petWeightUpserts: [{ value: { id: PET_WEIGHT_ID, timestamp: T0, weight: 99, createdAt: T0, updatedAt: T0 }, updatedAt: EARLIER }],
            petTrainingSkillUpserts: [{ value: { id: PET_SKILL_ID, label: "Stale skill", notes: "", status: "introduced", resolvedAt: null, createdAt: T0, updatedAt: T0 }, updatedAt: EARLIER }],
            petFixationUpserts: [{ value: { id: PET_FIXATION_ID, label: "Stale fixation", notes: "", resolvedAt: null, resolutionNote: "", createdAt: T0, updatedAt: T0 }, updatedAt: EARLIER }],
            petNotableEventUpserts: [{ value: { id: PET_EVENT_ID, title: "Stale event", notes: "", timestamp: T0, createdAt: T0, updatedAt: T0 }, updatedAt: EARLIER }],
            petProfileTombstone: { id: PET_PROFILE_ID, deletedAt: EARLIER },
            petActivityTombstones: [{ id: PET_ACTIVITY_ID, deletedAt: EARLIER }],
            petScheduleTombstones: [{ id: PET_SCHEDULE_ID, deletedAt: EARLIER }],
            petNapTombstones: [{ id: PET_NAP_ID, deletedAt: EARLIER }],
            petWeightTombstones: [{ id: PET_WEIGHT_ID, deletedAt: EARLIER }],
            petTrainingSkillTombstones: [{ id: PET_SKILL_ID, deletedAt: EARLIER }],
            petFixationTombstones: [{ id: PET_FIXATION_ID, deletedAt: EARLIER }],
            petNotableEventTombstones: [{ id: PET_EVENT_ID, deletedAt: EARLIER }],
        });
        snapshot = await remote.pull(user.userId);
        expect(snapshot.petProfile.value?.name).toBe("Whitney");
        expect(snapshot.petActivityRecords[PET_ACTIVITY_ID].value.skillIds).toEqual([PET_SKILL_ID, "unknown-skill"]);
        expect(snapshot.petScheduleItems[PET_SCHEDULE_ID].value.label).toBe("Breakfast");
        expect(snapshot.petNapRecords[PET_NAP_ID].value.end).toBeNull();
        expect(snapshot.petWeightEntries[PET_WEIGHT_ID].value.weight).toBe(5.25);
        expect(snapshot.petTrainingSkills[PET_SKILL_ID].value.label).toBe("Sit");
        expect(snapshot.petFixations[PET_FIXATION_ID].value.label).toBe("Shoes");
        expect(snapshot.petNotableEvents[PET_EVENT_ID].value.title).toBe("First walk");

        // A newer tag-only edit can clear the association while preserving the row.
        await remote.push(user.userId, {
            ...emptyPlan(),
            petActivityUpserts: [{
                value: { id: PET_ACTIVITY_ID, activityType: "training", timestamp: T0, createdAt: T0 },
                updatedAt: LATER,
            }],
        });
        snapshot = await remote.pull(user.userId);
        expect(snapshot.petActivityRecords[PET_ACTIVITY_ID].value).not.toHaveProperty("skillIds");

        const defaults = defaultAppState();
        await remote.push(user.userId, {
            ...emptyPlan(), fullWipe: true,
            settings: { value: defaults.settings, updatedAt: LATER },
            timerState: { value: { active_task: null, current_cycle_pomodoros: 0, timer: null }, updatedAt: LATER, newGeneration: true },
        });
        snapshot = await remote.pull(user.userId);
        expect(snapshot.petProfile.value?.id).toBe(PET_PROFILE_ID);
        expect(snapshot.petActivityRecords[PET_ACTIVITY_ID]).toBeDefined();
        expect(snapshot.petNotableEvents[PET_EVENT_ID]).toBeDefined();

        await remote.push(user.userId, {
            ...emptyPlan(),
            // The singleton delete is owner-scoped and LWW-gated even if this
            // client remembers an older profile id.
            petProfileTombstone: { id: "00000000-0000-4000-8000-100000000099", deletedAt: LATER },
            petActivityTombstones: [{ id: PET_ACTIVITY_ID, deletedAt: LATER }],
            petScheduleTombstones: [{ id: PET_SCHEDULE_ID, deletedAt: LATER }],
            petNapTombstones: [{ id: PET_NAP_ID, deletedAt: LATER }],
            petWeightTombstones: [{ id: PET_WEIGHT_ID, deletedAt: LATER }],
            petTrainingSkillTombstones: [{ id: PET_SKILL_ID, deletedAt: LATER }],
            petFixationTombstones: [{ id: PET_FIXATION_ID, deletedAt: LATER }],
            petNotableEventTombstones: [{ id: PET_EVENT_ID, deletedAt: LATER }],
        });
        snapshot = await remote.pull(user.userId);
        expect(snapshot.petProfile).toEqual({ value: null, updatedAt: null });
        expect(snapshot.petActivityRecords[PET_ACTIVITY_ID]).toBeUndefined();
        expect(snapshot.petScheduleItems).toEqual({});
        expect(snapshot.petNapRecords).toEqual({});
        expect(snapshot.petWeightEntries).toEqual({});
        expect(snapshot.petTrainingSkills).toEqual({});
        expect(snapshot.petFixations).toEqual({});
        expect(snapshot.petNotableEvents).toEqual({});
    });

    it("enforces owner RLS and rejects cross-owner pet ids", async () => {
        user = await createLocalUser();
        const other = await createLocalUser();
        try {
            const remote = new SupabaseDataAccess(user.client);
            await remote.push(user.userId, {
                ...emptyPlan(),
                petActivityUpserts: [{ value: { id: PET_ACTIVITY_ID, activityType: "potty", timestamp: T0, createdAt: T0 }, updatedAt: T0 }],
            });
            expect((await other.client.from("pet_activity_records").select("id")).data).toEqual([]);
            const spoof = await other.client.from("pet_activity_records").insert({
                id: PET_SCHEDULE_ID,
                owner_id: user.userId,
                activity_type: "potty",
                occurred_at: T0,
            });
            expect(spoof.error).not.toBeNull();

            // The definer RPC must not select another owner's row via a global
            // primary-key conflict. A colliding id fails without modifying it.
            await expect(new SupabaseDataAccess(other.client).push(other.userId, {
                ...emptyPlan(),
                petActivityUpserts: [{ value: { id: PET_ACTIVITY_ID, activityType: "feeding", timestamp: LATER, createdAt: T0 }, updatedAt: LATER }],
            })).rejects.toThrow();
            expect((await remote.pull(user.userId)).petActivityRecords[PET_ACTIVITY_ID].value.activityType).toBe("potty");
        } finally {
            await other.cleanup();
        }
    });

    it("rolls back the whole transition when a gated write fails", async () => {
        user = await createLocalUser();
        const client = user.client;
        const response = await client.rpc("persist_transition", {
            p_tasks: null,
            p_logs: [{ task_id: TASK_ID, duration_minutes: -1, finished_at: "2026-01-01T00:01:00.000Z", was_break: false, break_skipped: false }],
            p_settings: null,
            p_timer_data: { active_task: null, current_cycle_pomodoros: 0, timer: null },
            p_timer_new_generation: false,
            p_timer_updated_at: null,
        });
        expect(response.error).not.toBeNull();
        const timer = await client.from("timer_state").select("owner_id").maybeSingle();
        expect(timer.data).toBeNull();
        const logs = await client.from("pomodoro_logs").select("id");
        expect(logs.data).toHaveLength(0);
    });
});
