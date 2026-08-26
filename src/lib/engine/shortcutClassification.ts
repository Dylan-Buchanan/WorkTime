import type { PMTask, TaskPriority, TaskStatus } from "../../state/types";
import { normalizeTaskDueDate } from "../taskDueDate";

/** The slim story shape returned by the shortcut-sync Edge Function. */
export interface ShortcutStoryPayload {
    id: number;
    app_url: string;
    name: string;
    description: string;
    estimate: number | null;
    deadline: string | null;
    workflow_state_id: number;
    status_name: string;
    completed: boolean;
    archived: boolean;
    story_type: "feature" | "bug" | "chore";
    labels: { id: number; name: string }[];
}

/** The PMTask fields needed by the preview and the existing createTask path. */
export interface ShortcutTaskProposal {
    title: string;
    projectId: string | null;
    status: TaskStatus;
    priority: TaskPriority;
    dueDate?: string;
    estimatePomos?: number;
    description: string;
    tags: string[];
    links: string[];
    checklist: PMTask["checklist"];
    relatedTo: string[];
}

export interface ShortcutClassificationCounts {
    new: number;
    skippedAlreadyAdded: number;
    skippedStatusNotIncluded: number;
    skippedArchived: number;
}

export interface ShortcutClassificationResult {
    proposals: ShortcutTaskProposal[];
    counts: ShortcutClassificationCounts;
}

export interface ClassifyShortcutStoriesInput {
    stories: readonly ShortcutStoryPayload[];
    currentTasks: readonly PMTask[];
    includedStatuses: readonly string[];
    defaultProjectId: string | null;
}

const SHORTCUT_POINTS_TO_POMODOROS: Readonly<Record<number, number>> = {
    0: 1,
    1: 3,
    2: 5,
    3: 8,
    5: 12,
};

/** Convert Shortcut story points to the equivalent WorkTime pomodoro estimate. */
export function shortcutPointsToPomodoros(points: number): number {
    // Keep unsupported/non-standard point values compatible with the previous
    // behavior until an explicit mapping for them is defined.
    return SHORTCUT_POINTS_TO_POMODOROS[points] ?? points;
}

/**
 * Normalize a Shortcut app URL for deduplication without changing meaningful
 * URL components. Shortcut app URLs may be copied with surrounding whitespace
 * or a trailing slash, while path and query differences remain significant.
 */
export function normalizeShortcutUrl(value: string): string {
    const trimmed = value.trim();
    const suffixStart = trimmed.search(/[?#]/);
    const path = suffixStart === -1 ? trimmed : trimmed.slice(0, suffixStart);
    const suffix = suffixStart === -1 ? "" : trimmed.slice(suffixStart);
    return path.replace(/\/+$/, "") + suffix;
}

export function buildShortcutTaskProposal(
    story: ShortcutStoryPayload,
    projectId: string | null = null,
): ShortcutTaskProposal {
    const dueDate = normalizeTaskDueDate(story.deadline);
    return {
        title: story.name,
        projectId,
        status: "Backlog",
        priority: "Medium",
        ...(dueDate !== undefined ? { dueDate } : {}),
        ...(story.estimate !== null ? { estimatePomos: shortcutPointsToPomodoros(story.estimate) } : {}),
        description: story.description,
        tags: [story.story_type],
        links: [story.app_url],
        checklist: [],
        relatedTo: [],
    };
}

function classifyShortcutStoriesInput(input: ClassifyShortcutStoriesInput): ShortcutClassificationResult {
    const existingLinks = new Set(
        input.currentTasks.flatMap((task) => task.links.map(normalizeShortcutUrl)),
    );
    const includedStatuses = new Set(input.includedStatuses);
    const counts: ShortcutClassificationCounts = {
        new: 0,
        skippedAlreadyAdded: 0,
        skippedStatusNotIncluded: 0,
        skippedArchived: 0,
    };
    const proposals: ShortcutTaskProposal[] = [];

    for (const story of input.stories) {
        if (existingLinks.has(normalizeShortcutUrl(story.app_url))) {
            counts.skippedAlreadyAdded += 1;
            continue;
        }
        if (!includedStatuses.has(story.status_name)) {
            counts.skippedStatusNotIncluded += 1;
            continue;
        }
        if (story.archived) {
            counts.skippedArchived += 1;
            continue;
        }
        counts.new += 1;
        proposals.push(buildShortcutTaskProposal(story, input.defaultProjectId));
    }

    return { proposals, counts };
}

export function classifyShortcutStories(input: ClassifyShortcutStoriesInput): ShortcutClassificationResult;
export function classifyShortcutStories(
    stories: readonly ShortcutStoryPayload[],
    currentTasks: readonly PMTask[],
    includedStatuses: readonly string[],
    defaultProjectId?: string | null,
): ShortcutClassificationResult;
export function classifyShortcutStories(
    inputOrStories: ClassifyShortcutStoriesInput | readonly ShortcutStoryPayload[],
    currentTasks?: readonly PMTask[],
    includedStatuses?: readonly string[],
    defaultProjectId?: string | null,
): ShortcutClassificationResult {
    const input: ClassifyShortcutStoriesInput = Array.isArray(inputOrStories)
        ? {
            stories: inputOrStories,
            currentTasks: currentTasks ?? [],
            includedStatuses: includedStatuses ?? [],
            defaultProjectId: defaultProjectId ?? null,
        }
        : inputOrStories as ClassifyShortcutStoriesInput;
    return classifyShortcutStoriesInput(input);
}
