/** Hands what a callback receives to an async iterator, until `signal` aborts or `fail` is called. */
export const queue = <A>(signal: AbortSignal) => {
    const items: Array<A> = [];
    let wake: (() => void) | undefined;
    let failure: Error | undefined;
    const poke = () => {
        wake?.();
        wake = undefined;
    };
    signal.addEventListener('abort', poke);
    return {
        push: (item: A) => {
            items.push(item);
            poke();
        },
        fail: (error: Error) => {
            failure = error;
            poke();
        },
        async *[Symbol.asyncIterator](): AsyncGenerator<A> {
            while (!signal.aborted) {
                const item = items.shift();
                if (item !== undefined) {
                    yield item;
                    continue;
                }
                if (failure) throw failure;
                await new Promise<void>((resolve) => (wake = resolve));
            }
        },
    };
};

/** Cuts text to `max` characters, saying so. */
export const clip = (text: string, max: number) =>
    text.length > max ? `${text.slice(0, max)}\n… (${text.length - max} more characters)` : text;
