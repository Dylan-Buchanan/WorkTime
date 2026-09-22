import { describe, expect, it } from "vitest";
import { PET_SKILL_STAMP_FALLBACK_EMOJI, petSkillStampEmoji } from "./stamps";

describe("petSkillStampEmoji", () => {
    it("maps known skill labels to a representative emoji", () => {
        expect(petSkillStampEmoji("Sit")).toBe("🪑");
        expect(petSkillStampEmoji("Recall")).toBe("📣");
        expect(petSkillStampEmoji("Loose leash walking")).toBe("🐕‍🦺");
        expect(petSkillStampEmoji("Fetch the ball")).toBe("🎾");
        expect(petSkillStampEmoji("Crate training")).toBe("🛏️");
    });

    it("matches case-insensitively and ignores surrounding whitespace", () => {
        expect(petSkillStampEmoji("  SIT  ")).toBe("🪑");
        expect(petSkillStampEmoji("shake paw")).toBe("🤝");
    });

    it("falls back to the generic memento emoji for unknown labels", () => {
        expect(petSkillStampEmoji("Balance on a stool")).toBe(PET_SKILL_STAMP_FALLBACK_EMOJI);
        expect(petSkillStampEmoji("")).toBe(PET_SKILL_STAMP_FALLBACK_EMOJI);
    });
});
