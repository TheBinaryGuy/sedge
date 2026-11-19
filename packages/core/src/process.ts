/**
 * How to start this same program again: the compiled binary re-runs itself, a source checkout
 * re-runs `bun <entry>`. Used to spawn the daemon from the client and to restart after an update.
 */
export const selfCommand = (...args: ReadonlyArray<string>): Array<string> => {
    const compiled = Bun.main.startsWith('/$bunfs/') || /^[A-Z]:\\~BUN\\/i.test(Bun.main);
    return compiled ? [process.execPath, ...args] : [process.execPath, Bun.main, ...args];
};

export const isProcessAlive = (pid: number): boolean => {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        // EPERM means it exists but belongs to someone else.
        return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
};
