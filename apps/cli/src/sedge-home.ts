import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';

/**
 * Whether `dir` is a sedge home that `sedge uninstall` may delete whole: it has sedge's files in
 * it, and it is not your home folder or anything above it (`SEDGE_HOME` can point anywhere).
 */
export const isSedgeHome = async (dir: string, home = homedir()) => {
    const target = resolve(dir);
    const user = resolve(home);
    if (target === user || `${user}${sep}`.startsWith(`${target}${sep}`) || target === sep) {
        return false;
    }
    for (const marker of ['config.json', 'sedge.db', join('bin', 'sedge')]) {
        if (
            await stat(join(target, marker)).then(
                () => true,
                () => false,
            )
        ) {
            return true;
        }
    }
    return false;
};
