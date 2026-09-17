import React, { useState } from "react";
import { formatPetAgeAt } from "../../lib/pets";
import type { PetProfile } from "../../state/types";

interface PetProfileCardProps {
    profile: PetProfile;
    now: Date;
    currentWeight: number | null;
    onSaveProfile(name: string, birthDate: string): string | null;
    onAddWeight(weight: number): string | null;
}

/**
 * Profile card: placeholder avatar (photos are a deferred feature), editable
 * name and birth date, the derived age display, and the append-only weight
 * log entry flow. The current weight is the latest entry, never stored.
 */
export const PetProfileCard: React.FC<PetProfileCardProps> = ({
    profile,
    now,
    currentWeight,
    onSaveProfile,
    onAddWeight,
}) => {
    const [editing, setEditing] = useState(false);
    const [nameDraft, setNameDraft] = useState(profile.name);
    const [birthDraft, setBirthDraft] = useState(profile.birthDate);
    const [profileError, setProfileError] = useState<string | null>(null);
    const [weightDraft, setWeightDraft] = useState("");
    const [weightError, setWeightError] = useState<string | null>(null);

    const openEdit = () => {
        setNameDraft(profile.name);
        setBirthDraft(profile.birthDate);
        setProfileError(null);
        setEditing(true);
    };

    const submitProfile = () => {
        const error = onSaveProfile(nameDraft, birthDraft);
        if (error) {
            setProfileError(error);
            return;
        }
        setProfileError(null);
        setEditing(false);
    };

    const submitWeight = () => {
        const parsed = Number(weightDraft);
        if (weightDraft.trim() === "" || !Number.isFinite(parsed)) {
            setWeightError("Enter a number");
            return;
        }
        const error = onAddWeight(parsed);
        if (error) {
            setWeightError(error);
            return;
        }
        setWeightError(null);
        setWeightDraft("");
    };

    return (
        <section
            aria-label="Pet profile"
            className="flex flex-col gap-3 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4"
        >
            <div className="flex items-center gap-3">
                <div
                    aria-hidden="true"
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-neutral-700 bg-neutral-800 text-2xl"
                >
                    🐶
                </div>
                <div className="min-w-0 flex-1">
                    <h2 className="truncate text-sm font-semibold text-neutral-100">{profile.name}</h2>
                    <p className="text-[11px] text-neutral-400">
                        {formatPetAgeAt(profile.birthDate, now)} old · born {profile.birthDate}
                    </p>
                    <p className="text-[11px] text-neutral-400">
                        {currentWeight !== null ? `Current weight ${currentWeight}` : "No weight logged yet"}
                    </p>
                </div>
                {!editing && (
                    <button
                        type="button"
                        onClick={openEdit}
                        className="rounded bg-neutral-800 px-2 py-1 text-[11px] text-neutral-200 hover:bg-neutral-700"
                    >
                        Edit
                    </button>
                )}
            </div>

            {editing && (
                <div className="flex flex-col gap-2 rounded-xl border border-neutral-800 bg-neutral-950/60 p-3">
                    <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                        Name
                        <input
                            value={nameDraft}
                            onChange={(event) => setNameDraft(event.target.value)}
                            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100"
                        />
                    </label>
                    <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                        Birth date
                        <input
                            type="date"
                            value={birthDraft}
                            onChange={(event) => setBirthDraft(event.target.value)}
                            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100"
                        />
                    </label>
                    {profileError && (
                        <p role="alert" className="text-[11px] text-red-300">{profileError}</p>
                    )}
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={submitProfile}
                            className="rounded bg-neutral-100 px-2 py-1 text-[11px] font-medium text-neutral-900 hover:bg-white"
                        >
                            Save profile
                        </button>
                        <button
                            type="button"
                            onClick={() => setEditing(false)}
                            className="rounded bg-neutral-800 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-700"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            <div className="flex items-end gap-2">
                <label className="flex flex-1 flex-col gap-1 text-[11px] text-neutral-400">
                    Log weight
                    <input
                        inputMode="decimal"
                        value={weightDraft}
                        placeholder="e.g. 4.2"
                        onChange={(event) => setWeightDraft(event.target.value)}
                        className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100"
                    />
                </label>
                <button
                    type="button"
                    onClick={submitWeight}
                    className="rounded bg-neutral-800 px-2 py-1 text-[11px] text-neutral-200 hover:bg-neutral-700"
                >
                    Add weight
                </button>
            </div>
            {weightError && <p role="alert" className="text-[11px] text-red-300">{weightError}</p>}
        </section>
    );
};
