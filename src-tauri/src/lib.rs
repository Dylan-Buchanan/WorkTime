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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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

// =============================================================================
// Pure domain logic.
//
// Every piece of timer/task behavior is expressed as a function operating on
// `&mut AppStateData` (plus an explicit `now` where the result is time-sensitive).
// The Tauri commands below are thin wrappers: lock, call, persist, return.
// Keeping this logic pure lets us unit test the full engine without a Tauri
// runtime, and gives Phase 0 a faithful spec to port to TypeScript.
// =============================================================================

fn create_task_internal(s: &mut AppStateData, name: String, target_pomodoros: u32, now: DateTime<Utc>) -> Task {
    let task = Task {
        id: Uuid::new_v4(),
        name,
        target_pomodoros: target_pomodoros.max(1),
        completed_pomodoros: 0.0,
        created_at: now,
        completed_at: None,
        break_skips: 0,
        archived: false,
    };
    s.tasks.insert(task.id, task.clone());
    task
}

fn update_settings_internal(s: &mut AppStateData, settings: Settings) -> Settings {
    s.settings = settings;
    s.settings.clone()
}

/// Maintenance pass run on every `get_state`: auto-archive any task with a
/// `completed_at` timestamp, and clear the active selection if it was archived.
/// Returns `true` if state was mutated so the caller knows to persist.
fn run_get_state_maintenance(s: &mut AppStateData) -> bool {
    let mut mutated = false;
    for task in s.tasks.values_mut() {
        if task.completed_at.is_some() && !task.archived {
            task.archived = true;
            mutated = true;
        }
    }
    if let Some(active_id) = s.active_task {
        if s.tasks
            .get(&active_id)
            .map(|t| t.archived)
            .unwrap_or(false)
        {
            s.active_task = None;
            mutated = true;
        }
    }
    mutated
}

fn set_active_task_internal(s: &mut AppStateData, id: Uuid, now: DateTime<Utc>) -> Result<(), String> {
    if !s.tasks.contains_key(&id) {
        return Err("Task not found".into());
    }

    if let Some(timer) = s.timer.clone() {
        if timer.kind == TimerKind::Work && timer.task_id != id {
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
    Ok(())
}

fn start_work_timer_internal(s: &mut AppStateData, now: DateTime<Utc>) -> Result<ActiveTimer, String> {
    let task_id = s.active_task.ok_or("No active task")?;
    let mins = s.settings.work_minutes as i64;

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
    Ok(timer)
}

fn start_break_timer_internal(s: &mut AppStateData, now: DateTime<Utc>) -> Result<ActiveTimer, String> {
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
    Ok(timer)
}

fn complete_timer_internal(s: &mut AppStateData, now: DateTime<Utc>) -> Result<AppStateData, String> {
    let timer = s.timer.clone().ok_or("No active timer")?;
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
    Ok(s.clone())
}

fn stop_work_timer_internal(s: &mut AppStateData, now: DateTime<Utc>) -> Result<AppStateData, String> {
    let timer = s.timer.clone().ok_or("No active timer")?;
    if timer.kind != TimerKind::Work {
        return Err("Not a work timer".into());
    }
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
    Ok(s.clone())
}

fn skip_break_internal(s: &mut AppStateData, now: DateTime<Utc>) -> Result<AppStateData, String> {
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
            finished_at: now,
            was_break: true,
            break_skipped: true,
        });
        s.timer = None;
    } else {
        return Err("No active break".into());
    }
    Ok(s.clone())
}

fn pause_timer_internal(s: &mut AppStateData, now: DateTime<Utc>) -> Result<ActiveTimer, String> {
    let mut timer = s.timer.clone().ok_or("No active timer")?;
    if timer.paused {
        return Err("Already paused".into());
    }
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
    Ok(timer)
}

fn resume_timer_internal(s: &mut AppStateData, now: DateTime<Utc>) -> Result<ActiveTimer, String> {
    let mut timer = s.timer.clone().ok_or("No active timer")?;
    if !timer.paused {
        return Err("Timer not paused".into());
    }
    let new_end = now + chrono::Duration::seconds(timer.paused_remaining_secs);
    timer.paused = false;
    timer.started_at = now; // new segment start; accumulated_secs preserves prior progress
    timer.ends_at = new_end;
    timer.paused_remaining_secs = 0;
    s.timer = Some(timer.clone());
    Ok(timer)
}

fn finalize_task_internal(s: &mut AppStateData, task_id: Uuid, now: DateTime<Utc>) -> Result<Task, String> {
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
            task_mut.completed_at = Some(now);
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
    Ok(cloned)
}

fn delete_task_internal(s: &mut AppStateData, task_id: Uuid) -> Result<(), String> {
    s.tasks.remove(&task_id).ok_or("Task not found")?;
    if s.active_task == Some(task_id) {
        s.active_task = None;
    }
    Ok(())
}

fn archive_task_internal(s: &mut AppStateData, task_id: Uuid) -> Result<Task, String> {
    let mut_task_ref = s.tasks.get_mut(&task_id).ok_or("Task not found")?;
    mut_task_ref.archived = true;
    Ok(mut_task_ref.clone())
}

fn set_task_target_internal(s: &mut AppStateData, task_id: Uuid, target: u32) -> Result<Task, String> {
    let task = s.tasks.get_mut(&task_id).ok_or("Task not found")?;
    let new_target = target.max(1); // always at least 1
    task.target_pomodoros = new_target;
    // If target set below completed progress, leave as-is; next maintenance pass may auto-extend again.
    if task.completed_pomodoros > task.target_pomodoros as f32 {
        task.target_pomodoros = task.completed_pomodoros.ceil() as u32;
    }
    Ok(task.clone())
}

fn reset_app_state_internal(s: &mut AppStateData) -> AppStateData {
    *s = AppStateData::default();
    s.clone()
}

// =============================================================================
// Tauri command wrappers
// =============================================================================

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
    if run_get_state_maintenance(&mut s_guard) {
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
    let task = create_task_internal(&mut s, payload.name, payload.target_pomodoros, Utc::now());
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
    let result = update_settings_internal(&mut s, settings);
    save_state(&app, &s)?;
    Ok(result)
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
    set_active_task_internal(&mut s, id, Utc::now())?;
    save_state(&app, &s)?;
    Ok(())
}

#[tauri::command]
fn start_work_timer(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
) -> Result<ActiveTimer, String> {
    let mut s = state.0.lock().unwrap();
    let timer = start_work_timer_internal(&mut s, Utc::now())?;
    save_state(&app, &s)?;
    Ok(timer)
}

#[tauri::command]
fn complete_timer(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
) -> Result<AppStateData, String> {
    let mut s = state.0.lock().unwrap();
    let result = complete_timer_internal(&mut s, Utc::now())?;

    // Send notification if app not focused (front-end decides; we just always fire)
    // TODO: Send desktop notification (API differs per platform); placeholder no-op for compile.
    let _ = app.notification();

    save_state(&app, &s)?;
    Ok(result)
}

#[tauri::command]
fn start_break_timer(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
) -> Result<ActiveTimer, String> {
    let mut s = state.0.lock().unwrap();
    let timer = start_break_timer_internal(&mut s, Utc::now())?;
    save_state(&app, &s)?;
    Ok(timer)
}

#[tauri::command]
fn skip_break(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
) -> Result<AppStateData, String> {
    let mut s = state.0.lock().unwrap();
    let result = skip_break_internal(&mut s, Utc::now())?;
    save_state(&app, &s)?;
    Ok(result)
}

#[tauri::command]
fn delete_task(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    task_id: Uuid,
) -> Result<(), String> {
    let mut s = state.0.lock().unwrap();
    delete_task_internal(&mut s, task_id)?;
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
    let result = archive_task_internal(&mut s, task_id)?;
    save_state(&app, &s)?;
    Ok(result)
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
    let result = stop_work_timer_internal(&mut s, Utc::now())?;
    save_state(&app, &s)?;
    Ok(result)
}

#[tauri::command]
fn pause_timer(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
) -> Result<ActiveTimer, String> {
    let mut s = state.0.lock().unwrap();
    let timer = pause_timer_internal(&mut s, Utc::now())?;
    save_state(&app, &s)?;
    Ok(timer)
}

#[tauri::command]
fn resume_timer(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
) -> Result<ActiveTimer, String> {
    let mut s = state.0.lock().unwrap();
    let timer = resume_timer_internal(&mut s, Utc::now())?;
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
    let result = finalize_task_internal(&mut s, task_id, Utc::now())?;
    save_state(&app, &s)?;
    Ok(result)
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
    let result = set_task_target_internal(&mut s, task_id, target)?;
    save_state(&app, &s)?;
    Ok(result)
}

#[tauri::command]
fn reset_app_state(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
) -> Result<AppStateData, String> {
    let mut s = state.0.lock().unwrap();
    let result = reset_app_state_internal(&mut s);
    save_state(&app, &s)?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn dt(secs: i64) -> DateTime<Utc> {
        Utc.timestamp_opt(secs, 0).unwrap()
    }

    fn make_task(s: &mut AppStateData, name: &str, target: u32, now: DateTime<Utc>) -> Task {
        create_task_internal(s, name.to_string(), target, now)
    }

    fn make_state_with_task(target: u32, now: DateTime<Utc>) -> (AppStateData, Uuid) {
        let mut s = AppStateData::default();
        let task = make_task(&mut s, "Test Task", target, now);
        s.active_task = Some(task.id);
        (s, task.id)
    }

    // ---- create_task ----
    #[test]
    fn create_task_clamps_target_to_at_least_one() {
        let mut s = AppStateData::default();
        let now = dt(1_000_000);
        let t = create_task_internal(&mut s, "hi".into(), 0, now);
        assert_eq!(t.target_pomodoros, 1);
        assert_eq!(t.completed_pomodoros, 0.0);
        assert_eq!(t.archived, false);
        assert_eq!(t.completed_at, None);
        assert_eq!(s.tasks.len(), 1);
    }

    #[test]
    fn create_task_preserves_target_and_created_at() {
        let mut s = AppStateData::default();
        let now = dt(1_000_000);
        let t = create_task_internal(&mut s, "deep".into(), 8, now);
        assert_eq!(t.target_pomodoros, 8);
        assert_eq!(t.created_at, now);
    }

    // ---- get_state maintenance ----
    #[test]
    fn maintenance_archives_completed_tasks_and_clears_active() {
        let mut s = AppStateData::default();
        let now = dt(1_000_000);
        let mut t = make_task(&mut s, "done".into(), 3, now);
        t.completed_at = Some(now);
        let done_id = t.id;
        s.tasks.insert(done_id, t);
        s.active_task = Some(done_id);

        assert!(run_get_state_maintenance(&mut s));
        assert!(s.tasks[&done_id].archived);
        assert_eq!(s.active_task, None);
    }

    #[test]
    fn maintenance_is_noop_when_nothing_to_do() {
        let mut s = AppStateData::default();
        let now = dt(1_000_000);
        make_task(&mut s, "active".into(), 2, now);
        assert!(!run_get_state_maintenance(&mut s));
    }

    // ---- start_work_timer ----
    #[test]
    fn start_work_timer_requires_active_task() {
        let mut s = AppStateData::default();
        assert_eq!(start_work_timer_internal(&mut s, dt(1_000_000)).unwrap_err(), "No active task");
    }

    #[test]
    fn start_work_timer_sets_work_timer_using_settings() {
        let (mut s, _) = make_state_with_task(4, dt(1_000_000));
        let timer = start_work_timer_internal(&mut s, dt(1_000_000)).unwrap();
        assert_eq!(timer.kind, TimerKind::Work);
        assert_eq!(timer.planned_secs, 25 * 60);
        assert_eq!(timer.accumulated_secs, 0);
        assert!(!timer.paused);
        assert_eq!(s.timer.as_ref().unwrap().task_id, timer.task_id);
    }

    #[test]
    fn start_work_timer_resets_cycle_when_window_elapsed() {
        let (mut s, task_id) = make_state_with_task(4, dt(1_000_000));
        let work_start = dt(1_000_000);
        // Complete one work session to set the cycle counter
        start_work_timer_internal(&mut s, work_start).unwrap();
        s.timer.as_mut().unwrap().ends_at = work_start + chrono::Duration::seconds(25 * 60);
        let finish = work_start + chrono::Duration::seconds(25 * 60);
        complete_timer_internal(&mut s, finish).unwrap();
        assert_eq!(s.current_cycle_pomodoros, 1);

        // Start work again well past the full cycle window (>= full_cycle_duration_secs)
        let far_future = finish + chrono::Duration::seconds(full_cycle_duration_secs(&s.settings));
        start_work_timer_internal(&mut s, far_future).unwrap();
        assert_eq!(s.current_cycle_pomodoros, 0, "cycle should reset when window elapsed");
        assert_eq!(s.timer.as_ref().unwrap().task_id, task_id);
    }

    #[test]
    fn start_work_timer_keeps_cycle_within_window() {
        let (mut s, _) = make_state_with_task(4, dt(1_000_000));
        let work_start = dt(1_000_000);
        start_work_timer_internal(&mut s, work_start).unwrap();
        s.timer.as_mut().unwrap().ends_at = work_start + chrono::Duration::seconds(25 * 60);
        let finish = work_start + chrono::Duration::seconds(25 * 60);
        complete_timer_internal(&mut s, finish).unwrap();
        assert_eq!(s.current_cycle_pomodoros, 1);

        // Restart soon after finishing — should NOT reset the cycle
        let soon = finish + chrono::Duration::seconds(60);
        start_work_timer_internal(&mut s, soon).unwrap();
        assert_eq!(s.current_cycle_pomodoros, 1);
    }

    // ---- start_break_timer ----
    #[test]
    fn start_break_timer_uses_short_break_by_default() {
        let (mut s, _) = make_state_with_task(4, dt(1_000_000));
        let timer = start_break_timer_internal(&mut s, dt(1_000_000)).unwrap();
        assert_eq!(timer.kind, TimerKind::ShortBreak);
        assert_eq!(timer.planned_secs, 5 * 60);
    }

    #[test]
    fn start_break_timer_uses_long_break_at_segment_boundary_and_resets_cycle() {
        let (mut s, _) = make_state_with_task(4, dt(1_000_000));
        s.current_cycle_pomodoros = 4; // segment_length = 4
        let timer = start_break_timer_internal(&mut s, dt(1_000_000)).unwrap();
        assert_eq!(timer.kind, TimerKind::LongBreak);
        assert_eq!(timer.planned_secs, 20 * 60);
        assert_eq!(s.current_cycle_pomodoros, 0);
    }

    #[test]
    fn start_break_timer_requires_active_task() {
        let mut s = AppStateData::default();
        assert_eq!(start_break_timer_internal(&mut s, dt(1_000_000)).unwrap_err(), "No active task");
    }

    // ---- complete_timer ----
    #[test]
    fn complete_timer_requires_finished_timer() {
        let (mut s, _) = make_state_with_task(4, dt(1_000_000));
        start_work_timer_internal(&mut s, dt(1_000_000)).unwrap();
        let early = dt(1_000_000 + 60);
        assert_eq!(complete_timer_internal(&mut s, early).unwrap_err(), "Timer not finished yet");
    }

    #[test]
    fn complete_timer_accrues_fractional_pomodoro_and_logs() {
        let (mut s, task_id) = make_state_with_task(4, dt(1_000_000));
        start_work_timer_internal(&mut s, dt(1_000_000)).unwrap();
        // Advance exactly one work session
        let finish = dt(1_000_000 + 25 * 60);
        let result = complete_timer_internal(&mut s, finish).unwrap();
        assert!((result.tasks[&task_id].completed_pomodoros - 1.0).abs() < 1e-6);
        assert_eq!(result.logs.len(), 1);
        assert!(!result.logs[0].was_break);
        assert!((result.logs[0].duration_minutes - 25.0).abs() < 1e-6);
        assert_eq!(result.timer, None);
        assert_eq!(result.current_cycle_pomodoros, 1);
    }

    #[test]
    fn complete_timer_does_not_extend_target_within_estimate() {
        let (mut s, task_id) = make_state_with_task(4, dt(1_000_000));
        start_work_timer_internal(&mut s, dt(1_000_000)).unwrap();
        let finish = dt(1_000_000 + 25 * 60);
        complete_timer_internal(&mut s, finish).unwrap();
        assert_eq!(s.tasks[&task_id].target_pomodoros, 4);
    }

    #[test]
    fn complete_timer_extends_target_when_exceeding_estimate() {
        let (mut s, task_id) = make_state_with_task(2, dt(1_000_000));
        // Two full sessions -> completed = 2 which is NOT strictly greater than target, so no extend.
        for _ in 0..2 {
            start_work_timer_internal(&mut s, dt(1_000_000)).unwrap();
            s.timer.as_mut().unwrap().ends_at = dt(1_000_000 + 25 * 60);
            complete_timer_internal(&mut s, dt(1_000_000 + 25 * 60)).unwrap();
        }
        assert_eq!(s.tasks[&task_id].completed_pomodoros, 2.0);
        assert_eq!(s.tasks[&task_id].target_pomodoros, 2);

        // Third session pushes completed to 3 > 2 -> auto-extend target to 3
        start_work_timer_internal(&mut s, dt(1_000_000)).unwrap();
        s.timer.as_mut().unwrap().ends_at = dt(1_000_000 + 25 * 60);
        complete_timer_internal(&mut s, dt(1_000_000 + 25 * 60)).unwrap();
        assert_eq!(s.tasks[&task_id].completed_pomodoros, 3.0);
        assert_eq!(s.tasks[&task_id].target_pomodoros, 3);
    }

    #[test]
    fn complete_timer_logs_break_and_does_not_increment_cycle() {
        let (mut s, _) = make_state_with_task(4, dt(1_000_000));
        s.current_cycle_pomodoros = 3;
        start_break_timer_internal(&mut s, dt(1_000_000)).unwrap();
        s.timer.as_mut().unwrap().ends_at = dt(1_000_000 + 5 * 60);
        let result = complete_timer_internal(&mut s, dt(1_000_000 + 5 * 60)).unwrap();
        assert_eq!(result.logs.len(), 1);
        assert!(result.logs[0].was_break);
        assert_eq!(result.current_cycle_pomodoros, 3, "breaks must not increment cycle");
    }

    // ---- stop_work_timer ----
    #[test]
    fn stop_work_timer_requires_work_timer() {
        let (mut s, _) = make_state_with_task(4, dt(1_000_000));
        start_break_timer_internal(&mut s, dt(1_000_000)).unwrap();
        assert_eq!(stop_work_timer_internal(&mut s, dt(1_000_000)).unwrap_err(), "Not a work timer");
    }

    #[test]
    fn stop_work_timer_accrues_partial_progress() {
        let (mut s, task_id) = make_state_with_task(4, dt(1_000_000));
        start_work_timer_internal(&mut s, dt(1_000_000)).unwrap();
        // Stop 12.5 minutes in (half of 25)
        let stop = dt(1_000_000 + 12 * 60 + 30);
        let result = stop_work_timer_internal(&mut s, stop).unwrap();
        assert!((result.tasks[&task_id].completed_pomodoros - 0.5).abs() < 1e-6);
        assert_eq!(result.logs.len(), 1);
        assert!((result.logs[0].duration_minutes - 12.5).abs() < 1e-6);
        assert_eq!(result.timer, None);
    }

    #[test]
    fn stop_work_timer_does_not_complete_task() {
        let (mut s, task_id) = make_state_with_task(1, dt(1_000_000));
        start_work_timer_internal(&mut s, dt(1_000_000)).unwrap();
        let stop = dt(1_000_000 + 25 * 60);
        let result = stop_work_timer_internal(&mut s, stop).unwrap();
        assert_eq!(result.tasks[&task_id].completed_at, None, "stop must not finalize");
    }

    // ---- pause / resume ----
    #[test]
    fn pause_timer_accumulates_elapsed_and_keeps_remaining() {
        let (mut s, _) = make_state_with_task(4, dt(1_000_000));
        start_work_timer_internal(&mut s, dt(1_000_000)).unwrap();
        let paused = pause_timer_internal(&mut s, dt(1_000_000 + 10 * 60)).unwrap();
        assert!(paused.paused);
        assert_eq!(paused.accumulated_secs, 10 * 60);
        assert_eq!(paused.paused_remaining_secs, 15 * 60);
    }

    #[test]
    fn pause_timer_twice_is_error() {
        let (mut s, _) = make_state_with_task(4, dt(1_000_000));
        start_work_timer_internal(&mut s, dt(1_000_000)).unwrap();
        pause_timer_internal(&mut s, dt(1_000_000 + 60)).unwrap();
        assert_eq!(pause_timer_internal(&mut s, dt(1_000_000 + 120)).unwrap_err(), "Already paused");
    }

    #[test]
    fn resume_timer_extends_end_time_by_remaining() {
        let (mut s, _) = make_state_with_task(4, dt(1_000_000));
        start_work_timer_internal(&mut s, dt(1_000_000)).unwrap();
        let paused = pause_timer_internal(&mut s, dt(1_000_000 + 10 * 60)).unwrap();
        // Resume 5 min later (wall clock), remaining should still be 15 min
        let resumed = resume_timer_internal(&mut s, dt(1_000_000 + 15 * 60)).unwrap();
        assert!(!resumed.paused);
        assert_eq!(resumed.accumulated_secs, 10 * 60);
        assert_eq!(resumed.paused_remaining_secs, 0);
        let expected_end = dt(1_000_000 + 15 * 60) + chrono::Duration::seconds(15 * 60);
        assert_eq!(resumed.ends_at, expected_end);
        assert_eq!(paused.paused_remaining_secs, 15 * 60);
    }

    #[test]
    fn resume_timer_when_not_paused_is_error() {
        let (mut s, _) = make_state_with_task(4, dt(1_000_000));
        start_work_timer_internal(&mut s, dt(1_000_000)).unwrap();
        assert_eq!(resume_timer_internal(&mut s, dt(1_000_000 + 60)).unwrap_err(), "Timer not paused");
    }

    #[test]
    fn resume_then_stop_preserves_total_progress() {
        let (mut s, task_id) = make_state_with_task(4, dt(1_000_000));
        start_work_timer_internal(&mut s, dt(1_000_000)).unwrap();
        // Work 10 min, pause 30 min, resume, work 12.5 more min => 22.5 min total
        pause_timer_internal(&mut s, dt(1_000_000 + 10 * 60)).unwrap();
        resume_timer_internal(&mut s, dt(1_000_000 + 40 * 60)).unwrap();
        let stop = dt(1_000_000 + 52 * 60 + 30);
        let result = stop_work_timer_internal(&mut s, stop).unwrap();
        let expected = 22.5 / 25.0;
        assert!((result.tasks[&task_id].completed_pomodoros - expected).abs() < 1e-6);
    }

    // ---- skip_break ----
    #[test]
    fn skip_break_increments_skips_and_logs() {
        let (mut s, task_id) = make_state_with_task(4, dt(1_000_000));
        start_break_timer_internal(&mut s, dt(1_000_000)).unwrap();
        let result = skip_break_internal(&mut s, dt(1_000_000 + 60)).unwrap();
        assert_eq!(result.tasks[&task_id].break_skips, 1);
        assert_eq!(result.logs.len(), 1);
        assert!(result.logs[0].break_skipped);
        assert!(result.logs[0].was_break);
        assert_eq!(result.timer, None);
    }

    #[test]
    fn skip_break_on_work_timer_is_error() {
        let (mut s, _) = make_state_with_task(4, dt(1_000_000));
        start_work_timer_internal(&mut s, dt(1_000_000)).unwrap();
        assert_eq!(skip_break_internal(&mut s, dt(1_000_000 + 60)).unwrap_err(), "Not on a break");
    }

    #[test]
    fn skip_break_with_no_timer_is_error() {
        let mut s = AppStateData::default();
        assert_eq!(skip_break_internal(&mut s, dt(1_000_000)).unwrap_err(), "No active break");
    }

    // ---- set_active_task ----
    #[test]
    fn set_active_task_errors_for_missing_task() {
        let (mut s, _) = make_state_with_task(4, dt(1_000_000));
        let missing = Uuid::new_v4();
        assert!(set_active_task_internal(&mut s, missing, dt(1_000_000)).is_err());
    }

    #[test]
    fn set_active_task_switches_selection_without_timer() {
        let (mut s, _) = make_state_with_task(4, dt(1_000_000));
        let other = make_task(&mut s, "Other".into(), 2, dt(1_000_000));
        set_active_task_internal(&mut s, other.id, dt(1_000_000)).unwrap();
        assert_eq!(s.active_task, Some(other.id));
    }

    #[test]
    fn set_active_task_prorates_progress_when_switching_mid_work() {
        let (mut s, first_id) = make_state_with_task(4, dt(1_000_000));
        let other = make_task(&mut s, "Other".into(), 2, dt(1_000_000));
        start_work_timer_internal(&mut s, dt(1_000_000)).unwrap();
        // Switch after 12.5 minutes
        set_active_task_internal(&mut s, other.id, dt(1_000_000 + 12 * 60 + 30)).unwrap();
        assert!((s.tasks[&first_id].completed_pomodoros - 0.5).abs() < 1e-6);
        assert_eq!(s.logs.len(), 1);
        // Timer now belongs to the new task with remaining planned time
        let timer = s.timer.as_ref().unwrap();
        assert_eq!(timer.task_id, other.id);
        assert_eq!(timer.planned_secs, 25 * 60 - 12 * 60 - 30);
        assert_eq!(s.active_task, Some(other.id));
    }

    #[test]
    fn set_active_task_to_same_task_does_not_prorate() {
        let (mut s, task_id) = make_state_with_task(4, dt(1_000_000));
        start_work_timer_internal(&mut s, dt(1_000_000)).unwrap();
        set_active_task_internal(&mut s, task_id, dt(1_000_000 + 10 * 60)).unwrap();
        assert_eq!(s.tasks[&task_id].completed_pomodoros, 0.0);
        assert_eq!(s.logs.len(), 0);
    }

    // ---- finalize_task ----
    #[test]
    fn finalize_task_archives_and_completes() {
        let (mut s, task_id) = make_state_with_task(4, dt(1_000_000));
        s.tasks.get_mut(&task_id).unwrap().completed_pomodoros = 3.5;
        let now = dt(2_000_000);
        let task = finalize_task_internal(&mut s, task_id, now).unwrap();
        assert_eq!(task.completed_at, Some(now));
        assert!(task.archived);
        assert_eq!(task.target_pomodoros, 4); // ceil(3.5)
        assert_eq!(s.active_task, None);
    }

    #[test]
    fn finalize_task_errors_for_missing_task() {
        let mut s = AppStateData::default();
        assert!(finalize_task_internal(&mut s, Uuid::new_v4(), dt(1_000_000)).is_err());
    }

    // ---- set_task_target ----
    #[test]
    fn set_task_target_clamps_to_one_and_never_below_progress() {
        let (mut s, task_id) = make_state_with_task(4, dt(1_000_000));
        s.tasks.get_mut(&task_id).unwrap().completed_pomodoros = 2.5;
        let task = set_task_target_internal(&mut s, task_id, 0).unwrap();
        assert_eq!(task.target_pomodoros, 3); // max(1, ceil(2.5))
        let task = set_task_target_internal(&mut s, task_id, 5).unwrap();
        assert_eq!(task.target_pomodoros, 5);
    }

    #[test]
    fn set_task_target_errors_for_missing_task() {
        let mut s = AppStateData::default();
        assert!(set_task_target_internal(&mut s, Uuid::new_v4(), 3).is_err());
    }

    // ---- delete / archive ----
    #[test]
    fn delete_task_removes_and_clears_active() {
        let (mut s, task_id) = make_state_with_task(4, dt(1_000_000));
        delete_task_internal(&mut s, task_id).unwrap();
        assert!(!s.tasks.contains_key(&task_id));
        assert_eq!(s.active_task, None);
    }

    #[test]
    fn delete_missing_task_errors() {
        let mut s = AppStateData::default();
        assert!(delete_task_internal(&mut s, Uuid::new_v4()).is_err());
    }

    #[test]
    fn archive_task_marks_archived() {
        let (mut s, task_id) = make_state_with_task(4, dt(1_000_000));
        let t = archive_task_internal(&mut s, task_id).unwrap();
        assert!(t.archived);
    }

    // ---- reset ----
    #[test]
    fn reset_returns_default_state() {
        let (mut s, _) = make_state_with_task(4, dt(1_000_000));
        start_work_timer_internal(&mut s, dt(1_000_000)).unwrap();
        let reset = reset_app_state_internal(&mut s);
        assert!(reset.tasks.is_empty());
        assert!(reset.logs.is_empty());
        assert_eq!(reset.timer, None);
        assert_eq!(reset.current_cycle_pomodoros, 0);
    }

    // ---- settings / cycle math ----
    #[test]
    fn update_settings_roundtrips() {
        let mut s = AppStateData::default();
        let custom = Settings {
            work_minutes: 50,
            short_break_minutes: 10,
            long_break_minutes: 30,
            segment_length: 2,
        };
        let result = update_settings_internal(&mut s, custom.clone());
        assert_eq!(result.work_minutes, 50);
        assert_eq!(s.settings.segment_length, 2);
    }

    #[test]
    fn full_cycle_duration_uses_settings() {
        let settings = Settings::default();
        // 25*4 work + 5*3 short + 20 long = 100 + 15 + 20 = 135 min
        assert_eq!(full_cycle_duration_secs(&settings), 135 * 60);
    }
}
