import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataAccess } from "../lib/data/InMemoryDataAccess";
import { makeAppState } from "../test/mockTauri";
import { DataProvider } from "./DataContext";
import { PET_UI_STORAGE_KEY, PetProvider, usePets } from "./PetContext";
import { SyncProvider } from "./SyncContext";
import { TauriCloseProvider } from "./TauriCloseContext";
import type {
    PetFixation, PetNapRecord, PetNotableEvent, PetProfile, PetScheduleItem, PetTrainingSkill, PetWeightEntry,
} from "./types";

const OWNER = "owner-pets";
const T0 = "2026-09-20T12:00:00.000Z";
const profile: PetProfile = { id: "profile", name: "Mochi", birthDate: "2026-03-14", createdAt: T0, updatedAt: T0 };
const schedule: PetScheduleItem = { id: "schedule", activityType: "potty", label: "Potty", flexibility: "flexible", priority: 0, recurrence: { mode: "interval", minMinutes: 30, maxMinutes: 60 }, isActive: true, createdAt: T0, updatedAt: T0 };
const nap: PetNapRecord = { id: "nap", start: T0, end: null, createdAt: T0, updatedAt: T0 };
const weight: PetWeightEntry = { id: "weight", timestamp: T0, weight: 12.5, createdAt: T0, updatedAt: T0 };
const skill: PetTrainingSkill = { id: "skill", label: "Sit", notes: "", status: "introduced", resolvedAt: null, createdAt: T0, updatedAt: T0 };
const fixation: PetFixation = { id: "fixation", label: "Shoes", notes: "", resolvedAt: null, resolutionNote: "", createdAt: T0, updatedAt: T0 };
const notableEvent: PetNotableEvent = { id: "event", title: "First walk", notes: "", timestamp: T0, createdAt: T0, updatedAt: T0 };

function Probe() {
    const pets = usePets();
    return <div>
        <span data-testid="profile">{pets.state.profile?.name ?? "none"}</span>
        <span data-testid="counts">{[
            pets.state.scheduleItems, pets.state.naps, pets.state.weights, pets.state.trainingSkills,
            pets.state.fixations, pets.state.notableEvents,
        ].map((group) => Object.keys(group).length).join(",")}</span>
        <span data-testid="tab">{pets.state.ui.activeTab}</span>
        <button onClick={() => pets.setProfile({ ...profile, name: "Nori", updatedAt: "2026-09-20T13:00:00.000Z" })}>rename</button>
        <button onClick={() => pets.setActiveTab("timeline")}>timeline</button>
    </div>;
}

function wrap(data: InMemoryDataAccess, children: React.ReactNode) {
    return <TauriCloseProvider><DataProvider dataAccess={data}><SyncProvider ownerId={OWNER}>
        <PetProvider>{children}</PetProvider>
    </SyncProvider></DataProvider></TauriCloseProvider>;
}

async function seed(data: InMemoryDataAccess) {
    await Promise.all([
        data.savePetProfile(profile), data.savePetScheduleItems([schedule]), data.savePetNapRecords([nap]),
        data.savePetWeightEntries([weight]), data.savePetTrainingSkills([skill]), data.savePetFixations([fixation]),
        data.savePetNotableEvents([notableEvent]),
    ]);
}

beforeEach(() => localStorage.clear());

describe("PetContext", () => {
    it("guards the hook outside its provider", () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        expect(() => render(<Probe />)).toThrow("usePets must be inside provider");
        consoleError.mockRestore();
    });

    it("hydrates all seven groups, stages edits, and keeps the active tab device-local", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await seed(data);
        localStorage.setItem(PET_UI_STORAGE_KEY, JSON.stringify({ ui: { activeTab: "training" } }));
        const profileSave = vi.spyOn(data, "savePetProfile");
        const collectionSaves = [
            vi.spyOn(data, "savePetScheduleItems"), vi.spyOn(data, "savePetNapRecords"),
            vi.spyOn(data, "savePetWeightEntries"), vi.spyOn(data, "savePetTrainingSkills"),
            vi.spyOn(data, "savePetFixations"), vi.spyOn(data, "savePetNotableEvents"),
        ];
        render(wrap(data, <Probe />));

        await waitFor(() => expect(screen.getByTestId("profile")).toHaveTextContent("Mochi"));
        expect(screen.getByTestId("counts")).toHaveTextContent("1,1,1,1,1,1");
        expect(screen.getByTestId("tab")).toHaveTextContent("training");
        profileSave.mockClear();

        await act(async () => screen.getByText("rename").click());
        await waitFor(() => expect(profileSave).toHaveBeenCalledWith(expect.objectContaining({ name: "Nori" })));
        expect(profileSave).toHaveBeenCalledTimes(1);
        for (const save of collectionSaves) expect(save).not.toHaveBeenCalled();

        const pendingBeforeTabChange = data.pendingCount();
        await act(async () => screen.getByText("timeline").click());
        await waitFor(() => expect(JSON.parse(localStorage.getItem(PET_UI_STORAGE_KEY)!).ui.activeTab).toBe("timeline"));
        expect(data.pendingCount()).toBe(pendingBeforeTabChange);
        expect(profileSave).toHaveBeenCalledTimes(1);
        for (const save of collectionSaves) expect(save).not.toHaveBeenCalled();
        expect(data.store).not.toHaveProperty("ui");
    });

    it("reloads revision changes without restaging them and drops malformed loaded rows", async () => {
        class UntrustedPetData extends InMemoryDataAccess {
            override async loadPetTrainingSkills(): Promise<PetTrainingSkill[]> {
                return [skill, { ...skill, id: "bad", status: "unknown" } as unknown as PetTrainingSkill];
            }
        }
        const data = new UntrustedPetData(makeAppState());
        await seed(data);
        const skillSave = vi.spyOn(data, "savePetTrainingSkills");
        render(wrap(data, <Probe />));
        await waitFor(() => expect(screen.getByTestId("profile")).toHaveTextContent("Mochi"));
        skillSave.mockClear();

        await data.savePetProfile({ ...profile, name: "Remote Mochi", updatedAt: "2026-09-20T14:00:00.000Z" });
        await waitFor(() => expect(screen.getByTestId("profile")).toHaveTextContent("Remote Mochi"));
        expect(skillSave).not.toHaveBeenCalled();
    });
});
