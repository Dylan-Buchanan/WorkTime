import type { PMTask, TaskPriority, TaskStatus } from "../../state/types";

/**
 * The slim issue shape returned by the github-sync Edge Function. The repo
 * identity is not part of the payload: it travels in the sync context
 * (`repoName`) because every issue in a batch belongs to one repository.
 */
export interface GithubIssuePayload {
    number: number;
    title: string;
    html_url: string;
    state: "open" | "closed";
    closed: boolean;
    labels: { name: string }[];
}

/**
 * The PMTask fields needed by the preview and the existing createTask path.
 * GitHub issues carry no points or deadline, so `estimatePomos`/`dueDate` are
 * never set, and imports are description-free by design.
 */
export interface GithubTaskProposal {
    title: string;
    projectId: string | null;
    status: TaskStatus;
    priority: TaskPriority;
    description: string;
    tags: string[];
    links: string[];
    checklist: PMTask["checklist"];
    relatedTo: string[];
}

export interface GithubClassificationCounts {
    new: number;
    skippedAlreadyAdded: number;
    skippedClosed: number;
    skippedLabelNotIncluded: number;
}

export interface GithubClassificationResult {
    proposals: GithubTaskProposal[];
    counts: GithubClassificationCounts;
}

export interface ClassifyGithubIssuesInput {
    issues: readonly GithubIssuePayload[];
    currentTasks: readonly PMTask[];
    /** Tag value applied to every proposal; the sync context uses `owner/repo`. */
    repoName: string;
    /** The repo's default project, still overridable per task in the preview. */
    defaultProjectId: string | null;
    includeClosed: boolean;
    /** When set, only issues carrying this label are classified as new. */
    labelFilter?: string | null;
}

/**
 * Normalize a GitHub issue URL for deduplication without changing meaningful
 * URL components. Copied issue URLs may carry surrounding whitespace or a
 * trailing slash, while path and query differences remain significant.
 */
export function normalizeGithubIssueUrl(value: string): string {
    const trimmed = value.trim();
    const suffixStart = trimmed.search(/[?#]/);
    const path = suffixStart === -1 ? trimmed : trimmed.slice(0, suffixStart);
    const suffix = suffixStart === -1 ? "" : trimmed.slice(suffixStart);
    return path.replace(/\/+$/, "") + suffix;
}

export function buildGithubTaskProposal(
    issue: GithubIssuePayload,
    projectId: string | null = null,
    repoName = "",
): GithubTaskProposal {
    return {
        title: issue.title,
        projectId,
        status: "Backlog",
        priority: "Medium",
        description: "",
        tags: [repoName],
        links: [issue.html_url],
        checklist: [],
        relatedTo: [],
    };
}

function isClosedIssue(issue: GithubIssuePayload): boolean {
    return issue.closed || issue.state === "closed";
}

function matchesLabelFilter(issue: GithubIssuePayload, labelFilter: string): boolean {
    return issue.labels.some((label) => label.name === labelFilter);
}

function classifyGithubIssuesInput(input: ClassifyGithubIssuesInput): GithubClassificationResult {
    const existingLinks = new Set(
        input.currentTasks.flatMap((task) => task.links.map(normalizeGithubIssueUrl)),
    );
    const labelFilter = typeof input.labelFilter === "string" && input.labelFilter !== ""
        ? input.labelFilter
        : null;
    const counts: GithubClassificationCounts = {
        new: 0,
        skippedAlreadyAdded: 0,
        skippedClosed: 0,
        skippedLabelNotIncluded: 0,
    };
    const proposals: GithubTaskProposal[] = [];

    for (const issue of input.issues) {
        const normalizedUrl = normalizeGithubIssueUrl(issue.html_url);
        if (existingLinks.has(normalizedUrl)) {
            counts.skippedAlreadyAdded += 1;
            continue;
        }
        if (!input.includeClosed && isClosedIssue(issue)) {
            counts.skippedClosed += 1;
            continue;
        }
        if (labelFilter !== null && !matchesLabelFilter(issue, labelFilter)) {
            counts.skippedLabelNotIncluded += 1;
            continue;
        }
        counts.new += 1;
        existingLinks.add(normalizedUrl);
        proposals.push(buildGithubTaskProposal(issue, input.defaultProjectId, input.repoName));
    }

    return { proposals, counts };
}

export function classifyGithubIssues(input: ClassifyGithubIssuesInput): GithubClassificationResult;
export function classifyGithubIssues(
    issues: readonly GithubIssuePayload[],
    currentTasks: readonly PMTask[],
    repoName: string,
    defaultProjectId?: string | null,
    includeClosed?: boolean,
    labelFilter?: string | null,
): GithubClassificationResult;
export function classifyGithubIssues(
    inputOrIssues: ClassifyGithubIssuesInput | readonly GithubIssuePayload[],
    currentTasks?: readonly PMTask[],
    repoName?: string,
    defaultProjectId?: string | null,
    includeClosed?: boolean,
    labelFilter?: string | null,
): GithubClassificationResult {
    const input: ClassifyGithubIssuesInput = Array.isArray(inputOrIssues)
        ? {
            issues: inputOrIssues,
            currentTasks: currentTasks ?? [],
            repoName: repoName ?? "",
            defaultProjectId: defaultProjectId ?? null,
            includeClosed: includeClosed ?? false,
            labelFilter: labelFilter ?? null,
        }
        : inputOrIssues as ClassifyGithubIssuesInput;
    return classifyGithubIssuesInput(input);
}
