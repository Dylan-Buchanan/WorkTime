import assert from "node:assert/strict";
import { test } from "node:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

function fixture(t) {
    const root = mkdtempSync(join(tmpdir(), "worktime-version-"));
    t.after(() => {
        assert.equal(dirname(resolve(root)), resolve(tmpdir()));
        assert.ok(basename(root).startsWith("worktime-version-"));
        rmSync(root, { recursive: true, force: true });
    });
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, "src-tauri"));
    for (const name of ["version.mjs", "sync-version.mjs"]) {
        copyFileSync(new URL(name, import.meta.url), join(root, "scripts", name));
    }
    writeFileSync(join(root, "package.json"), JSON.stringify({
        name: "version-test", version: "1.2.3", private: true,
        scripts: { version: "node scripts/version.mjs", tauri: "node fake-build.mjs" },
    }));
    writeFileSync(join(root, "src-tauri/Cargo.toml"), '[package]\nname = "version-test"\nversion = "1.2.3"\n');
    writeFileSync(join(root, "src-tauri/tauri.conf.json"), '{"version":"1.2.3"}');
    writeFileSync(join(root, "fake-build.mjs"), `
        import fs from 'node:fs';
        if (process.argv[2] !== 'build') process.exit(2);
        const version = JSON.parse(fs.readFileSync('package.json')).version;
        if (!fs.readFileSync('src-tauri/Cargo.toml', 'utf8').includes('version = "' + version + '"')) process.exit(3);
        if (JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json')).version !== version) process.exit(4);
        if (process.env.FAIL_BUILD) process.exit(5);
        fs.writeFileSync('built-version.txt', version);
    `);
    function exec(command, args, env = {}) {
        return spawnSync(command, args, { cwd: root, env: { ...process.env, ...env }, encoding: "utf8" });
    }
    function git(...args) {
        const result = exec("git", args);
        assert.equal(result.status, 0, result.stderr);
        return result.stdout.trim();
    }
    git("init");
    git("config", "user.name", "Version Test");
    git("config", "user.email", "version-test@example.invalid");
    git("config", "commit.gpgsign", "false");
    git("config", "core.hooksPath", "no-hooks");
    git("add", ".");
    git("commit", "-m", "initial");
    return {
        root, git,
        read: (name) => readFileSync(join(root, name), "utf8"),
        version: (args, env) => exec(process.execPath, [process.env.npm_execpath, "run", "version", ...args], env),
    };
}

for (const [bump, expected] of [["major", "2.0.0"], ["minor", "1.3.0"], ["patch", "1.2.4"]]) {
    test(`${bump} synchronizes before building and leaves changes uncommitted`, (t) => {
        const f = fixture(t);
        const result = f.version([bump]);
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.equal(f.read("built-version.txt"), expected);
        assert.equal(f.git("log", "-1", "--format=%s"), "initial");
        assert.equal(f.git("diff", "--cached", "--name-only"), "");
    });
}

test("git commits the successful build and existing untracked changes", (t) => {
    const f = fixture(t);
    writeFileSync(join(f.root, "existing-change.txt"), "user change");
    const result = f.version(["patch", "git"]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(f.git("log", "-1", "--format=%s"), "v1.2.4");
    assert.equal(f.git("show", "HEAD:existing-change.txt"), "user change");
    assert.equal(f.git("show", "HEAD:built-version.txt"), "1.2.4");
    assert.equal(f.git("status", "--porcelain"), "");
});

test("failed build retains the bump without staging or committing", (t) => {
    const f = fixture(t);
    const result = f.version(["patch", "git"], { FAIL_BUILD: "1" });
    assert.notEqual(result.status, 0);
    assert.equal(JSON.parse(f.read("package.json")).version, "1.2.4");
    assert.equal(f.git("log", "-1", "--format=%s"), "initial");
    assert.equal(f.git("diff", "--cached", "--name-only"), "");
});

test("invalid arguments leave files unchanged", (t) => {
    const f = fixture(t);
    for (const args of [["bad"], ["patch", "bad"], ["patch", "git", "extra"]]) {
        assert.notEqual(f.version(args).status, 0);
        assert.equal(f.git("status", "--porcelain"), "");
    }
});

test("no arguments preserve the synchronization hook without building", (t) => {
    const f = fixture(t);
    const result = f.version([]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(JSON.parse(f.read("package.json")).version, "1.2.3");
    assert.equal(f.git("log", "-1", "--format=%s"), "initial");
    assert.ok(!f.git("status", "--porcelain").includes("built-version"));
});
