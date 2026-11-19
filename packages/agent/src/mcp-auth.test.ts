import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openMcp } from './mcp';
import { hasSignedIn, mcpAuthStore } from './mcp-auth';

describe('MCP sign-ins shared with the TUI', () => {
    it('reads a sign-in pi stored, under pi’s key for the server', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'sedge-mcp-auth-'));
        await writeFile(
            join(dir, 'mcp-auth.json'),
            JSON.stringify({
                'mcp__linear|https://mcp.linear.app/mcp': {
                    serverUrl: 'https://mcp.linear.app/mcp',
                    tokens: { access_token: 'a' },
                },
            }),
        );
        expect(hasSignedIn(dir, 'linear', 'https://mcp.linear.app/mcp')).toBe(true);
        expect(hasSignedIn(dir, 'sentry', 'https://mcp.sentry.dev/mcp')).toBe(false);
    });

    it('never runs two refreshes of one server at once', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'sedge-mcp-auth-'));
        const store = mcpAuthStore(dir)('linear', 'https://mcp.linear.app/mcp');
        const order: Array<string> = [];
        const refresh = (name: string) =>
            store.withRefreshLock(async () => {
                order.push(`${name} starts`);
                await Bun.sleep(150);
                order.push(`${name} ends`);
            });
        await Promise.all([refresh('one'), refresh('two')]);
        expect(order).toEqual(['one starts', 'one ends', 'two starts', 'two ends']);
    });

    it('tells you to sign in, for an OAuth server nobody signed in to', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'sedge-mcp-auth-'));
        const file = join(dir, 'mcp.json');
        await writeFile(
            file,
            JSON.stringify({ mcpServers: { linear: { url: 'https://mcp.linear.app/mcp' } } }),
        );
        const mcp = await openMcp({ file, cwd: dir, version: 'test' });
        expect(mcp.states).toEqual([
            {
                name: 'linear',
                status: 'not signed in: run /mcp in sedge to sign in, then sedge stop && sedge start',
            },
        ]);
        await mcp.close();
    });
});
