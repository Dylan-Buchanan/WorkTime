use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Listener};

/// Allow-once flag set by the frontend's `worktime-close-approved` emit. The
/// frontend always calls `getCurrentWindow().close()` after the handshake, which
/// fires a second `CloseRequested`; without consuming this flag the handler
/// would loop forever.
static CLOSE_APPROVED: AtomicBool = AtomicBool::new(false);

/// Set by the frontend's `worktime-close-ready` emit after its close-handshake
/// listener is confirmed registered. Until then a `CloseRequested` is allowed to
/// proceed, so an early startup close or a frontend whose adapter never
/// subscribed can never trap the window in an uninterruptible state. The flag is
/// disarmed by `worktime-close-unready` (frontend listener teardown) and on every
/// page load, so a reloaded or restarted frontend re-arms it only after its new
/// listener is confirmed registered.
static CLOSE_INTERCEPT_READY: AtomicBool = AtomicBool::new(false);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .on_page_load(|_, _| {
            // Every page load (initial load and full reloads) starts a fresh
            // frontend instance. Until that instance emits `worktime-close-ready`
            // after its listener is registered, native close requests stay
            // allowed, so a frontend that never re-subscribes can never trap the
            // window in an intercepted state.
            CLOSE_INTERCEPT_READY.store(false, Ordering::SeqCst);
        })
        .setup(|app| {
            app.listen("worktime-close-approved", |_| {
                CLOSE_APPROVED.store(true, Ordering::SeqCst);
            });
            app.listen("worktime-close-ready", |_| {
                CLOSE_INTERCEPT_READY.store(true, Ordering::SeqCst);
            });
            app.listen("worktime-close-unready", |_| {
                CLOSE_INTERCEPT_READY.store(false, Ordering::SeqCst);
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // A previously approved close is allowed exactly once.
                if CLOSE_APPROVED.swap(false, Ordering::SeqCst) {
                    return;
                }
                // Without a confirmed frontend handshake there is no listener
                // that can emit approval, so allow the close instead of
                // preventing it forever.
                if !CLOSE_INTERCEPT_READY.load(Ordering::SeqCst) {
                    return;
                }
                api.prevent_close();
                let _ = window.emit("worktime-close-requested", ());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
