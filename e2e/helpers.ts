import { Browser, BrowserContext, expect, Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAuthStorageKey } from "../src/lib/supabaseAuthStorage";
import { createLocalUser, localSupabaseConfig, type LocalUser } from "../tests/supabase/localSupabase";
import { AppStateData, Habit, HabitCompletion, Settings } from "../src/state/types";

export interface TestApp {
    context: BrowserContext;
    page: Page;
    client: SupabaseClient;
    userId: string;
    cleanup: () => Promise<void>;
}

function uuidFor(value: string): string {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return value;
    return `00000000-0000-4000-8000-${value.replace(/[^0-9a-f]/gi, "").padStart(12, "0").slice(-12)}`;
}

async function seedState(client: SupabaseClient, seed: Partial<AppStateData> = {}) {
    const tasks = Object.values(seed.tasks ?? {}).map((task) => ({ ...task, id: uuidFor(task.id) }));
    if (tasks.length) await client.from("tasks").upsert(tasks);
    if (seed.logs?.length) await client.from("pomodoro_logs").insert(seed.logs.map((log) => ({ ...log, task_id: uuidFor(log.task_id) })));
    await client.from("settings").upsert({ data: seed.settings ?? defaultSettings });
    const timer = seed.timer ? { ...seed.timer, task_id: uuidFor(seed.timer.task_id) } : null;
    await client.from("timer_state").upsert({ data: { active_task: seed.active_task ? uuidFor(seed.active_task) : null, current_cycle_pomodoros: seed.current_cycle_pomodoros ?? 0, timer }, completed: false });
}

export async function openApp(browser: Browser, seed?: Partial<AppStateData>, pmSeed?: any): Promise<TestApp> {
    const user: LocalUser = await createLocalUser();
    let context: BrowserContext | null = null;
    let cleaned = false;
    let inFlight: Promise<void> | null = null;
    const cleanup = (): Promise<void> => {
        if (inFlight) return inFlight;
        inFlight = (async () => {
            if (cleaned) return;
            cleaned = true;
            await context?.close().catch(() => undefined);
            await user.cleanup();
        })();
        return inFlight;
    };
    try {
        if (seed) await seedState(user.client, seed);
        if (pmSeed) await user.client.from("pm_state").upsert({ data: { projects: pmSeed.projects ?? {}, tasks: pmSeed.tasks ?? {}, meta: pmSeed.meta ?? {} } });
        const config = localSupabaseConfig();
        context = await browser.newContext();
        await context.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: supabaseAuthStorageKey(config.url), session: user.session });
        const page = await context.newPage();
        // The close listener and explicit cleanup share one promise so closing the
        // context does not resolve before the Supabase user/cascade deletes finish.
        context.on("close", () => { void cleanup(); });
        return { context, page, client: user.client, userId: user.userId, cleanup };
    } catch (err) {
        await cleanup();
        throw err;
    }
}

export async function backendState(app: TestApp): Promise<AppStateData> {
    const [tasks, logs, settings, timer] = await Promise.all([
        app.client.from("tasks").select("*").order("id"),
        app.client.from("pomodoro_logs").select("*").order("finished_at").order("id"),
        app.client.from("settings").select("data").maybeSingle(),
        app.client.from("timer_state").select("data").maybeSingle(),
    ]);
    const state = timer.data?.data ?? {};
    return { tasks: Object.fromEntries((tasks.data ?? []).map((task: any) => [task.id, { ...task }])), logs: (logs.data ?? []).map(({ id: _id, owner_id: _owner, ...log }: any) => log), settings: settings.data?.data ?? defaultSettings, active_task: state.active_task ?? null, current_cycle_pomodoros: state.current_cycle_pomodoros ?? 0, timer: state.timer ?? null };
}

export async function backendPMState(app: TestApp) {
    const response = await app.client.from("pm_state").select("data").maybeSingle();
    return response.data?.data ?? null;
}

export async function backendHabitState(app: TestApp): Promise<{
    habits: Record<string, Habit>;
    completions: Record<string, HabitCompletion>;
}> {
    const [habits, completions] = await Promise.all([
        app.client.from("habits").select("*").order("position").order("id"),
        app.client.from("habit_completions").select("*").order("habit_id").order("bucket").order("id"),
    ]);
    if (habits.error) throw habits.error;
    if (completions.error) throw completions.error;

    return {
        habits: Object.fromEntries((habits.data ?? []).map((habit: any) => [habit.id, {
            id: habit.id,
            name: habit.name,
            description: habit.description,
            color: habit.color,
            frequency: habit.frequency,
            position: habit.position,
            isArchived: habit.is_archived,
            createdAt: habit.created_at,
            updatedAt: habit.updated_at,
        } satisfies Habit])),
        completions: Object.fromEntries((completions.data ?? []).map((completion: any) => [completion.id, {
            id: completion.id,
            habitId: completion.habit_id,
            bucket: completion.bucket,
            createdAt: completion.created_at,
            updatedAt: completion.updated_at,
        } satisfies HabitCompletion])),
    };
}

/** Push staged browser state before an assertion reads Supabase. */
export async function syncData(page: Page): Promise<void> {
    const button = page.getByRole("button", { name: /Sync data/ });
    const badge = page.getByTestId("pending-badge");
    // Sync until the staged store drains. A single sync can succeed while a
    // same-tab write (the estimate/PM bridge) lands during the sync and stays
    // pending, so retry a bounded number of times. Each attempt waits for the
    // button to cycle when the request is still in flight. Very small pushes
    // can settle before Playwright observes the transient disabled state.
    for (let attempt = 0; attempt < 5; attempt += 1) {
        await button.click();
        try { await expect(button).toBeDisabled({ timeout: 1000 }); } catch { /* Sync settled before the disabled state was observed. */ }
        await expect(button).toBeEnabled();
        try {
            await expect(badge).toHaveCount(0, { timeout: 2000 });
            break;
        } catch {
            // A same-tab write raced this sync; drain it on the next attempt.
        }
    }
    // The badge clearing is the stable success signal: the staged store is fully
    // drained. The derived "Synced" text can flip to "Ready" when a same-tab
    // write or focus event fires during the assertion window, so accept either
    // settled text rather than asserting the exact success string.
    await expect(badge).toHaveCount(0);
    await expect(page.getByTestId("sync-status")).toHaveText(/Synced|Ready/);
}

export const defaultSettings: Settings = { work_minutes: 25, short_break_minutes: 5, long_break_minutes: 20, segment_length: 4 };

export function baseState(overrides: Partial<AppStateData> = {}): AppStateData {
    return { tasks: {}, logs: [], settings: { ...defaultSettings }, active_task: null, current_cycle_pomodoros: 0, timer: null, ...overrides };
}

export function taskFixture(id: string, name: string, overrides: Partial<AppStateData["tasks"][string]> = {}) {
    return { id, name, target_pomodoros: 4, completed_pomodoros: 0, created_at: "2026-01-01T00:00:00Z", completed_at: null, break_skips: 0, archived: false, ...overrides };
}
