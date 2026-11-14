/** Overlay stacking tiers.
 *
 * Rule: the switch sheet is always above the overlay tier. Drawers and dialogs (the PM projects
 * drawer, the PM task-details drawer, the planning agent panel and the mobile tasks drawer) share
 * OVERLAY_TIER_CLASS; the switch sheet alone owns TOP_SHEET_TIER_CLASS so it can open over any of
 * them. Keep both values as whole literal class strings so Tailwind's scanner still sees them;
 * never compose them from fragments.
 */
export const OVERLAY_TIER_CLASS = "z-40";
export const TOP_SHEET_TIER_CLASS = "z-50";
