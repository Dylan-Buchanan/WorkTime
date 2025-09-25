#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

function readJson(filePath) {
    return JSON.parse(readFileSync(filePath, "utf8"));
}

function updateCargoToml(version) {
    const cargoPath = join(rootDir, "src-tauri", "Cargo.toml");
    const cargoToml = readFileSync(cargoPath, "utf8");
    const packageSectionRegex = /(\[package\][\s\S]*?version\s*=\s*")(.*?)(")/;

    if (!packageSectionRegex.test(cargoToml)) {
        throw new Error("Could not find [package] version field in Cargo.toml");
    }

    const updated = cargoToml.replace(packageSectionRegex, (_match, prefix, _version, suffix) => `${prefix}${version}${suffix}`);
    writeFileSync(cargoPath, updated);
}

function updateTauriConfig(version) {
    const tauriConfigPath = join(rootDir, "src-tauri", "tauri.conf.json");
    const tauriConfig = readJson(tauriConfigPath);

    if (typeof tauriConfig.version !== "undefined") {
        tauriConfig.version = version;
    } else {
        if (!tauriConfig.package) {
            tauriConfig.package = {};
        }
        tauriConfig.package.version = version;
    }

    writeFileSync(tauriConfigPath, `${JSON.stringify(tauriConfig, null, 4)}\n`);
}

function main() {
    const packageJsonPath = join(rootDir, "package.json");
    const { version } = readJson(packageJsonPath);

    if (!version) {
        throw new Error("package.json is missing a version field");
    }

    updateCargoToml(version);
    updateTauriConfig(version);

    console.log(`Synchronized version ${version} to Cargo.toml and tauri.conf.json`);
}

main();
