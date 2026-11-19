/**
 * Where Sedge is published. The CLI is a small launcher package that depends on one package per
 * platform holding the compiled binary. `apps/cli/bin/sedge.js` and `scripts/install.sh` run
 * without this module and spell the same names out; keep them in step.
 */
export const NPM_SCOPE = '@sedge-hq';
export const CLI_PACKAGE = `${NPM_SCOPE}/sedge`;
export const REPOSITORY = 'sedge-hq/sedge';

export type Os = 'darwin' | 'linux' | 'windows';

export const platformPackage = (os: string, cpu: string) => `${NPM_SCOPE}/sedge-${os}-${cpu}`;

export const hostPlatformPackage = () =>
    platformPackage(process.platform === 'win32' ? 'windows' : process.platform, process.arch);

/** The registry path of a package: scoped names keep their `@` and escape the slash. */
export const registryPath = (name: string) => name.replace('/', '%2f');
