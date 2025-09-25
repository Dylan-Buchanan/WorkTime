# Tauri + React + Typescript

## Updating

1. Run `npm version <patch|minor|major>` to bump the app version (automatically updates `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`).
2. Run `npm install` to make sure dependencies are up to date.
3. Run `npm run build`.
4. Run `npm run tauri dev` to ensure the changes worked
5. Run `npm run tauri build`.
6. Run the new MSI file in `target/release/bundle/msi`.
