import React, { useState } from "react";
import type { NewPetScheduleItemInput } from "../../lib/pets";
import { PetScheduleItemForm } from "./PetScheduleItemForm";

interface PetProfileSetupProps {
    onSaveProfile(name: string, birthDate: string): string | null;
}

/**
 * First-run step: no profile yet. Asks for the pet's name and birth date in
 * one small form; the birth date feeds the derived age display.
 */
export const PetProfileSetup: React.FC<PetProfileSetupProps> = ({ onSaveProfile }) => {
    const [nameDraft, setNameDraft] = useState("Whitney");
    const [birthDraft, setBirthDraft] = useState("");
    const [error, setError] = useState<string | null>(null);

    const submit = () => {
        const result = onSaveProfile(nameDraft, birthDraft);
        setError(result);
    };

    return (
        <section
            aria-label="Pet setup"
            className="mx-auto flex w-full max-w-md flex-col gap-3 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4"
        >
            <h2 className="text-sm font-semibold text-neutral-100">When was your puppy born?</h2>
            <p className="text-[11px] text-neutral-400">
                The age display switches from weeks to months at six months.
            </p>
            <form
                onSubmit={(event) => { event.preventDefault(); submit(); }}
                className="flex flex-col gap-2"
            >
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
                {error && <p role="alert" className="text-[11px] text-red-300">{error}</p>}
                <button
                    type="submit"
                    className="rounded-lg bg-neutral-100 px-3 py-1.5 text-[11px] font-medium text-neutral-900 hover:bg-white"
                >
                    Save profile
                </button>
            </form>
        </section>
    );
};

interface PetFirstItemsProps {
    onAddItem(input: NewPetScheduleItemInput): string | null;
}

/** First-run step: a profile exists but no schedule items have been added. */
export const PetFirstItems: React.FC<PetFirstItemsProps> = ({ onAddItem }) => (
    <section aria-label="First schedule items" className="flex flex-col gap-3 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
        <h2 className="text-sm font-semibold text-neutral-100">Add your first schedule items</h2>
        <p className="text-[11px] text-neutral-400">
          Start with one or two — e.g. a potty interval and a fixed feeding time. You can add more anytime.
        </p>
        <PetScheduleItemForm submitLabel="Add schedule item" onAddItem={onAddItem} />
    </section>
);
