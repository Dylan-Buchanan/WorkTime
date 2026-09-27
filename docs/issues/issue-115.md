# Title: Make settings groups collapsible and collapsed by default

## Tags

Complexity Classification: T1
Classification Reason: This is a localized SettingsPanel UI change with existing component tests and a collapsible-group precedent in TaskPanel.
Severity: Low
Severity Reason: The settings remain usable, but showing every control at once makes the panel more cluttered and harder to navigate.

Needs research before implementation: No

## Summary

Organize the Settings panel into three collapsible groups—Base settings, Day hour settings, and Agent API key—and have all three start collapsed whenever the panel is opened. Keep the existing shared Save behavior for app settings. The Day hour group should include the start-of-day and End of day controls; adding the start-of-day setting itself is covered by issue #113 and is not part of this issue.

## Steps to Reproduce Context

1. Open the app and locate the Settings panel in the sidebar.
2. Observe that the timer settings, End of day control, and Agent API key controls are all displayed together without collapsible sections.

## Expected Behavior

- Settings are organized into Base settings, Day hour settings, and Agent API key sections.
- All three sections are collapsed by default each time the panel is opened.
- Users can expand and collapse each section to access its controls.
- The existing Save behavior for app settings remains unchanged.

## Actual Behavior

- The Settings panel displays its timer-duration controls, End of day control, and Agent API key controls at the same time.
- The panel currently has no start-of-day control; issue #113 covers adding that setting.

## Requirements for completed issue

1. The Settings panel has separate collapsible Base settings, Day hour settings, and Agent API key sections.
2. The sections start collapsed whenever the panel is opened; expanded/collapsed choices are not remembered between openings.
3. The Day hour section contains the start-of-day and End of day controls once the start-of-day setting from issue #113 is available.
4. Users can still edit and save app settings using the existing shared Save behavior, and the Agent API key controls continue to work when expanded.
5. The collapsible controls are accessible and their expanded/collapsed state is conveyed to assistive technology.

### Testing

- Update `SettingsPanel` component tests to verify all three sections are collapsed initially and that each section can be expanded and collapsed.
- Verify app-setting edits can still be saved with the shared Save action and Agent API key save/clear behavior still works when its section is expanded.
- Verify reopening or remounting the panel returns all sections to their collapsed default.
- Run the relevant SettingsPanel tests.

## Context

- `src/components/SettingsPanel.tsx` renders the current Settings panel. The four timer-duration controls and `End of day` `TimeOfDayInput` currently share one grid and one Save button. The Agent API key controls are rendered below them.
- `src/components/SettingsPanel.test.tsx` covers end-of-day editing/saving and Agent API key interactions. Tests that query these controls will need to open their containing section first.
- `src/components/TaskPanel.tsx` already uses temporary React state and `ChevronDown`/`ChevronRight` icons for collapsible task groups.
- `src/App.tsx` renders `SettingsPanel` in the app sidebar.
- Issue #113 covers adding a configurable start-of-day setting; this issue depends on that control being available for the Day hour section and does not add or persist the setting itself.

## Notes

- The existing `Save` button updates the app settings as a whole; its save semantics are outside the scope of this issue.
