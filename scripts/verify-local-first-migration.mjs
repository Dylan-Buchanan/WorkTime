// Local-only historical migration replay gate for
// supabase/migrations/20260802000000_sync_metadata.sql.
//
// This script is strictly a local development safety check: it refuses to run
// against any non-loopback Supabase URL, resets the local database to the
// migration immediately before the sync-metadata migration, seeds pre-migration
// rows for a throwaway owner, replays the pending migration, and asserts the
// backfill/trigger contract. The finally block always performs a full local
// reset so subsequent integration and E2E suites start from the latest schema.
//
// Uses only node: built-ins (child_process and global fetch). It shells out to
// `npx supabase` and parses `npx supabase status -o env`, mirroring
// tests/supabase/localSupabase.ts; no new npm dependencies are required.
import { execFileSync, execSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

function run(command) {
    return execSync(command, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function refreshLocalGatewayDns() {
    const names = execFileSync(
        "docker",
        ["ps", "--filter", `label=com.supabase.cli.workdir=${root}`, "--format", "{{.Names}}"],
        { cwd: root, encoding: "utf8" },
    )
        .split(/\r?\n/)
        .filter(Boolean);
    const gateway = names.find((name) => name.startsWith("supabase_kong_"));
    if (!gateway) throw new Error("Could not locate this repo's local Supabase gateway container");
    // db reset can recreate Auth at a new container IP while Kong retains the
    // old DNS answer. Restarting only this repo's gateway refreshes that cache.
    execFileSync("docker", ["restart", gateway], { cwd: root, stdio: "ignore" });
}

function loadConfig() {
    const output = run("npx supabase status -o env");
    const values = {};
    for (const line of output.split(/\r?\n/)) {
        const match = line.match(/^([A-Z_]+)=(.*)$/);
        if (match) values[match[1]] = match[2].replace(/^"|"$/g, "");
    }
    if (!values.API_URL || !values.ANON_KEY || !values.SERVICE_ROLE_KEY) {
        throw new Error("Start the local Supabase stack before running the migration replay");
    }
    return { url: values.API_URL, anonKey: values.ANON_KEY, serviceRoleKey: values.SERVICE_ROLE_KEY };
}

function assertLoopback(url) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        parsed = null;
    }
    if (!parsed || (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost")) {
        console.error(`Refusing to run the migration replay against a non-loopback Supabase URL: ${url}`);
        console.error("This script is local-only and must never touch a hosted project.");
        process.exit(1);
    }
}

async function rest(config, accessToken, path, options = {}) {
    const response = await fetch(`${config.url}/rest/v1/${path}`, {
        ...options,
        headers: {
            apikey: config.anonKey,
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            ...(options.headers ?? {}),
        },
    });
    if (!response.ok) {
        throw new Error(`REST ${options.method ?? "GET"} ${path} failed (${response.status}): ${await response.text()}`);
    }
    if (response.status === 204) return null;
    const text = await response.text();
    if (!text) return null;
    return JSON.parse(text);
}

async function createThrowawayUser(config) {
    const password = "WorkTime-replay-123";
    let lastFailure = "local Auth did not become ready";
    // A local db reset restarts services asynchronously. Retry only transient
    // upstream/readiness failures, using a fresh throwaway address so an
    // ambiguous gateway response cannot turn the next attempt into a conflict.
    for (let attempt = 0; attempt < 12; attempt += 1) {
        const email = `worktime-replay-${Date.now()}-${attempt}-${Math.random().toString(36).slice(2)}@example.test`;
        let response;
        try {
            response = await fetch(`${config.url}/auth/v1/admin/users`, {
                method: "POST",
                headers: {
                    apikey: config.serviceRoleKey,
                    Authorization: `Bearer ${config.serviceRoleKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ email, password, email_confirm: true }),
            });
        } catch (error) {
            lastFailure = error instanceof Error ? error.message : String(error);
            await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
            continue;
        }
        if (response.ok) {
            const created = await response.json();
            if (!created.id) throw new Error("Admin user creation returned no user id");
            return { userId: created.id, email, password };
        }
        const body = await response.text();
        lastFailure = `Failed to create throwaway local user (${response.status}): ${body}`;
        if (response.status !== 502 && response.status !== 503) throw new Error(lastFailure);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
    }
    throw new Error(lastFailure);
}

async function signIn(config, email, password) {
    const response = await fetch(`${config.url}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: {
            apikey: config.anonKey,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
    });
    if (!response.ok) {
        throw new Error(`Failed to sign in throwaway local user (${response.status}): ${await response.text()}`);
    }
    const session = await response.json();
    if (!session.access_token) throw new Error("Sign-in returned no access token");
    return session.access_token;
}

const TASK_IDS = [
    "00000000-0000-4000-8000-0000000000a1",
    "00000000-0000-4000-8000-0000000000a2",
    "00000000-0000-4000-8000-0000000000a3",
];

async function seedPreMigrationRows(config, accessToken, userId) {
    await rest(config, accessToken, "tasks", {
        method: "POST",
        body: JSON.stringify([
            { id: TASK_IDS[0], owner_id: userId, name: "Pre-migration alpha", target_pomodoros: 1, completed_pomodoros: 0, created_at: "2025-01-01T00:00:00Z", completed_at: null, break_skips: 0, archived: false },
            { id: TASK_IDS[1], owner_id: userId, name: "Pre-migration beta", target_pomodoros: 2, completed_pomodoros: 1, created_at: "2025-06-15T12:30:00+05:00", completed_at: null, break_skips: 1, archived: false },
            { id: TASK_IDS[2], owner_id: userId, name: "Pre-migration gamma", target_pomodoros: 0, completed_pomodoros: 0, created_at: "2025-12-31T23:59:59.123456+00:00", completed_at: null, break_skips: 0, archived: true },
        ]),
    });
    await rest(config, accessToken, "settings", { method: "POST", body: JSON.stringify({ owner_id: userId, data: { theme: "dark" } }) });
    await rest(config, accessToken, "timer_state", { method: "POST", body: JSON.stringify({ owner_id: userId, data: { active_task: null, current_cycle_pomodoros: 0, timer: null } }) });
    await rest(config, accessToken, "pm_state", { method: "POST", body: JSON.stringify({ owner_id: userId, data: { projects: {}, tasks: {}, meta: { initializedAt: "pre-migration" } } }) });
}

const epoch = (value) => new Date(value).getTime();

async function assertBackfillAndTrigger(config, accessToken, userId) {
    const tasks = await rest(config, accessToken, `tasks?select=id,created_at,updated_at&owner_id=eq.${userId}`);
    if (tasks.length !== TASK_IDS.length) {
        throw new Error(`Expected ${TASK_IDS.length} seeded tasks, found ${tasks.length}`);
    }
    for (const task of tasks) {
        if (epoch(task.updated_at) !== epoch(task.created_at)) {
            throw new Error(`Task ${task.id} updated_at (${task.updated_at}) does not equal created_at (${task.created_at})`);
        }
    }

    const jsonb = [];
    for (const table of ["settings", "timer_state", "pm_state"]) {
        const rows = await rest(config, accessToken, `${table}?select=updated_at&owner_id=eq.${userId}`);
        if (rows.length !== 1) throw new Error(`Expected exactly one ${table} row, found ${rows.length}`);
        jsonb.push(...rows.map((row) => epoch(row.updated_at)));
    }
    const low = Math.min(...jsonb);
    const high = Math.max(...jsonb);
    if (high - low > 1000) {
        throw new Error(`JSONB rows do not share a single migration-window timestamp: ${jsonb.join(", ")}`);
    }

    const target = TASK_IDS[0];
    const before = await rest(config, accessToken, `tasks?select=updated_at&id=eq.${target}`);
    if (before.length !== 1) throw new Error(`Expected one task ${target}, found ${before.length}`);
    await rest(config, accessToken, `tasks?id=eq.${target}`, { method: "PATCH", body: JSON.stringify({ name: "Ordinary update" }) });
    const ordinary = await rest(config, accessToken, `tasks?select=updated_at&id=eq.${target}`);
    if (ordinary.length !== 1 || epoch(ordinary[0].updated_at) <= epoch(before[0].updated_at)) {
        throw new Error(`Trigger did not advance updated_at on an ordinary UPDATE (before ${before[0].updated_at}, after ${ordinary[0]?.updated_at})`);
    }

    const supplied = "2031-01-01T00:00:00Z";
    await rest(config, accessToken, `tasks?id=eq.${target}`, { method: "PATCH", body: JSON.stringify({ name: "LWW update", updated_at: supplied }) });
    const lww = await rest(config, accessToken, `tasks?select=updated_at&id=eq.${target}`);
    if (lww.length !== 1 || epoch(lww[0].updated_at) !== epoch(supplied)) {
        throw new Error(`Deliberately supplied updated_at was not preserved (expected ${supplied}, got ${lww[0]?.updated_at})`);
    }
}

let failure = null;
let restored = false;
try {
    const config = loadConfig();
    assertLoopback(config.url);

    console.log("Resetting local database to the migration before 20260802000000_sync_metadata.sql...");
    // The current seed may reference tables introduced after this historical
    // target (for example todos), so this replay supplies its own fixtures.
    run("npx supabase db reset --local --version 20260801020000 --no-seed");
    refreshLocalGatewayDns();

    const user = await createThrowawayUser(config);
    const accessToken = await signIn(config, user.email, user.password);
    console.log(`Seeding pre-migration rows for throwaway owner ${user.userId}...`);
    await seedPreMigrationRows(config, accessToken, user.userId);

    console.log("Replaying pending migration 20260802000000_sync_metadata.sql...");
    run("npx supabase migration up --local");

    console.log("Asserting backfill and trigger behavior...");
    await assertBackfillAndTrigger(config, accessToken, user.userId);
} catch (error) {
    failure = error;
} finally {
    try {
        run("npx supabase db reset --local");
        refreshLocalGatewayDns();
        restored = true;
        console.log("Restored the latest local schema.");
    } catch (error) {
        console.error("Failed to restore the latest local schema after the replay:", error.message);
    }
}

if (failure) {
    console.error("Migration replay verification failed:", failure.message);
    process.exit(1);
}
if (!restored) {
    console.error("Migration replay verification could not restore the latest local schema.");
    process.exit(1);
}
console.log("Migration replay verification passed.");
