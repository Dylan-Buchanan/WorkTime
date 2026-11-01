/// <reference types="node" />
import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DragEndEvent } from "@dnd-kit/core";
import { DeckPreview, type DeckPreviewProps } from "./DeckPreview";
import { buildDeckPlan } from "../../lib/goals/deck/plan";
import type { DeckPlan } from "../../lib/goals/deck/types";
import type { GoalPeriod } from "../../lib/goals/periods";
import {
    buildGoalCheckInFixture,
    buildGoalFixture,
    buildGoalTrackerFixture,
} from "../../lib/goals/testFixtures";
import type { LocalDateKey } from "../../lib/todos/types";

const PERIOD: GoalPeriod = {
    periodStart: "2026-10-04",
    periodEnd: "2026-10-18",
    monthKey: "2026-10",
};
const NOW = new Date("2026-10-18T12:00:00.000Z");
const localDateOf = (iso: string): LocalDateKey => iso.slice(0, 10) as LocalDateKey;
const clock = (totalSeconds: number): string =>
    `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;

const drag = vi.hoisted(() => ({ end: null as null | ((event: DragEndEvent) => void) }));
vi.mock("@dnd-kit/core", async importOriginal => {
    const original = await importOriginal<typeof import("@dnd-kit/core")>();
    return {
        ...original,
        DndContext: (props: React.ComponentProps<typeof original.DndContext>) => {
            drag.end = props.onDragEnd ?? null;
            return <original.DndContext {...props} />;
        },
    };
});

function buildPlan(): DeckPlan {
    const tracker = buildGoalTrackerFixture({
        id: "tracker-work",
        name: "Work",
        purpose: "Ship the release",
    });
    const goals = [
        buildGoalFixture({ id: "goal-ship", trackerId: tracker.id, title: "Ship the release", sortOrder: 0 }),
        buildGoalFixture({ id: "goal-ops", trackerId: tracker.id, title: "Automate invoices", sortOrder: 1 }),
        buildGoalFixture({
            id: "goal-metric",
            trackerId: tracker.id,
            title: "Train four times",
            sortOrder: 2,
            metric: {
                label: "Sessions",
                target: 8,
                current: 3,
                unit: "",
                source: "manual",
                overridePinned: false,
            },
        }),
        buildGoalFixture({
            id: "goal-achieved",
            trackerId: tracker.id,
            title: "Ship v1",
            sortOrder: 3,
            lifecycle: "achieved",
            achievedAt: "2026-10-12T12:00:00.000Z",
        }),
    ];
    const checkIns = [
        buildGoalCheckInFixture({
            id: "check-ship-previous",
            goalId: "goal-ship",
            periodStart: "2026-09-20",
            did: "Reviewed the outline",
            planned: [{ text: "Write the spec", dueDate: null }],
            isFocus: true,
        }),
        buildGoalCheckInFixture({
            id: "check-ship",
            goalId: "goal-ship",
            periodStart: PERIOD.periodStart,
            did: "Reviewed the spec",
            current: "Writing the migration",
            planned: [{ text: "Ship the migration", dueDate: "2026-10-30" }],
            statusPill: "at-risk",
            missReason: "",
            isFocus: true,
        }),
        buildGoalCheckInFixture({
            id: "check-ops",
            goalId: "goal-ops",
            periodStart: PERIOD.periodStart,
            did: "Drafted the invoice flow",
            current: "Building the importer",
            planned: [{ text: "Ship the importer", dueDate: null }],
            isFocus: true,
        }),
        buildGoalCheckInFixture({
            id: "check-metric",
            goalId: "goal-metric",
            periodStart: PERIOD.periodStart,
            did: "Two sessions",
            current: "",
            planned: [],
            isFocus: false,
        }),
        buildGoalCheckInFixture({
            id: "check-achieved",
            goalId: "goal-achieved",
            periodStart: PERIOD.periodStart,
            did: "Shipped v1",
            planned: [{ text: "Celebrate", dueDate: null }],
            isFocus: true,
        }),
    ];
    return buildDeckPlan({
        tracker,
        goals,
        checkIns,
        period: PERIOD,
        now: NOW,
        localDateOf,
    });
}

function buildThinPlan(): DeckPlan {
    const tracker = buildGoalTrackerFixture({ id: "tracker-thin", name: "Thin", purpose: "" });
    const goal = buildGoalFixture({
        id: "goal-thin",
        trackerId: tracker.id,
        title: "Thin goal",
        sortOrder: 0,
    });
    const checkIns = [
        buildGoalCheckInFixture({
            id: "thin-previous",
            goalId: goal.id,
            periodStart: "2026-09-20",
            did: "Started the draft",
            planned: [{ text: "Finish the draft", dueDate: null }],
            isFocus: true,
        }),
        buildGoalCheckInFixture({
            id: "thin-current",
            goalId: goal.id,
            periodStart: PERIOD.periodStart,
            did: "",
            current: "",
            planned: [],
            missReason: "",
            isFocus: true,
        }),
    ];
    return buildDeckPlan({ tracker, goals: [goal], checkIns, period: PERIOD, now: NOW, localDateOf });
}

function renderPreview(
    plan: DeckPlan,
    onExport: DeckPreviewProps["onExport"] = vi.fn(),
    onClose: DeckPreviewProps["onClose"] = vi.fn(),
) {
    const user = userEvent.setup();
    const view = render(<DeckPreview plan={plan} onClose={onClose} onExport={onExport} />);
    return { user, onExport, onClose, ...view };
}

const articleNames = () =>
    screen.getAllByRole("article").map(article => article.getAttribute("aria-label"));

const estimateText = () => screen.getByTestId("deck-estimate-total").textContent;

beforeEach(() => {
    localStorage.clear();
});

describe("DeckPreview", () => {
    it("renders the plan in order with titles, notes, suggested seconds, and the plan estimate", () => {
        const plan = buildPlan();
        renderPreview(plan);

        const expected = plan.slides
            .filter(slide => !(slide.kind === "recap" && slide.placement === "appendix"))
            .map(slide => slide.title);
        expect(articleNames()).toEqual(expected.map(title => `Slide: ${title}`));

        for (const slide of plan.slides) {
            if (slide.kind === "recap" && slide.placement === "appendix") continue;
            const article = screen.getByRole("article", { name: `Slide: ${slide.title}` });
            expect(within(article).getByLabelText("Slide title")).toHaveValue(slide.title);
            expect(within(article).getByLabelText("Speaker notes")).toHaveValue(slide.notes);
            expect(within(article).getByText(`${slide.suggestedSeconds}s`)).toBeInTheDocument();
        }

        expect(screen.getByTestId("deck-estimate-total")).toHaveTextContent(
            `Total talk time ${clock(plan.estimate.totalSeconds)} of ${clock(plan.estimate.targetSeconds)} target`,
        );
        expect(screen.getByTestId("deck-estimate-summary")).toHaveTextContent(
            `${plan.estimate.visibleSlides} visible slides`,
        );
    });

    it("hides and shows a slide, updates the estimate, and retains edited hidden content", async () => {
        const plan = buildPlan();
        const { user } = renderPreview(plan);
        const titleArticle = screen.getByRole("article", { name: "Slide: Work" });
        const notes = within(titleArticle).getByLabelText("Speaker notes");

        await user.clear(notes);
        await user.type(notes, "A note kept while hidden");
        const editedEstimate = estimateText();

        await user.click(within(titleArticle).getByRole("button", { name: "Hide slide: Work" }));
        expect(screen.queryByRole("article", { name: "Slide: Work" })).not.toBeInTheDocument();
        expect(estimateText()).not.toBe(editedEstimate);

        const hidden = screen.getByRole("region", { name: "Hidden slides" });
        expect(within(hidden).getByText(/Work/)).toBeInTheDocument();
        await user.click(within(hidden).getByRole("button", { name: "Show slide: Work" }));

        expect(estimateText()).toBe(editedEstimate);
        expect(within(screen.getByRole("article", { name: "Slide: Work" })).getByLabelText("Speaker notes"))
            .toHaveValue("A note kept while hidden");
    });

    it("edits a slide title, speaker notes, and a recap field in memory and recomputes the estimate", async () => {
        const plan = buildPlan();
        const { user } = renderPreview(plan);
        const before = estimateText();
        const ship = screen.getByRole("article", { name: "Slide: Ship the release" });

        const title = within(ship).getByLabelText("Slide title");
        await user.clear(title);
        await user.type(title, "Ship the release now");
        expect(screen.getByRole("article", { name: "Slide: Ship the release now" })).toBeInTheDocument();
        expect(plan.slides.find(slide => slide.id === "recap:goal-ship")?.title).toBe("Ship the release");

        const edited = screen.getByRole("article", { name: "Slide: Ship the release now" });
        const notes = within(edited).getByLabelText("Speaker notes");
        await user.clear(notes);
        await user.type(notes, "Talk about the release train and the migration");
        const did = within(edited).getByLabelText("Did");
        await user.clear(did);
        await user.type(did, "Reviewed the spec and the tests");

        expect(within(edited).getByLabelText("Slide title")).toHaveValue("Ship the release now");
        expect(within(edited).getByLabelText("Speaker notes"))
            .toHaveValue("Talk about the release train and the migration");
        expect(within(edited).getByLabelText("Did")).toHaveValue("Reviewed the spec and the tests");
        expect(estimateText()).not.toBe(before);
    });

    it("reorders recaps with move controls, rejects cross-block controls, and accepts a dnd drop", async () => {
        const plan = buildPlan();
        const { user } = renderPreview(plan);

        expect(within(screen.getByRole("article", { name: "Slide: Ship the release" }))
            .getByRole("button", { name: "Move Ship the release up" })).toBeDisabled();
        expect(within(screen.getByRole("article", { name: "Slide: Ship v1" }))
            .getByRole("button", { name: "Move Ship v1 down" })).toBeDisabled();
        expect(screen.queryByRole("button", { name: "Move Work up" })).not.toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Move Automate invoices up" }));
        expect(articleNames().slice(0, 4)).toEqual([
            "Slide: Work",
            "Slide: Automate invoices",
            "Slide: Ship the release",
            "Slide: Ship v1",
        ]);

        await act(async () => {
            drag.end!({
                active: { id: "recap:goal-ship" },
                over: { id: "recap:goal-ops" },
            } as DragEndEvent);
        });
        expect(articleNames().slice(0, 3)).toEqual([
            "Slide: Work",
            "Slide: Ship the release",
            "Slide: Automate invoices",
        ]);
    });

    it("keeps edited appendix copy when the appendix temporarily disappears and returns", async () => {
        const plan = buildPlan();
        const { user } = renderPreview(plan);
        const appendix = screen.getByRole("article", { name: "Slide: Appendix" });
        const entry = within(appendix).getByRole("group", { name: "Appendix entry Train four times" });

        const goalTitle = within(entry).getByLabelText("Appendix goal title");
        await user.clear(goalTitle);
        await user.type(goalTitle, "Train four times weekly");
        const metricText = within(entry).getByLabelText("Appendix metric text");
        await user.clear(metricText);
        await user.type(metricText, "Sessions: 3 / 8");

        await user.click(screen.getByRole("button", { name: "Demote Train four times weekly to body" }));
        expect(screen.queryByRole("article", { name: "Slide: Appendix" })).not.toBeInTheDocument();
        const metricRecap = screen.getByRole("article", { name: "Slide: Train four times" });
        await user.click(within(metricRecap).getByRole("button", { name: "Promote Train four times to appendix" }));

        const restored = screen.getByRole("article", { name: "Slide: Appendix" });
        const restoredEntry = within(restored).getByRole("group", { name: "Appendix entry Train four times weekly" });
        expect(within(restoredEntry).getByLabelText("Appendix goal title")).toHaveValue("Train four times weekly");
        expect(within(restoredEntry).getByLabelText("Appendix metric text")).toHaveValue("Sessions: 3 / 8");
    });

    it("preserves recap copy and hidden state through appendix promotion and demotion", async () => {
        const plan = buildPlan();
        const { user } = renderPreview(plan);
        const ship = screen.getByRole("article", { name: "Slide: Ship the release" });
        const did = within(ship).getByLabelText("Did");
        await user.clear(did);
        await user.type(did, "Reviewed the spec and the tests");
        await user.click(within(ship).getByRole("button", { name: "Hide slide: Ship the release" }));

        const hidden = screen.getByRole("region", { name: "Hidden slides" });
        await user.click(within(hidden).getByRole("button", { name: "Promote Ship the release to appendix" }));
        const appendix = screen.getByRole("article", { name: "Slide: Appendix" });
        expect(within(appendix).getByRole("group", { name: "Appendix entry Ship the release" })).toBeInTheDocument();

        await user.click(within(appendix).getByRole("button", { name: "Demote Ship the release to body" }));
        const hiddenAgain = screen.getByRole("region", { name: "Hidden slides" });
        expect(within(hiddenAgain).getByRole("button", { name: "Show slide: Ship the release" })).toBeInTheDocument();
        await user.click(within(hiddenAgain).getByRole("button", { name: "Show slide: Ship the release" }));

        const shown = screen.getByRole("article", { name: "Slide: Ship the release" });
        expect(within(shown).getByLabelText("Did")).toHaveValue("Reviewed the spec and the tests");
    });

    it("lists every thin-warning category, fixes by selecting, skips one warning, and proceeds without blocking", async () => {
        const plan = buildThinPlan();
        const onExport = vi.fn();
        const { user } = renderPreview(plan, onExport);
        expect(plan.warnings.map(warning => warning.kind))
            .toEqual(["miss-without-reason", "goal-without-plans", "empty-period"]);
        expect(screen.getByRole("button", { name: "Export deck" })).toBeEnabled();

        const check = screen.getByRole("region", { name: "Pre-export check" });
        for (const warning of plan.warnings) {
            expect(within(check).getByText(warning.message)).toBeInTheDocument();
        }

        const missWarning = plan.warnings.find(warning => warning.kind === "miss-without-reason")!;
        const missRow = within(check).getByText(missWarning.message).closest("li") as HTMLElement;
        await user.click(within(missRow).getByRole("button", { name: "Fix" }));
        expect(screen.getByRole("article", { name: "Slide: Misses" })).toHaveAttribute("aria-current", "true");

        const planWarning = plan.warnings.find(warning => warning.kind === "goal-without-plans")!;
        const planRow = within(check).getByText(planWarning.message).closest("li") as HTMLElement;
        await user.click(within(planRow).getByRole("button", { name: "Fix" }));
        expect(screen.getByRole("article", { name: "Slide: Thin goal" })).toHaveAttribute("aria-current", "true");

        const emptyWarning = plan.warnings.find(warning => warning.kind === "empty-period")!;
        const emptyRow = within(check).getByText(emptyWarning.message).closest("li") as HTMLElement;
        await user.click(within(emptyRow).getByRole("button", { name: "Skip" }));
        expect(within(check).queryByText(emptyWarning.message)).not.toBeInTheDocument();
        expect(within(check).getByText(missWarning.message)).toBeInTheDocument();
        expect(within(check).getByText(planWarning.message)).toBeInTheDocument();

        await user.click(within(check).getByRole("button", { name: "Proceed with export" }));
        await waitFor(() => expect(onExport).toHaveBeenCalledTimes(1));
    });

    it("exports the edited in-memory plan and keeps editing when onExport rejects", async () => {
        const plan = buildPlan();
        const onExport = vi.fn();
        const { user } = renderPreview(plan, onExport);
        const ship = screen.getByRole("article", { name: "Slide: Ship the release" });
        const title = within(ship).getByLabelText("Slide title");
        await user.clear(title);
        await user.type(title, "Ship the release now");

        await user.click(screen.getByRole("button", { name: "Export deck" }));
        await waitFor(() => expect(onExport).toHaveBeenCalledTimes(1));
        const exported = onExport.mock.calls[0][0] as DeckPlan;
        expect(exported.slides.find(slide => slide.id === "recap:goal-ship")?.title).toBe("Ship the release now");
        expect(exported.estimate.totalSeconds).toBeGreaterThan(plan.estimate.totalSeconds);

        onExport.mockRejectedValueOnce(new Error("Renderer unavailable"));
        await user.click(screen.getByRole("button", { name: "Export deck" }));
        expect(await screen.findByRole("alert")).toHaveTextContent("Renderer unavailable");
        expect(screen.getByRole("article", { name: "Slide: Ship the release now" })).toBeInTheDocument();
    });

    it("discards edits on close and shows the original plan on a fresh mount", async () => {
        const plan = buildPlan();
        const onClose = vi.fn();
        const { user, unmount } = renderPreview(plan, vi.fn(), onClose);
        const ship = screen.getByRole("article", { name: "Slide: Ship the release" });
        const title = within(ship).getByLabelText("Slide title");
        await user.clear(title);
        await user.type(title, "Edited title");

        await user.click(screen.getByRole("button", { name: "Close preview" }));
        expect(onClose).toHaveBeenCalledTimes(1);
        unmount();

        renderPreview(plan);
        expect(screen.queryByRole("article", { name: "Slide: Edited title" })).not.toBeInTheDocument();
        expect(within(screen.getByRole("article", { name: "Slide: Ship the release" }))
            .getByLabelText("Slide title")).toHaveValue("Ship the release");
    });

    it("does not write to localStorage and statically imports no pptx renderer", async () => {
        const setItem = vi.spyOn(Storage.prototype, "setItem");
        const plan = buildPlan();
        const { user } = renderPreview(plan);
        const ship = screen.getByRole("article", { name: "Slide: Ship the release" });
        const title = within(ship).getByLabelText("Slide title");
        await user.clear(title);
        await user.type(title, "Local only");
        await user.click(screen.getByRole("button", { name: "Hide slide: Local only" }));
        await user.click(screen.getByRole("button", { name: "Export deck" }));
        await waitFor(() => expect(setItem).not.toHaveBeenCalled());

        const source = readFileSync(resolve(process.cwd(), "src/components/goals/DeckPreview.tsx"), "utf8");
        expect(source).not.toMatch(/pptx/i);
    });
});
