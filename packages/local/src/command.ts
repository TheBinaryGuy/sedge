import { defineSignal, field, type Happening, type Kit } from '@sedge-hq/kit';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { clip, queue } from './queue';

const KEEP = 20_000;
/** A run of a command on a schedule may take this long. */
const TIMEOUT = 5 * 60_000;

const shell = (command: string) =>
    process.platform === 'win32' ? ['cmd', '/c', command] : ['sh', '-c', command];

const spawn = (command: string, cwd: string | undefined, signal: AbortSignal) =>
    Bun.spawn(shell(command), {
        cwd: cwd ? resolve(cwd.replace(/^~(?=$|\/)/, homedir())) : homedir(),
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
        signal,
    });

/** Runs the command every `minutes`, and reports when what it prints changes. */
async function* changes(
    command: string,
    cwd: string | undefined,
    minutes: number,
    kit: Kit,
): AsyncGenerator<Happening> {
    while (!kit.signal.aborted) {
        const timeout = AbortSignal.any([kit.signal, AbortSignal.timeout(TIMEOUT)]);
        const child = spawn(command, cwd, timeout);
        const [out, err] = await Promise.all([
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
        ]);
        const code = await child.exited;
        if (kit.signal.aborted) return;
        const output = clip(out.trim() || err.trim(), KEEP);
        const before = await kit.memo.get('output');
        await kit.memo.set('output', output);
        kit.status(`ran ${command}: exit ${code}`);
        // The first run only learns what it prints.
        if (before !== undefined && before !== output) {
            yield {
                text: `\`${command}\` printed something new (exit ${code}):\n${output}`,
                key: createHash('sha256').update(output).digest('hex').slice(0, 16),
            };
        }
        await kit.sleep(minutes * 60_000);
    }
}

/** Keeps the command running and reports what it prints, a burst of lines at a time. */
const lines = (command: string, cwd: string | undefined, kit: Kit): AsyncIterable<Happening> => {
    const printed = queue<Happening>(kit.signal);
    const child = spawn(command, cwd, kit.signal);
    kit.status(`running ${command}`);
    let partial = '';
    const decoder = new TextDecoder();
    void (async () => {
        for await (const chunk of child.stdout) {
            const text = partial + decoder.decode(chunk, { stream: true });
            const complete = text.split('\n');
            partial = complete.pop() ?? '';
            const burst = complete.filter((line) => line.trim() !== '');
            if (burst.length > 0) printed.push({ text: clip(burst.join('\n'), KEEP) });
        }
        const code = await child.exited;
        if (partial.trim()) printed.push({ text: clip(partial, KEEP) });
        if (kit.signal.aborted) return;
        const err = (await new Response(child.stderr).text()).trim();
        printed.fail(new Error(`${command} exited (${code})${err ? `: ${err.slice(-300)}` : ''}`));
    })();
    return printed;
};

/** Anything a command can see: a sensor, a log, a queue, a service's status, an MQTT topic. */
export default defineSignal({
    name: 'command',
    summary:
        'a shell command: what a long-running one prints (tail -f, a sensor feed), or a change in what one prints on a schedule',
    settings: {
        command: field.text(
            'The command, run in your shell with your permissions. A long-running one (tail -n0 -f app.log, mosquitto_sub -t sensors/#) reports each burst of lines it prints.',
        ),
        minutes: field.optional(
            field.number(
                'Run it every this many minutes instead, and report when its output changes. Leave out for a long-running command.',
            ),
        ),
        cwd: field.optional(field.text('The folder to run it in. Default: your home folder.')),
    },
    watch: ({ command, minutes, cwd }, kit) =>
        minutes === undefined ? lines(command, cwd, kit) : changes(command, cwd, minutes, kit),
});
