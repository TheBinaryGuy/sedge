import type { Happening } from '@sedge-hq/kit';
import { describe, expect, it } from 'vitest';
import ci from './ci';
import github from './github';

const fakeHost = (memo: Record<string, string>) => {
    const happened: Array<Happening> = [];
    return {
        happened,
        host: {
            status: () => {},
            memoGet: async (key: string) => memo[key],
            memoSet: async (key: string, value: string) => void (memo[key] = value),
            happened: async (h: Happening) => void happened.push(h),
            received: async () => {},
            claim: async () => false,
        },
    };
};

const until = async (check: () => boolean) => {
    for (let i = 0; i < 300 && !check(); i++) await Bun.sleep(10);
};

describe('github-ci', () => {
    it('reports runs that failed after it was connected, not the ones before', async () => {
        const asked: Array<string> = [];
        const server = Bun.serve({
            port: 0,
            fetch: (request) => {
                asked.push(
                    `${new URL(request.url).pathname}?${new URL(request.url).search} ${request.headers.get('authorization')}`,
                );
                return Response.json({
                    workflow_runs: [
                        {
                            id: 1,
                            name: 'lint',
                            html_url: 'https://gh/1',
                            head_branch: 'main',
                            conclusion: 'failure',
                            updated_at: '2026-11-01T00:00:00Z',
                        },
                        {
                            id: 2,
                            name: 'e2e',
                            display_title: 'fix the parser',
                            html_url: 'https://gh/2',
                            head_branch: 'main',
                            conclusion: 'failure',
                            updated_at: '2026-11-19T10:00:00Z',
                            actor: { login: 'ann' },
                        },
                    ],
                });
            },
        });
        const { host, happened } = fakeHost({ since: '2026-11-18T00:00:00Z' });
        const running = ci.start(
            { repo: 'me/app', branch: 'main', token: 't0k', api: server.url.origin },
            host,
        );
        await until(() => happened.length > 0);
        await running.stop();
        void server.stop(true);
        expect(happened[0]).toEqual({
            text: 'CI failed on main of me/app: e2e (fix the parser)',
            key: '2',
            details: { url: 'https://gh/2', by: 'ann' },
        });
        expect(happened.some((h) => h.key === '1')).toBe(false);
        expect(asked[0]).toContain('/repos/me/app/actions/runs');
        expect(asked[0]).toContain('branch=main');
        expect(asked[0]).toContain('Bearer t0k');
    });
});

describe('github', () => {
    it('tells you about reviews, assignments and mentions in your repos since it was connected', async () => {
        const queries: Array<string> = [];
        const server = Bun.serve({
            port: 0,
            fetch: (request) => {
                const q = new URL(request.url).searchParams.get('q') ?? '';
                queries.push(q);
                const item = {
                    number: 7,
                    title: 'Faster startup',
                    html_url: 'https://gh/pr/7',
                    updated_at: '2026-11-19T09:00:00Z',
                    user: { login: 'ann' },
                    repository_url: 'https://api.github.com/repos/me/app',
                    pull_request: {},
                };
                return Response.json({ items: q.includes('review-requested') ? [item] : [] });
            },
        });
        const { host, happened } = fakeHost({ since: '2026-11-18T00:00:00Z' });
        const running = github.start(
            { token: 't', repos: ['me/app'], api: server.url.origin },
            host,
        );
        await until(() => happened.length > 0);
        await running.stop();
        void server.stop(true);
        expect(happened[0]?.text).toBe('ann asks for your review: Faster startup (me/app#7)');
        expect(queries).toEqual([
            'is:open is:pr review-requested:@me repo:me/app updated:>2026-11-18T00:00:00Z',
            'is:open assignee:@me repo:me/app updated:>2026-11-18T00:00:00Z',
            'mentions:@me repo:me/app updated:>2026-11-18T00:00:00Z',
        ]);
    });
});
