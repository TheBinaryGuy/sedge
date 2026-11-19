import { type SedgeConfig, type SedgePaths } from '@sedge-hq/core';
import { Context, Layer } from 'effect';

/** The config the daemon started with, plus what's derived from it. */
export class Settings extends Context.Service<
    Settings,
    {
        readonly paths: SedgePaths;
        readonly config: SedgeConfig;
        /** Where runs without a terminal (sources, timers) work. */
        readonly workspace: string;
    }
>()('sedge/daemon/Settings') {
    static readonly layer = (paths: SedgePaths, config: SedgeConfig) =>
        Layer.succeed(Settings)(
            Settings.of({ paths, config, workspace: config.workspace ?? paths.workspace }),
        );
}
