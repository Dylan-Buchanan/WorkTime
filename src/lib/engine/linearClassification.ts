import type { PMTask, TaskPriority, TaskStatus } from "../../state/types";
import { normalizeTaskDueDate } from "../taskDueDate";

/** The slim issue shape returned by the linear-sync Edge Function. */
export interface LinearIssuePayload {
    id: string;
    identifier: string;
    title: string;
    description: string;
    url: string;
    dueDate: string | null;
    priority: number;
    state: { name: string };
}

/**
 * The PMTask fields needed by the preview and the existing createTask path.
 *
 * Linear does not expose an estimate in the sync payload, so `estimatePomos` is
 * never set here. `createTask` still assigns its own fallback estimate to the
 * persisted timer/PM task today; this proposal deliberately carries none.
 */
export interface LinearTaskProposal {
    title: string;
    projectId: string | null;
    status: TaskStatus;
    priority: TaskPriority;
    dueDate?: string;
    description: string;
    tags: string[];
    links: string[];
    checklist: PMTask["checklist"];
    relatedTo: string[];
}

export interface LinearClassificationCounts {
    new: number;
    skippedAlreadyAdded: number;
    skippedStatusNotIncluded: number;
}

export interface LinearClassificationResult {
    proposals: LinearTaskProposal[];
    counts: LinearClassificationCounts;
    /** Total issues in the sync payload, used to explain empty results. */
    totalIssues: number;
}

export interface ClassifyLinearIssuesInput {
    issues: readonly LinearIssuePayload[];
    currentTasks: readonly PMTask[];
    includedStatuses: readonly string[];
    defaultProjectId: string | null;
}

/** Prefix used for the durable, visible Linear identity tag on imported tasks. */
export const LINEAR_TAG_PREFIX = "linear:";

/**
 * Map Linear's integer priority scale to WorkTime's three-value scale.
 *
 * This mapping is intentionally lossy: `TaskPriority` is only Low | Medium |
 * High, so Urgent (1) and High (2) both collapse onto High, while "No priority"
 * (0) falls back to Medium. Do not "fix" this without widening TaskPriority.
 */
export function linearPriorityToTaskPriority(priority: number): TaskPriority {
    switch (priority) {
        case 1:
        case 2:
            return "High";
        case 3:
            return "Medium";
        case 4:
            return "Low";
        default:
            return "Medium";
    }
}

/** The identifier-shaped tag used for tag-first deduplication. */
export function linearIssueTag(identifier: string): string {
    return `${LINEAR_TAG_PREFIX}${identifier}`;
}

/**
 * Normalize a Linear issue URL for deduplication.
 *
 * Linear issue URLs are `https://linear.app/<workspace>/issue/<IDENTIFIER>/<slug>`.
 * The trailing slug is presentation-only and can change independently of the
 * issue, so it is removed before comparison. Whitespace, trailing slashes and
 * the fragment/query suffix are handled the same way as the other integrations.
 */
export function normalizeLinearUrl(value: string): string {
    const trimmed = value.trim();
    const suffixStart = trimmed.search(/[?#]/);
    const path = suffixStart === -1 ? trimmed : trimmed.slice(0, suffixStart);
    const suffix = suffixStart === -1 ? "" : trimmed.slice(suffixStart);
    const withoutTrailingSlash = path.replace(/\/+$/, "");
    const issuePath = /^(.*\/issue\/[^/]+)(?:\/.*)?$/.exec(withoutTrailingSlash);
    return (issuePath ? issuePath[1] : withoutTrailingSlash) + suffix;
}

export function buildLinearTaskProposal(
    issue: LinearIssuePayload,
    projectId: string | null = null,
): LinearTaskProposal {
    const dueDate = normalizeTaskDueDate(issue.dueDate);
    return {
        title: issue.title,
        projectId,
        status: "Backlog",
        priority: linearPriorityToTaskPriority(issue.priority),
        ...(dueDate !== undefined ? { dueDate } : {}),
        description: issue.description,
        // Tag first so a re-import is recognised even if the URL slug changed.
        tags: [linearIssueTag(issue.identifier)],
        links: [issue.url],
        checklist: [],
        relatedTo: [],
    };
}

/**
 * Explain why a sync produced no proposals. The payload has no per-reason
 * counts, so the message is derived from the payload size and the counters.
 */
export function describeLinearEmptyResult(result: LinearClassificationResult): string | null {
    if (result.proposals.length > 0) return null;
    if (result.totalIssues === 0) {
        return "No Linear issues are assigned to you in this sync's scope.";
    }
    const alreadyAdded = result.counts.skippedAlreadyAdded;
    const statusNotIncluded = result.counts.skippedStatusNotIncluded;
    if (alreadyAdded > 0 && statusNotIncluded > 0) {
        return "Every assigned issue was either already imported or excluded by your included statuses.";
    }
    if (alreadyAdded >= result.totalIssues) {
        return "Every assigned issue was already imported.";
    }
    if (statusNotIncluded >= result.totalIssues) {
        return "No assigned issues matched your included statuses.";
    }
    return "No new tasks to create.";
}

export function classifyLinearIssues(input: ClassifyLinearIssuesInput): LinearClassificationResult {
    const existingTags = new Set(input.currentTasks.flatMap((task) => task.tags));
    const existingLinks = new Set(
        input.currentTasks.flatMap((task) => task.links.map(normalizeLinearUrl)),
    );
    // A blank team key syncs every accessible team, so one global status-name
    // list may not span all of them. The card surfaces discovered state names
    // as hints for exactly that case.
    const includedStatuses = new Set(input.includedStatuses);
    const counts: LinearClassificationCounts = {
        new: 0,
        skippedAlreadyAdded: 0,
        skippedStatusNotIncluded: 0,
    };
    const proposals: LinearTaskProposal[] = [];

    // Linear hides archived issues at query time (`includeArchived: false`), so
    // this slice deliberately has no archived-skip counter.
    for (const issue of input.issues) {
        // Tag-first dedupe: an issue moved between Linear teams changes its
        // identifier (ENG-123 -> PLAT-88) and therefore imports as a duplicate.
        // That is accepted; do not add a fallback identity without a decision.
        if (existingTags.has(linearIssueTag(issue.identifier))) {
            counts.skippedAlreadyAdded += 1;
            continue;
        }
        const normalizedUrl = normalizeLinearUrl(issue.url);
        if (existingLinks.has(normalizedUrl)) {
            counts.skippedAlreadyAdded += 1;
            continue;
        }
        if (!includedStatuses.has(issue.state.name)) {
            counts.skippedStatusNotIncluded += 1;
            continue;
        }
        counts.new += 1;
        existingTags.add(linearIssueTag(issue.identifier));
        existingLinks.add(normalizedUrl);
        proposals.push(buildLinearTaskProposal(issue, input.defaultProjectId));
    }

    return { proposals, counts, totalIssues: input.issues.length };
}
