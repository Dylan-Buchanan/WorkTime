import { beforeEach, describe, expect, it } from "vitest";
import {
    AGENT_START_OF_DAY_PLAN_STORAGE_KEY,
    clearAgentStartOfDayPlan,
    getAgentStartOfDayPlan,
    saveAgentStartOfDayPlan,
} from "./startOfDayPlanStore";

beforeEach(() => localStorage.clear());

function input() {
    return {
        projectId: "p1",
        createdAt: "2026-08-07T13:00:00.000Z",
        completedAt: "2026-08-07T13:05:00.000Z",
        workUntil: "2026-08-07T17:00:00.000Z",
        workBudgetPomos: 4,
        summary: "Finish the critical slice.",
        orderedTasks: [{ taskId: "t1", title: "Critical slice", estimatePomos: 6, plannedPomos: 4, rollover: true, checklist: [] }],
        approvedChanges: [{ type: "update" as const, taskId: "t1", title: "Critical slice", estimatePomos: 6 }],
    };
}

describe("Start-of-Day plan store", () => {
    it("round trips a cloned versioned plan", () => {
        const saved = saveAgentStartOfDayPlan(input());
        saved.orderedTasks[0].title = "mutated";
        expect(getAgentStartOfDayPlan()).toEqual(expect.objectContaining({
            version: 1,
            projectId: "p1",
            orderedTasks: [expect.objectContaining({ title: "Critical slice", plannedPomos: 4, rollover: true })],
        }));
        clearAgentStartOfDayPlan();
        expect(getAgentStartOfDayPlan()).toBeNull();
    });

    it("ignores corrupt, wrong-version, and over-budget records", () => {
        localStorage.setItem(AGENT_START_OF_DAY_PLAN_STORAGE_KEY, "not-json");
        expect(getAgentStartOfDayPlan()).toBeNull();
        localStorage.setItem(AGENT_START_OF_DAY_PLAN_STORAGE_KEY, JSON.stringify({ version: 2 }));
        expect(getAgentStartOfDayPlan()).toBeNull();
        localStorage.setItem(AGENT_START_OF_DAY_PLAN_STORAGE_KEY, JSON.stringify({ version: 1, ...input(), workBudgetPomos: 3 }));
        expect(getAgentStartOfDayPlan()).toBeNull();
    });

    it.each(["createdAt", "completedAt", "workUntil"] as const)("ignores records with a malformed %s date", (field) => {
        localStorage.setItem(AGENT_START_OF_DAY_PLAN_STORAGE_KEY, JSON.stringify({
            version: 1,
            ...input(),
            [field]: "not-a-date",
        }));

        expect(getAgentStartOfDayPlan()).toBeNull();
        expect(() => saveAgentStartOfDayPlan({ ...input(), [field]: "not-a-date" })).toThrow("Start-of-Day plan is invalid");
    });
});
