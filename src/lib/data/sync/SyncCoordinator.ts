import { DataAccessAuthError } from "../DataAccess";
import type { SyncExecutor, SyncOptions, SyncResult } from "../DataAccess";
import type { LocalStagingStore } from "../staging/LocalStagingStore";
import type { PendingTimerCompletion, StagedOwnerRecord, SyncSnapshot } from "../staging/types";
import type { PushPlan, SyncRemote } from "./types";
import { buildPushPlan, commitAcknowledgedPush, mergePulledSnapshot, timestampMs } from "./merge";
import { applyCompletionLoser, applyCompletionWinner } from "./timerCompletions";

function clone<T>(value: T): T {
    return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/** True when a push plan carries at least one entity/marker to apply. */
function isPlanNonEmpty(plan: PushPlan): boolean {
    return (
        plan.taskUpserts.length > 0 ||
        plan.taskTombstones.length > 0 ||
        plan.logUpserts.length > 0 ||
        plan.logTombstones.length > 0 ||
        plan.settings !== null ||
        plan.timerState !== null ||
        plan.pmState !== null ||
        plan.fullWipe === true
    );
}

/**
 * Builds the snapshot the server holds after a successful push: the current
 * baseline advanced by exactly the values/tombstones the plan acknowledged. The
 * timer `completed` guard is derived from the plan's `newGeneration` flag.
 */
function pushedSnapshotFromPlan(record: StagedOwnerRecord, plan: PushPlan): SyncSnapshot {
    const base = record.lastSynced;
    if (!base) {
        throw new Error("Cannot build the pushed snapshot without a lastSynced baseline");
    }
    const pushed: SyncSnapshot = {
        tasks: { ...base.tasks },
        logs: { ...base.logs },
        settings: { ...base.settings },
        timerState: { ...base.timerState },
        pmState: { ...base.pmState },
    };
    const ack = plan.acknowledged;

    for (const [id, value] of Object.entries(ack.taskUpserts)) {
        pushed.tasks[id] = { value: clone(value.value), updatedAt: value.updatedAt };
    }
    for (const id of Object.keys(ack.taskTombstones)) {
        delete pushed.tasks[id];
    }
    for (const [id, log] of Object.entries(ack.logUpserts)) {
        pushed.logs[id] = clone(log);
    }
    for (const id of Object.keys(ack.logTombstones)) {
        delete pushed.logs[id];
    }
    if (ack.settings) pushed.settings = clone(ack.settings);
    if (ack.timerState) {
        pushed.timerState = {
            value: clone(ack.timerState.value),
            updatedAt: ack.timerState.updatedAt,
            completed: !plan.timerState?.newGeneration,
        };
    }
    if (ack.pmState) pushed.pmState = clone(ack.pmState);
    if (ack.fullWipe) {
        // A successful wipe leaves only the default settings/timer rows and no
        // tasks or logs; PM merges independently and is never synthesized.
        pushed.tasks = {};
        pushed.logs = {};
        if (plan.settings) pushed.settings = clone(plan.settings);
        if (plan.timerState) {
            pushed.timerState = {
                value: clone(plan.timerState.value),
                updatedAt: plan.timerState.updatedAt,
                completed: false,
            };
        }
    }
    return pushed;
}

/**
 * Serialized pull -> merge -> completion CAS -> push coordinator for one owner.
 *
 * Focus, visibility, manual, bridge, close, and pagehide triggers that arrive
 * while a sync is running share the one in-flight promise instead of executing
 * overlapping pull/push cycles in one tab. `bestEffort` changes error
 * presentation/caller behavior only: it never skips a data-safety step.
 *
 * The attempt never pushes before a successful pull, is idempotent against an
 * unchanged server, and commits only the exact values/tombstones the push
 * acknowledged against the latest stored revision, so edits made while a sync
 * is in flight stay pending.
 */
export class SyncCoordinator implements SyncExecutor {
    private readonly ownerId: string;
    private readonly store: LocalStagingStore;
    private readonly remote: SyncRemote;
    private readonly now: () => Date;
    private inFlight: Promise<SyncResult> | null = null;

    constructor(
        ownerId: string,
        store: LocalStagingStore,
        remote: SyncRemote,
        options?: { now?: () => Date },
    ) {
        this.ownerId = ownerId;
        this.store = store;
        this.remote = remote;
        this.now = options?.now ?? (() => new Date());
    }

    sync(options: SyncOptions): Promise<SyncResult> {
        if (this.inFlight) {
            const shared = this.inFlight;
            if (options.bestEffort) {
                return shared.catch(() => this.currentBestEffortResult());
            }
            return shared;
        }

        const attempt = this.performSync();
        this.inFlight = attempt;
        attempt.then(
            () => {
                if (this.inFlight === attempt) this.inFlight = null;
            },
            () => {
                if (this.inFlight === attempt) this.inFlight = null;
            },
        );
        if (options.bestEffort) {
            return attempt.catch(() => this.currentBestEffortResult());
        }
        return attempt;
    }

    /**
     * Runs one attempt, catching only auth failures. A session refresh is tried
     * exactly once, then the entire pull -> merge -> push attempt restarts from
     * the persisted staging record. The auth error surfaces when the refresh or
     * the retry fails; arbitrary network/database errors are never retried here.
     */
    private async performSync(): Promise<SyncResult> {
        try {
            return await this.syncOnce();
        } catch (error) {
            if (error instanceof DataAccessAuthError) {
                await this.remote.refreshSession(this.ownerId);
                return this.syncOnce();
            }
            throw error;
        }
    }

    private async syncOnce(): Promise<SyncResult> {
        // 1. Pull first. A failed initial pull leaves `initialized` untouched and
        //    no remote write method is ever reached.
        const pulled = await this.remote.pull(this.ownerId);

        // 2. Merge the pull into the latest stored revision and persist the real
        //    baseline. The merge always advances `initialized` to true.
        await this.store.update(this.ownerId, (current) =>
            mergePulledSnapshot(current, pulled, this.now()).record,
        );

        // 3. Resolve pending completion entries chronologically. Each entry may
        //    install a local-only generation only when the local timer LWW wins,
        //    then replays the CAS and pulls again before winner/loser
        //    reconciliation.
        const entries = [...this.store.read(this.ownerId).pendingCompletions].sort(
            (a, b) => a.sequence - b.sequence,
        );
        let completionError: unknown = null;
        for (const entry of entries) {
            try {
                await this.resolveCompletion(entry);
            } catch (error) {
                // Auth failures still need the outer refresh/retry path. Other
                // completion failures leave the journal entry intact, but must
                // not block unrelated staged changes from being pushed below.
                if (error instanceof DataAccessAuthError) throw error;
                completionError ??= error;
            }
        }

        // 4. Re-read the latest staging record and push any non-empty ordinary
        //    delta. completionMask excludes unresolved completion-owned
        //    entities from this plan, so unrelated settings/PM/task changes can
        //    safely move forward while a completion journal entry is retried.
        const latest = this.store.read(this.ownerId);
        const plan = buildPushPlan(latest);
        if (isPlanNonEmpty(plan)) {
            await this.remote.push(this.ownerId, plan);
            await this.store.update(this.ownerId, (current) => {
                // A storage clear during the push replaces the record; the
                // fresh record has no baseline and must never be treated as
                // the acknowledged owner of this push.
                if (current.lastSynced === null) return current;
                return commitAcknowledgedPush(current, plan, pushedSnapshotFromPlan(current, plan));
            });
        }

        // 5. Return the final local state, PM slice, pending count, and
        //    initialized flag.
        const final = this.store.read(this.ownerId);
        const result = {
            state: clone(final.state),
            pmState: clone(final.pmState),
            pendingCount: this.store.pendingCount(this.ownerId),
            initialized: final.initialized,
        };
        if (completionError) throw completionError;
        return result;
    }

    private async resolveCompletion(entry: PendingTimerCompletion): Promise<void> {
        if (entry.localOnlyGeneration && this.localTimerLwwWins(entry)) {
            // The install decision may rest on an empty timer baseline (the last
            // pull observed no timer row). A concurrent tab could have started a
            // timer since that pull; re-pull in that window so a newer remote row
            // blocks the install instead of being overwritten by it.
            const baselineTimerUpdatedAt = this.store.read(this.ownerId).lastSynced?.timerState.updatedAt ?? null;
            if (baselineTimerUpdatedAt === null) {
                const now = this.now();
                const recheck = await this.remote.pull(this.ownerId);
                await this.store.update(this.ownerId, (current) =>
                    mergePulledSnapshot(current, recheck, now).record,
                );
            }
            if (this.localTimerLwwWins(entry)) {
                await this.remote.installTimerGeneration(this.ownerId, entry);
            }
        }

        const applied = await this.remote.completeTimer(this.ownerId, entry);

        // Pull again before applying the winner/loser reconciliation so the
        // reconciliation observes the server state produced by the CAS attempt.
        const now = this.now();
        const freshPull = await this.remote.pull(this.ownerId);
        await this.store.update(this.ownerId, (current) =>
            mergePulledSnapshot(current, freshPull, now).record,
        );
        await this.store.update(this.ownerId, (current) =>
            applied
                ? applyCompletionWinner(current, entry)
                : applyCompletionLoser(current, entry, freshPull, now),
        );
    }

    /**
     * True when a local-only generation's completion is newer than the remote
     * timer row, so its generation may be installed on the server before the CAS
     * replay. A missing remote timer row means the local generation wins; an
     * exact timestamp tie follows the merge convention and goes to the remote.
     */
    private localTimerLwwWins(entry: PendingTimerCompletion): boolean {
        const remoteUpdatedAt = this.store.read(this.ownerId).lastSynced?.timerState.updatedAt ?? null;
        if (remoteUpdatedAt === null) return true;
        return timestampMs(entry.completedAt) > timestampMs(remoteUpdatedAt);
    }

    /** Reads the persisted record so a best-effort failure never rejects. */
    private currentBestEffortResult(): SyncResult {
        const record = this.store.read(this.ownerId);
        return {
            state: clone(record.state),
            pmState: clone(record.pmState),
            pendingCount: this.store.pendingCount(this.ownerId),
            initialized: record.initialized,
        };
    }
}
