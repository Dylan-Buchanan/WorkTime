// Playwright e2e mock of the Tauri IPC bridge.
//
// Injected via context.addInitScript so `window.__TAURI_INTERNALS__.invoke`
// exists before the React app loads. It is a faithful JS port of the commands
// in src-tauri/src/lib.rs, backed by an in-memory store. Tests can seed/assert
// state through `window.__TEST_BACKEND__`.
(function () {
    if (window.__TAURI_INTERNALS__ && window.__TEST_BACKEND__) return;

    function uid() {
        if (window.crypto && typeof window.crypto.randomUUID === "function") {
            return window.crypto.randomUUID();
        }
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
            var r = (Math.random() * 16) | 0;
            var v = c === "x" ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    }

    function nowIso() {
        return new Date().toISOString();
    }

    function defaultState() {
        return {
            tasks: {},
            logs: [],
            settings: {
                work_minutes: 25,
                short_break_minutes: 5,
                long_break_minutes: 20,
                segment_length: 4,
            },
            active_task: null,
            current_cycle_pomodoros: 0,
            timer: null,
        };
    }

    function fullCycleSecs(settings) {
        var segment = Math.max(1, settings.segment_length);
        var work = settings.work_minutes * 60;
        var short = settings.short_break_minutes * 60;
        var long = settings.long_break_minutes * 60;
        var total = work * segment;
        if (segment > 1) total += short * (segment - 1);
        total += long;
        return total;
    }

    function makeTimer(taskId, kind, minutes) {
        var now = Date.now();
        var planned = minutes * 60;
        return {
            task_id: taskId,
            started_at: new Date(now).toISOString(),
            ends_at: new Date(now + planned * 1000).toISOString(),
            kind: kind,
            paused: false,
            paused_remaining_secs: 0,
            planned_secs: planned,
            accumulated_secs: 0,
        };
    }

    function parseArgs(args) {
        return args || {};
    }

    var state = defaultState();
    var pmState = null;

    var handlers = {
        get_state: function () {
            // maintenance pass: auto-archive completed tasks, clear archived active
            var mutated = false;
            Object.keys(state.tasks).forEach(function (id) {
                var t = state.tasks[id];
                if (t.completed_at && !t.archived) {
                    t.archived = true;
                    mutated = true;
                }
            });
            if (state.active_task && state.tasks[state.active_task] && state.tasks[state.active_task].archived) {
                state.active_task = null;
                mutated = true;
            }
            return state;
        },

        create_task: function (args) {
            var payload = args.payload || args;
            var task = {
                id: uid(),
                name: payload.name,
                target_pomodoros: Math.max(1, Number(payload.target_pomodoros) || 1),
                completed_pomodoros: 0,
                created_at: nowIso(),
                completed_at: null,
                break_skips: 0,
                archived: false,
            };
            state.tasks[task.id] = task;
            return task;
        },

        update_settings: function (args) {
            state.settings = args.settings;
            return state.settings;
        },

        load_pm_state: function () {
            return pmState;
        },

        save_pm_state: function (args) {
            pmState = args.state;
            return null;
        },

        set_active_task: function (args) {
            var a = parseArgs(args);
            var id = a.task_id || a.taskId || (a.payload && (a.payload.task_id || a.payload.taskId));
            if (!state.tasks[id]) throw "Task not found";

            var timer = state.timer;
            if (timer && timer.kind === "Work" && timer.task_id !== id) {
                var now = Date.now();
                var totalPlanned = timer.planned_secs > 0 ? timer.planned_secs : (new Date(timer.ends_at) - new Date(timer.started_at)) / 1000;
                var elapsed = timer.paused
                    ? timer.accumulated_secs
                    : timer.accumulated_secs + Math.max(0, (now - new Date(timer.started_at).getTime()) / 1000);
                elapsed = Math.max(0, Math.min(elapsed, totalPlanned));

                if (elapsed > 0) {
                    var workSecs = state.settings.work_minutes * 60;
                    if (workSecs > 0) {
                        var task = state.tasks[timer.task_id];
                        var fraction = Math.min(1, Math.max(0, elapsed / workSecs));
                        task.completed_pomodoros += fraction;
                        if (task.completed_pomodoros > task.target_pomodoros) {
                            task.target_pomodoros = Math.ceil(task.completed_pomodoros);
                        }
                    }
                    state.logs.push({
                        task_id: timer.task_id,
                        duration_minutes: elapsed / 60,
                        finished_at: new Date(now).toISOString(),
                        was_break: false,
                        break_skipped: false,
                    });
                }

                var remaining = totalPlanned - elapsed;
                if (remaining > 0) {
                    state.timer = {
                        task_id: id,
                        planned_secs: remaining,
                        accumulated_secs: 0,
                        paused: timer.paused,
                        paused_remaining_secs: timer.paused ? remaining : 0,
                        kind: "Work",
                        started_at: new Date(now).toISOString(),
                        ends_at: new Date(now + remaining * 1000).toISOString(),
                    };
                } else {
                    state.timer = null;
                }
            }

            state.active_task = id;
            return null;
        },

        start_work_timer: function () {
            if (!state.active_task) throw "No active task";
            if (state.current_cycle_pomodoros > 0) {
                var lastWork = null;
                for (var i = state.logs.length - 1; i >= 0; i--) {
                    if (!state.logs[i].was_break) {
                        lastWork = state.logs[i];
                        break;
                    }
                }
                if (lastWork) {
                    var cycleWindow = fullCycleSecs(state.settings);
                    if (cycleWindow > 0) {
                        var since = (Date.now() - new Date(lastWork.finished_at).getTime()) / 1000;
                        if (since >= cycleWindow) state.current_cycle_pomodoros = 0;
                    }
                }
            }
            var t = makeTimer(state.active_task, "Work", state.settings.work_minutes);
            state.timer = t;
            return t;
        },

        start_break_timer: function () {
            if (!state.active_task) throw "No active task";
            var isLong = state.current_cycle_pomodoros >= state.settings.segment_length;
            if (isLong) state.current_cycle_pomodoros = 0;
            var minutes = isLong ? state.settings.long_break_minutes : state.settings.short_break_minutes;
            var t = makeTimer(state.active_task, isLong ? "LongBreak" : "ShortBreak", minutes);
            state.timer = t;
            return t;
        },

        complete_timer: function () {
            var timer = state.timer;
            if (!timer) throw "No active timer";
            var now = Date.now();
            if (now < new Date(timer.ends_at).getTime()) throw "Timer not finished yet";

            var wasBreak = timer.kind !== "Work";
            var planned = timer.planned_secs > 0 ? timer.planned_secs : (new Date(timer.ends_at) - new Date(timer.started_at)) / 1000;

            state.logs.push({
                task_id: timer.task_id,
                duration_minutes: planned / 60,
                finished_at: new Date(now).toISOString(),
                was_break: wasBreak,
                break_skipped: false,
            });

            if (!wasBreak) {
                var workSecs = state.settings.work_minutes * 60;
                var task = state.tasks[timer.task_id];
                var fraction = workSecs > 0 ? Math.min(1, Math.max(0, planned / workSecs)) : 1;
                task.completed_pomodoros += fraction;
                if (!task.completed_at && task.completed_pomodoros > task.target_pomodoros) {
                    task.target_pomodoros = Math.ceil(task.completed_pomodoros);
                }
                state.current_cycle_pomodoros += 1;
            }
            state.timer = null;
            return state;
        },

        stop_work_timer: function () {
            var timer = state.timer;
            if (!timer) throw "No active timer";
            if (timer.kind !== "Work") throw "Not a work timer";
            var now = Date.now();
            var planned = timer.planned_secs > 0 ? timer.planned_secs : (new Date(timer.ends_at) - new Date(timer.started_at)) / 1000;
            var currentSegment = Math.max(0, (now - new Date(timer.started_at).getTime()) / 1000);
            var elapsed = Math.min(planned, timer.accumulated_secs + currentSegment);
            var fraction = planned > 0 ? elapsed / planned : 0;
            var task = state.tasks[timer.task_id];
            task.completed_pomodoros += fraction;
            if (task.completed_pomodoros > task.target_pomodoros) {
                task.target_pomodoros = Math.ceil(task.completed_pomodoros);
            }
            state.logs.push({
                task_id: timer.task_id,
                duration_minutes: elapsed / 60,
                finished_at: new Date(now).toISOString(),
                was_break: false,
                break_skipped: false,
            });
            state.timer = null;
            return state;
        },

        pause_timer: function () {
            var timer = state.timer;
            if (!timer) throw "No active timer";
            if (timer.paused) throw "Already paused";
            var now = Date.now();
            if (now >= new Date(timer.ends_at).getTime()) throw "Timer already finished";
            var segment = Math.max(0, (now - new Date(timer.started_at).getTime()) / 1000);
            timer.accumulated_secs += segment;
            var remaining = timer.planned_secs > 0 ? Math.max(0, timer.planned_secs - timer.accumulated_secs) : Math.max(0, (new Date(timer.ends_at).getTime() - now) / 1000);
            timer.paused = true;
            timer.paused_remaining_secs = remaining;
            state.timer = timer;
            return timer;
        },

        resume_timer: function () {
            var timer = state.timer;
            if (!timer) throw "No active timer";
            if (!timer.paused) throw "Timer not paused";
            var now = Date.now();
            var newEnd = now + timer.paused_remaining_secs * 1000;
            timer.paused = false;
            timer.started_at = new Date(now).toISOString();
            timer.ends_at = new Date(newEnd).toISOString();
            timer.paused_remaining_secs = 0;
            state.timer = timer;
            return timer;
        },

        skip_break: function () {
            var timer = state.timer;
            if (!timer) throw "No active break";
            if (timer.kind === "Work") throw "Not on a break";
            var task = state.tasks[timer.task_id];
            if (task) task.break_skips += 1;
            state.logs.push({
                task_id: timer.task_id,
                duration_minutes: 0,
                finished_at: nowIso(),
                was_break: true,
                break_skipped: true,
            });
            state.timer = null;
            return state;
        },

        delete_task: function (args) {
            var id = parseArgs(args).task_id || parseArgs(args).taskId;
            if (!state.tasks[id]) throw "Task not found";
            delete state.tasks[id];
            if (state.active_task === id) state.active_task = null;
            return null;
        },

        archive_task: function (args) {
            var id = parseArgs(args).task_id || parseArgs(args).taskId;
            var t = state.tasks[id];
            if (!t) throw "Task not found";
            t.archived = true;
            return t;
        },

        finalize_task: function (args) {
            var id = parseArgs(args).task_id || parseArgs(args).taskId;
            if (state.timer && state.timer.task_id === id && state.timer.kind === "Work") {
                state.timer = null;
            }
            var t = state.tasks[id];
            if (!t) throw "Task not found";
            if (!t.completed_at) {
                t.target_pomodoros = Math.ceil(t.completed_pomodoros);
                t.completed_at = nowIso();
            }
            t.archived = true;
            if (state.active_task === id) state.active_task = null;
            return t;
        },

        set_task_target: function (args) {
            var id = parseArgs(args).task_id || parseArgs(args).taskId;
            var t = state.tasks[id];
            if (!t) throw "Task not found";
            var target = Math.max(1, Number(args.target) || 1);
            t.target_pomodoros = target;
            if (t.completed_pomodoros > t.target_pomodoros) {
                t.target_pomodoros = Math.ceil(t.completed_pomodoros);
            }
            return t;
        },

        reset_app_state: function () {
            state = defaultState();
            return state;
        },
    };

    function invoke(cmd, args) {
        return Promise.resolve().then(function () {
            var handler = handlers[cmd];
            if (!handler) {
                // Unknown plugin commands (e.g. notification) resolve to a benign no-op/rejection.
                throw "Unhandled command: " + cmd;
            }
            return handler(args);
        });
    }

    window.__TAURI_INTERNALS__ = {
        invoke: invoke,
        transformCallback: function () {
            return 0;
        },
        convertFileSrc: function (p) {
            return p;
        },
        unregisterCallback: function () {},
    };
    window.__TAURI_IPC__ = true;

    window.__TEST_BACKEND__ = {
        getState: function () {
            return JSON.parse(JSON.stringify(state));
        },
        setState: function (next) {
            state = JSON.parse(JSON.stringify(next));
        },
        getPMState: function () {
            return pmState;
        },
        setPMState: function (next) {
            pmState = JSON.parse(JSON.stringify(next));
        },
        reset: function () {
            state = defaultState();
            pmState = null;
        },
    };
})();
