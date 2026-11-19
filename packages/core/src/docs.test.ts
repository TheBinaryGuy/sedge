import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SedgeConfig } from './config';

const root = join(import.meta.dirname, '../../..');
const page = () => readFile(join(root, 'docs/configuration.md'), 'utf8');

/** Variables only sedge sets for itself, or tests use. */
const INTERNAL = new Set(['SEDGE_SUPERVISED', 'SEDGE_REPLACES_PID', 'SEDGE_TEST_MCP_LOG']);

const sources = async (dir: string): Promise<Array<string>> => {
    const entries = await readdir(dir, { withFileTypes: true });
    const nested = await Promise.all(
        entries.map((entry) => {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) {
                return entry.name === 'node_modules' ? Promise.resolve([]) : sources(path);
            }
            const source = entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts');
            return Promise.resolve(source ? [path] : []);
        }),
    );
    return nested.flat();
};

/** The docs must keep up: every setting and environment variable is documented. */
describe('docs/configuration.md', () => {
    it('documents every setting in config.json', async () => {
        const text = await page();
        for (const key of Object.keys(SedgeConfig.fields)) expect(text, key).toContain(`\`${key}`);
        for (const key of ['bash', 'write', 'mcp'])
            expect(text, key).toContain(`\`permissions.${key}\``);
    });

    it('documents every environment variable sedge reads', async () => {
        const files = [
            ...(await sources(join(root, 'apps/cli/src'))),
            ...(await sources(join(root, 'packages'))),
        ];
        const used = new Set<string>();
        for (const file of files) {
            for (const match of (await readFile(file, 'utf8')).matchAll(
                /process\.env\.(SEDGE_\w+)/g,
            )) {
                used.add(match[1]!);
            }
        }
        const text = await page();
        expect(used.size).toBeGreaterThan(3);
        for (const name of used)
            if (!INTERNAL.has(name)) expect(text, name).toContain(`\`${name}\``);
    });
});
