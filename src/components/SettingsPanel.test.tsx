import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SettingsPanel } from "./SettingsPanel";
import { AppStateProvider } from "../state/AppStateContext";
import { SyncProvider } from "../state/SyncContext";
import { TauriCloseProvider } from "../state/TauriCloseContext";
import { DataProvider } from "../state/DataContext";
import { ProjectManagerProvider } from "../state/ProjectManagerContext";
import { InMemoryDataAccess } from "../lib/data/InMemoryDataAccess";
import { makeAppState } from "../test/mockTauri";
import {
    AGENT_API_KEY_STORAGE_KEY,
    AGENT_PROVIDER_STORAGE_KEY,
    getAgentApiKey,
} from "../lib/agent";

vi.mock("../hooks/useSounds", () => ({
    useSounds: () => ({ play: () => {} }),
}));

const OWNER = "owner-1";

function wrap(data: InMemoryDataAccess, children: React.ReactNode) {
    return (
        <TauriCloseProvider>
            <DataProvider dataAccess={data}>
                <SyncProvider ownerId={OWNER}>
                    <AppStateProvider>
                        <ProjectManagerProvider>{children}</ProjectManagerProvider>
                    </AppStateProvider>
                </SyncProvider>
            </DataProvider>
        </TauriCloseProvider>
    );
}

beforeEach(() => localStorage.clear());

describe("SettingsPanel reset scope", () => {
    it("edits and saves the global end-of-day cutoff", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const updateSpy = vi.spyOn(data, "updateSettings");
        render(wrap(data, <SettingsPanel />));

        const hour = await screen.findByLabelText("End of day hour");
        const minute = screen.getByLabelText("End of day minute");
        expect(hour).toHaveValue("10");
        expect(minute).toHaveValue("00");
        expect(screen.getByRole("button", { name: "PM" })).toHaveAttribute("aria-pressed", "true");

        fireEvent.change(hour, { target: { value: "6" } });
        fireEvent.blur(hour);
        fireEvent.change(minute, { target: { value: "30" } });
        fireEvent.blur(minute);
        fireEvent.click(screen.getByRole("button", { name: "Save" }));

        await waitFor(() => expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ end_of_day: "18:30" })));
    });

    it("switches the cutoff period without opening a native time picker", async () => {
        const data = new InMemoryDataAccess(makeAppState({ settings: { ...makeAppState().settings, end_of_day: "09:15" } }));
        const updateSpy = vi.spyOn(data, "updateSettings");
        render(wrap(data, <SettingsPanel />));

        expect(await screen.findByLabelText("End of day hour")).toHaveAttribute("inputmode", "numeric");
        expect(screen.queryByDisplayValue("09:15")).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "PM" }));
        fireEvent.click(screen.getByRole("button", { name: "Save" }));

        await waitFor(() => expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ end_of_day: "21:15" })));
    });

    it("resets timer data once, keeps PM, and describes the scoped deletion", async () => {
        const data = new InMemoryDataAccess(makeAppState({
            tasks: { t1: { id: "t1", name: "Doomed", target_pomodoros: 2, completed_pomodoros: 0, created_at: "2026-01-01T00:00:00Z", completed_at: null, break_skips: 0, archived: false } },
        }));
        await data.savePMState({
            projects: { p1: { id: "p1", name: "Keep Me", color: "#fff", workableStart: "09:00", workableEnd: "17:00", workableDays: [1, 2, 3, 4, 5], isArchived: false, sortOrder: 0, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" } },
            tasks: {},
            meta: { initializedAt: "2026-01-01T00:00:00Z" },
        });
        const pmBefore = await data.loadPMState();
        const resetSpy = vi.spyOn(data, "resetAppState");
        const savePMSpy = vi.spyOn(data, "savePMState");

        render(wrap(data, <SettingsPanel />));
        await waitFor(() => expect(screen.getByText("Reset All Data")).toBeTruthy());
        savePMSpy.mockClear();

        act(() => screen.getByText("Reset All Data").click());

        // The confirmation copy describes the scoped deletion: timer data is
        // removed while projects/estimates remain.
        const copy = screen.getByText(/This will delete all timer tasks, logs, settings and timer state/i).textContent ?? "";
        expect(copy).toContain("timer tasks");
        expect(copy).toContain("logs");
        expect(copy).toContain("settings");
        expect(copy).toContain("timer state");
        expect(screen.getByText(/Your projects and estimates will be kept/i)).toBeTruthy();

        // The delete button stays disabled until the user types "yes".
        const deleteButton = screen.getByText("Delete Data");
        const confirmInput = screen.getByPlaceholderText("type yes to confirm");
        expect(deleteButton).toBeDisabled();
        fireEvent.change(confirmInput, { target: { value: "no" } });
        expect(deleteButton).toBeDisabled();
        fireEvent.change(confirmInput, { target: { value: "yes" } });
        expect(deleteButton).toBeEnabled();

        await act(async () => {
            deleteButton.click();
        });

        // The app reset ran exactly once and the staged PM slice is untouched:
        // `resetPM` never reaches the PM provider and no PM write occurs.
        expect(resetSpy).toHaveBeenCalledTimes(1);
        expect(await data.loadPMState()).toEqual(pmBefore);
        expect(savePMSpy).not.toHaveBeenCalled();
    });

    it("stores and clears the agent API key locally", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        render(wrap(data, <SettingsPanel />));

        const input = await screen.findByLabelText("Agent API key");
        fireEvent.change(screen.getByRole("combobox", { name: /Provider/ }), { target: { value: "deepseek" } });
        fireEvent.change(input, { target: { value: "  secret-key  " } });
        fireEvent.click(screen.getByText("Save API key"));

        expect(localStorage.getItem(AGENT_API_KEY_STORAGE_KEY)).toBe("secret-key");
        expect(localStorage.getItem(AGENT_PROVIDER_STORAGE_KEY)).toBe("deepseek");
        expect(getAgentApiKey()).toBe("secret-key");
        expect(screen.getByRole("status")).toHaveTextContent("API key saved locally");

        fireEvent.click(screen.getByText("Clear"));
        expect(localStorage.getItem(AGENT_API_KEY_STORAGE_KEY)).toBeNull();
        expect(getAgentApiKey()).toBeNull();
        expect(screen.getByRole("status")).toHaveTextContent("API key cleared");
    });

    it("shows a failure indicator when browser storage rejects the save", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        render(wrap(data, <SettingsPanel />));
        const input = await screen.findByLabelText("Agent API key");
        fireEvent.change(input, { target: { value: "secret-key" } });
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new Error("storage quota exceeded");
        });

        fireEvent.click(screen.getByText("Save API key"));

        expect(screen.getByRole("status")).toHaveTextContent("Unable to save the API key locally");
    });
});
