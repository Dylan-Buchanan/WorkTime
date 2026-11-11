import { expect, test, type Locator, type Page } from "@playwright/test";
import { openApp } from "./helpers";

/**
 * Real-layout guard for fixed overlays mounted inside an ancestor that
 * establishes a containing block (`backdrop-filter`, `transform`, `filter`,
 * `contain`, `will-change`). `SettingsPanel`'s Reset confirmation is portalled
 * to <body> for exactly that reason, because the desktop sidebar carries
 * `backdrop-blur-sm`. jsdom performs no layout, so this cannot live in unit
 * tests; a regression shows up as a sidebar-sized scrim and dialog.
 */

const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
const MOBILE_VIEWPORT = { width: 375, height: 700 };

const OVERLAY = '[data-testid="reset-confirm-overlay"]';
const SCRIM = '[data-testid="reset-confirm-scrim"]';

function viewport(page: Page) {
    const size = page.viewportSize();
    expect(size, "the test needs an explicit viewport").not.toBeNull();
    return size!;
}

/** The element must be sized to the viewport, not to any ancestor. */
async function expectCoversViewport(page: Page, locator: Locator, label: string) {
    const size = viewport(page);
    const box = await locator.boundingBox();
    expect(box, `${label} has no layout box`).not.toBeNull();
    const tolerance = 1;
    expect(box!.x, `${label} left edge`).toBeLessThanOrEqual(tolerance);
    expect(box!.y, `${label} top edge`).toBeLessThanOrEqual(tolerance);
    expect(box!.x + box!.width, `${label} right edge`).toBeGreaterThanOrEqual(size.width - tolerance);
    expect(box!.y + box!.height, `${label} bottom edge`).toBeGreaterThanOrEqual(size.height - tolerance);
}

/** The dialog must be centred on the viewport and fully inside it. */
async function expectCentredOnViewport(page: Page, dialog: Locator) {
    const size = viewport(page);
    const box = await dialog.boundingBox();
    expect(box, "the reset dialog has no layout box").not.toBeNull();
    expect(Math.abs(box!.x + box!.width / 2 - size.width / 2), "dialog horizontal centre").toBeLessThanOrEqual(2);
    expect(Math.abs(box!.y + box!.height / 2 - size.height / 2), "dialog vertical centre").toBeLessThanOrEqual(2);
    expect(box!.x, "dialog is clipped on the left").toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, "dialog is clipped on the right").toBeLessThanOrEqual(size.width);
    expect(box!.y, "dialog is clipped at the top").toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height, "dialog is clipped at the bottom").toBeLessThanOrEqual(size.height);
}

async function openResetConfirmation(page: Page) {
    await page.getByRole("button", { name: "Reset All Data" }).click();
    const overlay = page.locator(OVERLAY);
    await expect(overlay).toBeVisible();
    return overlay;
}

test.describe("Reset confirmation overlay geometry", () => {
    test("covers the viewport and centres on it from the desktop sidebar", async ({ browser }) => {
        const app = await openApp(browser, undefined, undefined, { viewport: DESKTOP_VIEWPORT });
        const page = app.page;
        try {
            await page.goto("/");
            // The desktop aside hosts SettingsPanel and carries backdrop-blur-sm.
            const sidebar = page.locator("aside").filter({ hasText: "Reset All Data" });
            await expect(sidebar).toBeVisible();

            const overlay = await openResetConfirmation(page);
            const dialog = page.getByRole("dialog", { name: "Confirm Data Reset" });
            await expect(dialog).toBeVisible();

            await expectCoversViewport(page, overlay, "reset overlay");
            await expectCoversViewport(page, page.locator(SCRIM), "reset scrim");
            await expectCentredOnViewport(page, dialog);

            // The overlay escaped the sidebar in the DOM too, so no styled
            // ancestor can ever clamp it again.
            expect(await sidebar.evaluate((element, selector) => !element.querySelector(selector), OVERLAY)).toBe(true);
            // The dialog must not force a horizontal scrollbar inside the column.
            expect(await sidebar.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);

            // Closing still restores the panel with no lingering overlay.
            await dialog.getByRole("button", { name: "Cancel" }).click();
            await expect(page.locator(OVERLAY)).toHaveCount(0);
            await expect(page.getByRole("button", { name: "Reset All Data" })).toBeVisible();

            // Reopening after a close re-lays-out from scratch.
            await openResetConfirmation(page);
            await expectCentredOnViewport(page, page.getByRole("dialog", { name: "Confirm Data Reset" }));
        } finally {
            await app.cleanup();
        }
    });

    test("covers the viewport and centres on it from the mobile drawer", async ({ browser }) => {
        const app = await openApp(browser, undefined, undefined, { viewport: MOBILE_VIEWPORT });
        const page = app.page;
        try {
            await page.goto("/");
            await page.getByRole("button", { name: "Tasks & Settings" }).click();
            const drawer = page.locator("#timer-side-panel-drawer");
            await expect(drawer).toBeVisible();

            const overlay = await openResetConfirmation(page);
            const dialog = page.getByRole("dialog", { name: "Confirm Data Reset" });
            await expect(dialog).toBeVisible();

            await expectCoversViewport(page, overlay, "reset overlay");
            await expectCoversViewport(page, page.locator(SCRIM), "reset scrim");
            await expectCentredOnViewport(page, dialog);

            expect(await page.locator(OVERLAY).evaluate((element) => element.closest("#timer-side-panel-drawer") === null)).toBe(true);

            await dialog.getByRole("button", { name: "Cancel" }).click();
            await expect(page.locator(OVERLAY)).toHaveCount(0);
            // The drawer survives the reset dialog dismissal.
            await expect(drawer).toBeVisible();
        } finally {
            await app.cleanup();
        }
    });

    test("re-lays-out on resize and drops the overlay across the desktop breakpoint", async ({ browser }) => {
        const app = await openApp(browser, undefined, undefined, { viewport: DESKTOP_VIEWPORT });
        const page = app.page;
        try {
            await page.goto("/");
            await openResetConfirmation(page);
            await expectCentredOnViewport(page, page.getByRole("dialog", { name: "Confirm Data Reset" }));

            // Still desktop: the same mount must track the new viewport.
            await page.setViewportSize({ width: 1100, height: 800 });
            await expectCoversViewport(page, page.locator(OVERLAY), "reset overlay after resize");
            await expectCentredOnViewport(page, page.getByRole("dialog", { name: "Confirm Data Reset" }));

            // Crossing to the mobile branch unmounts the desktop SettingsPanel, so
            // no stale overlay may survive in the DOM.
            await page.setViewportSize({ width: 900, height: 800 });
            await expect(page.locator(OVERLAY)).toHaveCount(0);

            // The mobile mount opens fresh at the new viewport.
            await page.getByRole("button", { name: "Tasks & Settings" }).click();
            await openResetConfirmation(page);
            await expectCoversViewport(page, page.locator(OVERLAY), "reset overlay in the drawer");
            await expectCentredOnViewport(page, page.getByRole("dialog", { name: "Confirm Data Reset" }));

            // And the original desktop mount at 1440 must not regress after the trip.
            await page.setViewportSize(DESKTOP_VIEWPORT);
            await expect(page.locator(OVERLAY)).toHaveCount(0);
            await openResetConfirmation(page);
            await expectCentredOnViewport(page, page.getByRole("dialog", { name: "Confirm Data Reset" }));
        } finally {
            await app.cleanup();
        }
    });
});
