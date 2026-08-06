import type { EngineResult } from "../engine";
import {
    DEFAULT_SETTINGS,
    EngineError,
    cloneAppState,
    createTask,
    deleteTask,
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
import type { ActiveTimer, AppStateData, Habit, HabitCompletion, Settings, Task } from "../../state/types";
import type { CompleteTimerResult, DataAccess, FetchStateResult, SyncOptions, SyncResult, SyncedPMState } from "./DataAccess";

function clone<T>(value: T): T {
    return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function equal(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

function randomId(): string {
    try {
        const candidate = globalThis.crypto?.randomUUID;
        if (candidate) return candidate.call(globalThis.crypto);
    } catch {
        // Test/jsdom environments may not expose randomUUID.
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

export interface InMemoryDataStore {
    state: AppStateData;
    pmState: SyncedPMState | null;
    habits: Habit[];
    habitCompletions: HabitCompletion[];
    completed: boolean;
}

export interface InMemoryDataAccessOptions {
    now?: () => Date;
    createTaskId?: () => string;
    createLogId?: () => string;
    beforeCompletionCommit?: () => void | Promise<void>;
    onSync?: (options: SyncOptions) => void | Promise<void>;
    /**
     * Optional `pendingCount` returned by a successful `sync()`. Production
     * syncs can legitimately succeed while residual completion work stays
     * pending, so context tests can model that with a non-zero value; the
     * default resets pending to zero as before.
     */
    pendingAfterSync?: number;
}

export class InMemoryDataAccess implements DataAccess {
    readonly store: InMemoryDataStore;
    readonly syncCalls: SyncOptions[] = [];
    private readonly now: () => Date;
    private readonly createTaskId: () => string;
    private readonly createLogId: () => string;
    private readonly beforeCompletionCommit?: () => void | Promise<void>;
    private readonly onSync?: (options: SyncOptions) => void | Promise<void>;
    private readonly pendingAfterSync?: number;
    private readonly listeners = new Set<() => void>();
    private pending = 0;
    private baseline: InMemoryDataStore;

    constructor(initial?: Partial<AppStateData> | InMemoryDataStore, options: InMemoryDataAccessOptions = {}) {
        if (initial && "state" in initial && "completed" in initial && "pmState" in initial) {
            this.store = initial as InMemoryDataStore;
        } else {
            const base: AppStateData = {
                tasks: {},
                logs: [],
                settings: { ...DEFAULT_SETTINGS },
                active_task: null,
                current_cycle_pomodoros: 0,
                timer: null,
                ...(initial ?? {}),
            };
            this.store = { state: cloneAppState(base), pmState: null, habits: [], habitCompletions: [], completed: false };
        }
        this.store.state = cloneAppState(this.store.state);
        this.store.pmState = this.store.pmState ? clone(this.store.pmState) : null;
        this.store.habits = this.store.habits ? this.store.habits.map((habit) => clone(habit)) : [];
        this.store.habitCompletions = this.store.habitCompletions
            ? this.store.habitCompletions.map((completion) => clone(completion))
            : [];
        this.baseline = clone(this.store);
        this.now = options.now ?? (() => new Date());
        this.createTaskId = options.createTaskId ?? randomId;
        this.createLogId = options.createLogId ?? randomId;
        this.beforeCompletionCommit = options.beforeCompletionCommit;
        this.onSync = options.onSync;
        this.pendingAfterSync = options.pendingAfterSync;
    }

    private notify(): void {
        for (const listener of [...this.listeners]) {
            try {
                listener();
            } catch {
                // A subscriber failure must not break the command or other listeners.
            }
        }
    }

    private result<T>(result: EngineResult<T>): EngineResult<T> {
        this.store.state = cloneAppState(result.state);
        this.pending += 1;
        this.notify();
        return { state: cloneAppState(this.store.state), value: clone(result.value) };
    }

    private current<T>(value: T): EngineResult<T> {
        const state = cloneAppState(this.store.state);
        return { state, value: clone(value) };
    }

    async fetchState(): Promise<FetchStateResult> {
        const maintained = getState(this.store.state);
        this.store.state = cloneAppState(maintained.state);
        const timer = this.store.state.timer;
        if (timer && !timer.paused && new Date(timer.ends_at).getTime() <= this.now().getTime() && !this.store.completed) {
            const completion = await this.completeTimer(timer);
            return {
                state: cloneAppState(completion.state),
                value: cloneAppState(completion.state),
                reconciledTimer: { kind: timer.kind, taskId: timer.task_id, applied: completion.applied },
            };
        }
        return { state: cloneAppState(this.store.state), value: cloneAppState(this.store.state), reconciledTimer: null };
    }

    async createTask(name: string, targetPomodoros: number) {
        return this.result(createTask(this.store.state, name, targetPomodoros, this.now(), this.createTaskId()));
    }

    async setActiveTask(taskId: string) {
        return this.result(setActiveTask(this.store.state, taskId, this.now(), this.createLogId()));
    }

    async startWorkTimer() {
        const result = startWorkTimer(this.store.state, this.now());
        this.store.completed = false;
        return this.result(result);
    }

    async startBreakTimer() {
        const result = startBreakTimer(this.store.state, this.now());
        this.store.completed = false;
        return this.result(result);
    }

    async completeTimer(expectedTimer?: ActiveTimer): Promise<CompleteTimerResult> {
        const captured = this.store.state.timer ? clone(this.store.state.timer) : null;
        if (expectedTimer && !equal(expectedTimer, captured)) {
            return { ...this.current(cloneAppState(this.store.state)), applied: false };
        }
        if (this.store.completed) {
            return { ...this.current(cloneAppState(this.store.state)), applied: false };
        }
        const result = engineCompleteTimer(this.store.state, this.now(), this.createLogId());
        await this.beforeCompletionCommit?.();
        if (this.store.completed || !equal(this.store.state.timer, captured)) {
            return { ...this.current(cloneAppState(this.store.state)), applied: false };
        }
        this.store.state = cloneAppState(result.state);
        this.store.completed = true;
        this.pending += 1;
        this.notify();
        return { state: cloneAppState(this.store.state), value: cloneAppState(this.store.state), applied: true };
    }

    async stopWorkTimer() { return this.result(stopWorkTimer(this.store.state, this.now(), this.createLogId())); }
    async pauseTimer() { return this.result(pauseTimer(this.store.state, this.now())); }
    async resumeTimer() { return this.result(resumeTimer(this.store.state, this.now())); }
    async skipBreak() { return this.result(skipBreak(this.store.state, this.now(), this.createLogId())); }
    async updateSettings(settings: Settings) { return this.result(updateSettings(this.store.state, settings)); }
    async finalizeTask(taskId: string) { return this.result(finalizeTask(this.store.state, taskId, this.now())); }
    async setTaskTarget(taskId: string, target: number) { return this.result(setTaskTarget(this.store.state, taskId, target)); }

    async resetAppState() {
        this.store.completed = false;
        return this.result(resetAppState(this.store.state));
    }

    async deleteTask(taskId: string): Promise<EngineResult<void>> {
        return this.result(deleteTask(this.store.state, taskId));
    }

    async deletePomodoroLog(logId: string): Promise<EngineResult<void>> {
        const next = cloneAppState(this.store.state);
        const index = next.logs.findIndex((log) => log.id === logId);
        if (index === -1) throw new EngineError("Log not found");
        next.logs.splice(index, 1);
        return this.result({ state: next, value: undefined });
    }

    async savePMState(state: SyncedPMState): Promise<void> {
        this.store.pmState = clone({ projects: state.projects, tasks: state.tasks, meta: state.meta });
        this.pending += 1;
        this.notify();
    }

    async loadPMState(): Promise<SyncedPMState | null> {
        return this.store.pmState ? clone(this.store.pmState) : null;
    }

    async saveHabits(habits: Habit[], completions: HabitCompletion[]): Promise<void> {
        this.store.habits = habits.map((habit) => clone(habit));
        this.store.habitCompletions = completions.map((completion) => clone(completion));
        this.pending += 1;
        this.notify();
    }

    async loadHabits(): Promise<{ habits: Habit[]; completions: HabitCompletion[] }> {
        return {
            habits: this.store.habits.map((habit) => clone(habit)),
            completions: this.store.habitCompletions.map((completion) => clone(completion)),
        };
    }

    async sync(options: SyncOptions): Promise<SyncResult> {
        this.syncCalls.push(options);
        if (this.onSync) await this.onSync(options);
        if (this.pendingAfterSync !== undefined) {
            this.pending = this.pendingAfterSync;
        } else {
            this.pending = 0;
        }
        if (this.pending === 0) this.baseline = clone(this.store);
        return {
            state: cloneAppState(this.store.state),
            pmState: this.store.pmState ? clone(this.store.pmState) : null,
            pendingCount: this.pending,
            initialized: true,
        };
    }

    async discardPendingChanges(): Promise<void> {
        this.store.state = cloneAppState(this.baseline.state);
        this.store.pmState = this.baseline.pmState ? clone(this.baseline.pmState) : null;
        this.store.habits = this.baseline.habits.map((habit) => clone(habit));
        this.store.habitCompletions = this.baseline.habitCompletions.map((completion) => clone(completion));
        this.store.completed = this.baseline.completed;
        this.pending = 0;
        this.notify();
    }

    pendingCount(): number {
        return this.pending;
    }

    isInitialized(): boolean {
        return true;
    }

    reloadFromStorage(): void {
        this.notify();
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }
}

export function makeSharedInMemoryDataAccess(initial?: Partial<AppStateData>, options?: InMemoryDataAccessOptions) {
    const store: InMemoryDataStore = {
        state: {
            tasks: {}, logs: [], settings: { ...DEFAULT_SETTINGS }, active_task: null,
            current_cycle_pomodoros: 0, timer: null, ...(initial ?? {}),
        },
        pmState: null,
        habits: [],
        habitCompletions: [],
        completed: false,
    };
    return { store, dataAccess: new InMemoryDataAccess(store, options) };
}

export type { Task };
