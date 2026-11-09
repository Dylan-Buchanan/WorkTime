// Terminates a leftover Vite dev server that still owns a dev port.
//
// On Windows, Ctrl+C in Git Bash (mintty) can return the shell to its prompt
// while the `cmd.exe -> node vite.js` child tree keeps running, so the next
// `pnpm dev` fails with "Port 3000 is already in use" even though nothing is
// visible. This script only kills processes it can identify as this project's
// Vite server; anything else is reported and left alone.

import { execFileSync } from "node:child_process";

const DEFAULT_PORTS = [3000, 3001];
const requested = process.argv.slice(2).map(Number).filter((port) => Number.isInteger(port) && port > 0);
const ports = requested.length > 0 ? requested : DEFAULT_PORTS;
const isWindows = process.platform === "win32";

function run(command, args) {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

function listeningPidsWindows(port) {
    const output = run("netstat", ["-ano", "-p", "TCP"]);
    const pids = new Set();
    for (const line of output.split(/\r?\n/)) {
        const columns = line.trim().split(/\s+/);
        if (columns.length < 5 || columns[3] !== "LISTENING") continue;
        if (!columns[1].endsWith(`:${port}`)) continue;
        const pid = Number(columns[4]);
        if (Number.isInteger(pid) && pid > 0) pids.add(pid);
    }
    return [...pids];
}

function listeningPidsPosix(port) {
    try {
        return run("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"])
            .split(/\r?\n/)
            .map(Number)
            .filter((pid) => Number.isInteger(pid) && pid > 0);
    } catch {
        return [];
    }
}

function commandLineWindows(pid) {
    try {
        return run("powershell", [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`,
        ]).trim();
    } catch {
        return "";
    }
}

function commandLinePosix(pid) {
    try {
        return run("ps", ["-p", String(pid), "-o", "command="]).trim();
    } catch {
        return "";
    }
}

function listeningPids(port) {
    return isWindows ? listeningPidsWindows(port) : listeningPidsPosix(port);
}

function commandLine(pid) {
    return isWindows ? commandLineWindows(pid) : commandLinePosix(pid);
}

function kill(pid) {
    if (isWindows) {
        run("taskkill", ["/PID", String(pid), "/T", "/F"]);
        return;
    }
    process.kill(pid, "SIGKILL");
}

const isOwnViteServer = (pid, command) => pid !== process.pid && /vite/i.test(command);

let killed = 0;
let blocked = 0;

for (const port of ports) {
    const pids = listeningPids(port);
    if (pids.length === 0) {
        console.log(`[dev:stop] Nothing is listening on port ${port}.`);
        continue;
    }

    for (const pid of pids) {
        const command = commandLine(pid);
        if (!isOwnViteServer(pid, command)) {
            console.error(
                `[dev:stop] Port ${port} is held by PID ${pid}, which does not look like this project's Vite server: ${command || "<unknown command>"}`
            );
            blocked += 1;
            continue;
        }

        try {
            kill(pid);
            killed += 1;
            console.log(`[dev:stop] Killed the leftover Vite server on port ${port} (PID ${pid}).`);
        } catch (error) {
            console.error(`[dev:stop] Could not kill PID ${pid} on port ${port}: ${error instanceof Error ? error.message : error}`);
            blocked += 1;
        }
    }
}

if (blocked > 0) process.exitCode = 1;
else if (killed > 0) console.log("[dev:stop] Port is free; run `pnpm dev` again.");
