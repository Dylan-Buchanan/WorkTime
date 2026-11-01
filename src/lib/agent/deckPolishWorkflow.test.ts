import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildDeckPlan } from "../goals/deck/plan";
import { buildGoalCheckInFixture, buildGoalFixture, buildGoalTrackerFixture } from "../goals/testFixtures";
import type { DeckPlan } from "../goals/deck/types";
import { setAgentApiKey } from "./apiKey";
import * as transport from "./llmTransport";
import type { DeckPolishOutput } from "./outputSchemas";
import { buildDeckPolishContext, runDeckPolishWorkflow } from "./deckPolishWorkflow";

function fixture(): DeckPlan {
    const tracker = buildGoalTrackerFixture({ name: "PRIVATE TRACKER", purpose: "PRIVATE PURPOSE" });
    const goals = Array.from({ length: 6 }, (_, index) => buildGoalFixture({
        id: `goal-${index}`, title: `Goal ${index}`, trackerId: tracker.id, sortOrder: index,
        notes: "PRIVATE GOAL NOTE", projectId: "PRIVATE PROJECT ID",
        ...(index === 0 ? { metric: { label: "PRIVATE LABEL", unit: "PRIVATE UNIT", current: 3, target: 8, source: "manual" as const, overridePinned: false } } : {}),
    }));
    const checkIns = goals.map((goal, index) => buildGoalCheckInFixture({
        id: `check-${index}`, goalId: goal.id, periodStart: "2026-10-18",
        did: `Progress ${index}`, current: "Working on the review", missReason: "",
        statusPill: index === 0 ? "blocked" : "at-risk",
        isFocus: true, planned: [{ text: `Next step ${index}`, dueDate: "2026-11-03" }],
    }));
    return buildDeckPlan({
        tracker, goals, checkIns, now: new Date("2026-11-01T12:00:00Z"),
        period: { periodStart: "2026-10-18", periodEnd: "2026-11-01", monthKey: "2026-10" },
        evidenceTitlesByGoal: { "goal-0": ["Review tests"] },
    });
}

function validOutput(plan: DeckPlan): DeckPolishOutput {
    const context = buildDeckPolishContext(plan, "");
    return {
        slides: context.slides.map((slide, index) => ({
            title: `Polished headline ${index}`, notes: "Concise notes grounded in the review.",
            body: slide.body.map(field => `Polished ${field.text}`),
        })),
        focusGoalIndexes: [0, 1, 2],
    };
}

beforeEach(() => { localStorage.clear(); });

describe("deck polish workflow", () => {
    it("applies validated copy atomically, preserves structure and numbers, and only suggests focus", async () => {
        const plan = fixture();
        const original = structuredClone(plan);
        const output = validOutput(plan);
        const complete = vi.fn().mockResolvedValue(JSON.stringify(output));
        const onProgress = vi.fn();
        const result = await runDeckPolishWorkflow({ plan, prompt: "Be candid", client: { complete }, provider: "deepseek", onProgress });
        expect(result.outcome).toBe("polished");
        expect(result.suggestedFocusGoalIds).toEqual(["goal-0", "goal-1", "goal-2"]);
        expect(result.plan.slides.map(slide => [slide.id, slide.kind, slide.isHidden]))
            .toEqual(plan.slides.map(slide => [slide.id, slide.kind, slide.isHidden]));
        const recap = result.plan.slides.find(slide => slide.kind === "recap")!;
        expect(recap).toMatchObject({ title: "Polished headline 1", placement: "body", metric: { current: 3, target: 8 },
            planned: [{ text: "Polished Next step 0", dueDate: "2026-11-03" }], evidenceTaskTitles: ["Review tests"] });
        expect(plan).toEqual(original);
        expect(result.plan.estimate.totalSeconds).not.toBe(plan.estimate.totalSeconds);
        expect(complete).toHaveBeenCalledTimes(1);
        expect(complete.mock.calls[0][0]).toMatchObject({ model: "deepseek-flash", thinking: { type: "disabled" }, responseFormat: { type: "json_object" } });
        expect(onProgress.mock.calls.map(([event]) => event.phase)).toEqual(["building-context", "polishing", "validating-copy", "completed"]);
    });

    it("uses the saved provider/client and permits an explicit model override", async () => {
        const plan = fixture();
        setAgentApiKey("test-key");
        const complete = vi.fn().mockResolvedValue(JSON.stringify(validOutput(plan)));
        const stored = vi.spyOn(transport, "createStoredAgentClient").mockReturnValue({ complete });
        const result = await runDeckPolishWorkflow({ plan, prompt: "", provider: "openai", model: "injected-model" });
        expect(result.outcome).toBe("polished");
        expect(stored).toHaveBeenCalledWith({ provider: "openai" });
        expect(complete.mock.calls[0][0].model).toBe("injected-model");
    });

    it("retries invalid JSON once with feedback, then returns the untouched plan", async () => {
        const plan = fixture();
        const complete = vi.fn().mockResolvedValue("not JSON");
        const result = await runDeckPolishWorkflow({ plan, prompt: "", client: { complete } });
        expect(result).toMatchObject({ plan, suggestedFocusGoalIds: [], outcome: "fallback", failure: { kind: "invalid-output" } });
        expect(result.plan).toBe(plan);
        expect(complete).toHaveBeenCalledTimes(2);
        expect(complete.mock.calls[1][0].messages.at(-1).content).toContain("Validation errors:");
    });

    it("can recover on the feedback retry", async () => {
        const plan = fixture();
        const complete = vi.fn().mockResolvedValueOnce("{}").mockResolvedValueOnce(JSON.stringify(validOutput(plan)));
        expect((await runDeckPolishWorkflow({ plan, prompt: "", client: { complete } })).outcome).toBe("polished");
        expect(complete).toHaveBeenCalledTimes(2);
    });

    it.each(["body", "slide-count", "focus"]) ("retries %s validation with corrective feedback", async kind => {
        const plan = fixture();
        const invalid = validOutput(plan);
        if (kind === "body") invalid.slides[0].body = ["Invented title body"];
        if (kind === "slide-count") invalid.slides.pop();
        if (kind === "focus") invalid.focusGoalIndexes = [0, 1];
        const complete = vi.fn().mockResolvedValueOnce(JSON.stringify(invalid)).mockResolvedValueOnce(JSON.stringify(validOutput(plan)));
        const result = await runDeckPolishWorkflow({ plan, prompt: "", provider: "deepseek", client: { complete } });
        expect(result.outcome).toBe("polished");
        expect(complete).toHaveBeenCalledTimes(2);
        const feedback = complete.mock.calls[1][0].messages.at(-1).content;
        expect(feedback).toContain(kind === "body" ? "requires exactly 0 body strings" : kind === "focus" ? "distinct indexes" : `exactly ${plan.slides.length} slides`);
    });

    it("reports safe model/HTTP diagnostics without exposing provider response bodies", async () => {
        const plan = fixture();
        const complete = vi.fn().mockRejectedValue(new transport.LLMTransportError("SECRET ERROR", 404, "SECRET KEY AND RESPONSE"));
        const result = await runDeckPolishWorkflow({ plan, prompt: "", client: { complete }, provider: "deepseek" });
        expect(result.failure).toEqual({ provider: "deepseek", model: "deepseek-flash", kind: "transport", status: 404,
            message: "The provider rejected the polish request (HTTP 404)." });
        expect(JSON.stringify(result.failure)).not.toContain("SECRET");
        expect(result.plan).toBe(plan);
        expect(complete).toHaveBeenCalledTimes(1);
    });

    it("distinguishes unreachable transport from validation failures", async () => {
        const plan = fixture();
        const result = await runDeckPolishWorkflow({ plan, prompt: "", client: { complete: async () => {
            throw new transport.LLMTransportError("SECRET NETWORK ERROR");
        } } });
        expect(result.failure).toMatchObject({ kind: "transport", message: "The provider could not be reached or returned an unreadable response." });
        expect(JSON.stringify(result.failure)).not.toContain("SECRET");
    });

    it("reports final copy-shape failures and clears stale diagnostics on a malformed retry", async () => {
        const plan = fixture();
        const invalid = validOutput(plan);
        invalid.slides[0].body = ["SECRET INVENTED BODY"];
        const complete = vi.fn().mockResolvedValue(JSON.stringify(invalid));
        const input = { plan, prompt: "", client: { complete } };
        const result = await runDeckPolishWorkflow(input);
        expect(complete).toHaveBeenCalledTimes(2);
        expect(result.failure?.message).toContain("Slide index 0 requires exactly 0 body strings; received 1.");
        expect(JSON.stringify(result.failure)).not.toContain("SECRET");
        complete.mockReset().mockResolvedValueOnce(JSON.stringify(invalid)).mockResolvedValueOnce("not json");
        const second = await runDeckPolishWorkflow(input);
        expect(second.failure?.message).not.toContain("Slide index");
    });

    it("skips transport without a key and returns the original plan by reference", async () => {
        const plan = fixture();
        const stored = vi.spyOn(transport, "createStoredAgentClient");
        const onProgress = vi.fn();
        const result = await runDeckPolishWorkflow({ plan, prompt: "Ignored without a key", onProgress });
        expect(result.plan).toBe(plan);
        expect(result.outcome).toBe("no-key");
        expect(stored).not.toHaveBeenCalled();
        expect(onProgress).toHaveBeenCalledWith({ type: "phase", phase: "skipped" });
    });

    it("falls back on transport errors without retrying", async () => {
        const plan = fixture();
        const complete = vi.fn().mockRejectedValue(new Error("offline"));
        const result = await runDeckPolishWorkflow({ plan, prompt: "", client: { complete } });
        expect(result.plan).toBe(plan);
        expect(result.outcome).toBe("fallback");
        expect(complete).toHaveBeenCalledTimes(1);
    });

    it("accepts an empty suggestion without discarding valid copy", async () => {
        const plan = fixture();
        const output = { ...validOutput(plan), focusGoalIndexes: [] };
        const result = await runDeckPolishWorkflow({ plan, prompt: "", client: { complete: async () => JSON.stringify(output) } });
        expect(result.outcome).toBe("polished");
        expect(result.suggestedFocusGoalIds).toEqual([]);
    });

    it.each(["extra-slide", "missing-body", "extra-body", "blank-copy", "unknown-goal", "duplicate-goal", "too-few-goals", "too-many-goals", "structure"]) (
        "rejects %s without applying partial copy", async kind => {
            const plan = fixture();
            const output = validOutput(plan);
            if (kind === "extra-slide") output.slides.push(output.slides[0]);
            if (kind === "missing-body") output.slides[1].body = [];
            if (kind === "extra-body") output.slides[0].body.push("Invented text");
            if (kind === "blank-copy") output.slides[1].body[0] = " ";
            if (kind === "unknown-goal") output.focusGoalIndexes = [0, 1, 99];
            if (kind === "duplicate-goal") output.focusGoalIndexes = [0, 0, 1];
            if (kind === "too-few-goals") output.focusGoalIndexes = [0];
            if (kind === "too-many-goals") output.focusGoalIndexes = [0, 1, 2, 3, 4, 5];
            const response = kind === "structure" ? { ...output, isHidden: true } : output;
            const result = await runDeckPolishWorkflow({ plan, prompt: "", client: { complete: async () => JSON.stringify(response) } });
            expect(result.outcome).toBe("fallback");
            expect(result.plan).toBe(plan);
        },
    );

    it("projects only allow-listed content into the actual request", async () => {
        const plan = Object.assign(fixture(), {
            tasks: [{ title: "Private task object", description: "SECRET TASK DESCRIPTION" }],
            projects: [{ description: "SECRET PROJECT DESCRIPTION" }],
            logs: [{ startedAt: "SECRET RAW LOG" }],
        });
        const complete = vi.fn().mockResolvedValue(JSON.stringify(validOutput(plan)));
        await runDeckPolishWorkflow({ plan, prompt: "Be candid", client: { complete } });
        const request = complete.mock.calls[0][0];
        const payload = JSON.parse(request.messages[1].content);
        expect(payload.brief).toBe("Be candid");
        expect(payload.goals[0]).toEqual({ index: 0, title: "Goal 0", status: "blocked", achievedInPeriod: false,
            metric: { current: 3, target: 8 }, taskTitles: ["Review tests"] });
        const serialized = JSON.stringify(request);
        for (const secret of ["SECRET TASK DESCRIPTION", "SECRET PROJECT DESCRIPTION", "SECRET RAW LOG", "PRIVATE TRACKER", "PRIVATE PURPOSE", "PRIVATE GOAL NOTE", "PRIVATE PROJECT ID", "PRIVATE LABEL", "PRIVATE UNIT", "2026-11-03"]) {
            expect(serialized).not.toContain(secret);
        }
        expect(payload.slides[1].body).toEqual([
            { field: "did", text: "Progress 0", goalIndex: 0 },
            { field: "current", text: "Working on the review", goalIndex: 0 },
            { field: "planned", text: "Next step 0", goalIndex: 0 },
        ]);
    });

    it("keeps missing-information warnings and ignores failing progress listeners", async () => {
        const tracker = buildGoalTrackerFixture();
        const plan = buildDeckPlan({ tracker, goals: [buildGoalFixture()], checkIns: [],
            period: { periodStart: "2026-10-18", periodEnd: "2026-11-01", monthKey: "2026-10" }, now: new Date("2026-11-01T12:00:00Z") });
        const output = { ...validOutput(plan), focusGoalIndexes: [0] };
        const result = await runDeckPolishWorkflow({ plan, prompt: "", client: { complete: async () => JSON.stringify(output) },
            onProgress: () => { throw new Error("Observer failure"); } });
        expect(result.outcome).toBe("polished");
        expect(result.plan.warnings).toEqual(plan.warnings);
    });
});
