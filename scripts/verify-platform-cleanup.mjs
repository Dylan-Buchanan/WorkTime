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
