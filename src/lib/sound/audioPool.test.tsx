import { renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useSounds, type SoundKey } from "../../hooks/useSounds";

afterEach(() => vi.unstubAllGlobals());

it("preloads one shared element per sound and applies each caller's interrupt option", () => {
    const elements: TestAudio[] = [];
    class TestAudio {
        preload = "";
        currentTime = 0;
        play = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

        constructor(readonly url: string) {
            elements.push(this);
        }
    }
    vi.stubGlobal("Audio", TestAudio);

    const first = renderHook(useSounds, { reactStrictMode: true });
    const second = renderHook(useSounds);
    expect(elements).toHaveLength(6);
    expect(elements.every((audio) => audio.preload === "auto")).toBe(true);

    const clips: Record<SoundKey, string> = {
        breakOver: "break-over.mp3",
        completeTask: "complete-task.mp3",
        hover: "hover-sound.mp3",
        pomodoroFinish: "pomodoro-finished.mp3",
        pressSide: "press-sidepanel-button.mp3",
        startPomodoro: "start-pomodoro.mp3",
    };
    for (const [key, filename] of Object.entries(clips)) {
        const audio = elements.find((element) => element.url.endsWith(filename))!;
        audio.currentTime = 0.1;
        first.result.current.play(key as SoundKey, { interrupt: false });
        expect(audio.currentTime).toBe(0.1);
        expect(audio.play).toHaveBeenCalledTimes(1);
    }
    expect(elements.map((audio) => audio.play.mock.calls.length)).toEqual([1, 1, 1, 1, 1, 1]);

    first.unmount();
    second.unmount();
    const remounted = renderHook(useSounds);
    expect(elements).toHaveLength(6);

    const hover = elements.find((audio) => audio.url.endsWith(clips.hover))!;
    hover.play.mockRejectedValueOnce(new DOMException("Autoplay blocked", "NotAllowedError"));
    remounted.result.current.play("hover");
    expect(hover.currentTime).toBe(0);
    expect(hover.play).toHaveBeenCalledTimes(2);
});
