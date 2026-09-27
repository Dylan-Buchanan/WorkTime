# Title: Add a configurable start-of-day setting

## Tags

Complexity Classification: T3
Classification Reason: This preference crosses the Settings UI, settings validation/default handling, persisted state, and sync compatibility. Existing settings use a shared shape, so adding a field must remain compatible with stored settings.
Severity: Medium
Severity Reason: The setting is needed for users to define their daily schedule boundary, but does not itself change existing schedule behavior.

Needs research before implementation: Yes

### Research Needed

Choose a default start-of-day value and confirm whether it must be earlier than End of day or may define an overnight day. Check that adding the field remains compatible with legacy persisted settings and synced settings.

- `src/state/types.ts` — current `Settings` shape contains `end_of_day` but no start-of-day field.
- `src/lib/settings.ts` — validates the end-of-day clock value and supplies a default when older settings omit it.
- `src/components/SettingsPanel.tsx` — renders the existing End of day control and saves settings.
- `src/components/SettingsPanel.test.tsx` and `src/lib/settings.test.ts` — settings UI and validation coverage.

## Summary

Add a user-configurable start-of-day time as a separate setting from the existing End of day time. The setting is a prerequisite for the pet-schedule rollover work in issue #114.

## Steps to Reproduce Context

1. Open Settings.
2. Observe that there is an End of day time control.
3. Look for a separate start-of-day time control; none is currently available.

## Expected Behavior

- Users can configure and save a start-of-day time independently of End of day.
- The configured value remains available after reload and sync.

## Actual Behavior

- Settings currently expose only `end_of_day`; there is no configurable start-of-day time.

## Requirements for completed issue

1. A start-of-day time is represented separately from `end_of_day` in the Settings model.
2. Users can edit and save the start-of-day time in Settings.
3. The value is validated and remains compatible with existing persisted and synced settings.
4. The default value and its relationship to End of day are documented and covered by tests.

### Testing

- Test valid and invalid start-of-day values, including the chosen default for settings that do not yet contain the field.
- Test editing and saving the setting through the Settings UI.
- Run relevant settings persistence/sync tests to ensure older settings remain readable and the new value survives reload/sync.

## Context

- `src/state/types.ts` defines `Settings`, which currently includes `end_of_day` but no start time:

  ```ts
  export interface Settings {
      work_minutes: number;
      short_break_minutes: number;
      long_break_minutes: number;
      segment_length: number;
      end_of_day: string;
  }
  ```

- `src/lib/settings.ts` validates the existing setting as a local `HH:mm` value and fills in `DEFAULT_END_OF_DAY` for legacy settings.
- `src/components/SettingsPanel.tsx` currently renders a `TimeOfDayInput` labeled “End of day” and saves the settings through `updateSettings`.

## Notes

- Default start time: Unknown.
- Whether a start time later than End of day represents an overnight schedule day: Unknown.
