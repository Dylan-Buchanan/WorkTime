import { registerSW } from "virtual:pwa-register";

export function registerServiceWorker(): void {
    if (typeof navigator === "undefined" || !navigator.serviceWorker) return;
    try {
        registerSW({ immediate: true, onRegisterError: () => undefined });
    } catch {
        // Service workers are optional in Tauri webviews and older browsers.
    }
}
