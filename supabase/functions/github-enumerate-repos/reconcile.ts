export interface StoredGitHubRepo {
    full_name: string;
    is_stale: boolean;
}

export interface GitHubRepoReconciliation {
    seeded: string[];
    reappearing: string[];
    current: string[];
    missing: string[];
}

export interface GitHubRepoUpsert {
    owner_id: string;
    full_name: string;
    is_stale: false;
}

export function githubRepoUpserts(ownerId: string, accessibleFullNames: string[]): GitHubRepoUpsert[] {
    // Omitted preference columns use their defaults for inserts and remain untouched
    // on conflicts. In particular, new rows default to selected=true.
    return [...new Set(accessibleFullNames)].map((fullName) => ({
        owner_id: ownerId,
        full_name: fullName,
        is_stale: false,
    }));
}

export function reconcileGitHubRepos(
    stored: StoredGitHubRepo[],
    accessibleFullNames: string[],
): GitHubRepoReconciliation {
    const existing = new Map(stored.map((repo) => [repo.full_name, repo]));
    const accessible = [...new Set(accessibleFullNames)];
    const accessibleSet = new Set(accessible);

    return {
        seeded: accessible.filter((fullName) => !existing.has(fullName)),
        reappearing: accessible.filter((fullName) => existing.get(fullName)?.is_stale === true),
        current: accessible.filter((fullName) => existing.get(fullName)?.is_stale === false),
        missing: stored
            .map((repo) => repo.full_name)
            .filter((fullName) => !accessibleSet.has(fullName)),
    };
}
