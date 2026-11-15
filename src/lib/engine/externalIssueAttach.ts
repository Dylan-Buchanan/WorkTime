import type { PMTask } from "../../state/types";
import { normalizeGithubIssueUrl, type GithubIssuePayload } from "./githubClassification";
import { linearIssueTag, normalizeLinearUrl, type LinearIssuePayload } from "./linearClassification";
import { normalizeShortcutUrl, type ShortcutStoryPayload } from "./shortcutClassification";

export type ExternalIssueProvider = "linear" | "github" | "shortcut";

export interface ExternalIssueCandidate {
    provider: ExternalIssueProvider;
    key: string;
    title: string;
    url: string;
    tag: string;
}

export function linearIssueCandidate(issue: LinearIssuePayload): ExternalIssueCandidate {
    return { provider: "linear", key: issue.identifier, title: issue.title, url: issue.url, tag: linearIssueTag(issue.identifier) };
}

export function githubIssueCandidate(issue: GithubIssuePayload, repoName: string): ExternalIssueCandidate {
    return { provider: "github", key: `#${issue.number}`, title: issue.title, url: issue.html_url, tag: repoName };
}

export function shortcutStoryCandidate(story: ShortcutStoryPayload): ExternalIssueCandidate {
    return { provider: "shortcut", key: `#${story.id}`, title: story.name, url: story.app_url, tag: story.story_type };
}

const normalizeUrl = {
    linear: normalizeLinearUrl,
    github: normalizeGithubIssueUrl,
    shortcut: normalizeShortcutUrl,
};

const linearIssuePath = /^\/[^/]+\/issue\/([A-Z0-9]+-\d+)(?:\/[^/]+)?\/?$/i;
const githubIssuePath = /^\/([^/]+\/[^/]+)\/issues\/\d+\/?$/;
const shortcutStoryPath = /^\/[^/]+\/story\/\d+(?:\/[^/]+)?\/?$/;

function identifyExternalIssue(link: string): { provider: ExternalIssueProvider; tag?: string } | undefined {
    let url: URL;
    try {
        url = new URL(link);
    } catch {
        return;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return;

    if (url.hostname === "linear.app") {
        const match = linearIssuePath.exec(url.pathname);
        if (match) return { provider: "linear", tag: linearIssueTag(match[1]) };
    }
    if (url.hostname === "github.com") {
        const match = githubIssuePath.exec(url.pathname);
        if (match) return { provider: "github", tag: match[1] };
    }
    if (url.hostname === "app.shortcut.com" && shortcutStoryPath.test(url.pathname)) {
        return { provider: "shortcut" };
    }
}

export function hasExternalIssueReference(task: PMTask): boolean {
    return task.links.some((link) => identifyExternalIssue(link) !== undefined);
}

export function externalIssueAttachPatch(
    task: PMTask,
    candidate: ExternalIssueCandidate,
    knownShortcutStories: readonly ExternalIssueCandidate[] = [],
): Pick<PMTask, "links" | "tags"> {
    const normalize = normalizeUrl[candidate.provider];
    const candidateUrl = normalize(candidate.url);
    if (task.links.some((link) => normalize(link) === candidateUrl)) {
        return { links: task.links, tags: task.tags };
    }

    const previousTags = new Set<string>();
    const links = task.links.filter((link) => {
        const reference = identifyExternalIssue(link);
        if (!reference) return true;
        const previousTag = reference.provider === "shortcut"
            ? knownShortcutStories.find((story) => normalizeShortcutUrl(story.url) === normalizeShortcutUrl(link))?.tag
            : reference.tag;
        if (previousTag) previousTags.add(previousTag.toLowerCase());
        return false;
    });
    const tags = task.tags.filter((tag) => !previousTags.has(tag.toLowerCase()) || tag === candidate.tag);
    links.push(candidate.url);
    if (!tags.includes(candidate.tag)) tags.push(candidate.tag);
    return { links, tags };
}

export function availableExternalIssues(
    tasks: readonly PMTask[],
    candidates: readonly ExternalIssueCandidate[],
    provider: ExternalIssueProvider,
): ExternalIssueCandidate[] {
    const normalize = normalizeUrl[provider];
    const seen = new Set(tasks.flatMap((task) => task.links.map(normalize)));
    return candidates.filter((candidate) => {
        const url = normalize(candidate.url);
        if (seen.has(url)) return false;
        seen.add(url);
        return true;
    });
}

export function isExternalIssueAttachedElsewhere(
    tasks: readonly PMTask[],
    candidate: ExternalIssueCandidate,
    exceptTaskId?: string,
): boolean {
    const normalize = normalizeUrl[candidate.provider];
    const url = normalize(candidate.url);
    return tasks.some((task) => task.id !== exceptTaskId && task.links.some((link) => normalize(link) === url));
}
