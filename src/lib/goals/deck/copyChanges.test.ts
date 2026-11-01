import { describe, expect, it } from "vitest";
import { buildGoalCheckInFixture, buildGoalFixture, buildGoalTrackerFixture } from "../testFixtures";
import { findDeckCopyChanges } from "./copyChanges";
import { buildDeckPlan, moveGoalToAppendix, refreshDeckDerivations, setSlideHidden } from "./plan";
import type { DeckPlan, DeckSlide } from "./types";

function fixture(): DeckPlan {
    const tracker = buildGoalTrackerFixture();
    const goal = buildGoalFixture();
    return buildDeckPlan({ tracker, goals: [goal], now: new Date("2026-11-01T12:00:00Z"),
        period: { periodStart: "2026-10-18", periodEnd: "2026-11-01", monthKey: "2026-10" },
        checkIns: [
            buildGoalCheckInFixture({ id: "previous", periodStart: "2026-10-04", planned: [{ text: "Finish the outline", dueDate: null }] }),
            buildGoalCheckInFixture({ periodStart: "2026-10-18", did: "Reviewed the draft", current: "Writing tests", missReason: "Review pending",
                planned: [{ text: "Ship the draft", dueDate: "2026-11-02" }], isFocus: true }),
        ],
    });
}

function slide<K extends DeckSlide["kind"]>(plan: DeckPlan, kind: K): Extract<DeckSlide, { kind: K }> {
    return plan.slides.find(item => item.kind === kind) as Extract<DeckSlide, { kind: K }>;
}

describe("deck copy change summary", () => {
    it("reports exact field values and omits unchanged fields and slides", () => {
        const before = fixture();
        const after = structuredClone(before);
        slide(after, "title").title = "A sharper review";
        const recap = slide(after, "recap");
        recap.notes = "Explain the test coverage.";
        recap.did = "Reviewed the draft and tests";
        recap.planned[0].text = "Ship the reviewed draft";
        expect(findDeckCopyChanges(before, after)).toEqual([
            { slideId: "title", slideTitle: "A sharper review", fields: [{ label: "Slide title", before: "Work", after: "A sharper review" }] },
            { slideId: recap.id, slideTitle: recap.title, fields: [
                { label: "Speaker notes", before: slide(before, "recap").notes, after: "Explain the test coverage." },
                { label: "Did", before: "Reviewed the draft", after: "Reviewed the draft and tests" },
                { label: "Planned item 1", before: "Ship the draft", after: "Ship the reviewed draft" },
            ] },
        ]);
        expect(slide(before, "recap").did).toBe("Reviewed the draft");
    });

    it("includes missed plans, reasons, next plans, and closing commitments", () => {
        const before = fixture();
        const after = structuredClone(before);
        slide(after, "misses").items[0].text = "Complete the outline";
        slide(after, "misses").items[0].reason = "Awaiting review";
        slide(after, "next-plans").items[0].text = "Publish the draft";
        slide(after, "closing").commitments[0].text = "Deliver the draft";
        expect(findDeckCopyChanges(before, after).map(change => change.fields)).toEqual([
            [{ label: "Miss 1 text", before: "Finish the outline", after: "Complete the outline" },
                { label: "Miss 1 reason", before: "Review pending", after: "Awaiting review" }],
            [{ label: "Next plan 1", before: "Ship the draft", after: "Publish the draft" }],
            [{ label: "Commitment 1", before: "Ship the draft", after: "Deliver the draft" }],
        ]);
    });

    it("includes changed hidden and appendix recaps by ID and ignores placement and derived values", () => {
        const before = fixture();
        const recap = slide(before, "recap");
        const moved = setSlideHidden(moveGoalToAppendix(before, recap.goalId), recap.id, true);
        expect(findDeckCopyChanges(before, refreshDeckDerivations(moved))).toEqual([]);
        slide(moved, "recap").did = "A clearer summary";
        moved.slides.reverse();
        expect(findDeckCopyChanges(before, moved)).toEqual([{ slideId: recap.id, slideTitle: recap.title,
            fields: [{ label: "Did", before: recap.did, after: "A clearer summary" }] }]);
    });
});
