import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = join(root, "dist");
const failures = [];
const exists = (path) => existsSync(join(dist, path));
const read = (path) => readFileSync(join(dist, path), "utf8");

if (!exists("index.html")) failures.push("dist/index.html is missing");
if (!exists("manifest.webmanifest")) failures.push("dist/manifest.webmanifest is missing");
if (!exists("_redirects")) failures.push("dist/_redirects is missing");

if (exists("manifest.webmanifest")) {
    const manifest = JSON.parse(read("manifest.webmanifest"));
    for (const [key, expected] of [["name", "WorkTime"], ["short_name", "WorkTime"], ["start_url", "/"], ["display", "standalone"], ["theme_color", "#0a0a0a"], ["background_color", "#171717"]]) {
        if (manifest[key] !== expected) failures.push(`manifest.${key} must be ${expected}`);
    }
    for (const size of ["192x192", "512x512"]) {
        const icon = (manifest.icons ?? []).find((entry) => entry.sizes === size);
        if (!icon || icon.type !== "image/png" || icon.purpose !== "any" || !exists(icon.src.replace(/^\//, ""))) failures.push(`manifest icon ${size} is invalid or missing`);
    }
}

if (exists("index.html")) {
    const html = read("index.html");
    for (const marker of ["<title>WorkTime</title>", "rel=\"manifest\"", "apple-touch-icon", "theme-color", "apple-mobile-web-app-capable", "apple-mobile-web-app-status-bar-style"]) {
        if (!html.includes(marker)) failures.push(`dist/index.html is missing ${marker}`);
    }
}
if (exists("_redirects") && read("_redirects").trim() !== "/* /index.html 200") failures.push("dist/_redirects must contain only the SPA fallback rule");
if (readFileSync(join(root, "public", "_redirects"), "utf8").trim() !== "/* /index.html 200") failures.push("public/_redirects must contain only the SPA fallback rule");

function filesUnder(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? filesUnder(join(directory, entry.name)) : [join(directory, entry.name)]);
}
const generatedFiles = filesUnder(dist);
if (!generatedFiles.some((path) => /^sw(?:-[\w-]+)?\.js$/.test(path.slice(dist.length + 1)))) failures.push("generated service worker is missing");
// Assert registration behavior rather than minified formatting: workbox-window's `navigator.serviceWorker.register`
// call and the absolute "/sw.js" URL the plugin substitutes for `__SW__` when `base: "/"`.
// The substituted URL is a literal (never renamed by the minifier), but the minifier may emit it
// as a double-quoted string or a template literal depending on the bundler in use.
const generatedJs = generatedFiles.filter((path) => path.endsWith(".js")).map((path) => readFileSync(path, "utf8")).join("\n");
const registersAbsoluteSwUrl = generatedJs.includes('"/sw.js"') || generatedJs.includes("`/sw.js`");
if (!generatedJs.includes("navigator.serviceWorker.register") || !registersAbsoluteSwUrl) failures.push("generated service-worker registration code is missing");

if (failures.length) {
    console.error("PWA verification failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
}
console.log("PWA artifact verification passed.");
