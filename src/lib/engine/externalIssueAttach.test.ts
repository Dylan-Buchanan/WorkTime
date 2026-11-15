import { describe, expect, it } from "vitest";
import type { PMTask } from "../../state/types";
import {
    externalIssueAttachPatch,
    githubIssueCandidate,
    hasExternalIssueReference,
    isExternalIssueAttachedElsewhere,
    linearIssueCandidate,
    shortcutStoryCandidate,
} from "./externalIssueAttach";
import { buildGithubTaskProposal, type GithubIssuePayload } from "./githubClassification";
import { buildLinearTaskProposal, type LinearIssuePayload } from "./linearClassification";
import { buildShortcutTaskProposal, type ShortcutStoryPayload } from "./shortcutClassification";

const github: GithubIssuePayload = {
    number: 7, title: "GitHub issue", html_url: "https://github.com/acme/work/issues/7",
    state: "open", closed: false, labels: [],
};
const linear: LinearIssuePayload = {
    id: "l1", identifier: "ENG-123", title: "Linear issue", description: "",
    url: "https://linear.app/acme/issue/ENG-123/first-slug", dueDate: null, priority: 2,
    state: { name: "Todo" },
};
const shortcut: ShortcutStoryPayload = {
    id: 9, name: "Shortcut story", app_url: "https://app.shortcut.com/acme/story/9/story-slug",
    description: "", estimate: null, deadline: null, workflow_state_id: 1, status_name: "Todo",
    completed: false, archived: false, story_type: "bug", labels: [],
};

const task: PMTask = {
    id: "task", title: "WorkTime task", projectId: null, status: "Backlog", priority: "Medium",
    timeSpentMinutes: 0, tags: [], links: [], checklist: [], sortOrder: 0, isArchived: false,
    createdAt: "", updatedAt: "", relatedTo: [],
};

const linearCandidate = linearIssueCandidate(linear);
const githubCandidate = githubIssueCandidate(github, "acme/work");
const shortcutCandidate = shortcutStoryCandidate(shortcut);

describe("external issue attachment", () => {
    it.each([
        [linearCandidate, buildLinearTaskProposal(linear), " https://linear.app/acme/issue/ENG-123/updated-slug/ "],
        [githubCandidate, buildGithubTaskProposal(github, null, "acme/work"), ` ${github.html_url}/ `],
        [shortcutCandidate, buildShortcutTaskProposal(shortcut), ` ${shortcut.app_url}/ `],
    ] as const)("matches the $0.provider import representation and duplicate identity", (candidate, proposal, copiedLink) => {
        expect(externalIssueAttachPatch(task, candidate)).toEqual({ links: proposal.links, tags: proposal.tags });
        const archived = { ...task, isArchived: true, links: [copiedLink] };
        expect(isExternalIssueAttachedElsewhere([archived], candidate)).toBe(true);
        expect(isExternalIssueAttachedElsewhere([archived], candidate, archived.id)).toBe(false);
        expect(externalIssueAttachPatch(archived, candidate).links).toBe(archived.links);
    });

    it.each([
        [linearCandidate, githubCandidate],
        [githubCandidate, shortcutCandidate],
        [shortcutCandidate, linearCandidate],
    ] as const)("replaces the $0.provider reference with a $1.provider issue while keeping unrelated links and tags", (previous, next) => {
        const unrelated = ["https://github.com/acme/work/pull/7", "https://other.example/issue/ENG-123"];
        const linked = { ...task, links: [previous.url, ...unrelated], tags: [previous.tag, "chore", "linear:ENG-999"] };
        expect(hasExternalIssueReference(linked)).toBe(true);
        expect(hasExternalIssueReference({ ...linked, links: unrelated })).toBe(false);
        expect(externalIssueAttachPatch(linked, next, [shortcutCandidate])).toEqual({
            links: [...unrelated, next.url],
            tags: ["chore", "linear:ENG-999", next.tag],
        });
    });

    it("keeps a Shortcut type tag when the old story is outside the retained payload", () => {
        const linked = { ...task, links: [shortcut.app_url], tags: ["bug", "manual-tag", linearCandidate.tag] };
        expect(externalIssueAttachPatch(linked, linearCandidate)).toEqual({
            links: [linear.url],
            tags: ["bug", "manual-tag", linearCandidate.tag],
        });
    });
});
