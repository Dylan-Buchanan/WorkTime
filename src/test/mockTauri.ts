import { AppStateData, Settings } from "../state/types";

// Shared fixture builders for integration tests.
// Note: `vi.mock("@tauri-apps/api/core")` must be declared in each test file that
// needs the mocked `invoke`; helpers here stay mock-free.

export const defaultSettings: Settings = {
    work_minutes: 25,
    short_break_minutes: 5,
    long_break_minutes: 20,
    segment_length: 4,
};

export function makeAppState(overrides: Partial<AppStateData> = {}): AppStateData {
    return {
        tasks: {},
        logs: [],
        settings: { ...defaultSettings },
        active_task: null,
        current_cycle_pomodoros: 0,
        timer: null,
        ...overrides,
    };
}

export function makeActiveTimer(
    overrides: Partial<NonNullable<AppStateData["timer"]>> = {}
): NonNullable<AppStateData["timer"]> {
    return {
        task_id: "t1",
        started_at: new Date().toISOString(),
        ends_at: new Date(Date.now() + 25 * 60_000).toISOString(),
        kind: "Work",
        paused: false,
        paused_remaining_secs: 0,
        planned_secs: 25 * 60,
        accumulated_secs: 0,
        ...overrides,
    };
}
