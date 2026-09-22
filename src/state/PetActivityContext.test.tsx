import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataAccess } from "../lib/data/InMemoryDataAccess";
import { DataProvider } from "./DataContext";
import { SyncProvider } from "./SyncContext";
import { TauriCloseProvider } from "./TauriCloseContext";
import { ToastProvider } from "./ToastContext";
import { PetActivityProvider, usePetActivity } from "./PetActivityContext";
import { makeAppState } from "../test/mockTauri";
import type { PetActivityRecord, PetActivityType } from "./types";

const OWNER = "owner-1";
/** Pinned reference time: 2026-09-17 15:00 local. The clock never advances. */
const NOW = new Date(2026, 8, 17, 15, 0, 0, 0);
/** A record stamped the day before the pinned "today". */
const YESTERDAY = new Date(2026, 8, 16, 15, 0, 0, 0);

function at(hour: number, minute = 0): Date {
    return new Date(2026, 8, 17, hour, minute, 0, 0);
}

interface Deferred<T> {
    promise: Promise<T>;
    resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => { resolve = res; });
    return { promise, resolve };
}

function record(id: string, activityType: PetActivityType, timestamp: Date, durationMinutes?: number): PetActivityRecord {
    return {
        id,
        activityType,
        timestamp: timestamp.toISOString(),
        createdAt: timestamp.toISOString(),
        ...(durationMinutes === undefined ? {} : { durationMinutes }),
    };
}

function Probe() {
    const {
        state,
        hydrated,
        logActivity,
        undoActivity,
        setActivitySkillIds,
        correctActivityTimestamp,
        canCorrectActivity,
        todayCounts,
    } = usePetActivity();
    const records = Object.values(state.records);
    const first = records[0];
    const [error, setError] = useState("");
    return <div>
        <span data-testid="count">{records.length}</span>
        <span data-testid="hydrated">{String(hydrated)}</span>
        <span data-testid="today-potty">{todayCounts().potty}</span>
        <span data-testid="can-correct">{first ? String(canCorrectActivity(first.id)) : ""}</span>
        <span data-testid="error">{error}</span>
        <span data-testid="skill-ids">{JSON.stringify(first?.skillIds)}</span>
        <button onClick={() => logActivity({ activityType: "potty", timestamp: new Date() })}>log-potty</button>
        <button onClick={() => logActivity({ activityType: "training", timestamp: new Date(), durationMinutes: 10 })}>log-training</button>
        <button onClick={() => logActivity({ activityType: "training", timestamp: new Date(), skillIds: ["sit", "stay", "sit"] })}>log-tagged-training</button>
        <button onClick={() => first && setActivitySkillIds(first.id, ["down", "down"])}>set-tags</button>
        <button onClick={() => first && setActivitySkillIds(first.id, [])}>clear-tags</button>
        <button onClick={() => first && undoActivity(first.id)}>undo</button>
        <button onClick={() => {
            try {
                if (first) correctActivityTimestamp(first.id, new Date());
            } catch (caught) {
                setError(caught instanceof Error ? caught.message : String(caught));
            }
        }}>correct</button>
    </div>;
}

function wrap(data: InMemoryDataAccess) {
    return <TauriCloseProvider>
        <DataProvider dataAccess={data}>
            <SyncProvider ownerId={OWNER}>
                <ToastProvider>
                    <PetActivityProvider><Probe /></PetActivityProvider>
                </ToastProvider>
            </SyncProvider>
        </DataProvider>
    </TauriCloseProvider>;
}

/** Renders the provider tree and waits until staged records have hydrated. */
async function renderHydrated(data: InMemoryDataAccess): Promise<void> {
    render(wrap(data));
    await waitFor(() => expect(screen.getByTestId("hydrated")).toHaveTextContent("true"));
}

beforeEach(() => {
    localStorage.clear();
    // Freeze wall-clock time only: `waitFor`, the toast window, and Vitest
    // timeouts keep running on real timers, while every `new Date()` in the
    // provider and probe is pinned to NOW. This removes midnight rollover and
    // slow-run clock drift from the day-based assertions.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
});

afterEach(() => {
    vi.useRealTimers();
});

describe("PetActivityContext", () => {
    it("hydrates staged activity records", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.savePetActivityRecords([record("a1", "potty", at(9))]);

        await renderHydrated(data);
        await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("1"));
    });

    it("hydrates unknown skill ids without pruning them", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.savePetActivityRecords([{ ...record("a1", "training", at(9)), skillIds: ["missing-skill"] }]);

        await renderHydrated(data);
        await waitFor(() => expect(screen.getByTestId("skill-ids")).toHaveTextContent('["missing-skill"]'));
        expect((await data.loadPetActivityRecords())[0].skillIds).toEqual(["missing-skill"]);
    });

    it("logs through the single write path, stages locally, and offers undo", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const save = vi.spyOn(data, "savePetActivityRecords");
        await renderHydrated(data);
        save.mockClear();
        const syncCount = data.syncCalls.length;

        fireEvent.click(screen.getByText("log-potty"));
        await waitFor(async () => {
            expect(screen.getByTestId("count")).toHaveTextContent("1");
            expect(await data.loadPetActivityRecords()).toHaveLength(1);
        });
        // Exactly one staged write so far, and logging never syncs directly.
        expect(save).toHaveBeenCalledTimes(1);
        expect(data.syncCalls).toHaveLength(syncCount);
        expect(screen.getByTestId("today-potty")).toHaveTextContent("1");
        expect(screen.getByTestId("toast-message")).toHaveTextContent("Logged potty");

        fireEvent.click(within(screen.getByTestId("toast")).getByRole("button", { name: "Undo" }));
        await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("0"));
        await waitFor(async () => expect(await data.loadPetActivityRecords()).toEqual([]));
        // The log write and the undo write; nothing else was restaged.
        expect(save).toHaveBeenCalledTimes(2);
    });

    it("carries an optional duration for training but never for potty", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await renderHydrated(data);

        fireEvent.click(screen.getByText("log-training"));
        await waitFor(async () => {
            const records = await data.loadPetActivityRecords();
            expect(records).toHaveLength(1);
            expect(records[0]).toMatchObject({ activityType: "training", durationMinutes: 10 });
        });

        fireEvent.click(screen.getByText("log-potty"));
        await waitFor(async () => {
            const records = await data.loadPetActivityRecords();
            expect(records).toHaveLength(2);
            expect(records[1]).toMatchObject({ activityType: "potty" });
            expect(records[1].durationMinutes).toBeUndefined();
        });
    });

    it("persists tags on create and on tag-only replacement or clearing", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const save = vi.spyOn(data, "savePetActivityRecords");
        await renderHydrated(data);
        save.mockClear();

        fireEvent.click(screen.getByText("log-tagged-training"));
        await waitFor(async () => expect((await data.loadPetActivityRecords())[0].skillIds).toEqual(["sit", "stay"]));
        expect(save).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByText("set-tags"));
        await waitFor(async () => expect((await data.loadPetActivityRecords())[0].skillIds).toEqual(["down"]));
        expect(save).toHaveBeenCalledTimes(2);

        fireEvent.click(screen.getByText("clear-tags"));
        await waitFor(async () => expect((await data.loadPetActivityRecords())[0]).not.toHaveProperty("skillIds"));
        expect(save).toHaveBeenCalledTimes(3);
    });

    it("corrects today's timestamp in place", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await renderHydrated(data);

        fireEvent.click(screen.getByText("log-potty"));
        await waitFor(async () => expect(await data.loadPetActivityRecords()).toHaveLength(1));
        expect(screen.getByTestId("can-correct")).toHaveTextContent("true");
        const before = (await data.loadPetActivityRecords())[0];

        // Move the pinned clock forward, then correct: the rewrite is exactly
        // that instant, while id and createdAt are preserved.
        const correctedAt = at(15, 5);
        vi.setSystemTime(correctedAt);
        fireEvent.click(screen.getByText("correct"));
        await waitFor(async () => {
            const [after] = await data.loadPetActivityRecords();
            expect(after.id).toBe(before.id);
            expect(after.createdAt).toBe(before.createdAt);
            expect(after.timestamp).toBe(correctedAt.toISOString());
        });
        expect(screen.getByTestId("can-correct")).toHaveTextContent("true");
    });

    it("does not allow correcting a record stamped yesterday", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.savePetActivityRecords([record("old", "potty", YESTERDAY)]);

        await renderHydrated(data);
        await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("1"));
        expect(screen.getByTestId("can-correct")).toHaveTextContent("false");

        fireEvent.click(screen.getByText("correct"));
        await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent("today"));

        const [unchanged] = await data.loadPetActivityRecords();
        expect(unchanged.timestamp).toBe(YESTERDAY.toISOString());
    });

    it("reloads staged revisions without restaging the reloaded slice", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.savePetActivityRecords([record("a1", "potty", at(9))]);
        await renderHydrated(data);
        await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("1"));

        const save = vi.spyOn(data, "savePetActivityRecords");
        await data.savePetActivityRecords([
            record("a1", "potty", at(9)),
            record("a2", "training", at(10), 5),
        ]);
        await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("2"));
        await waitFor(async () => expect(await data.loadPetActivityRecords()).toHaveLength(2));
        // Only the external write above; the provider reloaded without restaging.
        expect(save).toHaveBeenCalledTimes(1);
    });

    it("discards a staged reload whose read started before a local write", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const originalLoad = data.loadPetActivityRecords.bind(data);
        const staleRead = deferred<PetActivityRecord[]>();
        let loadCalls = 0;
        vi.spyOn(data, "loadPetActivityRecords").mockImplementation(() => {
            loadCalls += 1;
            // Hold the post-hydration reload open so a log write can land while
            // its snapshot is still the empty pre-write store.
            if (loadCalls === 2) return staleRead.promise;
            return originalLoad();
        });

        await renderHydrated(data);
        await waitFor(() => expect(loadCalls).toBeGreaterThanOrEqual(2));

        fireEvent.click(screen.getByText("log-potty"));
        await waitFor(async () => expect(await originalLoad()).toHaveLength(1));

        // Resolve the stale pre-write read: it must not clobber the fresh log.
        await act(async () => { staleRead.resolve([]); });
        expect(screen.getByTestId("count")).toHaveTextContent("1");
        expect(screen.getByTestId("today-potty")).toHaveTextContent("1");
        expect(await originalLoad()).toHaveLength(1);
    });
});
