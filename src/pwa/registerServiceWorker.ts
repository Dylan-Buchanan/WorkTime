import { isTauri } from "@tauri-apps/api/core";
import { registerSW } from "virtual:pwa-register";

export async function clearTauriPwaState(): Promise<void> {
    try {
        const registrations = await navigator.serviceWorker?.getRegistrations?.();
        await Promise.all((registrations ?? []).map((registration) => registration.unregister()));
    } catch {
        // A stale registration must not prevent the desktop app from starting.
    }

    try {
        const cacheNames = await globalThis.caches?.keys?.();
        await Promise.all((cacheNames ?? []).map((cacheName) => globalThis.caches.delete(cacheName)));
    } catch {
        // Cache Storage is optional in WebView environments.
    }
}

export function registerServiceWorker(): void {
    if (isTauri()) {
        void clearTauriPwaState();
        return;
    }

    if (typeof navigator === "undefined" || !navigator.serviceWorker) return;
    try {
        registerSW({ immediate: true, onRegisterError: () => undefined });
    } catch {
        // Service workers are optional in Tauri webviews and older browsers.
    }
}
