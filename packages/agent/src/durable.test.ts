import { createModels } from '@earendil-works/pi-ai/models';
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { Effect, ManagedRuntime } from 'effect';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentHost, Outgoing } from './host';
import { Agent } from './index';

const setup = async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sedge-agent-test-'));
    const faux = fauxProvider({ tokensPerSecond: 1000 });
    const models = createModels();
    models.setProvider(faux.provider);
    const model = faux.getModel();
    const sent: Array<Outgoing> = [];
    const blocked: Array<string> = [];
    const host: AgentHost = {
        systemPrompt: async () => 'You are sedge.',
        send: async (_run, message) => {
            sent.push(message);
            return 'Queued for delivery.';
        },
        setTimer: async () => 'set',
        listTimers: async () => 'none',
        cancelTimer: async () => false,
        checkTool: async (_run, name) => {
            if (name !== 'bash') return { allow: true };
            blocked.push(name);
            return { allow: false, reason: 'This call needs the user’s approval.' };
        },
    };
    const open = () =>
        ManagedRuntime.make(
            Agent.layer({
                file: join(dir, 'durable.sqlite'),
                workspace: dir,
                loadPi: () => Promise.reject(new Error('pi is not used here')),
                host,
                models: async () => ({
                    models,
                    choose: async () => ({ provider: model.provider, modelId: model.id }),
                }),
            }),
        );
    const run = (runtime: ReturnType<typeof open>, items: Array<{ id: string; text: string }>) =>
        runtime.runPromise(
            Effect.gen(function* () {
                const agent = yield* Agent;
                return yield* agent.run(
                    { thread: 'main', sources: ['telegram'], cwd: dir, items },
                    () => Effect.void,
                );
            }),
        );
    return { dir, faux, sent, blocked, open, run };
};

describe('the durable agent', () => {
    it('answers an event once, even when it arrives again after a restart', async () => {
        const { faux, open, run } = await setup();
        faux.setResponses([fauxAssistantMessage('hello there')]);
        const first = open();
        expect(await run(first, [{ id: 'event-1', text: 'hi' }])).toBe('hello there');
        await first.dispose();

        // No responses are left: a second model call would fail the run.
        const second = open();
        expect(await run(second, [{ id: 'event-1', text: 'hi' }])).toBe('hello there');
        await second.dispose();
    }, 30_000);

    it('keeps a blocked tool call from running, and delivers choices to the user', async () => {
        const { dir, faux, sent, blocked, open, run } = await setup();
        const marker = join(dir, 'ran');
        faux.setResponses([
            fauxAssistantMessage([fauxToolCall('bash', { command: `touch ${marker}` })], {
                stopReason: 'toolUse',
            }),
            fauxAssistantMessage(
                [
                    fauxToolCall('send_message', {
                        text: 'May I run it?',
                        choices: [{ label: 'Yes', value: 'yes' }],
                    }),
                ],
                { stopReason: 'toolUse' },
            ),
            fauxAssistantMessage('Asked.'),
        ]);
        const runtime = open();
        expect(await run(runtime, [{ id: 'event-2', text: 'touch the file' }])).toBe('Asked.');
        await runtime.dispose();
        expect(blocked).toEqual(['bash']);
        expect(existsSync(marker)).toBe(false);
        expect(sent).toEqual([
            { text: 'May I run it?', choices: [{ label: 'Yes', value: 'yes' }] },
        ]);
    }, 30_000);
});
