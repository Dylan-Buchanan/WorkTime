import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { composeEnergyEntry } from "../lib/energy";
import { InMemoryDataAccess } from "../lib/data/InMemoryDataAccess";
import { DataProvider } from "./DataContext";
import { EnergyProvider, useEnergy, useOptionalEnergy } from "./EnergyContext";
import type { TimerTransitionEvent } from "./timerTransitions";

const harness = vi.hoisted(() => {
    const listeners = new Set<(event: TimerTransitionEvent) => void>();
    return { listeners, state: { settings: { start_of_day: "05:00" } },
        subscribeTimerTransitions: (listener: (event: TimerTransitionEvent) => void) => {
            listeners.add(listener); return () => { listeners.delete(listener); };
        } };
});
vi.mock("./AppStateContext", () => ({ useAppState: () => harness }));
const local = (hour: number) => new Date(2026, 10, 15, hour).toISOString();
const publish = (reason: "start" | "break-end" | "switch" | "resume", hour = 11) => {
    const event: TimerTransitionEvent = { type: "enter", reason, windowId: local(hour), taskId: "ignored", at: local(hour) };
    return [...harness.listeners].map(listener => listener(event));
};
function setup(data = new InMemoryDataAccess()) {
    const wrapper = ({ children }: { children: ReactNode }) =>
        <DataProvider dataAccess={data}><EnergyProvider>{children}</EnergyProvider></DataProvider>;
    return { data, ...renderHook(() => useEnergy(), { wrapper }) };
}
async function seed(data: InMemoryDataAccess) {
    await data.createEnergyEntry(composeEnergyEntry({ workWindowId: local(9), prefill: { energy: 4, clarity: 3 }, explicit: {}, now: local(9) }));
}
beforeEach(() => { harness.listeners.clear(); harness.state.settings.start_of_day = "05:00"; });

describe("EnergyProvider", () => {
    it("creates a same-day prefilled row once on start, with carried flags", async () => {
        const data = new InMemoryDataAccess(); await seed(data);
        const create = vi.spyOn(data, "createEnergyEntry");
        const { result } = setup(data);
        await waitFor(() => expect(result.current.entries[local(9)]).toBeDefined());
        act(() => { publish("start"); });
        await waitFor(() => expect(result.current.entries[local(11)]).toMatchObject({ energy: 4, clarity: 3, caffeine: false, energy_carried: true, clarity_carried: true }));
        act(() => { publish("start"); });
        await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
        await waitFor(async () => expect(await data.loadEnergyEntries()).toHaveLength(2));
    });
    it("creates on break-end, ignores switch/resume/leave, and never backfills mount state", async () => {
        const { data, result } = setup();
        const create = vi.spyOn(data, "createEnergyEntry");
        act(() => {
            publish("switch"); publish("resume");
            for (const listener of harness.listeners) listener({ type: "leave", reason: "stop", taskId: "ignored", windowId: local(11), at: local(11) });
        });
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
        expect(create).not.toHaveBeenCalled();
        act(() => { publish("break-end"); });
        await waitFor(() => expect(result.current.entries[local(11)]).toBeDefined());
        expect(create).toHaveBeenCalledTimes(1);
    });
    it("consumes armed explicit values only on start and disarms idempotently", async () => {
        const data = new InMemoryDataAccess(); await seed(data);
        const { result } = setup(data);
        const disarm = result.current.armStart({ energy: 2 });
        act(() => { publish("start"); });
        disarm(); disarm();
        await waitFor(() => expect(result.current.entries[local(11)]).toMatchObject({ energy: 2, energy_carried: false, clarity: 3, clarity_carried: true }));
        const cancel = result.current.armStart({ energy: 1 }); cancel(); cancel();
        act(() => { publish("start", 12); });
        await waitFor(() => expect(result.current.entries[local(12)]).toMatchObject({ energy: 2, energy_carried: true, clarity: 3, clarity_carried: true }));
    });
    it("break-end does not consume armed start values", async () => {
        const { result } = setup();
        const disarm = result.current.armStart({ caffeine: true });
        act(() => { publish("break-end"); publish("start", 12); });
        disarm();
        await waitFor(() => expect(result.current.entries[local(12)]?.caffeine).toBe(true));
        expect(result.current.entries[local(11)].caffeine).toBe(false);
    });
    it("returns synchronously before calling data and isolates create failure", async () => {
        const data = new InMemoryDataAccess();
        let fail!: (reason: Error) => void;
        const pending = new Promise<boolean>((_resolve, reject) => { fail = reject; });
        const create = vi.spyOn(data, "createEnergyEntry").mockReturnValue(pending);
        const { result } = setup(data);
        const load = vi.spyOn(data, "loadEnergyEntries");
        let returned: void[] = [];
        act(() => { returned = publish("start"); });
        expect(returned).toEqual([undefined]);
        expect(load).not.toHaveBeenCalled();
        expect(create).not.toHaveBeenCalled();
        await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
        act(() => { fail(new Error("create failed")); });
        await waitFor(() => expect(result.current.error).toBe("create failed"));
        act(() => result.current.clearError());
        expect(result.current.error).toBeNull();
    });
    it("serializes an immediate rating behind the pending start create", async () => {
        const data = new InMemoryDataAccess();
        const order: string[] = [];
        const original = data.createEnergyEntry.bind(data);
        let release!: () => void;
        const pending = new Promise<void>(resolve => { release = resolve; });
        vi.spyOn(data, "createEnergyEntry").mockImplementation(async entry => {
            order.push("create"); await pending; return original(entry);
        });
        const set = data.setEnergyRating.bind(data);
        vi.spyOn(data, "setEnergyRating").mockImplementation(async (...args) => { order.push("rating"); return set(...args); });
        const { result } = setup(data);
        let rating!: Promise<boolean>;
        act(() => { publish("start"); rating = result.current.setRating(local(11), { clarity: 5 }); });
        await waitFor(() => expect(order).toEqual(["create"]));
        await act(async () => { release(); expect(await rating).toBe(true); });
        expect(order).toEqual(["create", "rating"]);
        expect(result.current.entries[local(11)]).toMatchObject({ clarity: 5, clarity_carried: false });
    });
    it("returns false for missing/empty ratings and catches rating failures", async () => {
        const { data, result } = setup();
        await act(async () => { expect(await result.current.setRating("missing", { energy: 2 })).toBe(false); });
        expect(await data.loadEnergyEntries()).toEqual([]);
        vi.spyOn(data, "setEnergyRating").mockRejectedValue(new Error("rating failed"));
        await act(async () => { expect(await result.current.setRating("missing", { clarity: 3 })).toBe(false); });
        expect(result.current.error).toBe("rating failed");
    });
    it("reloads subscriptions and own writes, resolving prefill with latest settings and fresh data", async () => {
        const { data, result, rerender } = setup();
        await act(async () => { await seed(data); });
        await waitFor(() => expect(result.current.prefillFor(local(11))).toEqual({ energy: 4, clarity: 3 }));
        harness.state.settings.start_of_day = "10:00"; rerender();
        expect(result.current.prefillFor(local(11))).toEqual({ energy: null, clarity: null });
        act(() => { publish("start"); });
        await waitFor(() => expect(result.current.entries[local(11)]?.energy).toBeNull());
    });
    it("makes optional consumers safe outside the provider", () => {
        const { result } = renderHook(() => useOptionalEnergy());
        expect(result.current).toBeUndefined();
        expect(() => renderHook(() => useEnergy())).toThrow("useEnergy must be used within EnergyProvider");
    });
});
