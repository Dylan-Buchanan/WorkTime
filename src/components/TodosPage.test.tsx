import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { TodosPage } from "./TodosPage";
import { InMemoryDataAccess } from "../lib/data/InMemoryDataAccess";
import { addLocalDays, localDateKey, nextOccurrence } from "../lib/todos";
import type { Todo } from "../lib/todos";
import { DataProvider } from "../state/DataContext";
import { SyncProvider } from "../state/SyncContext";
import { TauriCloseProvider } from "../state/TauriCloseContext";
import { TodoProvider } from "../state/TodoContext";
import { makeAppState } from "../test/mockTauri";

const OWNER = "todo-page-owner";

function dateOffset(offset: number): Todo["dueDate"] {
    return localDateKey(addLocalDays(new Date(), offset)) as Todo["dueDate"];
}

function todo(id: string, dueDate: Todo["dueDate"], overrides: Partial<Todo> = {}): Todo {
    return {
        id,
        title: id,
        rule: dueDate ? { type: "one-off", date: dueDate } : null,
        dueDate,
        estimate: 1,
        currentTaskId: null,
        position: 0,
        isArchived: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

function wrap(data: InMemoryDataAccess) {
    return <TauriCloseProvider><DataProvider dataAccess={data}><SyncProvider ownerId={OWNER}><TodoProvider><TodosPage /></TodoProvider></SyncProvider></DataProvider></TauriCloseProvider>;
}

beforeEach(() => localStorage.clear());

describe("TodosPage", () => {
    it("groups active to-dos by local due-date bucket", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.saveTodos([
            todo("Overdue item", dateOffset(-1)),
            todo("Today item", dateOffset(0), { position: 1 }),
            todo("Upcoming item", dateOffset(1), { position: 2 }),
            todo("No date item", null, { position: 3 }),
        ]);

        render(wrap(data));
        await screen.findByText("Overdue item");
        expect(screen.getByRole("heading", { name: /^Overdue\(/ })).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: /^Today\(/ })).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: /^Upcoming\(/ })).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: /^No due date\(/ })).toBeInTheDocument();
    });

    it("creates a no-date item and rolls a recurring item on completion", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const today = new Date();
        const todayDate = localDateKey(today) as Todo["dueDate"];
        await data.saveTodos([todo("Recurring", todayDate, { rule: { type: "weekly", weekdays: [today.getDay()] } })]);
        const user = userEvent.setup();

        render(wrap(data));
        await screen.findByText("Recurring");
        await user.click(screen.getByRole("button", { name: "Complete Recurring" }));
        await waitFor(async () => {
            const saved = await data.loadTodos();
            expect(saved?.[0].dueDate).not.toBe(todayDate);
        });

        await user.click(screen.getByRole("button", { name: "Add to-do" }));
        await user.type(screen.getByLabelText("Title"), "Unscheduled");
        await user.click(screen.getByRole("button", { name: "Create to-do" }));
        await screen.findByText("Unscheduled");
        expect(within(screen.getByText("Unscheduled").closest("article")!).getByText(/No due date/)).toBeInTheDocument();
    });

    it("recomputes the pending date when an existing recurrence changes", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const today = new Date();
        const currentWeekday = today.getDay();
        const nextWeekday = (currentWeekday + 1) % 7;
        const weekdayLabels = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        const currentDate = localDateKey(today) as Todo["dueDate"];
        await data.saveTodos([todo("Editable recurring", currentDate, { rule: { type: "weekly", weekdays: [currentWeekday] } })]);
        const user = userEvent.setup();

        render(wrap(data));
        await screen.findByText("Editable recurring");
        await user.click(screen.getByRole("button", { name: "Edit" }));
        await user.click(screen.getByRole("checkbox", { name: weekdayLabels[currentWeekday] }));
        const nextDay = screen.getByRole("checkbox", { name: weekdayLabels[nextWeekday] });
        await user.click(nextDay);
        await user.click(screen.getByRole("button", { name: "Save changes" }));

        const expected = nextOccurrence({ type: "weekly", weekdays: [nextWeekday] }, new Date());
        await waitFor(async () => {
            const saved = await data.loadTodos();
            expect(saved?.[0].dueDate).toBe(expected ? localDateKey(expected) : null);
        });
    });
});
