/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
    readonly VITE_SUPABASE_URL: string;
    readonly VITE_SUPABASE_ANON_KEY: string;
    /** Canonical hosted PWA origin used for recovery and OAuth callback redirects. */
    readonly VITE_PUBLIC_APP_URL?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}

declare module "*.mp3" {
    const src: string;
    export default src;
}
