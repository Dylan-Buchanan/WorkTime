import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseDataAccess } from "./SupabaseDataAccess";
import type { Habit, HabitCompletion } from "../../state/types";
import type { PushPlan } from "./sync/types";
import type { Todo, TodoCompletion } from "../todos";

const OWNER = "00000000-0000-4000-8000-000000000001";

function H(id: string, overrides: Partial<Habit> = {}): Habit {
    return {
        id,
        name: `Habit ${id}`,
        description: "",
        color: "#ffffff",
        frequency: "daily",
        position: 0,
        isArchived: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

function HC(id: string, habitId: string, overrides: Partial<HabitCompletion> = {}): HabitCompletion {
    return {
        id,
        habitId,
        bucket: "2026-01-01",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

function TD(id: string): Todo {
    return { id, title: "Submit report", rule: { type: "weekly", weekdays: [1, 3] }, dueDate: "2026-01-07", estimate: 1, currentTaskId: null,
        position: 2, isArchived: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
}
function TC(id: string, todoId: string): TodoCompletion {
    return { id, todoId, bucket: "2026-01-07", createdAt: "2026-01-03T00:00:00.000Z", updatedAt: "2026-01-03T00:00:00.000Z" };
}

function mockClient(): { client: SupabaseClient; rpc: ReturnType<typeof vi.fn> } {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = {
        auth: {
            getSession: vi.fn().mockResolvedValue({
                data: { session: { user: { id: OWNER } } },
                error: null,
            }),
        },
        from: vi.fn(),
        rpc,
    } as unknown as SupabaseClient;
    return { client, rpc };
}

function pullClient(settingsData: unknown, tableRows: Record<string, unknown[]> = {}): SupabaseClient {
    const from = vi.fn((table: string) => {
        if (table === "settings" || table === "timer_state" || table === "pm_state") {
            const data = table === "settings"
                ? { data: settingsData, updated_at: "2026-01-01T00:00:00.000Z" }
                : null;
            return {
                select: () => ({
                    eq: () => ({ maybeSingle: async () => ({ data, error: null }) }),
                }),
            };
        }

        const query: Record<string, unknown> = {};
        query.eq = () => query;
        query.order = () => query;
        query.range = async () => ({ data: tableRows[table] ?? [], error: null });
        return { select: () => query };
    });
    return {
        auth: {
            getSession: vi.fn().mockResolvedValue({
                data: { session: { user: { id: OWNER } } },
                error: null,
            }),
        },
        from,
    } as unknown as SupabaseClient;
}

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
            settings: null,
            timerState: null,
            pmState: null,
            fullWipe: null,
        },
    };
}

describe("SupabaseDataAccess habit transport mapping", () => {
    it("normalizes legacy settings rows while rejecting malformed cutoffs", async () => {
        const legacy = { work_minutes: 25, short_break_minutes: 5, long_break_minutes: 20, segment_length: 4 };
        const snapshot = await new SupabaseDataAccess(pullClient(legacy)).pull(OWNER);
        expect(snapshot.settings.value).toEqual({ ...legacy, end_of_day: "22:00" });

        await expect(new SupabaseDataAccess(pullClient({ ...legacy, end_of_day: "24:00" })).pull(OWNER))
            .rejects.toThrow(/invalid settings row/);
    });

    it("maps habit deltas to apply_staged_sync and sends empty arrays as null", async () => {
        const { client, rpc } = mockClient();
        const data = new SupabaseDataAccess(client);
        const habit = H("h1", { name: "Push", color: "#112233", frequency: "weekly", position: 3 });
        const completion = HC("c1", "h1", { bucket: "2026-01-02" });
        const plan: PushPlan = {
            ...emptyPlan(),
            habitUpserts: [{ value: habit, updatedAt: "2026-01-03T00:00:00.000Z" }],
            habitTombstones: [{ id: "h1", deletedAt: "2026-01-03T00:00:00.000Z" }],
            habitCompletionUpserts: [completion],
            habitCompletionTombstones: [{ id: "c1", deletedAt: "2026-01-03T00:00:00.000Z" }],
        };

        await data.push(OWNER, plan);

        expect(rpc).toHaveBeenCalledTimes(1);
        const [name, args] = rpc.mock.calls[0];
        expect(name).toBe("apply_staged_sync");

        // Four populated arrays map camelCase to the exact snake_case DB shapes.
        expect(args.p_habit_upserts).toEqual([
            {
                id: habit.id,
                name: habit.name,
                description: habit.description,
                color: habit.color,
                frequency: habit.frequency,
                position: habit.position,
                is_archived: habit.isArchived,
                created_at: habit.createdAt,
                updated_at: "2026-01-03T00:00:00.000Z",
            },
        ]);
        expect(args.p_habit_tombstones).toEqual([{ id: "h1", deleted_at: "2026-01-03T00:00:00.000Z" }]);
        expect(args.p_habit_completion_upserts).toEqual([
            {
                id: completion.id,
                habit_id: completion.habitId,
                bucket: completion.bucket,
                created_at: completion.createdAt,
                updated_at: completion.updatedAt,
            },
        ]);
        expect(args.p_habit_completion_tombstones).toEqual([{ id: "c1", deleted_at: "2026-01-03T00:00:00.000Z" }]);

        // Empty arrays are sent as null, never as [].
        await data.push(OWNER, emptyPlan());
        const args2 = rpc.mock.calls[1][1];
        expect(args2.p_habit_upserts).toBeNull();
        expect(args2.p_habit_tombstones).toBeNull();
        expect(args2.p_habit_completion_upserts).toBeNull();
        expect(args2.p_habit_completion_tombstones).toBeNull();

        // No owner input is ever forwarded: the RPC derives it from auth.uid().
        const ownerKeys = Object.keys(args).filter((key) => key.toLowerCase().includes("owner"));
        expect(ownerKeys).toEqual([]);
        expect(args.p_owner).toBeUndefined();
    });

    it("maps cascade provenance on completion tombstones to the habit_id column", async () => {
        const { client, rpc } = mockClient();
        const data = new SupabaseDataAccess(client);
        const plan: PushPlan = {
            ...emptyPlan(),
            habitCompletionTombstones: [
                { id: "c1", deletedAt: "2026-01-03T00:00:00.000Z" },
                { id: "c2", deletedAt: "2026-01-03T00:00:00.000Z", habitId: "h1" },
            ],
        };

        await data.push(OWNER, plan);

        const args = rpc.mock.calls[0][1];
        expect(args.p_habit_completion_tombstones).toEqual([
            { id: "c1", deleted_at: "2026-01-03T00:00:00.000Z" },
            { id: "c2", deleted_at: "2026-01-03T00:00:00.000Z", habit_id: "h1" },
        ]);
    });

    it("maps to-do rows and tombstones to the extended RPC", async () => {
        const { client, rpc } = mockClient();
        const data = new SupabaseDataAccess(client);
        const todo = TD("todo-1");
        await data.push(OWNER, {
            ...emptyPlan(),
            todoUpserts: [{ value: todo, updatedAt: "2026-01-03T00:00:00.000Z" }],
            todoTombstones: [{ id: "todo-2", deletedAt: "2026-01-04T00:00:00.000Z" }],
            todoCompletionUpserts: [TC("completion-1", "todo-1")],
            todoCompletionTombstones: [{ id: "completion-2", deletedAt: "2026-01-04T00:00:00.000Z", todoId: "todo-2" }],
        });
        const args = rpc.mock.calls[0][1];
        expect(args.p_todo_upserts).toEqual([{
            id: "todo-1", title: "Submit report", rule: { type: "weekly", weekdays: [1, 3] },
            due_date: "2026-01-07", estimate: 1, current_task_id: null, position: 2, is_archived: false,
            created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-03T00:00:00.000Z",
        }]);
        expect(args.p_todo_tombstones).toEqual([{ id: "todo-2", deleted_at: "2026-01-04T00:00:00.000Z" }]);
        expect(args.p_todo_completion_upserts).toEqual([{
            id: "completion-1", todo_id: "todo-1", bucket: "2026-01-07",
            created_at: "2026-01-03T00:00:00.000Z", updated_at: "2026-01-03T00:00:00.000Z",
        }]);
        expect(args.p_todo_completion_tombstones).toEqual([{
            id: "completion-2", deleted_at: "2026-01-04T00:00:00.000Z", todo_id: "todo-2",
        }]);
    });

    it("pulls and validates all eight pet mirrors", async () => {
        const t = "2026-01-01T00:00:00.000Z";
        const rows = {
            pet_profiles: [{ id: "profile", name: "Mochi", birth_date: "2025-12-01", created_at: t, updated_at: t }],
            pet_activity_records: [
                { id: "activity", activity_type: "training", occurred_at: t, duration_minutes: null, skill_ids: ["sit", "unknown"], created_at: t, updated_at: t },
                { id: "legacy-activity", activity_type: "training", occurred_at: t, duration_minutes: null, created_at: t, updated_at: t },
            ],
            pet_schedule_items: [{ id: "schedule", activity_type: "feeding", label: "Breakfast", flexibility: "fixed", priority: 0, recurrence: { mode: "fixed-time", time: "08:00", startMinutes: 480, endMinutes: 510 }, is_active: true, created_at: t, updated_at: t }],
            pet_nap_records: [{ id: "nap", started_at: t, ended_at: null, created_at: t, updated_at: t }],
            pet_weight_entries: [{ id: "weight", measured_at: t, weight: 5.25, created_at: t, updated_at: t }],
            pet_training_skills: [{ id: "skill", label: "Sit", notes: "", status: "progressing", resolved_at: null, created_at: t, updated_at: t }],
            pet_fixations: [{ id: "fixation", label: "Shoes", notes: "", resolved_at: null, resolution_note: "", created_at: t, updated_at: t }],
            pet_notable_events: [{ id: "event", title: "First walk", notes: "", occurred_at: t, created_at: t, updated_at: t }],
        };
        const legacySettings = { work_minutes: 25, short_break_minutes: 5, long_break_minutes: 20, segment_length: 4 };
        const client = pullClient(legacySettings, rows);
        const snapshot = await new SupabaseDataAccess(client).pull(OWNER);

        expect(snapshot.petProfile.value).toMatchObject({ id: "profile", name: "Mochi" });
        expect(snapshot.petActivityRecords.activity.value).toMatchObject({ activityType: "training", skillIds: ["sit", "unknown"] });
        expect(snapshot.petActivityRecords["legacy-activity"].value).not.toHaveProperty("skillIds");
        expect(snapshot.petScheduleItems.schedule.value.recurrence).toMatchObject({ mode: "fixed-time", startMinutes: 480 });
        expect(snapshot.petNapRecords.nap.value.end).toBeNull();
        expect(snapshot.petWeightEntries.weight.value.weight).toBe(5.25);
        expect(snapshot.petTrainingSkills.skill.value.status).toBe("progressing");
        expect(snapshot.petFixations.fixation.value.label).toBe("Shoes");
        expect(snapshot.petNotableEvents.event.value.title).toBe("First walk");
        expect((client.from as ReturnType<typeof vi.fn>).mock.calls.map(([table]) => table)).toEqual(expect.arrayContaining(Object.keys(rows)));
    });

    it("rejects malformed rows from every pet table", async () => {
        const settings = { work_minutes: 25, short_break_minutes: 5, long_break_minutes: 20, segment_length: 4 };
        const t = "2026-01-01T00:00:00.000Z";
        for (const table of [
            "pet_profiles", "pet_activity_records", "pet_schedule_items", "pet_nap_records",
            "pet_weight_entries", "pet_training_skills", "pet_fixations", "pet_notable_events",
        ]) {
            await expect(new SupabaseDataAccess(pullClient(settings, {
                [table]: [{ id: "bad", created_at: t, updated_at: t }],
            })).pull(OWNER)).rejects.toThrow(new RegExp(table));
        }
    });

    it("rejects malformed skill_ids from pet activity rows", async () => {
        const t = "2026-01-01T00:00:00.000Z";
        const settings = { work_minutes: 25, short_break_minutes: 5, long_break_minutes: 20, segment_length: 4 };
        await expect(new SupabaseDataAccess(pullClient(settings, {
            pet_activity_records: [{
                id: "bad-tags",
                activity_type: "training",
                occurred_at: t,
                duration_minutes: null,
                skill_ids: ["sit", 1],
                created_at: t,
                updated_at: t,
            }],
        })).pull(OWNER)).rejects.toThrow(/pet_activity_records/);
    });

    it("maps every pet delta to its apply_staged_sync argument", async () => {
        const { client, rpc } = mockClient();
        const data = new SupabaseDataAccess(client);
        const t = "2026-01-03T00:00:00.000Z";
        await data.push(OWNER, {
            ...emptyPlan(),
            petProfile: { value: { id: "profile", name: "Mochi", birthDate: "2025-12-01", createdAt: t, updatedAt: t }, updatedAt: t },
            petProfileTombstone: { id: "old-profile", deletedAt: t },
            petActivityUpserts: [
                { value: { id: "activity", activityType: "training", timestamp: t, durationMinutes: 10, skillIds: ["sit"], createdAt: t }, updatedAt: t },
                { value: { id: "untagged-activity", activityType: "training", timestamp: t, createdAt: t }, updatedAt: t },
                { value: { id: "empty-tags-activity", activityType: "training", timestamp: t, skillIds: [], createdAt: t }, updatedAt: t },
            ],
            petActivityTombstones: [{ id: "old-activity", deletedAt: t }],
            petScheduleUpserts: [{ value: { id: "schedule", activityType: "feeding", label: "Breakfast", flexibility: "fixed", priority: 0, recurrence: { mode: "fixed-time", time: "08:00", startMinutes: 480, endMinutes: 510 }, isActive: true, createdAt: t, updatedAt: t }, updatedAt: t }],
            petScheduleTombstones: [{ id: "old-schedule", deletedAt: t }],
            petNapUpserts: [{ value: { id: "nap", start: t, end: null, createdAt: t, updatedAt: t }, updatedAt: t }],
            petNapTombstones: [{ id: "old-nap", deletedAt: t }],
            petWeightUpserts: [{ value: { id: "weight", timestamp: t, weight: 5.25, createdAt: t, updatedAt: t }, updatedAt: t }],
            petWeightTombstones: [{ id: "old-weight", deletedAt: t }],
            petTrainingSkillUpserts: [{ value: { id: "skill", label: "Sit", notes: "", status: "introduced", resolvedAt: null, createdAt: t, updatedAt: t }, updatedAt: t }],
            petTrainingSkillTombstones: [{ id: "old-skill", deletedAt: t }],
            petFixationUpserts: [{ value: { id: "fixation", label: "Shoes", notes: "", resolvedAt: null, resolutionNote: "", createdAt: t, updatedAt: t }, updatedAt: t }],
            petFixationTombstones: [{ id: "old-fixation", deletedAt: t }],
            petNotableEventUpserts: [{ value: { id: "event", title: "First walk", notes: "", timestamp: t, createdAt: t, updatedAt: t }, updatedAt: t }],
            petNotableEventTombstones: [{ id: "old-event", deletedAt: t }],
        });
        const args = rpc.mock.calls[0][1];
        expect(args.p_pet_profile_upsert).toMatchObject({ id: "profile", birth_date: "2025-12-01", updated_at: t });
        expect(args.p_pet_profile_tombstone).toEqual({ id: "old-profile", deleted_at: t });
        expect(args.p_pet_activity_upserts[0]).toMatchObject({ id: "activity", activity_type: "training", duration_minutes: 10, skill_ids: ["sit"] });
        expect(args.p_pet_activity_upserts[1]).not.toHaveProperty("skill_ids");
        expect(args.p_pet_activity_upserts[2]).not.toHaveProperty("skill_ids");
        expect(args.p_pet_schedule_upserts[0]).toMatchObject({ id: "schedule", activity_type: "feeding", is_active: true });
        expect(args.p_pet_nap_upserts[0]).toMatchObject({ id: "nap", started_at: t, ended_at: null });
        expect(args.p_pet_weight_upserts[0]).toMatchObject({ id: "weight", measured_at: t, weight: 5.25 });
        expect(args.p_pet_training_skill_upserts[0]).toMatchObject({ id: "skill", status: "introduced", resolved_at: null });
        expect(args.p_pet_fixation_upserts[0]).toMatchObject({ id: "fixation", resolution_note: "" });
        expect(args.p_pet_notable_event_upserts[0]).toMatchObject({ id: "event", occurred_at: t });
        for (const key of ["activity", "schedule", "nap", "weight", "training_skill", "fixation", "notable_event"]) {
            expect(args[`p_pet_${key}_tombstones`]).toEqual([{ id: `old-${key === "training_skill" ? "skill" : key === "notable_event" ? "event" : key}`, deleted_at: t }]);
        }

        await data.push(OWNER, emptyPlan());
        const emptyArgs = rpc.mock.calls[1][1];
        expect(emptyArgs.p_pet_profile_upsert).toBeNull();
        expect(emptyArgs.p_pet_activity_upserts).toBeNull();
        expect(emptyArgs.p_pet_notable_event_tombstones).toBeNull();
    });
});
