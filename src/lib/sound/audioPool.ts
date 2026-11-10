// Static imports let Vite resolve the sound URLs in dev and packaged builds.
import breakOverMp3 from "../../assets/audio/break-over.mp3";
import completeTaskMp3 from "../../assets/audio/complete-task.mp3";
import hoverSoundMp3 from "../../assets/audio/hover-sound.mp3";
import pomodoroFinishedMp3 from "../../assets/audio/pomodoro-finished.mp3";
import pressSidepanelButtonMp3 from "../../assets/audio/press-sidepanel-button.mp3";
import startPomodoroMp3 from "../../assets/audio/start-pomodoro.mp3";

export type SoundKey =
    | "breakOver"
    | "completeTask"
    | "hover"
    | "pomodoroFinish"
    | "pressSide"
    | "startPomodoro";

const fileMap: Record<SoundKey, string> = {
    breakOver: breakOverMp3,
    completeTask: completeTaskMp3,
    hover: hoverSoundMp3,
    pomodoroFinish: pomodoroFinishedMp3,
    pressSide: pressSidepanelButtonMp3,
    startPomodoro: startPomodoroMp3,
};

const sounds: Partial<Record<SoundKey, HTMLAudioElement>> = {};

export function preloadSounds() {
    if (typeof Audio === "undefined") return;

    for (const key of Object.keys(fileMap) as SoundKey[]) {
        if (sounds[key]) continue;
        const audio = new Audio(fileMap[key]);
        audio.preload = "auto";
        sounds[key] = audio;
    }
}

export function play(key: SoundKey, { interrupt = true } = {}) {
    const audio = sounds[key];
    if (!audio) return;
    if (interrupt) {
        audio.currentTime = 0;
    }
    void audio.play().catch(() => {});
}
