import { loadConfig, type SedgeConfig } from '@sedge-hq/core';
import { Context, Effect, Layer } from 'effect';
import { stat } from 'node:fs/promises';
import { Settings } from './settings';

/**
 * config.json as it is now: read again whenever the file changes, for what applies without a
 * restart (models, limits, agents). A config that doesn't read keeps the last one that did.
 */
export class LiveConfig extends Context.Service<
    LiveConfig,
    { readonly current: Effect.Effect<SedgeConfig> }
>()('sedge/daemon/LiveConfig') {
    static readonly layer = Layer.effect(
        LiveConfig,
        Effect.gen(function* () {
            const { paths, config } = yield* Settings;
            let cached = { mtime: Number.NaN, config };
            const current = Effect.promise(async () => {
                const mtime = (await stat(paths.config).catch(() => undefined))?.mtimeMs;
                if (mtime !== undefined && mtime !== cached.mtime) {
                    const loaded = await loadConfig(paths).catch(() => undefined);
                    cached = { mtime, config: loaded ?? cached.config };
                }
                return cached.config;
            });
            return LiveConfig.of({ current });
        }),
    );
}

/**
 * The model a run uses: the channel's or signal's when all its events came from that one, else its
 * agent's, else the daemon's; `undefined` leaves it to pi's default.
 */
export const modelFor = (
    config: SedgeConfig,
    agent: string,
    sources: ReadonlyArray<string>,
): string | undefined => {
    const only = new Set(sources);
    const source = only.size === 1 ? [...only][0]! : undefined;
    return (
        (source ? config.connections?.[source]?.model : undefined) ??
        config.agents?.[agent]?.model ??
        config.model
    );
};
