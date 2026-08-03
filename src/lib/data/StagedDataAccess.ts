import type { EngineResult } from "../engine";
import {
    cloneAppState,
    completeTimer as engineCompleteTimer,
    createTask,
    deleteTask,
    finalizeTask,
    getState,
    pauseTimer,
    resetAppState,
    resumeTimer,
    setActiveTask,
    setTaskTarget,
    skipBreak,
    startBreakTimer,
    startWorkTimer,
    stopWorkTimer,
    updateSettings,
} from "../engine";
import { EngineError } from "../engine";
import type { ActiveTimer, AppStateData, Settings, Task } from "../../state/types";
import type { LocalStagingStore } from "./staging/LocalStagingStore";
import { deepValuesEqual } from "./staging/serialization";
import type { PendingTimerCompletion, StagedOwnerRecord } from "./staging/types";
import { timerGenerationKey } from "./sync/timerCompletions";
import type {
    CompleteTimerResult,
    DataAccess,
    FetchStateResult,
    SyncExecutor,
    SyncOptions,
    SyncResult,
    SyncedPMState,
} from "./DataAccess";

function clone<T>(value: T): T {
    return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function equal(a: unknown, b: unknown): boolean {
    // Key-order-insensitive so a server-normalized baseline never looks
    // different from a local timer/task value.
    return deepValuesEqual(a, b);
}

function timerSliceOf(state: AppStateData) {
    return {
        active_task: state.active_task,
        current_cycle_pomodoros: state.current_cycle_pomodoros,
        timer: state.timer,
    };
}

/**
 * Compares the before/after app state produced by a local command and stamps
 * every changed task ID and changed settings/timer singleton with `now`. Logs
 * are immutable entities unioned by client UUID, so they need no stamp; pending
 * detection compares them to the baseline directly. Removed tasks drop their
 * stamp because their tombstone owns the pending state.
 */
function stampStagedChanges(
    next: StagedOwnerRecord,
    before: AppStateData,
    after: AppStateData,
    now: Date,
): StagedOwnerRecord {
    const stamp = now.toISOString();
    const taskUpdatedAt = { ...next.taskUpdatedAt };
    const taskIds = new Set<string>([...Object.keys(before.tasks), ...Object.keys(after.tasks)]);
    for (const id of taskIds) {
        const current = after.tasks[id];
        if (!current) {
            delete taskUpdatedAt[id];
            continue;
        }
        const previous = before.tasks[id];
        if (previous === undefined || !equal(previous, current)) {
            taskUpdatedAt[id] = stamp;
        }
    }
    const settingsUpdatedAt = equal(before.settings, after.settings) ? next.settingsUpdatedAt : stamp;
    const timerUpdatedAt = equal(timerSliceOf(before), timerSliceOf(after)) ? next.timerUpdatedAt : stamp;
    return { ...next, taskUpdatedAt, settingsUpdatedAt, timerUpdatedAt };
}

function omitTaskStamp(record: Record<string, string>, taskId: string): Record<string, string> {
    const copy = { ...record };
    delete copy[taskId];
    return copy;
}

/**
 * The first task whose row changed during a completion, or `null` when no task
 * was touched (break completions). `taskBefore` is `null` only when the task was
 * created by the completion itself, which the engine never does.
 */
function changedTaskOf(before: AppStateData, after: AppStateData): { before: Task | null; after: Task } | null {
    for (const task of Object.values(after.tasks)) {
        const previous = before.tasks[task.id];
        if (previous === undefined || !equal(previous, task)) {
            return { before: previous ?? null, after: task };
        }
    }
    return null;
}

/** Monotonic per-owner journal sequence so replay order is stable. */
function nextCompletionSequence(entries: PendingTimerCompletion[]): number {
    return entries.reduce((max, entry) => Math.max(max, entry.sequence), 0) + 1;
}

/**
 * True when the expected timer is the exact timer row the server last
 * acknowledged (`lastSynced`). A mismatch means the local generation has not
 * been installed server-side yet and needs the preparatory `persist_transition`
 * call before `complete_timer` can claim it.
 */
function sameAsLastSyncedTimer(record: StagedOwnerRecord, timer: ActiveTimer): boolean {
    const baselineTimer = record.lastSynced?.timerState?.value?.timer ?? null;
    return baselineTimer !== null && equal(baselineTimer, timer);
}

export interface StagedDataAccessOptions {
    now?: () => Date;
    createTaskId?: () => string;
    createLogId?: () => string;
}

/**
 * Local-only `DataAccess` implementation backed by the per-owner staging store.
 * Every command reads the latest persisted record, runs the pure engine command,
 * stamps changed rows, persists once, and returns cloned results. No command
 * touches the network; `sync` is the only method that calls the injected
 * `SyncExecutor`.
 */
export class StagedDataAccess implements DataAccess {
    private readonly ownerId: string;
    private readonly store: LocalStagingStore;
    private readonly syncExecutor: SyncExecutor;
    private readonly now: () => Date;
    private readonly createTaskId: () => string;
    private readonly createLogId: () => string;

    constructor(
        ownerId: string,
        store: LocalStagingStore,
        syncExecutor: SyncExecutor,
        options: StagedDataAccessOptions = {},
    ) {
        this.ownerId = ownerId;
        this.store = store;
        this.syncExecutor = syncExecutor;
        this.now = options.now ?? (() => new Date());
        this.createTaskId = options.createTaskId ?? randomId;
        this.createLogId = options.createLogId ?? randomId;
    }

    /**
     * Loads the latest record, runs the engine command, stamps changed rows,
     * persists once, and returns cloned results. Engine and storage errors
     * reject the command and leave the persisted record unchanged.
     */
    private async transition<T>(
        command: (state: AppStateData) => EngineResult<T>,
        extra?: (next: StagedOwnerRecord) => StagedOwnerRecord,
    ): Promise<EngineResult<T>> {
        let value!: T;
        const persisted = await this.store.update(this.ownerId, (current) => {
            const before = cloneAppState(current.state);
            const result = command(before);
            value = result.value;
            let next: StagedOwnerRecord = { ...current, state: result.state };
            next = stampStagedChanges(next, before, result.state, this.now());
            if (extra) next = extra(next);
            return next;
        });
        return Promise.resolve({ state: cloneAppState(persisted.state), value: clone(value) });
    }

    async fetchState(): Promise<FetchStateResult> {
        let record = this.store.read(this.ownerId);

        // Run get_state maintenance locally and stage any maintenance changes.
        if (getState(record.state).value) {
            record = await this.store.update(this.ownerId, (current) => {
                const maintained = getState(current.state);
                if (!maintained.value) return current;
                return stampStagedChanges(
                    { ...current, state: maintained.state },
                    current.state,
                    maintained.state,
                    this.now(),
                );
            });
        }

        const timer = record.state.timer;
        if (timer && !timer.paused && new Date(timer.ends_at).getTime() <= this.now().getTime() && !record.timerCompleted) {
            const completion = await this.completeTimer(timer);
            return {
                state: cloneAppState(completion.state),
                value: cloneAppState(completion.state),
                reconciledTimer: { kind: timer.kind, taskId: timer.task_id, applied: completion.applied },
            };
        }
        return { state: cloneAppState(record.state), value: cloneAppState(record.state), reconciledTimer: null };
    }

    async createTask(name: string, targetPomodoros: number) {
        return this.transition((state) => createTask(state, name, targetPomodoros, this.now(), this.createTaskId()));
    }

    async setActiveTask(taskId: string) {
        return this.transition((state) => setActiveTask(state, taskId, this.now(), this.createLogId()));
    }

    async startWorkTimer() {
        return this.transition(
            (state) => startWorkTimer(state, this.now()),
            (next) => ({ ...next, timerCompleted: false }),
        );
    }

    async startBreakTimer() {
        return this.transition(
            (state) => startBreakTimer(state, this.now()),
            (next) => ({ ...next, timerCompleted: false }),
        );
    }

    async completeTimer(expectedTimer?: ActiveTimer): Promise<CompleteTimerResult> {
        let record = this.store.read(this.ownerId);
        const captured = record.state.timer ? clone(record.state.timer) : null;
        if (expectedTimer && !equal(expectedTimer, captured)) {
            return { state: cloneAppState(record.state), value: cloneAppState(record.state), applied: false };
        }
        if (record.timerCompleted) {
            return { state: cloneAppState(record.state), value: cloneAppState(record.state), applied: false };
        }
        if (captured && record.pendingCompletions.some((c) => c.generationKey === timerGenerationKey(captured))) {
            return { state: cloneAppState(record.state), value: cloneAppState(record.state), applied: false };
        }

        let applied = false;
        const persisted = await this.store.update(this.ownerId, (current) => {
            // Re-verify against the latest stored revision so a concurrent
            // winner (or an already-journaled generation) is never double-applied.
            const latestTimer = current.state.timer ? clone(current.state.timer) : null;
            if (expectedTimer && !equal(expectedTimer, latestTimer)) return current;
            if (current.timerCompleted) return current;
            if (
                latestTimer &&
                current.pendingCompletions.some((c) => c.generationKey === timerGenerationKey(latestTimer))
            ) {
                return current;
            }

            // Run the engine once and capture the exact before/after task and
            // timer slices plus the one generated log for CAS replay later.
            const now = this.now();
            const before = cloneAppState(current.state);
            const result = engineCompleteTimer(before, now, this.createLogId());
            const changed = changedTaskOf(before, result.state);
            const newLog = result.state.logs.find((log) => !before.logs.some((existing) => existing.id === log.id));
            if (!newLog) throw new EngineError("Timer completion must produce exactly one journaled log");

            const entry: PendingTimerCompletion = {
                generationKey: timerGenerationKey(latestTimer!),
                sequence: nextCompletionSequence(current.pendingCompletions),
                expectedTimer: clone(latestTimer!),
                expectedTimerState: timerSliceOf(before),
                resultTimerState: timerSliceOf(result.state),
                taskBefore: changed ? clone(changed.before) : null,
                taskAfter: changed ? clone(changed.after) : null,
                log: clone(newLog),
                localOnlyGeneration: !sameAsLastSyncedTimer(current, latestTimer!),
                completedAt: now.toISOString(),
            };
            applied = true;

            let next: StagedOwnerRecord = { ...current, state: result.state, timerCompleted: true };
            next = stampStagedChanges(next, current.state, result.state, now);
            next = { ...next, pendingCompletions: [...next.pendingCompletions, entry] };
            return next;
        });

        return {
            state: cloneAppState(persisted.state),
            value: cloneAppState(persisted.state),
            applied,
        };
    }

    async stopWorkTimer() {
        return this.transition((state) => stopWorkTimer(state, this.now(), this.createLogId()));
    }

    async pauseTimer() {
        return this.transition((state) => pauseTimer(state, this.now()));
    }

    async resumeTimer() {
        return this.transition((state) => resumeTimer(state, this.now()));
    }

    async skipBreak() {
        return this.transition((state) => skipBreak(state, this.now(), this.createLogId()));
    }

    async updateSettings(settings: Settings) {
        return this.transition((state) => updateSettings(state, settings));
    }

    async finalizeTask(taskId: string) {
        return this.transition((state) => finalizeTask(state, taskId, this.now()));
    }

    async setTaskTarget(taskId: string, target: number) {
        return this.transition((state) => setTaskTarget(state, taskId, target));
    }

    async deleteTask(taskId: string): Promise<EngineResult<void>> {
        const now = this.now();
        return this.transition(
            (state) => deleteTask(state, taskId),
            (next) => ({
                ...next,
                taskUpdatedAt: omitTaskStamp(next.taskUpdatedAt, taskId),
                taskTombstones: { ...next.taskTombstones, [taskId]: { id: taskId, deletedAt: now.toISOString() } },
            }),
        );
    }

    async deletePomodoroLog(logId: string): Promise<EngineResult<void>> {
        const now = this.now();
        return this.transition(
            (state) => {
                const next = cloneAppState(state);
                const index = next.logs.findIndex((log) => log.id === logId);
                if (index === -1) throw new EngineError("Log not found");
                next.logs.splice(index, 1);
                return { state: next, value: undefined };
            },
            (next) => ({
                ...next,
                logTombstones: { ...next.logTombstones, [logId]: { id: logId, deletedAt: now.toISOString() } },
            }),
        );
    }

    async resetAppState(): Promise<EngineResult<AppStateData>> {
        const now = this.now();
        return this.transition(
            (state) => resetAppState(state),
            (next) => ({
                ...next,
                taskUpdatedAt: {},
                settingsUpdatedAt: null,
                timerUpdatedAt: null,
                taskTombstones: {},
                logTombstones: {},
                pendingCompletions: [],
                fullWipe: { createdAt: now.toISOString() },
                timerCompleted: false,
            }),
        );
    }

    async savePMState(state: SyncedPMState): Promise<void> {
        await this.store.update(this.ownerId, (current) => ({
            ...current,
            pmState: clone({ projects: state.projects, tasks: state.tasks, meta: state.meta }),
            pmUpdatedAt: this.now().toISOString(),
        }));
    }

    async loadPMState(): Promise<SyncedPMState | null> {
        const record = this.store.read(this.ownerId);
        return record.pmState ? clone(record.pmState) : null;
    }

    async sync(options: SyncOptions): Promise<SyncResult> {
        return this.syncExecutor.sync(options);
    }

    pendingCount(): number {
        return this.store.pendingCount(this.ownerId);
    }

    isInitialized(): boolean {
        return this.store.read(this.ownerId).initialized;
    }

    reloadFromStorage(): void {
        this.store.replaceFromExternal(this.ownerId);
    }

    subscribe(listener: () => void): () => void {
        return this.store.subscribe(this.ownerId, listener);
    }
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
