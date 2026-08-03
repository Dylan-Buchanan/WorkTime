import { isTauri } from "@tauri-apps/api/core";

/**
 * Browser-safe adapter over the Tauri window/event handshake used by the close
 * provider. `listen` subscribes to the Rust-emitted `worktime-close-requested`
 * event, `signalReady` tells Rust the listener is confirmed registered so it
 * starts intercepting close requests (until then native closes are allowed),
 * `signalUnready` tells Rust the listener is going away so it stops intercepting
 * (a reloaded frontend re-arms readiness after its new listener is registered),
 * and `approveAndClose` signals `worktime-close-approved` before calling
 * `window.close()` so the Rust allow-once flag is set before the second close
 * request arrives.
 */
export interface TauriCloseAdapter {
    listen(handler: () => void): Promise<() => void>;
    signalReady(): Promise<void>;
    signalUnready(): Promise<void>;
    approveAndClose(): Promise<void>;
}

/**
 * Creates the adapter only inside a Tauri webview. Returns null for web builds
 * (native close interception does not exist there) and on any import/listen
 * failure, logging a concise warning while leaving normal web behavior
 * untouched. The readiness signal is emitted only after a successful
 * `listen`, so a broken adapter or listener leaves the native handler in its
 * allow-closes state instead of trapping the window.
 */
export async function createTauriCloseAdapter(): Promise<TauriCloseAdapter | null> {
    if (!isTauri()) return null;
    try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const window = getCurrentWindow();
        return {
            async listen(handler: () => void) {
                return window.listen("worktime-close-requested", () => handler());
            },
            async signalReady() {
                await window.emit("worktime-close-ready");
            },
            async signalUnready() {
                await window.emit("worktime-close-unready");
            },
            async approveAndClose() {
                await window.emit("worktime-close-approved");
                await window.close();
            },
        };
    } catch (err) {
        console.warn("Failed to initialize the Tauri close handshake", err);
        return null;
    }
}
