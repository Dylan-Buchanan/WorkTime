/** Generic placeholder stamp emoji used when no keyword matches a skill label. */
export const PET_SKILL_STAMP_FALLBACK_EMOJI = "🏅";

/**
 * Keyword → placeholder emoji dictionary for the Skill Stamps gallery. Matching
 * is a case-insensitive substring test against the skill label; the first entry
 * whose keyword appears wins, so more specific keywords are listed first.
 */
const PET_SKILL_STAMP_EMOJI: readonly (readonly [string, string])[] = [
    ["high five", "🙌"],
    ["high-five", "🙌"],
    ["leave it", "🙅"],
    ["drop it", "🙅"],
    ["shake", "🤝"],
    ["paw", "🐾"],
    ["sit", "🪑"],
    ["stay", "✋"],
    ["wait", "⏳"],
    ["down", "⬇️"],
    ["recall", "📣"],
    ["come", "📣"],
    ["heel", "🐕‍🦺"],
    ["leash", "🐕‍🦺"],
    ["walk", "🦮"],
    ["fetch", "🎾"],
    ["ball", "🎾"],
    ["roll", "🔄"],
    ["spin", "🌀"],
    ["speak", "🗣️"],
    ["bark", "🗣️"],
    ["quiet", "🤫"],
    ["crate", "🛏️"],
    ["place", "🛏️"],
    ["bed", "🛏️"],
    ["potty", "🚽"],
    ["toilet", "🚽"],
    ["target", "👆"],
    ["touch", "👆"],
    ["kiss", "💋"],
    ["bow", "🙇"],
    ["settle", "😌"],
    ["calm", "😌"],
    ["treat", "🦴"],
];

/**
 * Picks a placeholder emoji for a completed skill stamp from its label. Falls
 * back to a generic memento emoji when nothing in the dictionary matches.
 */
export function petSkillStampEmoji(label: string): string {
    const normalized = label.trim().toLowerCase();
    for (const [keyword, emoji] of PET_SKILL_STAMP_EMOJI) {
        if (normalized.includes(keyword)) return emoji;
    }
    return PET_SKILL_STAMP_FALLBACK_EMOJI;
}
