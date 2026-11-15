import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveTimer, EnergyEntry, EnergyRatingPatch } from "../../state/types";
import type { EnergyContextValue } from "../../state/EnergyContext";
import { LogEnergyChip } from "./LogEnergyChip";

const mock = vi.hoisted(() => {
    const setRating = vi.fn<EnergyContextValue["setRating"]>(async (_windowId: string, _patch: EnergyRatingPatch) => true);
    const energy: EnergyContextValue = {
        entries: {},
        prefillFor: () => ({ energy: null, clarity: null }),
        armStart: () => () => {},
        setRating,
        error: null,
        clearError: () => {},
    };
    const app: {
        state: { timer: ActiveTimer | null; settings: { start_of_day: string } };
        pauseTimer: () => Promise<void>;
        resumeTimer: () => Promise<void>;
    } = {
        state: { timer: null, settings: { start_of_day: "05:00" } },
        pauseTimer: vi.fn(async () => {}),
        resumeTimer: vi.fn(async () => {}),
    };
    return { energy, app, setRating };
});

vi.mock("../../state/AppStateContext", () => ({ useAppState: () => mock.app }));
vi.mock("../../state/EnergyContext", () => ({ useOptionalEnergy: () => mock.energy }));

const WINDOW = new Date(2026, 10, 15, 9, 0, 0);
const WINDOW_ID = WINDOW.toISOString();
const at = (seconds: number) => new Date(WINDOW.getTime() + seconds * 1000);

function makeEntry(overrides: Partial<EnergyEntry> = {}): EnergyEntry {
    return {
        work_window_id: WINDOW_ID,
        energy: 2,
        clarity: 3,
        caffeine: false,
        energy_carried: false,
        clarity_carried: false,
        created_at: WINDOW_ID,
        updated_at: WINDOW_ID,
        ...overrides,
    };
}

function liveTimer(overrides: Partial<ActiveTimer> = {}): ActiveTimer {
    return {
        task_id: "a",
        started_at: WINDOW_ID,
        ends_at: at(25 * 60).toISOString(),
        kind: "Work",
        paused: false,
        paused_remaining_secs: 0,
        planned_secs: 25 * 60,
        accumulated_secs: 0,
        window_started_at: WINDOW_ID,
        ...overrides,
    };
}

const chipButton = () => screen.queryByRole("button", { name: "Log Energy" });

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(at(30));
    mock.energy.entries = { [WINDOW_ID]: makeEntry() };
    mock.energy.error = null;
    mock.setRating.mockReset();
    mock.setRating.mockImplementation(async () => true);
    mock.app.state = { timer: liveTimer(), settings: { start_of_day: "05:00" } };
    mock.app.pauseTimer = vi.fn(async () => {});
    mock.app.resumeTimer = vi.fn(async () => {});
});

afterEach(() => {
    vi.useRealTimers();
});

describe("LogEnergyChip", () => {
    it("is visible at 30 s of window age and still visible at 59 s while paused", () => {
        const { rerender } = render(<LogEnergyChip />);
        expect(chipButton()).toBeVisible();

        mock.app.state = {
            timer: liveTimer({ paused: true, accumulated_secs: 20 }),
            settings: mock.app.state.settings,
        };
        vi.setSystemTime(at(59));
        rerender(<LogEnergyChip />);

        expect(chipButton()).toBeVisible();
        expect(mock.app.resumeTimer).not.toHaveBeenCalled();
    });

    it("is gone at the 60 s mark and does not return on later renders", () => {
        const { rerender } = render(<LogEnergyChip />);
        expect(chipButton()).toBeVisible();

        act(() => { vi.advanceTimersByTime(30_000); });
        expect(chipButton()).toBeNull();

        vi.setSystemTime(at(61));
        rerender(<LogEnergyChip />);
        expect(chipButton()).toBeNull();

        vi.setSystemTime(at(90));
        rerender(<LogEnergyChip />);
        expect(chipButton()).toBeNull();
    });

    it("removes the expanded controls at the 60 s mark too", () => {
        render(<LogEnergyChip />);
        fireEvent.click(chipButton()!);
        expect(screen.getByRole("group", { name: "Energy" })).toBeInTheDocument();

        act(() => { vi.advanceTimersByTime(30_000); });

        expect(screen.queryByRole("group", { name: "Energy" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    });

    it("stays absent when the window has no stored row", () => {
        mock.energy.entries = {};
        render(<LogEnergyChip />);
        expect(chipButton()).toBeNull();
    });

    it("opens while paused without resuming, and writes nothing when closed untouched", () => {
        vi.setSystemTime(at(59));
        mock.app.state = {
            timer: liveTimer({ paused: true, accumulated_secs: 20 }),
            settings: mock.app.state.settings,
        };
        render(<LogEnergyChip />);

        fireEvent.click(chipButton()!);
        expect(screen.getByRole("group", { name: "Energy" })).toBeInTheDocument();
        expect(screen.getByRole("group", { name: "Clarity" })).toBeInTheDocument();
        expect(mock.app.resumeTimer).not.toHaveBeenCalled();
        expect(mock.app.pauseTimer).not.toHaveBeenCalled();
        expect(mock.app.state.timer?.paused).toBe(true);

        fireEvent.click(screen.getByRole("button", { name: "Close" }));
        expect(screen.queryByRole("group", { name: "Energy" })).toBeNull();
        expect(mock.setRating).not.toHaveBeenCalled();
        expect(screen.queryByText(/failed|error/i)).toBeNull();
    });

    it("shows the stored row values when opened", () => {
        render(<LogEnergyChip />);
        fireEvent.click(chipButton()!);

        expect(screen.getByRole("button", { name: "Energy 2 of 5" })).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByRole("button", { name: "Clarity 3 of 5" })).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByRole("button", { name: "Caffeine" })).toHaveAttribute("aria-pressed", "false");
    });

    it("writes only the touched field for the window", () => {
        render(<LogEnergyChip />);
        fireEvent.click(chipButton()!);

        fireEvent.click(screen.getByRole("button", { name: "Clarity 4 of 5" }));

        expect(mock.setRating).toHaveBeenCalledTimes(1);
        expect(mock.setRating).toHaveBeenCalledWith(WINDOW_ID, { clarity: 4 });
    });

    it("writes only the caffeine field when the pill is toggled", () => {
        render(<LogEnergyChip />);
        fireEvent.click(chipButton()!);

        fireEvent.click(screen.getByRole("button", { name: "Caffeine" }));

        expect(mock.setRating).toHaveBeenCalledTimes(1);
        expect(mock.setRating).toHaveBeenCalledWith(WINDOW_ID, { caffeine: true });
    });

    it("keeps the displayed stored value when a rating write fails", async () => {
        mock.setRating.mockResolvedValue(false);
        render(<LogEnergyChip />);
        fireEvent.click(chipButton()!);

        fireEvent.click(screen.getByRole("button", { name: "Energy 5 of 5" }));
        expect(mock.setRating).toHaveBeenCalledWith(WINDOW_ID, { energy: 5 });

        await act(async () => { await Promise.resolve(); });

        expect(screen.getByRole("button", { name: "Energy 2 of 5" })).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByRole("button", { name: "Energy 5 of 5" })).toHaveAttribute("aria-pressed", "false");
    });
});


