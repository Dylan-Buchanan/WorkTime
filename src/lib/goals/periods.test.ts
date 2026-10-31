import { describe, expect, it } from "vitest";
import { resolveCadenceAnchorAt } from "./periods";
import type { GoalCadence } from "../../state/types";
import type { LocalDateKey } from "../todos/types";

describe("resolveCadenceAnchorAt", () => {
    it.each<[GoalCadence, LocalDateKey, LocalDateKey]>([
        [{ kind: "every-n-weeks", weekday: 0, intervalWeeks: 2 }, "2026-10-01", "2026-10-04"],
        [{ kind: "every-n-weeks", weekday: 0, intervalWeeks: 2 }, "2026-10-04", "2026-10-11"],
        [{ kind: "every-n-weeks", weekday: 3, intervalWeeks: 1 }, "2026-12-31", "2027-01-06"],
        [{ kind: "monthly-weekday", weekday: 0 }, "2026-09-20", "2026-10-04"],
        [{ kind: "monthly-weekday", weekday: 0 }, "2026-11-01", "2026-11-29"],
        [{ kind: "monthly-weekday", weekday: 0 }, "2026-11-29", "2027-01-03"],
        // Monday and Tuesday triggers both snap backwards; equality stays on the 1st.
        [{ kind: "monthly-weekday", weekday: 0 }, "2026-05-20", "2026-05-31"],
        [{ kind: "monthly-weekday", weekday: 1 }, "2026-05-31", "2026-06-01"],
        [{ kind: "monthly-weekday", weekday: 1 }, "2026-06-01", "2026-07-06"],
        [{ kind: "monthly-weekday", weekday: 2 }, "2026-11-30", "2026-12-01"],
        [{ kind: "monthly-weekday", weekday: 5 }, "2026-11-20", "2026-11-27"],
        [{ kind: "monthly-weekday", weekday: 0 }, "2026-12-31", "2027-01-03"],
    ])("resolves %j strictly after %s to %s", (rule, after, expected) => {
        expect(resolveCadenceAnchorAt(rule, after)).toBe(expected);
    });

    it("validates the rule and date rather than inventing an anchor", () => {
        expect(() => resolveCadenceAnchorAt({ kind: "every-n-weeks", weekday: 0, intervalWeeks: 0 }, "2026-10-01")).toThrow(RangeError);
        expect(() => resolveCadenceAnchorAt({ kind: "monthly-weekday", weekday: 0 }, "2026-02-30")).toThrow(RangeError);
    });
});
