## Title: Attach images to Skill Stamps (future)

## Tags

Complexity Classification: T4
Severity: Low
Reason: Introduces an entirely new image-storage subsystem: a Supabase Storage bucket with owner RLS, upload/thumbnail UI, persistence changes to the training-skill shape, and cleanup on delete. There is no Storage usage anywhere today; the staging store is localStorage-only; there is no persisted stamp entity. Blast Radius=4 (cross-system: `supabase/migrations`, `src/state/types.ts`, `PetContext`, staged data access/sync, `PetTrainingTab` + new upload component, tests/e2e, plus an external Storage dependency), Uncertainty=3 (no existing Storage pattern; bucket RLS, object-reference shape, size/thumbnail, orphan cleanup all unresolved), Behavior=5 (infra + security/storage RLS + data model), Testing=3 (uploads, bucket RLS, cleanup hard to verify; privacy/data-loss impact), Reversibility=2 (revert leaves orphaned objects requiring cleanup). Total=17.
Needs research before implementation: Yes
Research needed: Determine the approved binary-asset path (Supabase Storage bucket + owner RLS vs any approved alternative) and how it reconciles with the `AGENTS.md` constraints (no service-role in browser, no binary data in the localStorage staging store, no Tauri `invoke`/file paths); define bucket naming, RLS mirroring the pet-table `owner_id = auth.uid()` pattern, upload size/type limits, thumbnail strategy, how an image reference is modeled on the training-skill entity and carried through the staged-sync / `apply_staged_sync` flow, and how orphaned objects are cleaned up.

## Summary

Future enhancement to the Skill Stamps gallery: let a user attach a photo of the skill being performed to a completed stamp, in addition to (and eventually in place of) the placeholder emoji. This is explicitly deferred and requires a new image storage and upload subsystem.

## Steps to Reproduce Context

1. Open `/pet` and switch to the **Training** tab.
2. View a completed skill in the Skill Stamps gallery.
3. Observe that a stamp can only show a placeholder emoji — there is no way to add a photo.
4. Observe that the app has no image upload or asset storage capability at all.

## Expected Behavior

A user can attach, replace, and remove an image on a completed skill's stamp, with the image scoped to the signed-in owner, persisted, and surviving sync. The placeholder emoji remains the fallback when no image is set.

## Actual Behavior

No image upload, storage, or display capability exists anywhere in the app. Stamps display a placeholder emoji only.

## Requirements for completed issue

1. A user can attach an image to a completed skill's stamp.
2. Images are stored and served through an approved binary-asset path with owner-scoped access.
3. A user can replace and remove an attached image.
4. Images persist and remain scoped to the owner across reload and sync.
5. The placeholder emoji remains the fallback when no image is attached.
6. Storage respects the repository's constraints: no service-role credentials in the browser, no binary data in the localStorage staging store, and no Tauri `invoke`/file-path data routes.

## Context

- Files:
  - `src/components/pets/PetTrainingTab.tsx` — the stamps gallery where images would render.
  - `src/state/types.ts` (lines ~253–267) — `PetTrainingSkill`, the entity an image reference could be modeled on.
  - `src/state/PetContext.tsx` — the persistence path for skill data.
  - `supabase/migrations/20260920000000_pet_domain.sql` (lines ~81–89) — owner-scoped RLS policy pattern (`owner_id = auth.uid()`) any storage policies would likely mirror.
  - `src/lib/data/staging/types.ts` / `src/lib/data/sync/merge.ts` — the staged-sync pipeline any new field would ride.
- Code Snippets:

  The owner-scoped RLS pattern used by pet tables (`supabase/migrations/20260920000000_pet_domain.sql`):
  ```sql
  -- select/insert/update/delete policies generated per table with:
  -- using (owner_id = auth.uid())  /  with check (owner_id = auth.uid())
  ```

## Notes

- This is deliberately a separate, later epic from the rest of the Training tab work; the immediate placeholder-emoji requirement belongs to the Skill Stamps gallery issue.
- Subject to the `AGENTS.md` constraints on persistence and credentials; the approved asset path must be researched before implementation.
