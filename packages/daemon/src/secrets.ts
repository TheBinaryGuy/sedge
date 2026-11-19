import type { SedgePaths } from '@sedge-hq/core';
import { createHash } from 'node:crypto';
import { chmod, readFile, rename, writeFile } from 'node:fs/promises';

/**
 * Where tokens and passwords live: the OS keychain (macOS Keychain, libsecret on Linux, Windows
 * Credential Manager) through Bun.secrets. The config only lists which settings are secret; the
 * values never sit in a file sedge or the agent reads. Each sedge home gets its own keychain
 * service, so a dev home and a real install never see each other's secrets.
 *
 * Where there is no keychain (a headless Linux box without a secret service), an owner-only file
 * in the sedge home stands in.
 */
export interface SecretStore {
    readonly get: (name: string) => Promise<string | undefined>;
    readonly set: (name: string, value: string) => Promise<void>;
    readonly delete: (name: string) => Promise<void>;
    /** `keychain` or `file`, for status lines. */
    readonly backend: 'keychain' | 'file';
}

const fileStore = (path: string): SecretStore => {
    const read = async () =>
        JSON.parse(await readFile(path, 'utf8').catch(() => '{}')) as Record<string, string>;
    const write = async (values: Record<string, string>) => {
        const temp = `${path}.${process.pid}.tmp`;
        await writeFile(temp, JSON.stringify(values), { mode: 0o600 });
        await chmod(temp, 0o600);
        await rename(temp, path);
    };
    return {
        backend: 'file',
        get: async (name) => (await read())[name],
        set: async (name, value) => write({ ...(await read()), [name]: value }),
        delete: async (name) => {
            const { [name]: _, ...rest } = await read();
            await write(rest);
        },
    };
};

export const openSecretStore = async (paths: SedgePaths): Promise<SecretStore> => {
    // SEDGE_SECRET_STORE=file skips the keychain: for machines without one, and sandboxes that
    // must not touch yours.
    if (process.env.SEDGE_SECRET_STORE === 'file') return fileStore(paths.secrets);
    const service = `sh.sedge.${createHash('sha256').update(paths.home).digest('hex').slice(0, 12)}`;
    const keychain: SecretStore = {
        backend: 'keychain',
        get: async (name) => (await Bun.secrets.get({ service, name })) ?? undefined,
        set: (name, value) => Bun.secrets.set({ service, name, value }),
        delete: async (name) => {
            await Bun.secrets.delete({ service, name });
        },
    };
    try {
        // A round trip proves a keychain is there and unlocked.
        await keychain.set('sedge.probe', 'ok');
        const ok = (await keychain.get('sedge.probe')) === 'ok';
        await keychain.delete('sedge.probe');
        if (ok) return keychain;
    } catch {
        // No secret service on this machine.
    }
    return fileStore(paths.secrets);
};
