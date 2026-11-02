/// <reference types="node" />
import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DragEndEvent } from "@dnd-kit/core";
import { DeckPreview, type DeckPreviewProps } from "./DeckPreview";
import { buildDeckPlan, refreshDeckDerivations } from "../../lib/goals/deck/plan";
import type { DeckPlan } from "../../lib/goals/deck/types";
import type { GoalPeriod } from "../../lib/goals/periods";
import {
    buildGoalCheckInFixture,
    buildGoalFixture,
    buildGoalTrackerFixture,
} from "../../lib/goals/testFixtures";
import type { LocalDateKey } from "../../lib/todos/types";
import { setAgentApiKey } from "../../lib/agent/apiKey";
import * as transport from "../../lib/agent/llmTransport";
import { buildDeckPolishContext } from "../../lib/agent/deckPolishWorkflow";
import type { DeckPolishOutput } from "../../lib/agent/outputSchemas";

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

function mockPolish(plan: DeckPlan, focusGoalIndexes = [0, 2, 3]) {
    setAgentApiKey("test-key");
    const output: DeckPolishOutput = {
        slides: buildDeckPolishContext(plan, "").slides.map((slide, index) => ({
            title: plan.slides[index].title,
            notes: "A cohesive review of the recorded progress.",
            body: slide.body.map(field => field.field === "did" ? `Polished: ${field.text}` : field.text),
        })),
        focusGoalIndexes,
    };
    const complete = vi.fn().mockResolvedValue(JSON.stringify(output));
    vi.spyOn(transport, "createStoredAgentClient").mockReturnValue({ complete });
    return { complete, output };
}

const articleNames = () =>
    screen.getAllByRole("article").map(article => article.getAttribute("aria-label"));

const estimateText = () => screen.getByTestId("deck-estimate-total").textContent;

beforeEach(() => {
    localStorage.clear();
});

describe("DeckPreview", () => {
    function habitPlan(): DeckPlan {
        const tracker = buildGoalTrackerFixture();
        const goal = buildGoalFixture({
            id: "practice", trackerId: tracker.id, title: "Practice goal",
            metric: { label: "Practice", current: 9999, target: 3, unit: "sessions", source: "habit", habitId: "habit", overridePinned: false },
        });
        return buildDeckPlan({
            tracker, goals: [goal], period: { periodStart: "2026-10-18", periodEnd: "2026-11-01", monthKey: "2026-10" },
            now: new Date(2026, 10, 2, 12),
            checkIns: (["2026-10-04", "2026-10-18"] as const).map(periodStart => buildGoalCheckInFixture({
                id: periodStart, goalId: goal.id, periodStart, isFocus: true,
            })),
            habits: [{ id: "habit", name: "Practice", description: "", color: "", frequency: "daily", position: 0,
                isArchived: false, createdAt: tracker.createdAt, updatedAt: tracker.createdAt }],
            completions: [4, 5, 6, 18, 19, 20, 21].map(day => ({
                id: `day-${day}`, habitId: "habit", bucket: `2026-10-${String(day).padStart(2, "0")}`,
                createdAt: tracker.createdAt, updatedAt: tracker.createdAt,
            })),
        });
    }

    it("shows the derived metric, hit pill, and both series for the same goal with distinct React keys", () => {
        const errors = vi.spyOn(console, "error");
        try {
            renderPreview(habitPlan());
            const recap = within(screen.getByRole("article", { name: "Slide: Practice goal" }));
            expect(recap.getByText("Practice: 4 / 3 sessions · 1 over")).toBeInTheDocument();
            expect(recap.getByText("hit target 2 periods running")).toBeInTheDocument();
            expect(recap.queryByText(/9999/)).not.toBeInTheDocument();
            const progress = within(screen.getByRole("article", { name: "Slide: Progress" }));
            expect(progress.getAllByRole("listitem")).toHaveLength(2);
            expect(progress.getByText("Status")).toBeInTheDocument();
            expect(progress.getByText("Practice (sessions)")).toBeInTheDocument();
            expect(progress.getByText("2026-10-04: 3 · 2026-10-18: 4")).toBeInTheDocument();
            expect(errors.mock.calls.flat().join(" ")).not.toMatch(/same key|unique.*key/i);
        } finally { errors.mockRestore(); }
    });

    it.each([1, 2, 3])("shows the hit pill for streak %i only at two or more", streak => {
        const plan = habitPlan();
        plan.slides = plan.slides.map(slide => slide.kind === "recap" ? { ...slide, habitStreak: streak } : slide);
        renderPreview(plan);
        const recap = within(screen.getByRole("article", { name: "Slide: Practice goal" }));
        if (streak >= 2) expect(recap.getByText(`hit target ${streak} periods running`)).toBeInTheDocument();
        else expect(recap.queryByText(/periods running/)).not.toBeInTheDocument();
    });

    it("shows unavailable copy without a numeric reading for a broken habit link", () => {
        const plan = habitPlan();
        plan.slides = plan.slides.map(slide => slide.kind === "recap" ? {
            ...slide, habitStreak: null, metric: { ...slide.metric!, current: null, met: undefined, delta: undefined, unavailable: true },
        } : slide);
        renderPreview(plan);
        const recap = within(screen.getByRole("article", { name: "Slide: Practice goal" }));
        expect(recap.getByText("Practice: unavailable")).toBeInTheDocument();
        expect(recap.queryByText(/0 \/ 3|9999/)).not.toBeInTheDocument();
    });

    it("runs the presentation preset in one click and shows the exact brief used", async () => {
        const { complete } = mockPolish(buildPlan());
        const { user } = renderPreview(buildPlan());
        const preset = screen.getByRole("region", { name: "Presentation preset" });
        expect(within(preset).getByRole("button", { name: "Improve my presentation" }))
            .toHaveAccessibleDescription(/Make slide wording more engaging and speaker notes sound natural aloud\. Runs immediately/);
        expect(within(preset).queryByRole("button", { name: "Polish deck" })).not.toBeInTheDocument();
        const custom = screen.getByRole("region", { name: "Custom deck polish" });
        expect(within(custom).getByRole("button", { name: "Polish deck" })).toBeInTheDocument();
        await user.type(screen.getByLabelText("Deck-level prompt"), "Old custom brief");
        await user.click(screen.getByRole("button", { name: "Improve my presentation" }));
        await screen.findByRole("region", { name: "Latest polish changes" });
        expect(complete).toHaveBeenCalledTimes(1);
        const brief = JSON.parse(complete.mock.calls[0][0].messages[1].content).brief;
        expect(brief).toContain("fun to read and engaging to hear presented aloud");
        expect(brief).toContain("speaker notes as natural spoken narration");
        expect(brief).toContain("Preserve all facts, numbers");
        expect(brief).not.toContain("Old custom brief");
        expect(screen.getByLabelText("Deck-level prompt")).toHaveValue(brief);
        expect(screen.getByRole("button", { name: "Improve my presentation" })).toBeEnabled();
    });

    it("can apply the preset after an earlier polish using current edited copy", async () => {
        const plan = buildPlan();
        const { complete } = mockPolish(plan);
        const { user } = renderPreview(plan);
        await user.click(screen.getByRole("button", { name: "Polish deck" }));
        await screen.findByRole("region", { name: "Latest polish changes" });
        const did = within(screen.getByRole("article", { name: "Slide: Ship the release" })).getByLabelText("Did");
        await user.clear(did);
        await user.type(did, "Progress edited before the preset");
        await user.click(screen.getByRole("button", { name: "Improve my presentation" }));
        await waitFor(() => expect(screen.getByRole("button", { name: "Improve my presentation" })).toBeEnabled());
        expect(complete).toHaveBeenCalledTimes(2);
        const context = JSON.parse(complete.mock.calls[1][0].messages[1].content);
        expect(context.brief).toContain("fun to read");
        expect(context.slides[1].body[0].text).toBe("Progress edited before the preset");
    });

    it("allows another polish with a new prompt and the user's current edits", async () => {
        const plan = buildPlan();
        const { complete, output } = mockPolish(plan);
        const { user } = renderPreview(plan);
        await user.click(screen.getByRole("button", { name: "Polish deck" }));
        await screen.findByRole("region", { name: "Latest polish changes" });
        expect(screen.getByRole("button", { name: "Polish deck" })).toBeEnabled();
        const did = within(screen.getByRole("article", { name: "Slide: Ship the release" })).getByLabelText("Did");
        await user.clear(did);
        await user.type(did, "My latest progress");
        await user.type(screen.getByLabelText("Deck-level prompt"), "Make this more direct");
        output.slides[1].body[0] = "A more direct summary";
        complete.mockResolvedValue(JSON.stringify(output));
        await user.click(screen.getByRole("button", { name: "Polish deck" }));
        await waitFor(() => expect(did).toHaveValue("A more direct summary"));
        expect(complete).toHaveBeenCalledTimes(2);
        const context = JSON.parse(complete.mock.calls[1][0].messages[1].content);
        expect(context.brief).toBe("Make this more direct");
        expect(context.slides[1].body[0].text).toBe("My latest progress");
        const changes = screen.getByRole("region", { name: "Latest polish changes" });
        const detail = within(changes).getByText(/Ship the release · 1 field/).closest("details")!;
        await user.click(within(detail).getByText(/Ship the release · 1 field/));
        expect(within(detail).getByText("My latest progress")).toBeInTheDocument();
        expect(within(detail).getByText("A more direct summary")).toBeInTheDocument();
        expect(within(changes).queryByText("Reviewed the spec")).not.toBeInTheDocument();
    });

    it("shows exact before/after changes, badges, and navigation including hidden and appendix slides", async () => {
        const plan = buildPlan();
        mockPolish(plan);
        const { user } = renderPreview(plan);
        await user.click(screen.getByRole("button", { name: "Hide slide: Work" }));
        await user.click(screen.getByRole("button", { name: "Polish deck" }));
        const changes = await screen.findByRole("region", { name: "Latest polish changes" });
        expect(within(changes).getByText(new RegExp(`Changed ${plan.slides.length} slides`))).toBeInTheDocument();
        expect(within(changes).getByText(/Work · 1 field · Hidden/)).toBeInTheDocument();
        expect(within(changes).getByText(/Train four times · 2 fields · In appendix/)).toBeInTheDocument();
        const ship = screen.getByRole("article", { name: "Slide: Ship the release" });
        expect(within(ship).getByText("Changed by latest polish")).toBeInTheDocument();
        const details = within(changes).getByText(/Ship the release · 2 fields/).closest("details")!;
        await user.click(within(details).getByText(/Ship the release · 2 fields/));
        expect(within(details).getByText("Reviewed the spec")).toBeInTheDocument();
        expect(within(details).getByText("Polished: Reviewed the spec")).toBeInTheDocument();
        await user.click(within(details).getByRole("button", { name: "View slide: Ship the release" }));
        expect(ship).toHaveAttribute("aria-current", "true");
    });

    it("clearly reports a pass with no changes", async () => {
        const plan = buildPlan();
        const { complete, output } = mockPolish(plan, []);
        output.slides = buildDeckPolishContext(plan, "").slides.map((slide, index) => ({
            title: plan.slides[index].title, notes: plan.slides[index].notes, body: slide.body.map(field => field.text),
        }));
        complete.mockResolvedValue(JSON.stringify(output));
        const { user } = renderPreview(plan);
        await user.click(screen.getByRole("button", { name: "Polish deck" }));
        expect(await screen.findByText("No copy changes in the latest polish.")).toBeInTheDocument();
        expect(screen.queryByText("Changed by latest polish")).not.toBeInTheDocument();
    });

    it("can retry a failed pass and clears stale failure details after success", async () => {
        const plan = buildPlan();
        const { complete, output } = mockPolish(plan);
        complete.mockRejectedValueOnce(new transport.LLMTransportError("offline"));
        const { user } = renderPreview(plan);
        await user.click(screen.getByRole("button", { name: "Polish deck" }));
        await screen.findByText("Polish details");
        expect(screen.getByRole("button", { name: "Polish deck" })).toBeEnabled();
        complete.mockResolvedValue(JSON.stringify(output));
        await user.click(screen.getByRole("button", { name: "Polish deck" }));
        await screen.findByRole("region", { name: "Latest polish changes" });
        expect(screen.queryByText("Polish details")).not.toBeInTheDocument();
    });

    it("ignores an older skipped response while a newer pass is pending", async () => {
        const plan = buildPlan();
        const { complete, output } = mockPolish(plan);
        let finishFirst!: (value: string) => void;
        let finishSecond!: (value: string) => void;
        complete.mockImplementationOnce(() => new Promise<string>(resolveResponse => { finishFirst = resolveResponse; }))
            .mockImplementationOnce(() => new Promise<string>(resolveResponse => { finishSecond = resolveResponse; }));
        const { user } = renderPreview(plan);
        await user.click(screen.getByRole("button", { name: "Polish deck" }));
        await user.click(screen.getByRole("button", { name: "Skip polish" }));
        await user.click(screen.getByRole("button", { name: "Polish deck" }));
        await act(async () => { finishFirst(JSON.stringify(output)); });
        expect(screen.getByRole("button", { name: "Export deck" })).toBeDisabled();
        expect(screen.getByLabelText("Deck-level prompt")).toBeDisabled();
        expect(screen.queryByRole("region", { name: "Latest polish changes" })).not.toBeInTheDocument();
        output.slides[1].body[0] = "The newer response";
        await act(async () => { finishSecond(JSON.stringify(output)); });
        expect(within(screen.getByRole("article", { name: "Slide: Ship the release" })).getByLabelText("Did"))
            .toHaveValue("The newer response");
        expect(screen.getByRole("button", { name: "Polish deck" })).toBeEnabled();
    });

    it("hides the pre-export check with no warnings, and restores it when an edit needs attention", async () => {
        const plan = buildPlan();
        const metric = plan.slides.find(slide => slide.id === "recap:goal-metric");
        if (metric?.kind === "recap") metric.planned = [{ text: "Train again", dueDate: null }];
        const misses = plan.slides.find(slide => slide.kind === "misses");
        if (misses?.kind === "misses") misses.items[0].reason = "Review pending";
        const cleanPlan = refreshDeckDerivations(plan);
        expect(cleanPlan.warnings).toEqual([]);
        const { user } = renderPreview(cleanPlan);
        expect(screen.queryByRole("region", { name: "Pre-export check" })).not.toBeInTheDocument();
        const reason = within(screen.getByRole("article", { name: "Slide: Misses" })).getByLabelText("Reason");
        await user.clear(reason);
        expect(screen.getByRole("region", { name: "Pre-export check" })).toBeInTheDocument();
        await user.type(reason, "Review pending");
        expect(screen.queryByRole("region", { name: "Pre-export check" })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Export deck" })).toBeEnabled();
    });

    it("hides the pre-export card after the final item is skipped", async () => {
        const { user } = renderPreview(buildThinPlan());
        for (let index = 0; index < 3; index += 1) {
            await user.click(within(screen.getByRole("region", { name: "Pre-export check" })).getAllByRole("button", { name: "Skip" })[0]);
        }
        expect(screen.queryByRole("region", { name: "Pre-export check" })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Export deck" })).toBeEnabled();
    });

    it("captures one deck prompt and waits for acceptance before changing focus", async () => {
        const plan = buildPlan();
        const { complete } = mockPolish(plan);
        const { user, onExport } = renderPreview(plan);
        await user.type(screen.getByLabelText("Deck-level prompt"), "Be concise and emphasize blockers");
        await user.click(screen.getByRole("button", { name: "Polish deck" }));
        const suggestion = await screen.findByRole("region", { name: "Suggested focus" });
        expect(JSON.parse(complete.mock.calls[0][0].messages[1].content).brief).toBe("Be concise and emphasize blockers");
        expect(complete).toHaveBeenCalledTimes(1);
        expect(screen.getByRole("article", { name: "Slide: Automate invoices" })).toBeInTheDocument();
        expect(screen.queryByRole("article", { name: "Slide: Train four times" })).not.toBeInTheDocument();
        await user.click(within(suggestion).getByRole("button", { name: "Accept suggested focus" }));
        expect(screen.queryByRole("article", { name: "Slide: Automate invoices" })).not.toBeInTheDocument();
        expect(screen.getByRole("article", { name: "Slide: Train four times" })).toBeInTheDocument();
        expect(screen.queryByRole("region", { name: "Suggested focus" })).not.toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Export deck" }));
        const exported = vi.mocked(onExport).mock.calls[0][0];
        expect(exported.slides.filter(slide => slide.kind === "recap" && slide.placement === "body").map(slide => slide.id))
            .toEqual(["recap:goal-ship", "recap:goal-metric", "recap:goal-achieved"]);
    });

    it("lets the user adjust the suggestion before applying it", async () => {
        const plan = buildPlan();
        mockPolish(plan);
        const { user } = renderPreview(plan);
        await user.click(screen.getByRole("button", { name: "Polish deck" }));
        const suggestion = await screen.findByRole("region", { name: "Suggested focus" });
        await user.click(within(suggestion).getByRole("button", { name: "Adjust focus" }));
        await user.click(within(suggestion).getByLabelText("Train four times"));
        await user.click(within(suggestion).getByLabelText("Automate invoices"));
        expect(screen.queryByRole("article", { name: "Slide: Train four times" })).not.toBeInTheDocument();
        await user.click(within(suggestion).getByRole("button", { name: "Apply adjusted focus" }));
        expect(screen.getByRole("article", { name: "Slide: Automate invoices" })).toBeInTheDocument();
        expect(screen.queryByRole("article", { name: "Slide: Train four times" })).not.toBeInTheDocument();
    });

    it("allows keeping current focus while editing polished text and rechecking before export", async () => {
        const plan = buildPlan();
        mockPolish(plan);
        const { user, onExport } = renderPreview(plan);
        await user.click(screen.getByRole("button", { name: "Polish deck" }));
        const suggestion = await screen.findByRole("region", { name: "Suggested focus" });
        await user.click(within(suggestion).getByRole("button", { name: "Keep current focus" }));
        const ship = screen.getByRole("article", { name: "Slide: Ship the release" });
        const did = within(ship).getByLabelText("Did");
        expect(did).toHaveValue("Polished: Reviewed the spec");
        await user.clear(did);
        await user.type(did, "My edited summary");
        const missWarning = plan.warnings.find(warning => warning.kind === "miss-without-reason")!;
        const check = screen.getByRole("region", { name: "Pre-export check" });
        expect(within(check).getByText(missWarning.message)).toBeInTheDocument();
        const misses = screen.getByRole("article", { name: "Slide: Misses" });
        await user.type(within(misses).getByLabelText("Reason"), "Waiting on review");
        expect(within(check).queryByText(missWarning.message)).not.toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Export deck" }));
        const exported = vi.mocked(onExport).mock.calls[0][0];
        expect(exported.slides.find(slide => slide.id === "recap:goal-ship")).toMatchObject({ did: "My edited summary" });
        expect(exported.slides.find(slide => slide.id === "recap:goal-ops")).toMatchObject({ placement: "body" });
        expect(exported.slides.find(slide => slide.id === "recap:goal-metric")).toMatchObject({ placement: "appendix" });
    });

    it.each(["no-key", "transport", "invalid-json", "empty-suggestion"]) ("keeps export available for %s", async kind => {
        const plan = buildPlan();
        if (kind !== "no-key") {
            const { complete, output } = mockPolish(plan, []);
            if (kind === "transport") complete.mockRejectedValue(new Error("offline"));
            if (kind === "invalid-json") complete.mockResolvedValue("invalid JSON");
            if (kind === "empty-suggestion") complete.mockResolvedValue(JSON.stringify(output));
        }
        const { user, onExport } = renderPreview(plan);
        await user.click(screen.getByRole("button", { name: "Polish deck" }));
        await waitFor(() => expect(screen.getByRole("button", { name: "Export deck" })).toBeEnabled());
        expect(screen.queryByRole("region", { name: "Suggested focus" })).not.toBeInTheDocument();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Export deck" }));
        const exported = vi.mocked(onExport).mock.calls[0][0];
        if (kind !== "empty-suggestion") expect(exported).toEqual(plan);
    });

    it("can skip a slow pass and ignores its late response", async () => {
        const plan = buildPlan();
        const { complete, output } = mockPolish(plan);
        let finish!: (value: string) => void;
        complete.mockImplementation(() => new Promise<string>(resolveResponse => { finish = resolveResponse; }));
        const { user, onExport } = renderPreview(plan);
        await user.click(screen.getByRole("button", { name: "Polish deck" }));
        expect(screen.getByRole("button", { name: "Export deck" })).toBeDisabled();
        expect(screen.getAllByLabelText("Did")[0]).toBeDisabled();
        await user.click(screen.getByRole("button", { name: "Skip polish" }));
        expect(screen.getByRole("button", { name: "Export deck" })).toBeEnabled();
        await act(async () => { finish(JSON.stringify(output)); });
        expect(screen.queryByRole("region", { name: "Suggested focus" })).not.toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Export deck" }));
        expect(vi.mocked(onExport).mock.calls[0][0]).toEqual(plan);
    });

    it("shows provider/model and HTTP diagnostics while preserving the editable deck", async () => {
        const plan = buildPlan();
        const { complete } = mockPolish(plan);
        complete.mockRejectedValue(new transport.LLMTransportError("SECRET ERROR", 404, "SECRET RESPONSE"));
        const { user } = renderPreview(plan);
        await user.click(screen.getByRole("button", { name: "Polish deck" }));
        await user.click(await screen.findByText("Polish details"));
        expect(screen.getByText(/HTTP 404/)).toHaveTextContent("openai · gpt-5.6-luna");
        expect(screen.queryByText(/SECRET/)).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Export deck" })).toBeEnabled();
        expect(screen.getAllByLabelText("Did")[0]).toBeEnabled();
    });

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
