import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataAccess } from "../lib/data/InMemoryDataAccess";
import { DataProvider } from "./DataContext";
import { SyncProvider } from "./SyncContext";
import { TauriCloseProvider } from "./TauriCloseContext";
import { ToastProvider } from "./ToastContext";
import { PetActivityProvider, usePetActivity } from "./PetActivityContext";
import { makeAppState } from "../test/mockTauri";
import type { PetActivityRecord, PetActivityType } from "./types";

const OWNER = "owner-1";

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
        <button onClick={() => logActivity({ activityType: "potty", timestamp: new Date() })}>log-potty</button>
        <button onClick={() => logActivity({ activityType: "training", timestamp: new Date(), durationMinutes: 10 })}>log-training</button>
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

beforeEach(() => localStorage.clear());

describe("PetActivityContext", () => {
    it("hydrates staged activity records", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.savePetActivityRecords([record("a1", "potty", new Date(2026, 8, 17, 9, 0))]);

        render(wrap(data));
        await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("1"));
        expect(screen.getByTestId("hydrated")).toHaveTextContent("true");
    });

    it("logs through the single write path, stages locally, and offers undo", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const save = vi.spyOn(data, "savePetActivityRecords");
        render(wrap(data));
        await waitFor(() => expect(screen.getByTestId("hydrated")).toHaveTextContent("true"));
        save.mockClear();
        const syncCount = data.syncCalls.length;

        fireEvent.click(screen.getByText("log-potty"));
        await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("1"));
        expect(save).toHaveBeenCalled();
        expect(data.syncCalls).toHaveLength(syncCount);
        expect(screen.getByTestId("today-potty")).toHaveTextContent("1");
        expect(screen.getByTestId("toast-message")).toHaveTextContent("Logged potty");

        fireEvent.click(screen.getByText("Undo"));
        await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("0"));
        await waitFor(async () => expect(await data.loadPetActivityRecords()).toEqual([]));
    });

    it("carries an optional duration for training but never for potty", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        render(wrap(data));
        await waitFor(() => expect(screen.getByTestId("hydrated")).toHaveTextContent("true"));

        fireEvent.click(screen.getByText("log-training"));
        await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("1"));
        const [saved] = await data.loadPetActivityRecords();
        expect(saved.activityType).toBe("training");
        expect(saved.durationMinutes).toBe(10);
    });

    it("corrects today's timestamp in place and rejects older records", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        render(wrap(data));
        await waitFor(() => expect(screen.getByTestId("hydrated")).toHaveTextContent("true"));

        fireEvent.click(screen.getByText("log-potty"));
        await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("1"));
        expect(screen.getByTestId("can-correct")).toHaveTextContent("true");
        const before = (await data.loadPetActivityRecords())[0];

        fireEvent.click(screen.getByText("correct"));
        await waitFor(async () => {
            const [after] = await data.loadPetActivityRecords();
            expect(after.id).toBe(before.id);
            expect(after.createdAt).toBe(before.createdAt);
            expect(new Date(after.timestamp).getTime()).toBeGreaterThan(new Date(before.timestamp).getTime());
        });
    });

    it("does not allow correcting a record stamped yesterday", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        await data.savePetActivityRecords([record("old", "potty", yesterday)]);

        render(wrap(data));
        await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("1"));
        expect(screen.getByTestId("can-correct")).toHaveTextContent("false");

        fireEvent.click(screen.getByText("correct"));
        await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent("today"));
    });

    it("reloads staged revisions without restaging the reloaded slice", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.savePetActivityRecords([record("a1", "potty", new Date(2026, 8, 17, 9, 0))]);
        render(wrap(data));
        await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("1"));

        const save = vi.spyOn(data, "savePetActivityRecords");
        await data.savePetActivityRecords([
            record("a1", "potty", new Date(2026, 8, 17, 9, 0)),
            record("a2", "training", new Date(2026, 8, 17, 10, 0), 5),
        ]);
        await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("2"));
        // Only the external write above; the provider reloaded without restaging.
        expect(save).toHaveBeenCalledTimes(1);
    });
});
