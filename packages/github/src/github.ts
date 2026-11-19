import { defineSignal, field, type Happening, secret } from '@sedge-hq/kit';
import { github, since } from './api';

interface Search {
    readonly items: ReadonlyArray<{
        readonly number: number;
        readonly title: string;
        readonly html_url: string;
        readonly updated_at: string;
        readonly pull_request?: unknown;
        readonly user?: { readonly login: string };
        readonly repository_url: string;
    }>;
}

const WHAT = ['reviews', 'assigned', 'mentions'] as const;
const repoOf = (url: string) => url.split('/repos/')[1] ?? url;

/**
 * What GitHub wants from you: pull requests waiting for your review, issues and pull requests
 * assigned to you, and where you're mentioned.
 */
export default defineSignal({
    name: 'github',
    summary: 'pull requests waiting for your review, issues and PRs assigned to you, and mentions',
    settings: {
        token: secret('A GitHub token that can read the repositories you care about.'),
        watch: field.optional(
            field.list('What to tell you about: reviews, assigned, mentions. Default: all three.'),
        ),
        repos: field.optional(
            field.list('Only these repositories (owner/name). Default: all of yours.'),
        ),
        api: field.optional(
            field.text('The GitHub API address, for GitHub Enterprise. Default: api.github.com.'),
        ),
    },
    every: '2 minutes',
    check: async ({ token, watch, repos, api }, kit) => {
        const after = await since(kit);
        const get = github(kit, token, api);
        const wanted = new Set(watch?.length ? watch : WHAT);
        // Only what changed since this signal was connected: connecting it doesn't replay what's open.
        const scope = `${repos?.length ? ` ${repos.map((r) => `repo:${r}`).join(' ')}` : ''} updated:>${after}`;
        const search = (q: string) =>
            get<Search>(
                `/search/issues?${new URLSearchParams({ q: `${q}${scope}`, sort: 'updated', per_page: '30' }).toString()}`,
            );

        const found: Array<Happening> = [];
        if (wanted.has('reviews')) {
            for (const pr of (await search('is:open is:pr review-requested:@me')).items) {
                found.push({
                    text: `${pr.user?.login ?? 'Someone'} asks for your review: ${pr.title} (${repoOf(pr.repository_url)}#${pr.number})`,
                    key: `review:${pr.html_url}`,
                    details: { url: pr.html_url },
                });
            }
        }
        if (wanted.has('assigned')) {
            for (const item of (await search('is:open assignee:@me')).items) {
                found.push({
                    text: `Assigned to you: ${item.title} (${repoOf(item.repository_url)}#${item.number})`,
                    key: `assigned:${item.html_url}`,
                    details: { url: item.html_url, pullRequest: Boolean(item.pull_request) },
                });
            }
        }
        if (wanted.has('mentions')) {
            for (const item of (await search('mentions:@me')).items) {
                found.push({
                    text: `You're mentioned in ${item.title} (${repoOf(item.repository_url)}#${item.number})`,
                    key: `mention:${item.html_url}:${item.updated_at}`,
                    details: { url: item.html_url },
                });
            }
        }
        kit.status(`watching ${[...wanted].join(', ')}`);
        return found;
    },
});
