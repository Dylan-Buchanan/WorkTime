import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
import { THEME_PREFERENCE_STORAGE_KEY } from "../lib/theme";
import { SOUND_KEYS, SOUND_PREFERENCE_STORAGE_KEY, clearSoundPreference } from "../lib/sound";
import { play } from "../lib/sound/audioPool";

const playClip = vi.fn<(src: string) => void>();

beforeAll(() => {
    vi.stubGlobal("Audio", class {
        constructor(readonly src: string) {}

        play() {
            playClip(this.src);
            return Promise.resolve();
        }
    });
});

afterAll(() => vi.unstubAllGlobals());

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

beforeEach(() => {
    localStorage.clear();
    clearSoundPreference();
    playClip.mockClear();
});

function expandSection(name: string) {
    const button = screen.getByRole("button", { name, expanded: false });
    fireEvent.click(button);
    return screen.getByRole("button", { name, expanded: true });
}

function soundSwitch(name: string) {
    return screen.getByRole("switch", { name });
}

/** Replaces window.matchMedia with one list the test can flip. */
function installMatchMedia(initialMatches: boolean) {
    window.matchMedia = (() => ({
        matches: initialMatches,
        media: "(prefers-color-scheme: dark)",
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
}

describe("SettingsPanel reset scope", () => {
    it("edits and saves the global end-of-day cutoff", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const updateSpy = vi.spyOn(data, "updateSettings");
        render(wrap(data, <SettingsPanel />));

        expandSection("Day hour settings");
        const hour = await screen.findByLabelText("End of day hour");
        const minute = screen.getByLabelText("End of day minute");
        expect(hour).toHaveValue("10");
        expect(minute).toHaveValue("00");
        expect(screen.getAllByRole("button", { name: "PM" })[1]).toHaveAttribute("aria-pressed", "true");

        // Settle every pending provider update (PM hydration, sync bootstrap,
        // Tauri adapter) before driving the controlled inputs. If a provider
        // re-render is still pending when the change event dispatches, React
        // restores the input's controlled value and drops the state update
        // from onChange, silently losing the edit.
        await act(async () => {});

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

        expandSection("Day hour settings");
        expect(await screen.findByLabelText("End of day hour")).toHaveAttribute("inputmode", "numeric");
        expect(screen.queryByDisplayValue("09:15")).not.toBeInTheDocument();
        fireEvent.click(screen.getAllByRole("button", { name: "PM" })[1]);
        fireEvent.click(screen.getByRole("button", { name: "Save" }));

        await waitFor(() => expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ end_of_day: "21:15" })));
    });

    it("edits start of day independently and saves it", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const updateSpy = vi.spyOn(data, "updateSettings");
        render(wrap(data, <SettingsPanel />));

        expandSection("Day hour settings");
        const hour = await screen.findByLabelText("Start of day hour");
        const minute = screen.getByLabelText("Start of day minute");
        expect(hour).toHaveValue("12");
        expect(minute).toHaveValue("00");
        await act(async () => {});

        fireEvent.change(hour, { target: { value: "7" } });
        fireEvent.blur(hour);
        fireEvent.change(minute, { target: { value: "30" } });
        fireEvent.blur(minute);
        fireEvent.click(screen.getByRole("button", { name: "Save" }));

        await waitFor(() => expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ start_of_day: "07:30", end_of_day: "22:00" })));
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

        expandSection("Sound");
        fireEvent.click(soundSwitch("Hover"));
        fireEvent.click(soundSwitch("All sounds"));
        const soundBefore = localStorage.getItem(SOUND_PREFERENCE_STORAGE_KEY);

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
        expect(localStorage.getItem(SOUND_PREFERENCE_STORAGE_KEY)).toBe(soundBefore);
        expect(soundSwitch("All sounds")).not.toBeChecked();
        expect(soundSwitch("Hover")).not.toBeChecked();
    });

    it("renders the reset confirmation outside the blurred sidebar subtree", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        // The desktop sidebar carries `backdrop-blur-sm`, which would make it the
        // containing block for a `position: fixed` overlay. jsdom runs no layout,
        // so this asserts the structural escape (portalled to <body>) rather than
        // geometry; e2e/overlay-geometry.spec.ts covers the real layout.
        render(wrap(data, <div data-testid="blurred-sidebar" className="backdrop-blur-sm"><SettingsPanel /></div>));

        await waitFor(() => expect(screen.getByText("Reset All Data")).toBeTruthy());
        act(() => screen.getByText("Reset All Data").click());

        const dialog = screen.getByRole("dialog", { name: "Confirm Data Reset" });
        expect(dialog.parentElement).toBe(document.body);
        expect(screen.getByTestId("blurred-sidebar").contains(dialog)).toBe(false);
        expect(document.body.contains(dialog)).toBe(true);
    });

    it("stores and clears the agent API key locally", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        render(wrap(data, <SettingsPanel />));

        expandSection("Agent API key");
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
        expandSection("Agent API key");
        const input = await screen.findByLabelText("Agent API key");
        fireEvent.change(input, { target: { value: "secret-key" } });
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new Error("storage quota exceeded");
        });

        fireEvent.click(screen.getByText("Save API key"));

        expect(screen.getByRole("status")).toHaveTextContent("Unable to save the API key locally");
    });

    it("starts all sections collapsed, toggles them independently, and resets on remount", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const view = render(wrap(data, <SettingsPanel />));
        const names = ["Appearance", "Sound", "Base settings", "Day hour settings", "Agent API key"];
        expect(screen.getAllByRole("button", { expanded: false })).toEqual(
            names.map((name) => screen.getByRole("button", { name, expanded: false })),
        );
        expect(screen.queryByRole("switch")).not.toBeInTheDocument();
        for (const name of names) {
            expect(screen.getByRole("button", { name, expanded: false })).toBeInTheDocument();
        }
        expect(screen.queryByLabelText("work minutes")).not.toBeInTheDocument();
        expect(screen.queryByLabelText("Start of day hour")).not.toBeInTheDocument();
        expect(document.getElementById("settings-agent-content")).toHaveAttribute("hidden");

        for (const name of names) {
            expandSection(name);
            expect(screen.getByRole("button", { name, expanded: true })).toHaveAttribute("aria-controls");
            fireEvent.click(screen.getByRole("button", { name, expanded: true }));
            expect(screen.getByRole("button", { name, expanded: false })).toBeInTheDocument();
        }

        view.unmount();
        render(wrap(data, <SettingsPanel />));
        for (const name of names) {
            expect(screen.getByRole("button", { name, expanded: false })).toBeInTheDocument();
        }
    });

    it("offers Light, Dark, and System with Dark selected by default and applies on selection", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        render(wrap(data, <SettingsPanel />));

        expandSection("Appearance");
        const light = screen.getByRole("radio", { name: "Light" });
        const dark = screen.getByRole("radio", { name: "Dark" });
        const system = screen.getByRole("radio", { name: "System" });

        expect(light).not.toBeChecked();
        expect(dark).toBeChecked();
        expect(system).not.toBeChecked();
        expect(screen.getByRole("status")).toHaveTextContent("Current theme: Dark");

        fireEvent.click(light);

        expect(light).toBeChecked();
        expect(dark).not.toBeChecked();
        expect(localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY)).toBe("light");
        expect(document.documentElement).toHaveAttribute("data-theme", "light");
        expect(screen.getByRole("status")).toHaveTextContent("Current theme: Light");

        fireEvent.click(dark);

        expect(localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY)).toBe("dark");
        expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    });

    it("resolves System against the OS preference and announces the resolved theme", async () => {
        installMatchMedia(false);
        const data = new InMemoryDataAccess(makeAppState());
        render(wrap(data, <SettingsPanel />));

        expandSection("Appearance");
        fireEvent.click(screen.getByRole("radio", { name: "System" }));

        expect(localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY)).toBe("system");
        expect(document.documentElement).toHaveAttribute("data-theme", "light");
        expect(screen.getByRole("status")).toHaveTextContent("Current theme: Light (system)");
    });
});

describe("SettingsPanel sound preference", () => {
    it("mutes every clip while preserving editable individual settings", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const updateSettings = vi.spyOn(data, "updateSettings");
        const view = render(wrap(data, <SettingsPanel />));
        await act(async () => {});
        const existingStorageKeys = Object.keys(localStorage);
        expandSection("Sound");

        const names = ["All sounds", "Hover", "Button press", "Pomodoro start", "Pomodoro finished", "Break over", "Task complete"];
        expect(screen.getAllByRole("switch")).toEqual(names.map(soundSwitch));
        for (const name of names) expect(soundSwitch(name)).toBeChecked();

        fireEvent.click(soundSwitch("All sounds"));
        for (const key of SOUND_KEYS) play(key);
        expect(playClip).not.toHaveBeenCalled();

        for (const name of names.slice(1)) {
            expect(soundSwitch(name)).toBeEnabled();
            expect(soundSwitch(name)).toBeChecked();
        }
        fireEvent.click(soundSwitch("Hover"));
        fireEvent.click(soundSwitch("Task complete"));
        fireEvent.click(soundSwitch("Task complete"));
        expect(soundSwitch("Hover")).not.toBeChecked();
        expect(soundSwitch("Task complete")).toBeChecked();
        expect(playClip).not.toHaveBeenCalled();

        fireEvent.click(soundSwitch("All sounds"));
        expect(playClip).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("press-sidepanel-button.mp3"));
        expect(soundSwitch("Hover")).not.toBeChecked();
        expect(soundSwitch("Task complete")).toBeChecked();
        expect(updateSettings).not.toHaveBeenCalled();
        expect(Object.keys(localStorage).filter((key) => !existingStorageKeys.includes(key))).toEqual([SOUND_PREFERENCE_STORAGE_KEY]);

        view.unmount();
        render(wrap(data, <SettingsPanel />));
        await act(async () => {});
        expandSection("Sound");
        expect(soundSwitch("All sounds")).toBeChecked();
        expect(soundSwitch("Hover")).not.toBeChecked();
    });

    it("silences only a disabled clip and previews it once when re-enabled", async () => {
        render(wrap(new InMemoryDataAccess(makeAppState()), <SettingsPanel />));
        await act(async () => {});
        expandSection("Sound");

        fireEvent.click(soundSwitch("Hover"));
        expect(playClip).not.toHaveBeenCalled();
        play("hover");
        play("pressSide");
        expect(playClip).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("press-sidepanel-button.mp3"));

        playClip.mockClear();
        fireEvent.click(soundSwitch("Hover"));
        expect(playClip).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("hover-sound.mp3"));
    });

    it("stays silent when unmuting with Button press disabled", async () => {
        render(wrap(new InMemoryDataAccess(makeAppState()), <SettingsPanel />));
        await act(async () => {});
        expandSection("Sound");

        fireEvent.click(soundSwitch("Button press"));
        fireEvent.click(soundSwitch("All sounds"));
        fireEvent.click(soundSwitch("All sounds"));
        expect(soundSwitch("Button press")).not.toBeChecked();
        expect(playClip).not.toHaveBeenCalled();
    });
});
