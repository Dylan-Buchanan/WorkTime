# Tauri + React + Typescript

## Updating

Run `pnpm install` to make sure dependencies are up to date, then use the commands below. The explicit `run` is required: pnpm 9 forwards bare `pnpm version` to npm's built-in version command instead of this project script.

```powershell
pnpm run version patch git
pnpm run version minor git
pnpm run version major git
```

Each command bumps `package.json`, synchronizes `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`, and runs `pnpm tauri build` (which also updates `src-tauri/Cargo.lock`). After a successful build, the optional `git` argument runs `git add .` and `git commit -m "vX.X.X"`. This includes all current changes, including untracked files that Git does not ignore. It does not create a tag or push.

Omit `git` to bump and build without committing. `pnpm sync-version` only synchronizes the version files, without bumping or building.

The build requires Rust/Tauri tooling and all three public Vite environment variables (see `.env.example`). If the build fails, staging and committing are skipped, and the bumped version remains for inspection. Fix the build issue and run `pnpm tauri build` to retry that version; running the version command again bumps it again.

Run `pnpm app` to check the app, or install the new MSI from `src-tauri/target/release/bundle/msi/`.

Push supabase edge functions `npx supabase functions deploy <name> --no-verify-jwt` using no verify jwt as needed.
