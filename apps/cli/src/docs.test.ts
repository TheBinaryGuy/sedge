import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { registerAgentTools } from './agent-tools';
import { registerConnectionTools } from './connection-tools';

const docs = (page: string) => readFile(join(import.meta.dirname, '../../../docs', page), 'utf8');

/** The docs must keep up: anything a user can run or ask for is documented. */
describe('docs/commands.md', () => {
    it('lists every tool the TUI’s agent has', async () => {
        const names: Array<string> = [];
        const pi = {
            registerTool: (tool: { name: string }) => names.push(tool.name),
        } as unknown as ExtensionAPI;
        const unused = () => Promise.reject(new Error('unused'));
        registerConnectionTools(pi, unused);
        registerAgentTools(pi, unused);
        const page = await docs('commands.md');
        expect(names.length).toBeGreaterThan(0);
        for (const name of names) expect(page, name).toContain(`\`${name}\``);
    });

    it('lists every command of the sedge command line', async () => {
        const main = await readFile(join(import.meta.dirname, 'main.ts'), 'utf8');
        const help = main.slice(main.indexOf('Usage'), main.indexOf('In the TUI'));
        const commands = [...help.matchAll(/^ {2}sedge (\w+)/gm)].map((m) => m[1]!);
        const page = await docs('commands.md');
        expect(commands.length).toBeGreaterThan(3);
        for (const command of commands) expect(page, command).toContain(`\`sedge ${command}`);
    });
});
