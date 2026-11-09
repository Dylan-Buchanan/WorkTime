import { isGoalTracker, isGoal, isGoalCheckIn } from "../goals/factories";
import type { GoalTracker, Goal, GoalCheckIn } from "../../state/types";
import type { EngineResult } from "../engine";
import {
    DEFAULT_SETTINGS,
    archiveTask,
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
import type {
    ActiveTimer,
    AppStateData,
    Habit,
    HabitCompletion,
    PetActivityRecord,
    PetFixation,
    PetNapRecord,
    PetNotableEvent,
    PetProfile,
    PetReminderMark,
    PetScheduleItem,
    PetTrainingSkill,
    PetWeightEntry,
    Settings,
    Task,
} from "../../state/types";
import type { Todo, TodoCompletion } from "../todos";
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
    todos: Todo[];
    todoCompletions: TodoCompletion[];
    goalTrackers: GoalTracker[];
    goals: Goal[];
    goalCheckIns: GoalCheckIn[];
    petActivityRecords: PetActivityRecord[];
    petProfile: PetProfile | null;
    petScheduleItems: PetScheduleItem[];
    petReminderMarks: PetReminderMark[];
    petNapRecords: PetNapRecord[];
    petWeightEntries: PetWeightEntry[];
    petTrainingSkills: PetTrainingSkill[];
    petFixations: PetFixation[];
    petNotableEvents: PetNotableEvent[];
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
            this.store = { state: cloneAppState(base), pmState: null, habits: [], habitCompletions: [], todos: [], todoCompletions: [], goalTrackers: [], goals: [], goalCheckIns: [], petActivityRecords: [], petProfile: null, petScheduleItems: [], petReminderMarks: [], petNapRecords: [], petWeightEntries: [], petTrainingSkills: [], petFixations: [], petNotableEvents: [], completed: false };
        }
        this.store.goalTrackers = clone(this.store.goalTrackers ?? []);
        this.store.goals = clone(this.store.goals ?? []);
        this.store.goalCheckIns = clone(this.store.goalCheckIns ?? []);
        this.store.state = cloneAppState(this.store.state);
        this.store.pmState = this.store.pmState ? clone(this.store.pmState) : null;
        this.store.habits = this.store.habits ? this.store.habits.map((habit) => clone(habit)) : [];
        this.store.habitCompletions = this.store.habitCompletions
            ? this.store.habitCompletions.map((completion) => clone(completion))
            : [];
        this.store.todos = this.store.todos ? this.store.todos.map((todo) => clone(todo)) : [];
        this.store.todoCompletions = this.store.todoCompletions ? this.store.todoCompletions.map((completion) => clone(completion)) : [];
        this.store.petActivityRecords = this.store.petActivityRecords
            ? this.store.petActivityRecords.map((record) => clone(record))
            : [];
        this.store.petProfile = this.store.petProfile ? clone(this.store.petProfile) : null;
        this.store.petScheduleItems = this.store.petScheduleItems
            ? this.store.petScheduleItems.map((item) => clone(item))
            : [];
        this.store.petReminderMarks = this.store.petReminderMarks
            ? this.store.petReminderMarks.map((mark) => clone(mark))
            : [];
        this.store.petNapRecords = this.store.petNapRecords ? this.store.petNapRecords.map((nap) => clone(nap)) : [];
        this.store.petWeightEntries = this.store.petWeightEntries
            ? this.store.petWeightEntries.map((entry) => clone(entry))
            : [];
        this.store.petTrainingSkills = this.store.petTrainingSkills
            ? this.store.petTrainingSkills.map((skill) => clone(skill))
            : [];
        this.store.petFixations = this.store.petFixations
            ? this.store.petFixations.map((fixation) => clone(fixation))
            : [];
        this.store.petNotableEvents = this.store.petNotableEvents
            ? this.store.petNotableEvents.map((event) => clone(event))
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
        return this.result(setActiveTask(
            this.store.state,
            taskId,
            this.now(),
            this.createLogId(),
        ));
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
        const result = engineCompleteTimer(
            this.store.state,
            this.now(),
            this.createLogId(),
        );
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
    async finalizeTask(taskId: string) { return this.result(finalizeTask(this.store.state, taskId, this.now(), this.createLogId())); }
    async archiveTask(taskId: string) { return this.result(archiveTask(this.store.state, taskId)); }
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

    async saveTodos(todos: Todo[], completions: TodoCompletion[]): Promise<void> {
        this.store.todos = todos.map((todo) => clone(todo));
        this.store.todoCompletions = completions.map((completion) => clone(completion));
        this.pending += 1;
        this.notify();
    }

    async loadTodos(): Promise<{ todos: Todo[]; completions: TodoCompletion[] }> {
        return { todos: this.store.todos.map((todo) => clone(todo)), completions: this.store.todoCompletions.map((completion) => clone(completion)) };
    }

    async savePetActivityRecords(records: PetActivityRecord[]): Promise<void> {
        this.store.petActivityRecords = records.map((record) => clone(record));
        this.pending += 1;
        this.notify();
    }

    async loadPetActivityRecords(): Promise<PetActivityRecord[]> {
        return this.store.petActivityRecords.map((record) => clone(record));
    }

    async savePetProfile(profile: PetProfile | null): Promise<void> {
        this.store.petProfile = profile ? clone(profile) : null;
        this.pending += 1;
        this.notify();
    }

    async loadPetProfile(): Promise<PetProfile | null> {
        return this.store.petProfile ? clone(this.store.petProfile) : null;
    }

    async savePetScheduleItems(items: PetScheduleItem[]): Promise<void> {
        this.store.petScheduleItems = items.map((item) => clone(item));
        this.pending += 1;
        this.notify();
    }

    async loadPetScheduleItems(): Promise<PetScheduleItem[]> {
        return this.store.petScheduleItems.map((item) => clone(item));
    }

    async savePetReminderMarks(marks: PetReminderMark[]): Promise<void> {
        const merged = new Map(this.store.petReminderMarks.map((mark) => [mark.id, mark]));
        for (const mark of marks) merged.set(mark.id, clone(mark));
        this.store.petReminderMarks = [...merged.values()].map((mark) => clone(mark));
        this.notify();
    }

    async loadPetReminderMarks(): Promise<PetReminderMark[]> {
        return this.store.petReminderMarks.map((mark) => clone(mark));
    }

    async savePetNapRecords(naps: PetNapRecord[]): Promise<void> {
        this.store.petNapRecords = naps.map((nap) => clone(nap));
        this.pending += 1;
        this.notify();
    }

    async loadPetNapRecords(): Promise<PetNapRecord[]> {
        return this.store.petNapRecords.map((nap) => clone(nap));
    }

    async savePetWeightEntries(entries: PetWeightEntry[]): Promise<void> {
        this.store.petWeightEntries = entries.map((entry) => clone(entry));
        this.pending += 1;
        this.notify();
    }

    async loadPetWeightEntries(): Promise<PetWeightEntry[]> {
        return this.store.petWeightEntries.map((entry) => clone(entry));
    }

    async savePetTrainingSkills(skills: PetTrainingSkill[]): Promise<void> {
        this.store.petTrainingSkills = skills.map((skill) => clone(skill));
        this.pending += 1;
        this.notify();
    }

    async loadPetTrainingSkills(): Promise<PetTrainingSkill[]> {
        return this.store.petTrainingSkills.map((skill) => clone(skill));
    }

    async savePetFixations(fixations: PetFixation[]): Promise<void> {
        this.store.petFixations = fixations.map((fixation) => clone(fixation));
        this.pending += 1;
        this.notify();
    }

    async loadPetFixations(): Promise<PetFixation[]> {
        return this.store.petFixations.map((fixation) => clone(fixation));
    }

    async savePetNotableEvents(events: PetNotableEvent[]): Promise<void> {
        this.store.petNotableEvents = events.map((event) => clone(event));
        this.pending += 1;
        this.notify();
    }

    async loadPetNotableEvents(): Promise<PetNotableEvent[]> {
        return this.store.petNotableEvents.map((event) => clone(event));
    }

    async loadGoals(): Promise<{ trackers: GoalTracker[]; goals: Goal[]; checkIns: GoalCheckIn[] }> {
        return clone({ trackers: this.store.goalTrackers, goals: this.store.goals, checkIns: this.store.goalCheckIns });
    }

    async saveGoals(trackers: GoalTracker[], goals: Goal[], checkIns: GoalCheckIn[]): Promise<void> {
        if (!trackers.every(isGoalTracker) || !goals.every(isGoal) || !checkIns.every(isGoalCheckIn)) throw new RangeError("Invalid goals payload");
        for (const tracker of trackers) {
            const previous = this.store.goalTrackers.find(row => row.id === tracker.id)?.lastBuiltPeriodStart;
            if (previous && (!tracker.lastBuiltPeriodStart || tracker.lastBuiltPeriodStart < previous)) throw new RangeError("lastBuiltPeriodStart cannot move backwards");
        }
        const next = clone({ trackers, goals, checkIns });
        if (equal(next, await this.loadGoals())) return;
        this.store.goalTrackers = next.trackers;
        this.store.goals = next.goals;
        this.store.goalCheckIns = next.checkIns;
        this.pending += 1;
        this.notify();
    }

    async discardPendingChanges(): Promise<void> {
        this.store.state = cloneAppState(this.baseline.state);
        this.store.pmState = this.baseline.pmState ? clone(this.baseline.pmState) : null;
        this.store.habits = this.baseline.habits.map((habit) => clone(habit));
        this.store.habitCompletions = this.baseline.habitCompletions.map((completion) => clone(completion));
        this.store.todos = this.baseline.todos.map((todo) => clone(todo));
        this.store.todoCompletions = this.baseline.todoCompletions.map((completion) => clone(completion));
        this.store.petActivityRecords = this.baseline.petActivityRecords.map((record) => clone(record));
        this.store.petProfile = this.baseline.petProfile ? clone(this.baseline.petProfile) : null;
        this.store.petScheduleItems = this.baseline.petScheduleItems.map((item) => clone(item));
        this.store.petReminderMarks = this.baseline.petReminderMarks.map((mark) => clone(mark));
        this.store.petNapRecords = this.baseline.petNapRecords.map((nap) => clone(nap));
        this.store.petWeightEntries = this.baseline.petWeightEntries.map((entry) => clone(entry));
        this.store.petTrainingSkills = this.baseline.petTrainingSkills.map((skill) => clone(skill));
        this.store.petFixations = this.baseline.petFixations.map((fixation) => clone(fixation));
        this.store.petNotableEvents = this.baseline.petNotableEvents.map((event) => clone(event));
        this.store.goalTrackers = clone(this.baseline.goalTrackers);
        this.store.goals = clone(this.baseline.goals);
        this.store.goalCheckIns = clone(this.baseline.goalCheckIns);
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
        todos: [],
        todoCompletions: [],
        goalTrackers: [],
        goals: [],
        goalCheckIns: [],
        petActivityRecords: [],
        petProfile: null,
        petScheduleItems: [],
        petReminderMarks: [],
        petNapRecords: [],
        petWeightEntries: [],
        petTrainingSkills: [],
        petFixations: [],
        petNotableEvents: [],
        completed: false,
    };
    return { store, dataAccess: new InMemoryDataAccess(store, options) };
}

export type { Task };
