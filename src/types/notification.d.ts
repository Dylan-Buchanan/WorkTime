declare module "@tauri-apps/plugin-notification" {
    export function isPermissionGranted(): Promise<boolean>;
    export function requestPermission(): Promise<void>;
    export function sendNotification(opts: {
        title: string;
        body?: string;
    }): void;
}
