import { useEffect, useRef } from "react";

// Centralized sound management; simple HTMLAudio usage (small number of sounds)
export type SoundKey =
    | "breakOver"
    | "completeTask"
    | "hover"
    | "pomodoroFinish"
    | "pressSide"
    | "startPomodoro";

const fileMap: Record<SoundKey, string> = {
    breakOver: "/src/assets/audio/break-over.mp3",
    completeTask: "/src/assets/audio/complete-task.mp3",
    hover: "/src/assets/audio/hover-sound.mp3",
    pomodoroFinish: "/src/assets/audio/pomodoro-finished.mp3",
    pressSide: "/src/assets/audio/press-sidepanel-button.mp3",
    startPomodoro: "/src/assets/audio/start-pomodoro.mp3",
};

export function useSounds() {
    const sounds = useRef<Partial<Record<SoundKey, HTMLAudioElement>>>({});

    useEffect(() => {
        (Object.keys(fileMap) as SoundKey[]).forEach((k) => {
            const audio = new Audio(fileMap[k]);
            audio.preload = "auto";
            sounds.current[k] = audio;
        });
    }, []);

    function play(key: SoundKey, { interrupt = true } = {}) {
        const a = sounds.current[key];
        if (!a) return;
        if (interrupt) {
            a.currentTime = 0;
        }
        a.play().catch(() => {});
    }

    return { play };
}
