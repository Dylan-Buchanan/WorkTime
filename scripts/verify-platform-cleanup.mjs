import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const failures = [];
const lib = read("src-tauri/src/lib.rs");
const cargo = read("src-tauri/Cargo.toml");
const packageJson = read("package.json");
const agents = read("AGENTS.md");
const config = read("src-tauri/tauri.conf.json");
const capabilities = read("src-tauri/capabilities/default.json");

if (!lib.includes("tauri_plugin_opener::init()") || !lib.includes("tauri_plugin_notification::init()")) failures.push("native plugin initializers must remain");
if (/#\[tauri::command\]|invoke_handler/.test(lib)) failures.push("Tauri commands or invoke_handler remain in lib.rs");

// Functional close-handshake checks: bare string presence can be satisfied by
// comments or dead code, so verify the listener/flags and the ordering inside
// the native handler.
const closeNeedles = ["WindowEvent::CloseRequested", "prevent_close()", "worktime-close-requested", "worktime-close-approved", "worktime-close-ready", "worktime-close-unready"];
for (const needle of closeNeedles) if (!lib.includes(needle)) failures.push(`lib.rs must reference ${needle} for the close handshake`);
if (!lib.includes('app.listen("worktime-close-approved"') || !lib.includes("CLOSE_APPROVED.store(true")) {
    failures.push("lib.rs must arm CLOSE_APPROVED from the worktime-close-approved listener");
}
if (!lib.includes('app.listen("worktime-close-ready"') || !lib.includes("CLOSE_INTERCEPT_READY.store(true")) {
    failures.push("lib.rs must arm CLOSE_INTERCEPT_READY from the worktime-close-ready listener");
}
if (!lib.includes('app.listen("worktime-close-unready"') || !lib.includes("CLOSE_INTERCEPT_READY.store(false")) {
    failures.push("lib.rs must disarm CLOSE_INTERCEPT_READY from the worktime-close-unready listener");
}
if (!lib.includes("on_page_load") || !lib.includes("CLOSE_INTERCEPT_READY.store(false")) {
    failures.push("lib.rs must disarm CLOSE_INTERCEPT_READY on every page load");
}
if (!lib.includes("CLOSE_APPROVED.swap(false")) failures.push("lib.rs must consume CLOSE_APPROVED once so an approved close is allowed");
if (!lib.includes("CLOSE_INTERCEPT_READY.load")) failures.push("lib.rs must gate close prevention on CLOSE_INTERCEPT_READY");
const readyCheck = lib.indexOf("CLOSE_INTERCEPT_READY.load");
const prevent = lib.indexOf("prevent_close()");
const approveConsume = lib.indexOf("CLOSE_APPROVED.swap(false");
if (readyCheck === -1 || prevent === -1 || readyCheck > prevent) {
    failures.push("lib.rs must check CLOSE_INTERCEPT_READY before calling prevent_close()");
}
if (approveConsume === -1 || approveConsume > prevent) {
    failures.push("lib.rs must consume CLOSE_APPROVED before intercepting a close request");
}

// A real Rust compile gate: the string checks prove the handshake text exists,
// but only the compiler proves the close lifecycle still builds and links.
try {
    execFileSync("cargo", ["check", "--quiet", "--manifest-path", join(root, "src-tauri", "Cargo.toml")], {
        cwd: root,
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf8",
    });
} catch (error) {
    const detail = (error.stderr || error.stdout || error.message || "").toString().trim().split(/\r?\n/).slice(-3).join("; ");
    failures.push(`cargo check failed for the Tauri shell: ${detail || "compilation error"}`);
}

for (const dependency of ["chrono", "uuid", "serde", "serde_json"]) if (new RegExp(`^${dependency}\\s*=`, "m").test(cargo)) failures.push(`${dependency} remains a direct Cargo dependency`);
for (const dependency of ["tauri", "tauri-plugin-opener", "tauri-plugin-notification"]) if (!new RegExp(`^${dependency}\\s*=`, "m").test(cargo)) failures.push(`${dependency} is missing from Cargo.toml`);
if (existsSync(join(root, "e2e/mock-ipc.js"))) failures.push("obsolete e2e/mock-ipc.js still exists");
for (const [name, content] of [["package.json", packageJson], ["AGENTS.md", agents]]) if (/test:rust|mock-ipc/.test(content)) failures.push(`${name} contains stale Rust/IPC workflow guidance`);
if (!config.includes('"beforeBuildCommand": "npm run build"') || !config.includes('"frontendDist": "../dist"')) failures.push("Tauri must retain the local dist build contract");
for (const permission of ["opener:default", "notification:default", "notification:allow-request-permission"]) if (!capabilities.includes(permission)) failures.push(`missing capability ${permission}`);

if (failures.length) {
    console.error("Platform cleanup verification failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
}
console.log("Platform cleanup verification passed.");
