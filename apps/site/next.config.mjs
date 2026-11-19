import { createMDX } from 'fumadocs-mdx/next';
import { fileURLToPath } from 'node:url';

const withMDX = createMDX();

/**
 * sedge.sh: the home page and the docs (from the repository's docs/ folder), exported as static
 * files that the Worker in worker.ts serves next to the `curl sedge.sh | sh` installer.
 */
/** @type {import('next').NextConfig} */
const config = {
    output: 'export',
    reactStrictMode: true,
    images: { unoptimized: true },
    // The workspace root, where the packages this app imports from live.
    turbopack: { root: fileURLToPath(new URL('../..', import.meta.url)) },
};

export default withMDX(config);
