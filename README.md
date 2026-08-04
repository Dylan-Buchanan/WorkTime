# Tauri + React + Typescript

## Updating

1. Run `pnpm version <patch|minor|major>` to bump the app version (automatically updates `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`).
2. Run `pnpm install` to make sure dependencies are up to date.
3. Run `pnpm build`.
4. Run `pnpm app` to ensure the changes worked
5. Run `pnpm tauri build`.
6. Run the new MSI file in `target/release/bundle/msi`.
