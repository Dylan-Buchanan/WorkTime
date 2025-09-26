use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::io::ErrorKind;
use std::path::PathBuf;
use std::sync::Mutex;
use std::{env, path::Path};
use tauri::Manager; // for path(), manage()
use tauri_plugin_notification::NotificationExt; // Notification construction APIs vary; using extension only
use uuid::Uuid;

// Data Models
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: Uuid,
    pub name: String,
    pub target_pomodoros: u32,
    pub completed_pomodoros: f32, // includes partials
    pub created_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub break_skips: u32,
    pub archived: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PomodoroLogEntry {
    pub task_id: Uuid,
    pub duration_minutes: f32,
    pub finished_at: DateTime<Utc>,
    pub was_break: bool,
    pub break_skipped: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub work_minutes: u32,
    pub short_break_minutes: u32,
    pub long_break_minutes: u32,
    pub segment_length: u32, // how many pomodoros before a long break
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            work_minutes: 25,
            short_break_minutes: 5,
            long_break_minutes: 20,
            segment_length: 4,
        }
    }
}

fn full_cycle_duration_secs(settings: &Settings) -> i64 {
    let segment = settings.segment_length.max(1) as i64;
    let work_secs = settings.work_minutes as i64 * 60;
    let short_break_secs = settings.short_break_minutes as i64 * 60;
    let long_break_secs = settings.long_break_minutes as i64 * 60;

    let mut total = work_secs * segment;
    if segment > 1 {
        total += short_break_secs * (segment - 1);
    }
    total + long_break_secs
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppStateData {
    pub tasks: HashMap<Uuid, Task>,
    pub logs: Vec<PomodoroLogEntry>,
    pub settings: Settings,
    pub active_task: Option<Uuid>,
    pub current_cycle_pomodoros: u32, // number completed in current segment cycle
    pub timer: Option<ActiveTimer>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveTimer {
    pub task_id: Uuid,
    pub started_at: DateTime<Utc>,
    pub ends_at: DateTime<Utc>,
    pub kind: TimerKind,
    pub paused: bool,
    pub paused_remaining_secs: i64, // remaining seconds when paused
    #[serde(default)]
    pub planned_secs: i64, // total planned active seconds (excludes paused gaps)
    #[serde(default)]
    pub accumulated_secs: i64, // active (non-paused) seconds elapsed before current run segment
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum TimerKind {
    Work,
    ShortBreak,
    LongBreak,
}

impl Default for AppStateData {
    fn default() -> Self {
        Self {
            tasks: HashMap::new(),
            logs: Vec::new(),
            settings: Settings::default(),
            active_task: None,
            current_cycle_pomodoros: 0,
            timer: None,
        }
    }
}

struct AppState(Mutex<AppStateData>);

// Persistence helpers
fn resolve_storage_path(app: &tauri::AppHandle, env_key: &str, default_filename: &str) -> PathBuf {
    if let Ok(custom) = env::var(env_key) {
        let trimmed = custom.trim();
        if !trimmed.is_empty() {
            let custom_path = Path::new(trimmed);
            return if custom_path.is_relative() {
                env::current_dir()
                    .map(|cwd| cwd.join(custom_path))
                    .unwrap_or_else(|_| custom_path.to_path_buf())
            } else {
                custom_path.to_path_buf()
            };
        }
    }

    if cfg!(debug_assertions) {
        return PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("dev-data")
            .join(default_filename);
    }

    app.path().app_data_dir().unwrap().join(default_filename)
}

fn data_file_path(app: &tauri::AppHandle) -> PathBuf {
    resolve_storage_path(app, "WORK_TIME_DATA_PATH", "data.json")
}

fn pm_data_file_path(app: &tauri::AppHandle) -> PathBuf {
    resolve_storage_path(app, "WORK_TIME_PM_DATA_PATH", "pm-state.json")
}

fn load_state(app: &tauri::AppHandle) -> AppStateData {
    let path = data_file_path(app);
    if let Ok(bytes) = fs::read(path) {
        if let Ok(state) = serde_json::from_slice::<AppStateData>(&bytes) {
            return state;
        }
    }
    AppStateData::default()
}

fn save_state(app: &tauri::AppHandle, state: &AppStateData) -> Result<(), String> {
    let path = data_file_path(app);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let data = serde_json::to_vec_pretty(state).map_err(|e| e.to_string())?;
    fs::write(path, data).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_pm_state(app: tauri::AppHandle) -> Result<Option<Value>, String> {
    let path = pm_data_file_path(&app);
    match fs::read(&path) {
        Ok(bytes) => serde_json::from_slice::<Value>(&bytes)
            .map(Some)
            .map_err(|err| format!("Failed to parse project manager state: {err}")),
        Err(err) => {
            if err.kind() == ErrorKind::NotFound {
                Ok(None)
            } else {
                Err(err.to_string())
            }
        }
    }
}

#[tauri::command]
fn save_pm_state(app: tauri::AppHandle, state: Value) -> Result<(), String> {
    let path = pm_data_file_path(&app);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let data = serde_json::to_vec_pretty(&state).map_err(|e| e.to_string())?;
    fs::write(path, data).map_err(|e| e.to_string())
}

// Commands
#[tauri::command]
fn get_state(app: tauri::AppHandle, state: tauri::State<AppState>) -> Result<AppStateData, String> {
    // Also perform a lightweight maintenance pass: any task that has a completed_at timestamp
    // but is not yet archived (perhaps from older versions) will be archived automatically
    // so it no longer appears in the selectable task list.
    let mut s_guard = state.0.lock().unwrap();
    let mut mutated = false;
    // Collect task ids needing archival
    for task in s_guard.tasks.values_mut() {
        if task.completed_at.is_some() && !task.archived {
            task.archived = true;
            mutated = true;
        }
    }
    // If active task is now archived, clear selection so user must choose a new active task.
    if let Some(active_id) = s_guard.active_task {
        if s_guard
            .tasks
            .get(&active_id)
            .map(|t| t.archived)
            .unwrap_or(false)
        {
            s_guard.active_task = None;
            mutated = true;
        }
    }
    if mutated {
        let _ = save_state(&app, &s_guard);
    }
    Ok(s_guard.clone())
}

#[derive(Debug, Deserialize)]
struct NewTaskPayload {
    name: String,
    target_pomodoros: u32,
}

#[tauri::command]
fn create_task(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    payload: NewTaskPayload,
) -> Result<Task, String> {
    let mut s = state.0.lock().unwrap();
    let task = Task {
        id: Uuid::new_v4(),
        name: payload.name,
        target_pomodoros: payload.target_pomodoros.max(1),
        completed_pomodoros: 0.0,
        created_at: Utc::now(),
        completed_at: None,
        break_skips: 0,
        archived: false,
    };
    s.tasks.insert(task.id, task.clone());
    save_state(&app, &s)?;
    Ok(task)
}

#[tauri::command]
fn update_settings(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    settings: Settings,
) -> Result<Settings, String> {
    let mut s = state.0.lock().unwrap();
    s.settings = settings;
    save_state(&app, &s)?;
    Ok(s.settings.clone())
}

#[derive(Deserialize)]
struct SetActiveTaskArg {
    #[serde(alias = "taskId")]
    task_id: Uuid,
}

#[tauri::command]
fn set_active_task(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    task_id: Option<Uuid>,
    payload: Option<SetActiveTaskArg>,
) -> Result<(), String> {
    // Accept either direct param task_id or payload struct (robust to earlier front-end variants)
    let id = task_id
        .or_else(|| payload.map(|p| p.task_id))
        .ok_or("Missing task id")?;
    let mut s = state.0.lock().unwrap();
    if !s.tasks.contains_key(&id) {
        return Err("Task not found".into());
    }

    if let Some(timer) = s.timer.clone() {
        if timer.kind == TimerKind::Work && timer.task_id != id {
            let now = Utc::now();
            let total_planned = if timer.planned_secs > 0 {
                timer.planned_secs
            } else {
                (timer.ends_at - timer.started_at).num_seconds()
            };
            let mut elapsed = if timer.paused {
                timer.accumulated_secs
            } else {
                timer.accumulated_secs + (now - timer.started_at).num_seconds().max(0)
            };
            if elapsed < 0 {
                elapsed = 0;
            }
            if elapsed > total_planned {
                elapsed = total_planned;
            }

            if elapsed > 0 {
                let work_secs = (s.settings.work_minutes as f32) * 60.0;
                if let Some(task) = s.tasks.get_mut(&timer.task_id) {
                    if work_secs > 0.0 {
                        let fraction = (elapsed as f32 / work_secs).clamp(0.0, 1.0);
                        task.completed_pomodoros += fraction;
                        if task.completed_pomodoros > task.target_pomodoros as f32 {
                            task.target_pomodoros = task.completed_pomodoros.ceil() as u32;
                        }
                    }
                }
                s.logs.push(PomodoroLogEntry {
                    task_id: timer.task_id,
                    duration_minutes: elapsed as f32 / 60.0,
                    finished_at: now,
                    was_break: false,
                    break_skipped: false,
                });
            }

            let remaining = total_planned - elapsed;
            if remaining > 0 {
                let mut updated_timer = timer;
                updated_timer.task_id = id;
                updated_timer.planned_secs = remaining;
                updated_timer.accumulated_secs = 0;
                if updated_timer.paused {
                    updated_timer.paused_remaining_secs = remaining;
                } else {
                    updated_timer.paused_remaining_secs = 0;
                }
                updated_timer.started_at = now;
                updated_timer.ends_at = now + chrono::Duration::seconds(remaining);
                s.timer = Some(updated_timer);
            } else {
                s.timer = None;
            }
        }
    }

    s.active_task = Some(id);
    save_state(&app, &s)?;
    Ok(())
}

#[tauri::command]
fn start_work_timer(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
) -> Result<ActiveTimer, String> {
    let mut s = state.0.lock().unwrap();
    let task_id = s.active_task.ok_or("No active task")?;
    let mins = s.settings.work_minutes as i64;
    let now = Utc::now();

    if s.current_cycle_pomodoros > 0 {
        if let Some(last_work) = s.logs.iter().rev().find(|log| !log.was_break) {
            let cycle_window = full_cycle_duration_secs(&s.settings);
            if cycle_window > 0 {
                let since_last = (now - last_work.finished_at).num_seconds();
                if since_last >= cycle_window {
                    s.current_cycle_pomodoros = 0;
                }
            }
        }
    }

    let planned_secs = mins * 60;
    let timer = ActiveTimer {
        task_id,
        started_at: now,
        ends_at: now + chrono::Duration::seconds(planned_secs),
        kind: TimerKind::Work,
        paused: false,
        paused_remaining_secs: 0,
        planned_secs,
        accumulated_secs: 0,
    };
    s.timer = Some(timer.clone());
    save_state(&app, &s)?;
    Ok(timer)
}

#[tauri::command]
fn complete_timer(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
) -> Result<AppStateData, String> {
    let mut s = state.0.lock().unwrap();
    let timer = s.timer.clone().ok_or("No active timer")?;
    let now = Utc::now();
    if now < timer.ends_at {
        return Err("Timer not finished yet".into());
    }

    // Log
    let was_break = timer.kind != TimerKind::Work;
    // For completed timers, we treat duration as the planned length (work or break)
    let planned_secs = if timer.planned_secs > 0 {
        timer.planned_secs
    } else {
        (timer.ends_at - timer.started_at).num_seconds()
    };
    let planned_secs_f = planned_secs as f32;
    s.logs.push(PomodoroLogEntry {
        task_id: timer.task_id,
        duration_minutes: planned_secs_f / 60.0,
        finished_at: now,
        was_break,
        break_skipped: false,
    });

    if !was_break {
        let work_secs = (s.settings.work_minutes as f32) * 60.0;
        if let Some(task) = s.tasks.get_mut(&timer.task_id) {
            let fraction = if work_secs > 0.0 {
                (planned_secs_f / work_secs).clamp(0.0, 1.0)
            } else {
                1.0
            };
            task.completed_pomodoros += fraction;
            // Auto-extend only if user exceeded original estimate (strictly greater)
            if task.completed_at.is_none()
                && task.completed_pomodoros > task.target_pomodoros as f32
            {
                task.target_pomodoros = task.completed_pomodoros.ceil() as u32; // raise to ceiling of actual
            }
        }
        s.current_cycle_pomodoros += 1;
    }
    // Decide next timer suggestion (not auto-start): none set here
    s.timer = None;

    // Send notification if app not focused (front-end decides; we just always fire)
    // TODO: Send desktop notification (API differs per platform); placeholder no-op for compile.
    let _ = app.notification();

    save_state(&app, &s)?;
    Ok(s.clone())
}

#[tauri::command]
fn start_break_timer(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
) -> Result<ActiveTimer, String> {
    let mut s = state.0.lock().unwrap();
    let task_id = s.active_task.ok_or("No active task")?; // tie break to active task for logging continuity
    let is_long = s.current_cycle_pomodoros >= s.settings.segment_length;
    if is_long {
        s.current_cycle_pomodoros = 0;
    }
    let mins = if is_long {
        s.settings.long_break_minutes
    } else {
        s.settings.short_break_minutes
    } as i64;
    let kind = if is_long {
        TimerKind::LongBreak
    } else {
        TimerKind::ShortBreak
    };
    let now = Utc::now();
    let planned_secs = mins * 60;
    let timer = ActiveTimer {
        task_id,
        started_at: now,
        ends_at: now + chrono::Duration::seconds(planned_secs),
        kind,
        paused: false,
        paused_remaining_secs: 0,
        planned_secs,
        accumulated_secs: 0,
    };
    s.timer = Some(timer.clone());
    save_state(&app, &s)?;
    Ok(timer)
}

#[tauri::command]
fn skip_break(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
) -> Result<AppStateData, String> {
    let mut s = state.0.lock().unwrap();
    let timer_opt = s.timer.clone();
    if let Some(timer) = timer_opt {
        if timer.kind == TimerKind::Work {
            return Err("Not on a break".into());
        }
        if let Some(task) = s.tasks.get_mut(&timer.task_id) {
            task.break_skips += 1;
        }
        s.logs.push(PomodoroLogEntry {
            task_id: timer.task_id,
            duration_minutes: 0.0,
            finished_at: Utc::now(),
            was_break: true,
            break_skipped: true,
        });
        s.timer = None;
    } else {
        return Err("No active break".into());
    }
    save_state(&app, &s)?;
    Ok(s.clone())
}

#[tauri::command]
fn delete_task(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    task_id: Uuid,
) -> Result<(), String> {
    let mut s = state.0.lock().unwrap();
    s.tasks.remove(&task_id).ok_or("Task not found")?;
    if s.active_task == Some(task_id) {
        s.active_task = None;
    }
    save_state(&app, &s)?;
    Ok(())
}

#[tauri::command]
fn archive_task(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    task_id: Uuid,
) -> Result<Task, String> {
    let mut s = state.0.lock().unwrap();
    let mut_task_ref = s.tasks.get_mut(&task_id).ok_or("Task not found")?;
    mut_task_ref.archived = true;
    let cloned = mut_task_ref.clone();
    save_state(&app, &s)?;
    Ok(cloned)
}

// Initialize backend
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let handle = app.handle();
            let initial = load_state(&handle);
            app.manage(AppState(Mutex::new(initial)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_state,
            create_task,
            update_settings,
            load_pm_state,
            save_pm_state,
            set_active_task,
            start_work_timer,
            start_break_timer,
            complete_timer,
            pause_timer,
            resume_timer,
            stop_work_timer,
            skip_break,
            delete_task,
            archive_task,
            finalize_task,
            set_task_target,
            reset_app_state
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn stop_work_timer(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
) -> Result<AppStateData, String> {
    let mut s = state.0.lock().unwrap();
    let timer = s.timer.clone().ok_or("No active timer")?;
    if timer.kind != TimerKind::Work {
        return Err("Not a work timer".into());
    }
    let now = Utc::now();
    // Use planned length for denominator and accumulated + current segment for elapsed
    let planned_secs = if timer.planned_secs > 0 {
        timer.planned_secs as f32
    } else {
        (timer.ends_at - timer.started_at).num_seconds() as f32
    };
    let current_segment = (now - timer.started_at).num_seconds().max(0) as f32;
    let elapsed_secs = timer.accumulated_secs as f32 + current_segment;
    let clamped_elapsed = elapsed_secs.min(planned_secs);
    let fraction = if planned_secs > 0.0 {
        clamped_elapsed / planned_secs
    } else {
        0.0
    };
    if let Some(task) = s.tasks.get_mut(&timer.task_id) {
        task.completed_pomodoros += fraction;
        // Do NOT set completed_at automatically here; user must finalize explicitly.
        if task.completed_pomodoros > task.target_pomodoros as f32 {
            // Extend target to ceiling of actual progress (keeps task visible)
            task.target_pomodoros = task.completed_pomodoros.ceil() as u32;
        }
    }
    s.logs.push(PomodoroLogEntry {
        task_id: timer.task_id,
        duration_minutes: clamped_elapsed / 60.0,
        finished_at: now,
        was_break: false,
        break_skipped: false,
    });
    s.timer = None;
    save_state(&app, &s)?;
    Ok(s.clone())
}

#[tauri::command]
fn pause_timer(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
) -> Result<ActiveTimer, String> {
    let mut s = state.0.lock().unwrap();
    let mut timer = s.timer.clone().ok_or("No active timer")?;
    if timer.paused {
        return Err("Already paused".into());
    }
    let now = Utc::now();
    if now >= timer.ends_at {
        return Err("Timer already finished".into());
    }
    // Accumulate active seconds so far in this run segment
    let segment_elapsed = (now - timer.started_at).num_seconds().max(0);
    timer.accumulated_secs += segment_elapsed;
    let remaining = if timer.planned_secs > 0 {
        (timer.planned_secs - timer.accumulated_secs).max(0)
    } else {
        (timer.ends_at - now).num_seconds().max(0)
    };
    timer.paused = true;
    timer.paused_remaining_secs = remaining;
    s.timer = Some(timer.clone());
    save_state(&app, &s)?;
    Ok(timer)
}

#[tauri::command]
fn resume_timer(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
) -> Result<ActiveTimer, String> {
    let mut s = state.0.lock().unwrap();
    let mut timer = s.timer.clone().ok_or("No active timer")?;
    if !timer.paused {
        return Err("Timer not paused".into());
    }
    let now = Utc::now();
    let new_end = now + chrono::Duration::seconds(timer.paused_remaining_secs);
    timer.paused = false;
    timer.started_at = now; // new segment start; accumulated_secs preserves prior progress
    timer.ends_at = new_end;
    timer.paused_remaining_secs = 0;
    s.timer = Some(timer.clone());
    save_state(&app, &s)?;
    Ok(timer)
}

#[tauri::command]
fn finalize_task(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    task_id: Uuid,
) -> Result<Task, String> {
    let mut s = state.0.lock().unwrap();
    if let Some(timer) = s.timer.clone() {
        if timer.task_id == task_id {
            if timer.kind == TimerKind::Work {
                s.timer = None;
            }
        }
    }
    {
        let task_mut = s.tasks.get_mut(&task_id).ok_or("Task not found")?;
        if task_mut.completed_at.is_none() {
            task_mut.target_pomodoros = task_mut.completed_pomodoros.ceil() as u32;
            task_mut.completed_at = Some(Utc::now());
        }
        // Auto-archive finalized tasks so they are removed from selectable list.
        if !task_mut.archived {
            task_mut.archived = true;
        }
    }
    // If the active task was just archived, clear the active selection.
    if s.active_task == Some(task_id) {
        s.active_task = None;
    }
    let cloned = s.tasks.get(&task_id).unwrap().clone();
    save_state(&app, &s)?;
    Ok(cloned)
}

// Explicitly update a task's target_pomodoros (used to sync Project Manager estimate changes)
#[tauri::command]
fn set_task_target(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    task_id: Uuid,
    target: u32,
) -> Result<Task, String> {
    let mut s = state.0.lock().unwrap();
    let task = s.tasks.get_mut(&task_id).ok_or("Task not found")?;
    let new_target = target.max(1); // always at least 1
    task.target_pomodoros = new_target;
    // If target set below completed progress, leave as-is; next maintenance pass may auto-extend again.
    if task.completed_pomodoros > task.target_pomodoros as f32 {
        task.target_pomodoros = task.completed_pomodoros.ceil() as u32;
    }
    let cloned = task.clone();
    save_state(&app, &s)?;
    Ok(cloned)
}

#[tauri::command]
fn reset_app_state(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
) -> Result<AppStateData, String> {
    let mut s = state.0.lock().unwrap();
    *s = AppStateData::default();
    save_state(&app, &s)?;
    Ok(s.clone())
}
