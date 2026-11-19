import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bundleModule, kitPackage } from './connection-tools';

describe('create_signal', () => {
    it('recognises a file that belongs to a package of channels and signals, so the package is installed instead', async () => {
        const owner = await kitPackage(
            resolve(import.meta.dirname, '../../../packages/telegram/src'),
        );
        expect(owner?.name).toBe('@sedge-hq/telegram');
    });

    it('bundles a module with the files it imports, leaving nothing to resolve later', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'sedge-kind-test-'));
        await writeFile(
            join(dir, 'helper.ts'),
            "export const greeting = 'hello from the helper';\n",
        );
        await writeFile(
            join(dir, 'signal.ts'),
            "import { greeting } from './helper';\nexport default { sedge: 1, kind: 'signal', name: 'hello', summary: greeting };\n",
        );
        expect(await kitPackage(dir)).toBeUndefined();
        const bundled = await bundleModule(join(dir, 'signal.ts'));
        if ('error' in bundled) throw new Error(bundled.error);
        expect(bundled.code).toContain('hello from the helper');
        expect(bundled.code).not.toContain("from './helper'");
    }, 30_000);
});
