import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { TodosPage } from "./TodosPage";
import { InMemoryDataAccess } from "../lib/data/InMemoryDataAccess";
import { addLocalDays, localDateAtNoon, localDateFromKey, localDateKey, nextOccurrence } from "../lib/todos";
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

const displayKey = (key: string) => localDateFromKey(key).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const fullDayLabel = (date: Date) => date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
const monthHeading = (date: Date) => date.toLocaleDateString(undefined, { month: "long", year: "numeric" });

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
    it("creates, reopens, edits, archives, reloads and clears multiline descriptions", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const user = userEvent.setup();
        const view = render(wrap(data));
        await screen.findByText("Nothing on your list yet");
        await user.click(screen.getByRole("button", { name: "Add to-do" }));
        await user.type(screen.getByLabelText("Title"), "With notes");
        await user.type(screen.getByLabelText("Description (optional)"), "  Context\nDone means shipped  ");
        await user.click(screen.getByRole("button", { name: "Create to-do" }));
        const notes = await screen.findByText("Context Done means shipped");
        expect(notes.textContent).toBe("Context\nDone means shipped");
        await user.click(screen.getByRole("button", { name: "Edit" }));
        expect(screen.getByLabelText("Description (optional)")).toHaveValue("Context\nDone means shipped");
        await user.clear(screen.getByLabelText("Description (optional)"));
        await user.type(screen.getByLabelText("Description (optional)"), "Updated notes");
        await user.click(screen.getByRole("button", { name: "Save changes" }));
        await user.click(screen.getByRole("button", { name: "Archive" }));
        await user.click(screen.getByRole("button", { name: /Show archived/ }));
        expect(await screen.findByText("Updated notes")).toBeInTheDocument();
        await waitFor(async () => expect((await data.loadTodos()).todos[0]).toMatchObject({ description: "Updated notes", isArchived: true }));
        view.unmount();
        render(wrap(data));
        await user.click(screen.getByRole("button", { name: /Show archived/ }));
        await screen.findByText("Updated notes");
        await user.click(screen.getByRole("button", { name: "Edit" }));
        await user.clear(screen.getByLabelText("Description (optional)"));
        await user.type(screen.getByLabelText("Description (optional)"), "  ");
        await user.click(screen.getByRole("button", { name: "Save changes" }));
        expect(screen.queryByText("Updated notes")).not.toBeInTheDocument();
        await waitFor(async () => expect((await data.loadTodos()).todos[0].description).toBe(""));
    });

    it("groups active to-dos by local due-date bucket", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.saveTodos([
            todo("Overdue item", dateOffset(-1)),
            todo("Today item", dateOffset(0), { position: 1 }),
            todo("Upcoming item", dateOffset(1), { position: 2 }),
            todo("No date item", null, { position: 3 }),
        ], []);

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
        await data.saveTodos([todo("Recurring", todayDate, { rule: { type: "weekly", weekdays: [today.getDay()] } })], []);
        const user = userEvent.setup();

        render(wrap(data));
        await screen.findByText("Recurring");
        await user.click(screen.getByRole("button", { name: "Complete Recurring" }));
        await waitFor(async () => {
            const saved = await data.loadTodos();
            expect(saved.todos[0].dueDate).not.toBe(todayDate);
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
        await data.saveTodos([todo("Editable recurring", currentDate, { rule: { type: "weekly", weekdays: [currentWeekday] } })], []);
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
            expect(saved.todos[0].dueDate).toBe(expected ? localDateKey(expected) : null);
        });
    });

    it("creates a one-off to-do from the calendar picker", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const user = userEvent.setup();
        render(wrap(data));
        await screen.findByText("Nothing on your list yet");
        await user.click(screen.getByRole("button", { name: "Add to-do" }));
        await user.type(screen.getByLabelText("Title"), "Calendar item");
        await user.selectOptions(screen.getByLabelText("Schedule"), "one-off");

        const today = new Date();
        const target = localDateAtNoon(today.getFullYear(), today.getMonth(), today.getDate() <= 15 ? 15 : 1);
        const expected = localDateKey(target);

        const trigger = screen.getByLabelText("Due date");
        expect(trigger).toHaveTextContent("Pick a date");
        await user.click(trigger);
        await user.click(screen.getByRole("button", { name: fullDayLabel(target) }));

        expect(trigger).toHaveTextContent(displayKey(expected));
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Create to-do" }));
        await screen.findByText("Calendar item");
        await waitFor(async () => {
            const saved = await data.loadTodos();
            expect(saved.todos[0]).toMatchObject({ title: "Calendar item", dueDate: expected });
        });
    });

    it("edits an existing one-off to-do through the calendar", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.saveTodos([todo("Stored date", "2026-03-04")], []);
        const user = userEvent.setup();
        render(wrap(data));
        await screen.findByText("Stored date");
        await user.click(screen.getByRole("button", { name: "Edit" }));

        const trigger = screen.getByLabelText("Due date");
        expect(trigger).toHaveTextContent(displayKey("2026-03-04"));
        await user.click(trigger);
        expect(screen.getByText(monthHeading(localDateAtNoon(2026, 2, 1)))).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: fullDayLabel(localDateAtNoon(2026, 2, 10)) }));
        expect(trigger).toHaveTextContent(displayKey("2026-03-10"));

        await user.click(screen.getByRole("button", { name: "Save changes" }));
        await waitFor(async () => {
            expect((await data.loadTodos()).todos[0].dueDate).toBe("2026-03-10");
        });
    });

    it("keeps the one-off date validation when no date is chosen", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const user = userEvent.setup();
        render(wrap(data));
        await screen.findByText("Nothing on your list yet");
        await user.click(screen.getByRole("button", { name: "Add to-do" }));
        await user.type(screen.getByLabelText("Title"), "Needs a date");
        await user.selectOptions(screen.getByLabelText("Schedule"), "one-off");
        await user.click(screen.getByRole("button", { name: "Create to-do" }));

        expect(await screen.findByRole("alert")).toHaveTextContent("Choose a valid date.");
        expect((await data.loadTodos()).todos).toHaveLength(0);
    });

    it("keeps the recurrence date-match validation", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const user = userEvent.setup();
        render(wrap(data));
        await screen.findByText("Nothing on your list yet");
        await user.click(screen.getByRole("button", { name: "Add to-do" }));
        await user.type(screen.getByLabelText("Title"), "Mismatched recurrence");
        await user.selectOptions(screen.getByLabelText("Schedule"), "weekly");
        await user.click(screen.getByRole("checkbox", { name: "Monday" }));

        const today = new Date();
        let target = localDateAtNoon(today.getFullYear(), today.getMonth(), 1);
        if (target.getDay() === 1) target = localDateAtNoon(today.getFullYear(), today.getMonth(), 2);

        await user.click(screen.getByLabelText("First due date"));
        await user.click(screen.getByRole("button", { name: fullDayLabel(target) }));
        await user.click(screen.getByRole("button", { name: "Create to-do" }));

        expect(await screen.findByRole("alert")).toHaveTextContent("The first due date must match the recurrence schedule.");
        expect((await data.loadTodos()).todos).toHaveLength(0);
    });
});
