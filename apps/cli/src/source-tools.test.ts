import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bundleModule, sourcePackage } from './source-tools';

describe('add_source_type', () => {
    it('recognises a file that belongs to a source package, so the package is installed instead', async () => {
        const owner = await sourcePackage(
            resolve(import.meta.dirname, '../../../packages/telegram/src'),
        );
        expect(owner?.name).toBe('@sedge-hq/telegram');
    });

    it('bundles a module with the files it imports, leaving nothing to resolve later', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'sedge-type-test-'));
        await writeFile(
            join(dir, 'helper.ts'),
            "export const greeting = 'hello from the helper';\n",
        );
        await writeFile(
            join(dir, 'source.ts'),
            "import { greeting } from './helper';\nexport const type = { summary: greeting, options: { type: 'object', properties: {} } };\nexport default () => {};\n",
        );
        expect(await sourcePackage(dir)).toBeUndefined();
        const bundled = await bundleModule(join(dir, 'source.ts'));
        if ('error' in bundled) throw new Error(bundled.error);
        expect(bundled.code).toContain('hello from the helper');
        expect(bundled.code).not.toContain("from './helper'");
    }, 30_000);
});
