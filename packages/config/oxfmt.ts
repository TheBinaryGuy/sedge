import { defineConfig } from 'oxfmt';

export default defineConfig({
    printWidth: 100,
    tabWidth: 4,
    semi: true,
    singleQuote: true,
    trailingComma: 'all',
    ignorePatterns: [
        '**/node_modules/**',
        '**/dist/**',
        '**/.turbo/**',
        '**/*.gen.ts',
        '**/drizzle/**/snapshot.json',
        '.changeset/*.md',
        'CHANGELOG.md',
        'bun.lock',
    ],
});
