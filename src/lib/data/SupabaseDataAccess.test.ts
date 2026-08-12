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

function pullClient(settingsData: unknown): SupabaseClient {
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
        query.range = async () => ({ data: [], error: null });
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
});
