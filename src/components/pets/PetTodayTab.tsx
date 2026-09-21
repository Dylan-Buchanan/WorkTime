import React, { useEffect, useMemo, useState } from "react";
import {
    applyNapReflow,
    buildPetSchedule,
    countActivitiesToday,
    createPetNapRecord,
    createPetProfile,
    createPetScheduleItem,
    createPetWeightEntry,
    isSameLocalDay,
    latestWeightEntry,
    petBirthDateKey,
    proposeNapReflow,
} from "../../lib/pets";
import type { NewPetScheduleItemInput, PetNapReflowProposal, PetScheduleEntry } from "../../lib/pets";
import type { PetNapRecord, PetProfile } from "../../state/types";
import { usePetActivity } from "../../state/PetActivityContext";
import { usePets } from "../../state/PetContext";
import { PetHeroStatus } from "./PetHeroStatus";
import { PetNapToggle } from "./PetNapToggle";
import { PetFirstItems, PetProfileSetup } from "./PetOnboarding";
import { PetOverdueBanner } from "./PetOverdueBanner";
import { PetPottyBar } from "./PetPottyBar";
import { PetProfileCard } from "./PetProfileCard";
import { PetReflowPanel } from "./PetReflowPanel";
import { PetScheduleDeck } from "./PetScheduleDeck";
import { PetScheduleItemForm } from "./PetScheduleItemForm";

/**
 * The Today tab: profile card, hero status, conditional overdue banner, nap
 * toggle with wake-confirmation reflow, today's card deck, and the persistent
 * potty bar. Profile/schedule/nap/weight records stage through the data
 * provider; every activity log write goes through the single
 * `logActivity` path in `PetActivityContext`, so the potty bar and the inline
 * checks can never diverge.
 */
export const PetTodayTab: React.FC = () => {
    const pets = usePets();
    const activity = usePetActivity();
    const profile = pets.state.profile;
    const scheduleItems = Object.values(pets.state.scheduleItems);
    const naps = Object.values(pets.state.naps);
    const weights = Object.values(pets.state.weights);
    const [now, setNow] = useState(() => pets.now());
    const [deckExpanded, setDeckExpanded] = useState(false);
    const [reflowProposal, setReflowProposal] = useState<PetNapReflowProposal | null>(null);

    useEffect(() => {
        const id = setInterval(() => setNow(pets.now()), 1000);
        return () => clearInterval(id);
    }, []);

    const activityRecords = useMemo(() => Object.values(activity.state.records), [activity.state.records]);

    const schedule = useMemo(
        () => buildPetSchedule({ now, scheduleItems, activityRecords, naps }),
        [now, scheduleItems, activityRecords, naps],
    );

    const overdueEntries = useMemo(
        () => schedule.entries.filter((entry) => !entry.fulfilled && entry.overdueMinutes > 0),
        [schedule.entries],
    );

    const todayNaps = useMemo(
        () => naps.filter((nap) => nap.end !== null && isSameLocalDay(new Date(nap.end), now)),
        [naps, now],
    );

    const currentWeight = useMemo(() => latestWeightEntry(weights)?.weight ?? null, [weights]);

    /** Done-today counts from the log, derived only; never stored. */
    const doneCounts = useMemo(() => countActivitiesToday(activityRecords, now), [activityRecords, now]);

    const saveProfile = (name: string, birthDate: string): string | null => {
        try {
            const next: PetProfile = profile
                ? {
                      ...profile,
                      name: name.trim(),
                      birthDate: petBirthDateKey(birthDate),
                      updatedAt: now.toISOString(),
                  }
                : createPetProfile({ name, birthDate }, now, pets.uuid());
            pets.setProfile(next);
            return null;
        } catch (error) {
            return error instanceof RangeError ? error.message : "Could not save the profile";
        }
    };

    const addWeight = (weight: number): string | null => {
        try {
            const entry = createPetWeightEntry({ timestamp: now, weight }, now, pets.uuid());
            const next = [...weights, entry];
            pets.setWeights(next);
            return null;
        } catch (error) {
            return error instanceof RangeError ? error.message : "Could not log the weight";
        }
    };

    const addScheduleItem = (input: NewPetScheduleItemInput): string | null => {
        try {
            const item = createPetScheduleItem(input, now, pets.uuid());
            const next = [...scheduleItems, item];
            pets.setScheduleItems(next);
            return null;
        } catch (error) {
            return error instanceof RangeError ? error.message : "Could not add the schedule item";
        }
    };

    /** The single write path for every log action on this page. */
    const logCareActivity = (activityType: PetScheduleEntry["activityType"]): void => {
        activity.logActivity({ activityType, timestamp: now });
    };

    const startNap = (): void => {
        if (schedule.activeNap) return;
        const nap = createPetNapRecord({ start: now }, now, pets.uuid());
        const next = [...naps, nap];
        pets.setNaps(next);
    };

    const endNap = (): void => {
        const activeNap = schedule.activeNap;
        if (!activeNap) return;
        const ended: PetNapRecord = { ...activeNap, end: now.toISOString(), updatedAt: now.toISOString() };
        const next = naps.map((nap) => (nap.id === ended.id ? ended : nap));
        pets.setNaps(next);
        const proposal = proposeNapReflow({
            nap: ended,
            now,
            scheduleItems,
            activityRecords,
            naps: next,
        });
        if (proposal.changes.length > 0) setReflowProposal(proposal);
    };

    const confirmReflow = (): void => {
        if (!reflowProposal) return;
        const next = applyNapReflow(scheduleItems, reflowProposal, now);
        pets.setScheduleItems(next);
        setReflowProposal(null);
    };

    const adjustReflow = (): void => {
        setReflowProposal(null);
    };

    if (!pets.hydrated || !activity.hydrated) {
        return (
            <div className="flex h-full items-center justify-center text-xs text-neutral-500" role="status">
                Loading…
            </div>
        );
    }

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="app-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
                <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
                    {!profile ? (
                        <PetProfileSetup onSaveProfile={saveProfile} />
                    ) : scheduleItems.length === 0 ? (
                        <>
                            <PetProfileCard
                                profile={profile}
                                now={now}
                                currentWeight={currentWeight}
                                onSaveProfile={saveProfile}
                                onAddWeight={addWeight}
                            />
                            <PetFirstItems onAddItem={addScheduleItem} />
                        </>
                    ) : (
                        <>
                            <div className="grid items-stretch gap-4 lg:grid-cols-[minmax(220px,280px)_1fr]">
                                <PetProfileCard
                                    profile={profile}
                                    now={now}
                                    currentWeight={currentWeight}
                                    onSaveProfile={saveProfile}
                                    onAddWeight={addWeight}
                                />
                                <PetHeroStatus name={profile.name} schedule={schedule} now={now} />
                            </div>
                            <PetOverdueBanner entries={overdueEntries} onLog={(entry) => logCareActivity(entry.activityType)} />
                            <PetNapToggle
                                napping={schedule.napping}
                                activeNap={schedule.activeNap}
                                now={now}
                                onStart={startNap}
                                onEnd={endNap}
                            />
                            <PetScheduleDeck
                                schedule={schedule}
                                doneCounts={doneCounts}
                                todayNaps={todayNaps}
                                now={now}
                                expanded={deckExpanded}
                                onToggleExpanded={() => setDeckExpanded((value) => !value)}
                                onCheck={(entry) => logCareActivity(entry.activityType)}
                            />
                            <PetScheduleItemForm submitLabel="Add schedule item" onAddItem={addScheduleItem} />
                        </>
                    )}
                </div>
            </div>
            <PetPottyBar onPotty={() => logCareActivity("potty")} />
            {reflowProposal && (
                <PetReflowPanel proposal={reflowProposal} onConfirm={confirmReflow} onAdjust={adjustReflow} />
            )}
        </div>
    );
};
