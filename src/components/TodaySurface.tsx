import React, { useState } from "react";
import { CalendarDays, Check, ChevronDown, ChevronRight, Play } from "lucide-react";
import { useAppState } from "../state/AppStateContext";
import { usePM } from "../state/ProjectManagerContext";
import { useHabits } from "../state/HabitContext";
import {
    formatDurationMinutes,
    formatPomodoroCount,
    computeActiveFractionComplete,
} from "../lib/timer";
import {
    buildTodayOverview,
    type TodayHabitEntry,
    type TodayTaskEntry,
} from "../lib/today";
import { useSounds } from "../hooks/useSounds";

const CONTENT_ID = "today-surface-content";

interface TodaySurfaceProps {
    /** Select the task in the project manager and open the task-details panel. */
    onSelectTask: (taskId: string) => void;
}

function taskCountLabel(count: number): string {
    return `${count} ${count === 1 ? "task" : "tasks"}`;
}

const GroupHeading: React.FC<{ children: React.ReactNode; count?: string }> = ({ children, count }) => (
    <div className="flex items-center justify-between gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-400">{children}</h3>
        {count && <span className="text-[10px] text-neutral-500">{count}</span>}
    </div>
);

const EmptyGroup: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <p className="rounded-lg border border-dashed border-neutral-800 bg-neutral-950/40 px-2.5 py-2 text-[10px] text-neutral-500">{children}</p>
);

const TaskRow: React.FC<{
    task: TodayTaskEntry;
    starting: boolean;
    onSelectTask: (taskId: string) => void;
    onStartFocus: (task: TodayTaskEntry) => void;
}> = ({ task, starting, onSelectTask, onStartFocus }) => (
    <li className="flex items-start gap-2 rounded-lg border border-neutral-800 bg-neutral-900/60 p-2">
        <button
            type="button"
            onClick={() => onSelectTask(task.id)}
            className="min-w-0 flex-1 rounded text-left transition-colors hover:text-white focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400/60"
            aria-label={`Select ${task.title}`}
        >
            <span className="flex flex-wrap items-center gap-1.5">
                <span className="truncate text-[11px] font-medium text-neutral-100">{task.title}</span>
                {task.isActive && <span className="rounded-full bg-indigo-500/15 px-1.5 py-0.5 text-[9px] font-medium text-indigo-300">Running</span>}
                {task.bucket === "overdue" && <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] text-amber-300">Overdue</span>}
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-neutral-500">
                <span className="inline-flex min-w-0 items-center gap-1">
                    {task.projectColor && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: task.projectColor }} aria-hidden />}
                    <span className={task.projectName ? "truncate" : "text-amber-300/90"}>{task.projectName ?? "No project"}</span>
                </span>
                <span aria-hidden>·</span>
                <span>{formatPomodoroCount(task.remainingPomodoros)} left of {formatPomodoroCount(task.estimatePomos)}</span>
            </span>
        </button>
        <button
            type="button"
            onClick={() => onStartFocus(task)}
            disabled={starting}
            className="inline-flex shrink-0 items-center gap-1 rounded border border-emerald-400/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-medium text-emerald-200 transition-colors hover:bg-emerald-500/20 disabled:cursor-wait disabled:opacity-60"
            aria-label={`Start focus on ${task.title}`}
        >
            <Play size={10} aria-hidden />
            {starting ? "Starting…" : "Focus"}
        </button>
    </li>
);

const HabitRow: React.FC<{ habit: TodayHabitEntry; onToggle: (habit: TodayHabitEntry) => void }> = ({ habit, onToggle }) => (
    <li>
        <button
            type="button"
            aria-pressed={habit.completed}
            aria-label={`${habit.name} (${habit.frequency})`}
            onClick={() => onToggle(habit)}
            className={`flex w-full items-center gap-2 rounded-lg border p-2 text-left transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400/60 ${
                habit.completed ? "border-neutral-700 bg-neutral-900/80" : "border-neutral-800 bg-neutral-900/40 hover:border-neutral-700"
            }`}
        >
            <span
                className={`grid h-5 w-5 shrink-0 place-items-center rounded border ${habit.completed ? "border-transparent text-white" : "border-neutral-600 text-transparent"}`}
                style={habit.completed ? { backgroundColor: habit.color } : undefined}
                aria-hidden
            >
                <Check size={12} />
            </span>
            <span className={`min-w-0 flex-1 truncate text-[11px] ${habit.completed ? "text-neutral-300 line-through" : "text-neutral-100"}`} style={habit.completed ? undefined : { color: habit.color }}>
                {habit.name}
            </span>
            <span className="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-[9px] capitalize text-neutral-400">{habit.frequency}</span>
        </button>
    </li>
);

export const TodaySurface: React.FC<TodaySurfaceProps> = ({ onSelectTask }) => {
    const { state, startTaskWork, createTask } = useAppState();
    const { state: pmState, updateTask } = usePM();
    const habitContext = useHabits();
    const { play } = useSounds();
    const [expanded, setExpanded] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    const [startingTaskId, setStartingTaskId] = useState<string | null>(null);

    const timer = state?.timer ?? null;
    const activeFraction = computeActiveFractionComplete(timer, Date.now(), state?.settings?.work_minutes ?? 0);
    const overview = buildTodayOverview({
        pmTasks: Object.values(pmState.tasks),
        backendTasks: state?.tasks ?? {},
        projects: pmState.projects,
        activeWorkTaskId: timer?.kind === "Work" ? timer.task_id : null,
        activeWorkFraction: activeFraction,
        reference: new Date(),
        habits: Object.values(habitContext.state.habits),
        completions: Object.values(habitContext.state.completions),
        logs: state?.logs ?? [],
    });

    const toggleExpanded = () => {
        setExpanded((open) => !open);
        setNotice(null);
        play("pressSide");
    };

    const handleToggleHabit = (habit: TodayHabitEntry) => {
        play("pressSide");
        if (habit.completed) habitContext.uncheckCompletion(habit.id, habit.bucket);
        else habitContext.checkCompletion(habit.id, habit.bucket);
    };

    const handleStartFocus = async (task: TodayTaskEntry) => {
        if (timer) {
            setNotice(`A timer is already running. Finish or stop it before starting focus on “${task.title}”.`);
            return;
        }
        setNotice(null);
        setStartingTaskId(task.id);
        try {
            let appTaskId = task.appTaskId;
            if (!appTaskId) {
                const created = await createTask(task.title, Math.max(1, Math.floor(task.estimatePomos)));
                appTaskId = created.id;
                updateTask(task.id, { appTaskId: created.id });
            }
            await startTaskWork(appTaskId);
            play("startPomodoro");
        } catch (error) {
            setNotice(error instanceof Error && error.message ? error.message : "Unable to start focus.");
        } finally {
            setStartingTaskId(null);
        }
    };

    const { tasks, remainingPomodoros, habits, habitsCompleted, pomodoros } = overview;

    return (
        <section className="relative w-full overflow-hidden rounded-xl border border-emerald-400/20 bg-neutral-900/75 text-left shadow-lg shadow-black/10" aria-label="Today">
            <div className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-emerald-500/10 blur-3xl" />
            <button
                type="button"
                onClick={toggleExpanded}
                aria-expanded={expanded}
                aria-controls={CONTENT_ID}
                className="relative flex w-full items-start gap-2.5 p-3 text-left transition-colors hover:bg-white/[0.02] focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400/60"
            >
                <span className="mt-0.5 shrink-0 text-neutral-500" aria-hidden>
                    {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                </span>
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-400/10 text-emerald-300 ring-1 ring-emerald-400/20">
                    <CalendarDays size={15} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                    <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300">Today</span>
                    <span className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-neutral-400">
                        <span className="rounded-full border border-white/5 bg-white/[0.03] px-2 py-0.5">
                            {tasks.length === 0 ? "No tasks" : `${taskCountLabel(tasks.length)} · ${formatPomodoroCount(remainingPomodoros)} left`}
                        </span>
                        <span className="rounded-full border border-white/5 bg-white/[0.03] px-2 py-0.5">
                            {habits.length === 0 ? "No habits" : `${habitsCompleted}/${habits.length} habits`}
                        </span>
                        <span className="rounded-full border border-white/5 bg-white/[0.03] px-2 py-0.5">
                            {pomodoros.count === 0 ? "No pomodoros" : `${formatPomodoroCount(pomodoros.count)} · ${formatDurationMinutes(pomodoros.minutes)}`}
                        </span>
                    </span>
                </span>
            </button>

            {expanded && (
                <div id={CONTENT_ID} className="app-scrollbar relative max-h-[min(65vh,32rem)] overflow-y-auto border-t border-white/5 px-3 pb-3">
                    {notice && (
                        <p role="status" className="mt-3 rounded-md bg-amber-400/5 px-2.5 py-1.5 text-[10px] text-amber-300/90 ring-1 ring-inset ring-amber-400/10">
                            {notice}
                        </p>
                    )}

                    <div className="mt-3 space-y-2">
                        <GroupHeading count={tasks.length > 0 ? `${formatPomodoroCount(remainingPomodoros)} left` : undefined}>Tasks</GroupHeading>
                        {tasks.length === 0 ? (
                            <EmptyGroup>No tasks are due today.</EmptyGroup>
                        ) : (
                            <ul className="space-y-1.5">
                                {tasks.map((task) => (
                                    <TaskRow
                                        key={task.id}
                                        task={task}
                                        starting={startingTaskId === task.id}
                                        onSelectTask={onSelectTask}
                                        onStartFocus={(entry) => void handleStartFocus(entry)}
                                    />
                                ))}
                            </ul>
                        )}
                    </div>

                    <div className="mt-4 space-y-2">
                        <GroupHeading count={habits.length > 0 ? `${habitsCompleted}/${habits.length} done` : undefined}>Habits</GroupHeading>
                        {habits.length === 0 ? (
                            <EmptyGroup>No habits yet.</EmptyGroup>
                        ) : (
                            <ul className="space-y-1.5">
                                {habits.map((habit) => (
                                    <HabitRow key={habit.id} habit={habit} onToggle={handleToggleHabit} />
                                ))}
                            </ul>
                        )}
                    </div>

                    <div className="mt-4 space-y-2">
                        <GroupHeading count={pomodoros.count > 0 ? `${formatPomodoroCount(pomodoros.count)} · ${formatDurationMinutes(pomodoros.minutes)}` : undefined}>Pomodoros</GroupHeading>
                        {pomodoros.count === 0 ? (
                            <EmptyGroup>No pomodoros completed today.</EmptyGroup>
                        ) : (
                            <ul className="space-y-1">
                                {pomodoros.sessions.map((session) => (
                                    <li key={session.id} className="flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900/40 px-2.5 py-1.5 text-[10px]">
                                        <span className="tabular-nums text-neutral-400">
                                            {new Date(session.finishedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                                        </span>
                                        <span className="min-w-0 flex-1 truncate text-neutral-300" title={session.taskTitle}>{session.taskTitle}</span>
                                        <span className="shrink-0 text-neutral-500">{formatDurationMinutes(session.durationMinutes)}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            )}
        </section>
    );
};
