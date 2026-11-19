#!/usr/bin/env node
// The `sedge` npm package is this launcher plus one optional dependency per platform holding the
// compiled binary (see scripts/build.ts). npm installs only the one matching this machine.
const { spawnSync } = require('node:child_process');
const { dirname, join } = require('node:path');

const os = process.platform === 'win32' ? 'windows' : process.platform;
const pkg = `@sedge-hq/sedge-${os}-${process.arch}`;
const exe = process.platform === 'win32' ? 'sedge.exe' : 'sedge';

let binary;
try {
    binary = join(dirname(require.resolve(`${pkg}/package.json`)), 'bin', exe);
} catch {
    console.error(`sedge: no prebuilt binary for ${os}-${process.arch} (${pkg} is not installed).`);
    process.exit(1);
}

const result = spawnSync(binary, process.argv.slice(2), { stdio: 'inherit' });
if (result.error) {
    console.error(`sedge: ${result.error.message}`);
    process.exit(1);
}
process.exit(result.status ?? (result.signal ? 1 : 0));
