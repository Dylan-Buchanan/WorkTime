import { useEffect, useRef } from "react";
// Import assets so Vite/Tauri bundle them and give us correct hashed URLs in production
import breakOverMp3 from "../assets/audio/break-over.mp3";
import completeTaskMp3 from "../assets/audio/complete-task.mp3";
import hoverSoundMp3 from "../assets/audio/hover-sound.mp3";
import pomodoroFinishedMp3 from "../assets/audio/pomodoro-finished.mp3";
import pressSidepanelButtonMp3 from "../assets/audio/press-sidepanel-button.mp3";
import startPomodoroMp3 from "../assets/audio/start-pomodoro.mp3";

// Centralized sound management; simple HTMLAudio usage (small number of sounds)
export type SoundKey =
    | "breakOver"
    | "completeTask"
    | "hover"
    | "pomodoroFinish"
    | "pressSide"
    | "startPomodoro";

// Using imported URLs ensures they resolve both in dev and when packaged.
const fileMap: Record<SoundKey, string> = {
    breakOver: breakOverMp3,
    completeTask: completeTaskMp3,
    hover: hoverSoundMp3,
    pomodoroFinish: pomodoroFinishedMp3,
    pressSide: pressSidepanelButtonMp3,
    startPomodoro: startPomodoroMp3,
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
