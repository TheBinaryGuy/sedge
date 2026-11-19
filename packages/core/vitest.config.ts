import { defineConfig } from 'vitest/config';

/* Tests run on Bun (`bun --bun vitest`) for bun:sqlite; Bun's child processes lack the IPC the forks pool needs. */
export default defineConfig({
    test: { include: ['src/**/*.test.ts'], pool: 'threads' },
});
