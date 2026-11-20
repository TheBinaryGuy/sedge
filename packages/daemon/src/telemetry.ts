import type { SedgePaths } from '@sedge-hq/core';
import { Cause, Context, Effect, Layer, Logger, Metric } from 'effect';
import { appendFile, mkdir, readFile, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { format } from 'node:util';

/**
 * What the daemon did, for you to see in `sedge dash`, and nowhere else: nothing here leaves the
 * machine. Three parts:
 *
 * - **Logs**: every log line (Effect's, and anything printed by pi or a channel), structured, in
 *   `~/.sedge/logs/sedge.jsonl`.
 * - **Runs**: each finished run, with what woke it, how long it took, how it ended, and every tool
 *   call with its own timing, in `~/.sedge/logs/runs.jsonl`.
 * - **Metrics**: Effect's own counters and histograms (runs by agent and outcome, run time, tool
 *   calls, events by source, deliveries), read from memory, so they count since the daemon started.
 *
 * Both files rotate past 10 MB, keeping one previous file.
 */

export interface ToolTiming {
    readonly name: string;
    readonly ms: number;
    readonly error: boolean;
}

export interface RunRecord {
    readonly id: string;
    readonly thread: string;
    readonly sources: ReadonlyArray<string>;
    readonly events: number;
    readonly startedAt: number;
    readonly finishedAt: number;
    readonly ok: boolean;
    readonly error?: string;
    readonly tools: ReadonlyArray<ToolTiming>;
}

export type Level = 'debug' | 'info' | 'warn' | 'error';

export interface LogRecord {
    readonly t: number;
    readonly level: Level;
    readonly message: string;
    /** Where it came from: `daemon` (Effect's logs) or `console` (pi, channels, signals). */
    readonly from: string;
}

// ── Metrics: Effect's, kept in memory ──────────────────────────────────────────────────────────

export const metrics = {
    /** `<agent thread>:<ok|failed>` */
    runs: Metric.frequency('sedge_runs', { description: 'Finished runs, by thread and outcome' }),
    runSeconds: Metric.histogram('sedge_run_seconds', {
        description: 'How long runs take',
        boundaries: [1, 2, 5, 10, 20, 30, 60, 120, 300, 600],
    }),
    tools: Metric.frequency('sedge_tool_calls', { description: 'Tool calls, by tool' }),
    events: Metric.frequency('sedge_events', { description: 'Events run, by source' }),
    deliveries: Metric.frequency('sedge_deliveries', {
        description: 'Outbox deliveries, sent or failed',
    }),
};

const MAX_FILE = 10 * 1024 * 1024;
const KEEP_RUNS = 500;
const KEEP_LOGS = 3000;

/**
 * Appends lines to a file, one write at a time, moving it aside past 10 MB. `flush` waits for the
 * writes so far.
 */
const journal = (file: string) => {
    let chain = Promise.resolve();
    let written = 0;
    const write = (line: string) => {
        chain = chain
            .then(async () => {
                if (written === 0 || written > 256 * 1024) {
                    written = 1;
                    const size = await stat(file).then(
                        (s) => s.size,
                        () => 0,
                    );
                    if (size > MAX_FILE) await rename(file, `${file}.1`);
                }
                written += line.length;
                await appendFile(file, `${line}\n`);
            })
            .catch(() => undefined);
    };
    return Object.assign(write, { flush: () => chain });
};

const tail = async <A>(file: string, keep: number): Promise<Array<A>> => {
    const text = await readFile(file, 'utf8').catch(() => '');
    return text
        .split('\n')
        .slice(-keep - 1)
        .flatMap((line) => {
            try {
                return line ? [JSON.parse(line) as A] : [];
            } catch {
                return [];
            }
        });
};

export class Telemetry extends Context.Service<
    Telemetry,
    {
        readonly recordRun: (run: RunRecord) => Effect.Effect<void>;
        readonly runs: (options: {
            readonly thread?: string | undefined;
            readonly limit: number;
        }) => Effect.Effect<ReadonlyArray<RunRecord>>;
        readonly logs: (options: {
            readonly level?: Level | undefined;
            readonly limit: number;
        }) => Effect.Effect<ReadonlyArray<LogRecord>>;
        /** Effect's metric snapshot, since the daemon started. */
        readonly snapshot: Effect.Effect<ReadonlyArray<Metric.Metric.Snapshot>>;
    }
>()('sedge/daemon/Telemetry') {}

const RANK: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const levelOf = (label: string): Level => {
    const l = label.toLowerCase();
    return l === 'error' || l === 'fatal'
        ? 'error'
        : l === 'warn' || l === 'warning'
          ? 'warn'
          : l === 'debug' || l === 'trace'
            ? 'debug'
            : 'info';
};

/**
 * Opens the journals, and returns the Telemetry layer with a Logger that records every Effect log
 * line too. The console is teed as well, so pi's and channels' own output is recorded.
 */
export const openTelemetry = async (paths: SedgePaths) => {
    await mkdir(paths.logs, { recursive: true });
    const runsFile = join(paths.logs, 'runs.jsonl');
    const logsFile = join(paths.logs, 'sedge.jsonl');
    const writeRun = journal(runsFile);
    const writeLog = journal(logsFile);
    const runs: Array<RunRecord> = await tail<RunRecord>(runsFile, KEEP_RUNS);
    const logs: Array<LogRecord> = await tail<LogRecord>(logsFile, KEEP_LOGS);

    const log = (record: LogRecord) => {
        logs.push(record);
        if (logs.length > KEEP_LOGS) logs.splice(0, logs.length - KEEP_LOGS);
        writeLog(JSON.stringify(record));
    };

    // pi, channels and signals print; what they print is part of the record.
    for (const [method, level] of [
        ['log', 'info'],
        ['info', 'info'],
        ['warn', 'warn'],
        ['error', 'error'],
    ] as const) {
        const original = console[method].bind(console);
        console[method] = (...args: Array<unknown>) => {
            original(...args);
            log({ t: Date.now(), level, message: format(...args), from: 'console' });
        };
    }

    const logger = Logger.make(({ logLevel, message, cause, date }) => {
        const text = (Array.isArray(message) ? message : [message])
            .map((part) => (typeof part === 'string' ? part : format(part)))
            .join(' ');
        const failure = cause.reasons.length === 0 ? '' : `\n${Cause.pretty(cause)}`;
        log({
            t: date.getTime(),
            level: levelOf(logLevel),
            message: `${text}${failure}`,
            from: 'daemon',
        });
    });

    const service = Telemetry.of({
        recordRun: (run) =>
            Effect.gen(function* () {
                runs.push(run);
                if (runs.length > KEEP_RUNS) runs.splice(0, runs.length - KEEP_RUNS);
                writeRun(JSON.stringify(run));
                yield* Metric.update(metrics.runs, `${run.thread}:${run.ok ? 'ok' : 'failed'}`);
                yield* Metric.update(metrics.runSeconds, (run.finishedAt - run.startedAt) / 1000);
                for (const tool of run.tools) yield* Metric.update(metrics.tools, tool.name);
                for (const source of run.sources) yield* Metric.update(metrics.events, source);
            }),
        runs: ({ thread, limit }) =>
            Effect.sync(() =>
                runs
                    .filter((run) => thread === undefined || run.thread === thread)
                    .slice(-limit)
                    .reverse(),
            ),
        logs: ({ level, limit }) =>
            Effect.sync(() =>
                logs
                    .filter((record) => level === undefined || RANK[record.level] >= RANK[level])
                    .slice(-limit)
                    .reverse(),
            ),
        snapshot: Metric.snapshot,
    });

    // What's still being written lands before the daemon stops.
    const flush = Layer.effectDiscard(
        Effect.addFinalizer(() =>
            Effect.promise(() => Promise.all([writeRun.flush(), writeLog.flush()])),
        ),
    );
    return Layer.mergeAll(
        Layer.succeed(Telemetry, service),
        Logger.layer([Logger.defaultLogger, logger]),
        flush,
    );
};
