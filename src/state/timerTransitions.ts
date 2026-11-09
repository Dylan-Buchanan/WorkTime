export type TimerLeaveReason = "pause" | "stop" | "switch";
export type TimerEnterReason = "resume" | "start" | "switch" | "break-end";

/**
 * AppStateContext publishes successful explicit Work commands after assigning
 * its state ref and calling setState. Pause/stop leave, resume/start enter,
 * and task handovers enter (with a preceding leave only for newly logged work).
 * Only local, applied break completion can publish break-end. Hydration,
 * reconciliation, race losers, natural Work completion, finalize, archive,
 * reset, and break commands are silent.
 *
 * `at` is observed immediately after command success. Switch pairs share it,
 * are synchronous, and leave precedes enter and any awaited progression.
 * `windowId` is windowStartedAt of the Work timer, including legacy fallback.
 * `pausedAt` links stop/switch to a pause in this mount for that task/window.
 * Plain resume ends the episode; handoff resume silently carries it to the
 * next matching switch. No incoming occupant inherits the outgoing pause.
 *
 * Listeners MUST NOT synchronously invoke app commands; record/enqueue events
 * and schedule UI work instead. Delivery snapshots listeners and isolates errors.
 */
export type TimerTransitionEvent =
    | { type: "leave"; taskId: string; reason: TimerLeaveReason; at: string; windowId: string; pausedAt?: string }
    | { type: "enter"; taskId: string; reason: TimerEnterReason; at: string; windowId: string; fromTaskId?: string };
