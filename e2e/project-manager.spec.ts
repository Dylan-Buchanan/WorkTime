import { test, expect, type Page } from "@playwright/test";
import { backendPMState, baseState, openApp, syncData, taskFixture } from "./helpers";

test.describe("Project Manager", () => {
    test("create a project and add a task via quick add", async ({ browser }) => {
        const app = await openApp(browser);
        const page = app.page;
        try {
        await page.goto("/projects");

        // Create a project.
        await page.getByRole("button", { name: "New Project" }).click();
        await page.getByPlaceholder("Project name").fill("Backend");
        await page.getByRole("button", { name: "Create Project" }).click();
        await expect(page.getByText("Backend", { exact: true }).first()).toBeVisible();

        // Quick-add a task to that project.
        const quickAdd = page.getByPlaceholder("Quick add: Title @Project ^YYYY-MM-DD #tag !high");
        await quickAdd.fill("Add auth flow @Backend #security !high 3p");
        await quickAdd.press("Enter");

        await expect(page.getByText("Add auth flow", { exact: true }).first()).toBeVisible();

        // Debug footer confirms counts.
        await expect(page.getByText("Projects: 2")).toBeVisible();
        await expect(page.getByText("Tasks: 1")).toBeVisible();

        // PM changes stage immediately and reach Supabase only on explicit sync.
        await syncData(page);

        const pm = await backendPMState(app);
        const pmTask = Object.values(pm.tasks)[0] as any;
        expect(pmTask.title).toBe("Add auth flow");
        expect(pmTask.tags).toEqual(["security"]);
        expect(pmTask.priority).toBe("High");
        expect(pmTask.estimatePomos).toBe(3);
        } finally { await app.cleanup(); }
    });

    test("quick add to a missing project warns instead of creating", async ({ browser }) => {
        const app = await openApp(browser);
        const page = app.page;
        try {
        page.on("dialog", (d) => d.accept());
        await page.goto("/projects");

        const quickAdd = page.getByPlaceholder("Quick add: Title @Project ^YYYY-MM-DD #tag !high");
        await quickAdd.fill("Orphan task @DoesNotExist");
        await quickAdd.press("Enter");

        // No task was created.
        await expect(page.getByText("Tasks: 0")).toBeVisible();
        } finally { await app.cleanup(); }
    });

    test("dragging a task across board columns persists the target ordering", async ({ browser }) => {
        const pmSeed = {
            projects: {
                p1: { id: "p1", name: "Backend", color: "#fff", isArchived: false, sortOrder: 0, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
            },
            tasks: {
                taskA: pmTask("taskA", "Task A", "Backlog", 0),
                taskB: pmTask("taskB", "Task B", "Backlog", 1),
                taskC: pmTask("taskC", "Task C", "Next", 0),
                taskD: pmTask("taskD", "Task D", "Next", 1),
            },
            meta: { initializedAt: "2026-01-01T00:00:00Z" },
        };
        const app = await openApp(browser, undefined, pmSeed);
        const page = app.page;
        try {
            await page.goto("/projects");
            await page.getByRole("button", { name: "Board" }).click();
            await expect(page.locator('[data-taskid="taskA"]')).toBeVisible();

            // Drag Task A from Backlog onto the top of Task C in Next: it should
            // land before Task C, not append to the end of the column.
            await dragCard(page, "taskA", "taskC", 0.25);
            await expect(page.locator('[data-status="Next"] [data-taskid]')).toHaveCount(3);
            expect(await columnOrder(page, "Next")).toEqual(["taskA", "taskC", "taskD"]);
            expect(await columnOrder(page, "Backlog")).toEqual(["taskB"]);

            // Drag Task B onto the empty In Progress column space.
            await dragToColumn(page, "taskB", "In Progress");
            await expect(page.locator('[data-status="In Progress"] [data-taskid]')).toHaveCount(1);
            expect(await columnOrder(page, "In Progress")).toEqual(["taskB"]);
            expect(await columnOrder(page, "Backlog")).toEqual([]);

            // The recomputed ordering is persisted to the backend.
            await syncData(page);
            const pm = await backendPMState(app);
            const tasks = (pm?.tasks ?? {}) as Record<string, any>;
            expect(tasks.taskA).toMatchObject({ status: "Next", sortOrder: 0 });
            expect(tasks.taskC).toMatchObject({ status: "Next", sortOrder: 1 });
            expect(tasks.taskD).toMatchObject({ status: "Next", sortOrder: 2 });
            expect(tasks.taskB).toMatchObject({ status: "In Progress", sortOrder: 0 });

            // The layout is stable after a reload.
            await page.reload();
            await expect(page.locator('[data-status="Next"] [data-taskid]')).toHaveCount(3);
            expect(await columnOrder(page, "Next")).toEqual(["taskA", "taskC", "taskD"]);
            expect(await columnOrder(page, "In Progress")).toEqual(["taskB"]);
        } finally { await app.cleanup(); }
    });

    test("reorders inspector checklist rows with keyboard, mouse, and touch and persists across reload", async ({ browser }) => {
        const task = pmTask("taskA", "Checklist task", "Backlog", 0);
        const checklist = [
            { id: "a", title: "Step A", done: false },
            { id: "c", title: "Step C", done: true },
            { id: "b", title: "Step B", done: false },
            { id: "d", title: "Step D", done: true },
        ];
        const longTail = Array.from({ length: 18 }, (_, index) => ({ id: `extra-${index}`, title: `Extra item ${index}`, done: true }));
        const appTaskId = "00000000-0000-4000-8000-00000000000a";
        const seed = baseState({ active_task: appTaskId, tasks: { [appTaskId]: taskFixture(appTaskId, task.title) } });
        const app = await openApp(browser, seed, {
            projects: {
                p1: { id: "p1", name: "Checklist project", color: "#fff", isArchived: false, sortOrder: 0, createdAt: task.createdAt, updatedAt: task.updatedAt },
            },
            tasks: { taskA: { ...task, appTaskId, estimatePomos: 4, checklist: [...checklist, ...longTail] } },
            meta: { initializedAt: task.createdAt },
        });
        const { page } = app;
        const handle = (letter: string) => page.getByRole("button", { name: `Reorder Step ${letter}` });
        const rowOrder = () => page.getByRole("checkbox", { name: /^Step / }).evaluateAll((nodes) =>
            nodes.map((node) => (node as HTMLInputElement).labels?.[0]?.textContent),
        );
        const expectOrder = (letters: string) => expect.poll(rowOrder).toEqual(Array.from(letters, (letter) => `Step ${letter}`));
        const center = async (letter: string) => {
            const box = await handle(letter).boundingBox();
            if (!box) throw new Error(`Step ${letter} has no visible handle`);
            return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        };

        try {
            await page.goto("/projects");
            await page.getByText(task.title, { exact: true }).first().click();
            await handle("A").scrollIntoViewIfNeeded();
            await handle("A").focus();
            await page.keyboard.press("Space");
            await expect(page.getByRole("status").filter({ hasText: "Picked up Step A." })).toBeAttached();
            await page.keyboard.press("ArrowDown");
            await expect(page.getByRole("status").filter({ hasText: "Step A is over Step B." })).toBeAttached();
            await page.keyboard.press("ArrowDown");
            await page.keyboard.press("Space");
            await expectOrder("BACD");

            await handle("D").scrollIntoViewIfNeeded();
            const d = await center("D");
            const c = await center("C");
            await page.mouse.move(d.x, d.y);
            await page.mouse.down();
            await page.mouse.move(c.x, c.y, { steps: 12 });
            await page.mouse.up();
            await expectOrder("BADC");

            const touch = await app.context.newCDPSession(page);
            await touch.send("Emulation.setTouchEmulationEnabled", { enabled: true });
            const a = await center("A");
            const b = await center("B");
            await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [a] });
            await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: a.x, y: a.y - 10 }] });
            await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [b] });
            await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
            await expectOrder("ABDC");
            await touch.send("Emulation.setTouchEmulationEnabled", { enabled: false });
            await touch.detach();

            await syncData(page);
            const stored = (await backendPMState(app)).tasks.taskA;
            expect(stored.checklist).toEqual([checklist[0], checklist[2], checklist[3], checklist[1], ...longTail]);
            expect(stored.updatedAt).toBe(task.updatedAt);
            await page.reload();
            await expectOrder("ABDC");

            await handle("D").scrollIntoViewIfNeeded();
            const scrollArea = page.locator(".overflow-y-auto").filter({ has: handle("D") }).last();
            const scrollTop = () => scrollArea.evaluate((element) => element.scrollTop);
            const initialScroll = await scrollTop();
            const scrollBox = (await scrollArea.boundingBox())!;
            const start = await center("D");
            await page.mouse.move(start.x, start.y);
            await page.mouse.down();
            await page.mouse.move(start.x, scrollBox.y + scrollBox.height - 8, { steps: 12 });
            await expect.poll(scrollTop).toBeGreaterThan(initialScroll);
            await page.keyboard.press("Escape");
            await page.mouse.up();
            await expectOrder("ABDC");

            await page.getByRole("link", { name: "Timer" }).click();
            await page.getByRole("button", { name: "Task Details", exact: true }).click();
            await expectOrder("ABDC");
            await expect(handle("A")).toBeVisible();
        } finally { await app.cleanup(); }
    });
});

function pmTask(id: string, title: string, status: string, sortOrder: number) {
    return {
        id,
        title,
        projectId: "p1",
        status,
        priority: "Medium",
        timeSpentMinutes: 0,
        workedPomos: 0,
        tags: [],
        links: [],
        checklist: [],
        sortOrder,
        isArchived: false,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        relatedTo: [],
    };
}

async function columnOrder(page: Page, status: string): Promise<string[]> {
    return page.locator(`[data-status="${status}"] [data-taskid]`).evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-taskid") as string));
}

/** Drag a task card's handle onto another card at a vertical ratio of its box. */
async function dragCard(page: Page, taskId: string, targetTaskId: string, targetRatio: number) {
    const handle = page.locator(`[data-taskid="${taskId}"] [title="Drag"]`);
    const target = page.locator(`[data-taskid="${targetTaskId}"]`);
    const sourceBox = await handle.boundingBox();
    const targetBox = await target.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(targetBox).not.toBeNull();
    await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(sourceBox!.x + sourceBox!.width / 2 + 12, sourceBox!.y + sourceBox!.height / 2 + 12, { steps: 4 });
    await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height * targetRatio, { steps: 20 });
    await page.mouse.up();
}

/** Drag a task card's handle onto empty column space. */
async function dragToColumn(page: Page, taskId: string, status: string) {
    const handle = page.locator(`[data-taskid="${taskId}"] [title="Drag"]`);
    const column = page.locator(`[data-status="${status}"]`);
    const sourceBox = await handle.boundingBox();
    const targetBox = await column.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(targetBox).not.toBeNull();
    await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(sourceBox!.x + sourceBox!.width / 2 + 12, sourceBox!.y + sourceBox!.height / 2 + 12, { steps: 4 });
    await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height * 0.5, { steps: 20 });
    await page.mouse.up();
}
