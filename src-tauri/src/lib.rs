use chrono::{DateTime, Utc};
use tauri::Manager; // for path(), manage()
use tauri_plugin_notification::NotificationExt; // Notification construction APIs vary; using extension only
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
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
fn data_file_path(app: &tauri::AppHandle) -> PathBuf { app.path().app_data_dir().unwrap().join("data.json") }

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
    if let Some(parent) = path.parent() { fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
    let data = serde_json::to_vec_pretty(state).map_err(|e| e.to_string())?;
    fs::write(path, data).map_err(|e| e.to_string())
}

// Commands
#[tauri::command]
fn get_state(state: tauri::State<AppState>) -> Result<AppStateData, String> {
    Ok(state.0.lock().unwrap().clone())
}

#[derive(Debug, Deserialize)]
struct NewTaskPayload { name: String, target_pomodoros: u32 }

#[tauri::command]
fn create_task(app: tauri::AppHandle, state: tauri::State<AppState>, payload: NewTaskPayload) -> Result<Task, String> {
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
fn update_settings(app: tauri::AppHandle, state: tauri::State<AppState>, settings: Settings) -> Result<Settings, String> {
    let mut s = state.0.lock().unwrap();
    s.settings = settings;
    save_state(&app, &s)?;
    Ok(s.settings.clone())
}

#[derive(Deserialize)]
struct SetActiveTaskArg { #[serde(alias="taskId")] task_id: Uuid }

#[tauri::command]
fn set_active_task(app: tauri::AppHandle, state: tauri::State<AppState>, task_id: Option<Uuid>, payload: Option<SetActiveTaskArg>) -> Result<(), String> {
    // Accept either direct param task_id or payload struct (robust to earlier front-end variants)
    let id = task_id.or_else(|| payload.map(|p| p.task_id)).ok_or("Missing task id")?;
    let mut s = state.0.lock().unwrap();
    if !s.tasks.contains_key(&id) { return Err("Task not found".into()); }
    s.active_task = Some(id);
    save_state(&app, &s)?; Ok(()) }

#[tauri::command]
fn start_work_timer(app: tauri::AppHandle, state: tauri::State<AppState>) -> Result<ActiveTimer, String> {
    let mut s = state.0.lock().unwrap();
    let task_id = s.active_task.ok_or("No active task")?;
    let mins = s.settings.work_minutes as i64;
    let now = Utc::now();
    let timer = ActiveTimer { task_id, started_at: now, ends_at: now + chrono::Duration::minutes(mins), kind: TimerKind::Work, paused: false, paused_remaining_secs: 0 };
    s.timer = Some(timer.clone());
    save_state(&app, &s)?;
    Ok(timer)
}

#[tauri::command]
fn complete_timer(app: tauri::AppHandle, state: tauri::State<AppState>) -> Result<AppStateData, String> {
    let mut s = state.0.lock().unwrap();
    let timer = s.timer.clone().ok_or("No active timer")?;
    let now = Utc::now();
    if now < timer.ends_at { return Err("Timer not finished yet".into()); }

    // Log
    let was_break = timer.kind != TimerKind::Work;
    s.logs.push(PomodoroLogEntry { task_id: timer.task_id, duration_minutes: ((timer.ends_at - timer.started_at).num_seconds() as f32)/60.0, finished_at: now, was_break, break_skipped: false });

    if !was_break {
        if let Some(task) = s.tasks.get_mut(&timer.task_id) {
            task.completed_pomodoros += 1.0;
            // Auto-extend if this would finish the task (user continues flow)
            if task.completed_at.is_none() && task.completed_pomodoros >= task.target_pomodoros as f32 {
                task.target_pomodoros += 1; // extend by one
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
fn start_break_timer(app: tauri::AppHandle, state: tauri::State<AppState>) -> Result<ActiveTimer, String> {
    let mut s = state.0.lock().unwrap();
    let task_id = s.active_task.ok_or("No active task")?; // tie break to active task for logging continuity
    let is_long = s.current_cycle_pomodoros >= s.settings.segment_length;
    if is_long { s.current_cycle_pomodoros = 0; }
    let mins = if is_long { s.settings.long_break_minutes } else { s.settings.short_break_minutes } as i64;
    let kind = if is_long { TimerKind::LongBreak } else { TimerKind::ShortBreak };
    let now = Utc::now();
    let timer = ActiveTimer { task_id, started_at: now, ends_at: now + chrono::Duration::minutes(mins), kind, paused: false, paused_remaining_secs: 0 };
    s.timer = Some(timer.clone());
    save_state(&app, &s)?;
    Ok(timer)
}

#[tauri::command]
fn skip_break(app: tauri::AppHandle, state: tauri::State<AppState>) -> Result<AppStateData, String> {
    let mut s = state.0.lock().unwrap();
    let timer_opt = s.timer.clone();
    if let Some(timer) = timer_opt {
        if timer.kind == TimerKind::Work { return Err("Not on a break".into()); }
        if let Some(task) = s.tasks.get_mut(&timer.task_id) { task.break_skips += 1; }
        s.logs.push(PomodoroLogEntry { task_id: timer.task_id, duration_minutes: 0.0, finished_at: Utc::now(), was_break: true, break_skipped: true });
        s.timer = None;
    } else { return Err("No active break".into()); }
    save_state(&app, &s)?; Ok(s.clone()) }

#[tauri::command]
fn delete_task(app: tauri::AppHandle, state: tauri::State<AppState>, task_id: Uuid) -> Result<(), String> {
    let mut s = state.0.lock().unwrap();
    s.tasks.remove(&task_id).ok_or("Task not found")?;
    if s.active_task == Some(task_id) { s.active_task = None; }
    save_state(&app, &s)?;
    Ok(())
}

#[tauri::command]
fn archive_task(app: tauri::AppHandle, state: tauri::State<AppState>, task_id: Uuid) -> Result<Task, String> {
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
            app.manage(AppState(Mutex::new(initial))); Ok(()) })
        .invoke_handler(tauri::generate_handler![
            get_state,
            create_task,
            update_settings,
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
            finalize_task
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn stop_work_timer(app: tauri::AppHandle, state: tauri::State<AppState>) -> Result<AppStateData, String> {
    let mut s = state.0.lock().unwrap();
    let timer = s.timer.clone().ok_or("No active timer")?;
    if timer.kind != TimerKind::Work { return Err("Not a work timer".into()); }
    let now = Utc::now();
    let total_secs = (timer.ends_at - timer.started_at).num_seconds() as f32;
    let elapsed_secs = (now - timer.started_at).num_seconds().clamp(0, total_secs as i64) as f32;
    let fraction = if total_secs > 0.0 { elapsed_secs / total_secs } else { 0.0 };
    if let Some(task) = s.tasks.get_mut(&timer.task_id) {
        task.completed_pomodoros += fraction;
        if task.completed_pomodoros >= task.target_pomodoros as f32 && task.completed_at.is_none() { task.completed_at = Some(now); }
    }
    s.logs.push(PomodoroLogEntry { task_id: timer.task_id, duration_minutes: elapsed_secs / 60.0, finished_at: now, was_break: false, break_skipped: false });
    s.timer = None;
    save_state(&app, &s)?;
    Ok(s.clone())
}

#[tauri::command]
fn pause_timer(app: tauri::AppHandle, state: tauri::State<AppState>) -> Result<ActiveTimer, String> {
    let mut s = state.0.lock().unwrap();
    let mut timer = s.timer.clone().ok_or("No active timer")?;
    if timer.paused { return Err("Already paused".into()); }
    let now = Utc::now();
    if now >= timer.ends_at { return Err("Timer already finished".into()); }
    let remaining = (timer.ends_at - now).num_seconds().max(0);
    timer.paused = true;
    timer.paused_remaining_secs = remaining;
    s.timer = Some(timer.clone());
    save_state(&app, &s)?;
    Ok(timer)
}

#[tauri::command]
fn resume_timer(app: tauri::AppHandle, state: tauri::State<AppState>) -> Result<ActiveTimer, String> {
    let mut s = state.0.lock().unwrap();
    let mut timer = s.timer.clone().ok_or("No active timer")?;
    if !timer.paused { return Err("Timer not paused".into()); }
    let now = Utc::now();
    let new_end = now + chrono::Duration::seconds(timer.paused_remaining_secs);
    timer.paused = false;
    timer.started_at = now; // treat resume as new start for remaining segment
    timer.ends_at = new_end;
    timer.paused_remaining_secs = 0;
    s.timer = Some(timer.clone());
    save_state(&app, &s)?;
    Ok(timer)
}

#[tauri::command]
fn finalize_task(app: tauri::AppHandle, state: tauri::State<AppState>, task_id: Uuid) -> Result<Task, String> {
    let mut s = state.0.lock().unwrap();
    if s.timer.as_ref().map(|t| t.task_id) == Some(task_id) { s.timer = None; }
    {
        let task_mut = s.tasks.get_mut(&task_id).ok_or("Task not found")?;
        if task_mut.completed_at.is_none() {
            task_mut.target_pomodoros = task_mut.completed_pomodoros.ceil() as u32;
            task_mut.completed_at = Some(Utc::now());
        }
    }
    let cloned = s.tasks.get(&task_id).unwrap().clone();
    save_state(&app, &s)?;
    Ok(cloned)
}
