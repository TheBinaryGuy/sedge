/**
 * Whether this is the compiled binary rather than a source checkout: its entry lives in Bun's
 * embedded filesystem, `/$bunfs/root/…` on macOS and Linux and `B:\~BUN\root\…` on Windows
 * (which Bun also writes with forward slashes, or URL-encoded as `%7EBUN`).
 */
export const isCompiled = (main: string = Bun.main): boolean =>
    main.startsWith('/$bunfs/') || /^[A-Z]:[\\/](~|%7E)BUN[\\/]/i.test(main);

/**
 * How to start this same program again: the compiled binary re-runs itself, a source checkout
 * re-runs `bun <entry>`. Used to spawn the daemon from the client and to restart after an update.
 */
export const selfCommand = (...args: ReadonlyArray<string>): Array<string> => {
    return isCompiled() ? [process.execPath, ...args] : [process.execPath, Bun.main, ...args];
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
