#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const rootDir = fileURLToPath(new URL("../", import.meta.url));

function run(command, args) {
    const result = spawnSync(command, args, { cwd: rootDir, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.signal}).`);
}

function main() {
    const args = process.argv.slice(2);
    // Preserve the synchronization hook used by npm version.
    if (args.length === 0) {
        run(process.execPath, [join(rootDir, "scripts/sync-version.mjs")]);
        return;
    }

    const [bump, git] = args;
    if (!["major", "minor", "patch"].includes(bump) || args.length > 2 || (git !== undefined && git !== "git")) {
        throw new Error("Usage: pnpm run version <major|minor|patch> [git]");
    }

    // pnpm supplies its CLI path, avoiding Windows .cmd spawning and shell quoting.
    const pnpmPath = process.env.npm_execpath;
    if (!pnpmPath || !/pnpm/i.test(pnpmPath)) {
        throw new Error("Run this command through pnpm: pnpm run version <major|minor|patch> [git]");
    }
    if (git) run("git", ["rev-parse", "--show-toplevel"]);

    const packagePath = join(rootDir, "package.json");
    const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
    if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) {
        throw new Error(`Expected a major.minor.patch version; found ${pkg.version}`);
    }
    const parts = pkg.version.split(".").map(Number);
    const index = ["major", "minor", "patch"].indexOf(bump);
    parts[index] += 1;
    for (let i = index + 1; i < parts.length; i++) parts[i] = 0;
    pkg.version = parts.join(".");
    writeFileSync(packagePath, `${JSON.stringify(pkg, null, 4)}\n`);
    run(process.execPath, [join(rootDir, "scripts/sync-version.mjs")]);

    console.log(`Building v${pkg.version}...`);
    run(process.execPath, [pnpmPath, "tauri", "build"]);
    if (git) {
        run("git", ["add", "."]);
        run("git", ["commit", "-m", `v${pkg.version}`]);
    }
}

try {
    main();
} catch (error) {
    console.error(error.message);
    console.error("Stopped. Any version changes are kept so you can inspect or retry the build.");
    process.exitCode = 1;
}
