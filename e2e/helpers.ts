import { readFileSync } from "fs";
import { Browser, BrowserContext, Page } from "@playwright/test";
import { AppStateData, Settings } from "../src/state/types";

declare global {
    interface Window {
        __TAURI_INTERNALS__?: {
            invoke: (cmd: string, args?: any, options?: any) => Promise<any>;
        };
        __TAURI_IPC__?: boolean;
        __TEST_BACKEND__?: {
            getState: () => any;
            setState: (next: any) => void;
            getPMState: () => any;
            setPMState: (next: any) => void;
            reset: () => void;
        };
    }
}

const mockScript = readFileSync(new URL("./mock-ipc.js", import.meta.url), "utf8");

/**
 * Create a browser context with the mock Tauri IPC bridge injected, optionally
 * seeded with backend state (runs before the app mounts on first navigation).
 */
export async function openApp(browser: Browser, seed?: Partial<AppStateData>, pmSeed?: object): Promise<BrowserContext> {
    const context = await browser.newContext();
    await context.addInitScript({ content: mockScript });
    if (seed) {
        await context.addInitScript((s) => {
            window.__TEST_BACKEND__!.setState(s);
        }, seed);
    }
    if (pmSeed) {
        await context.addInitScript((s) => {
            window.__TEST_BACKEND__!.setPMState(s);
        }, pmSeed);
    }
    return context;
}

export async function backendState(page: Page) {
    return page.evaluate(() => window.__TEST_BACKEND__!.getState());
}

export const defaultSettings: Settings = {
    work_minutes: 25,
    short_break_minutes: 5,
    long_break_minutes: 20,
    segment_length: 4,
};

export function baseState(overrides: Partial<AppStateData> = {}): AppStateData {
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

export function taskFixture(id: string, name: string, overrides: Partial<AppStateData["tasks"][string]> = {}) {
    return {
        id,
        name,
        target_pomodoros: 4,
        completed_pomodoros: 0,
        created_at: "2026-01-01T00:00:00Z",
        completed_at: null,
        break_skips: 0,
        archived: false,
        ...overrides,
    };
}
