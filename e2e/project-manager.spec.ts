import { test, expect, type Page } from "@playwright/test";
import { backendPMState, openApp, syncData } from "./helpers";

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
