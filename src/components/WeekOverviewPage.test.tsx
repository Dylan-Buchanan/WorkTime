import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PMTask } from "../state/types";
import { WeekOverviewContent } from "./WeekOverviewPage";

function task(id: string, overrides: Partial<PMTask> = {}): PMTask {
    return {
        id,
        title: id,
        projectId: null,
        status: "Backlog",
        priority: "Medium",
        timeSpentMinutes: 0,
        tags: [],
        links: [],
        checklist: [],
        sortOrder: 0,
        isArchived: false,
        createdAt: "2026-08-01T12:00:00.000Z",
        updatedAt: "2026-08-01T12:00:00.000Z",
        relatedTo: [],
        ...overrides,
    };
}

describe("WeekOverviewContent", () => {
    it("shows daily due and flexible pomodoro counts with calendar progress", () => {
        render(
            <WeekOverviewContent
                reference={new Date(2026, 7, 12, 10, 0)}
                projects={{}}
                tasks={[
                    task("due", { dueDate: "2026-08-14", estimatePomos: 3 }),
                    task("flexible", { estimatePomos: 2 }),
                ]}
            />,
        );

        expect(screen.getByRole("heading", { name: "Week overview" })).toBeInTheDocument();
        expect(screen.getByText("Day 3 of 7")).toBeInTheDocument();
        expect(screen.getByRole("progressbar", { name: "Calendar week progress" })).toHaveAttribute("aria-valuenow", "43");
        const friday = screen.getByRole("article", { name: "Fri 2026-08-14" });
        expect(within(friday).getAllByText("3")).toHaveLength(2);
        expect(within(friday).getByText("0")).toBeInTheDocument();
        expect(within(screen.getByRole("article", { name: "Wed 2026-08-12" })).getAllByText("1")).toHaveLength(2);
        expect(within(screen.getByRole("article", { name: "Thu 2026-08-13" })).getAllByText("1")).toHaveLength(2);
    });

    it("renders all seven days for an empty week", () => {
        render(<WeekOverviewContent reference={new Date(2026, 7, 10, 10, 0)} projects={{}} tasks={[]} />);

        expect(screen.getAllByText("pomodoros")).toHaveLength(7);
        expect(screen.getByText("0 of 0 remaining pomodoros fall on days through today.")).toBeInTheDocument();
    });
});
