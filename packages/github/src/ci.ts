import { defineSignal, field, secret } from '@sedge-hq/kit';
import { github, since } from './api';

interface Runs {
    readonly workflow_runs: ReadonlyArray<{
        readonly id: number;
        readonly name: string | null;
        readonly display_title?: string;
        readonly html_url: string;
        readonly head_branch: string | null;
        readonly conclusion: string | null;
        readonly updated_at: string;
        readonly actor?: { readonly login: string };
    }>;
}

/** GitHub Actions runs that fail: "CI failed on main: lint (fix the parser)". */
export default defineSignal({
    name: 'github-ci',
    summary: 'GitHub Actions runs that fail on a branch',
    settings: {
        repo: field.text('The repository, as owner/name.'),
        branch: field.optional(field.text('The branch to watch. Default: every branch.')),
        token: secret('A GitHub token that can read the repository’s Actions.'),
        api: field.optional(
            field.text('The GitHub API address, for GitHub Enterprise. Default: api.github.com.'),
        ),
    },
    every: '1 minute',
    check: async ({ repo, branch, token, api }, kit) => {
        const after = await since(kit);
        const query = new URLSearchParams({ status: 'failure', per_page: '20' });
        if (branch) query.set('branch', branch);
        const { workflow_runs } = await github(
            kit,
            token,
            api,
        )<Runs>(`/repos/${repo}/actions/runs?${query.toString()}`);
        kit.status(`watching ${repo}${branch ? ` (${branch})` : ''}`);
        return workflow_runs
            .filter((run) => run.updated_at > after)
            .map((run) => ({
                text: `CI failed on ${run.head_branch ?? 'a branch'} of ${repo}: ${run.name ?? 'a workflow'}${run.display_title ? ` (${run.display_title})` : ''}`,
                key: String(run.id),
                details: { url: run.html_url, by: run.actor?.login },
            }));
    },
});
