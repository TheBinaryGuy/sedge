import { defineSignal, field, type Happening, secret } from '@sedge-hq/kit';
import mqtt from 'mqtt';
import { randomBytes } from 'node:crypto';

const KEEP = 20_000;

const clip = (text: string) =>
    text.length > KEEP ? `${text.slice(0, KEEP)}\n… (${text.length - KEEP} more characters)` : text;

/** A payload as the agent reads it: JSON laid out, text as it is, binary only by its size. */
export const readable = (payload: Uint8Array): string => {
    let text: string;
    try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(payload);
    } catch {
        return `(${payload.length} bytes of binary)`;
    }
    if (text.includes('\u0000')) return `(${payload.length} bytes of binary)`;
    try {
        const value: unknown = JSON.parse(text);
        if (typeof value === 'object' && value !== null)
            return clip(JSON.stringify(value, null, 2));
    } catch {
        // Not JSON: plain text.
    }
    return clip(text);
};

/** One event per message: the topic, then what was sent. */
export const happening = (topic: string, payload: Uint8Array): Happening => {
    const body = readable(payload);
    return { text: body.includes('\n') ? `${topic}\n${body}` : `${topic}: ${body}` };
};

/** A sensor, a home hub, a device: anything that publishes to an MQTT broker. */
export default defineSignal({
    name: 'mqtt',
    summary: 'messages on MQTT topics: sensors, home automation, devices',
    settings: {
        url: field.text(
            'The broker, like mqtt://localhost:1883, mqtts://broker.example.com:8883 (TLS) or wss://… (WebSocket).',
        ),
        topics: field.list(
            'Topics to subscribe to. + matches one level and # the rest: home/+/soil, sensors/#.',
        ),
        username: field.optional(field.text('The username, if the broker asks for one.')),
        password: field.optional(secret('The password, if the broker asks for one.')),
    },
    watch: ({ url, topics, username, password }, kit) => {
        const items: Array<Happening> = [];
        let wake: (() => void) | undefined;
        let failure: Error | undefined;
        const poke = () => {
            wake?.();
            wake = undefined;
        };
        const fail = (error: Error) => {
            failure ??= error;
            poke();
        };

        return {
            async *[Symbol.asyncIterator]() {
                // The same client id every time, with a session the broker keeps: messages at
                // QoS 1 that arrive while sedge is stopped are delivered when it's back.
                let clientId = await kit.memo.get('client-id');
                if (!clientId) {
                    clientId = `sedge-${randomBytes(6).toString('hex')}`;
                    await kit.memo.set('client-id', clientId);
                }
                const client = mqtt.connect(url, {
                    clientId,
                    clean: false,
                    // A lost connection ends this watch; the kit starts it again, backing off.
                    reconnectPeriod: 0,
                    connectTimeout: 30_000,
                    ...(username ? { username } : {}),
                    ...(password ? { password } : {}),
                });
                const stop = () => {
                    client.end(true);
                    poke();
                };
                kit.signal.addEventListener('abort', stop);
                client.on('connect', () => {
                    client.subscribe([...topics], { qos: 1 }, (error, granted) => {
                        if (error) return fail(error);
                        const refused = (granted ?? []).filter((g) => g.qos === 128);
                        if (refused.length > 0) {
                            return fail(
                                new Error(
                                    `the broker refused ${refused.map((g) => g.topic).join(', ')}`,
                                ),
                            );
                        }
                        kit.status(`subscribed to ${topics.join(', ')} on ${new URL(url).host}`);
                    });
                });
                client.on('message', (topic, payload, packet) => {
                    // A retained message is the topic's last value, sent again on every
                    // subscribe: it's news only the first time, so it isn't reported.
                    if (packet.retain) return;
                    items.push(happening(topic, payload));
                    poke();
                });
                client.on('error', fail);
                client.on('close', () => {
                    if (!kit.signal.aborted) fail(new Error(`lost the connection to ${url}`));
                });
                try {
                    while (!kit.signal.aborted) {
                        const item = items.shift();
                        if (item) {
                            yield item;
                            continue;
                        }
                        if (failure) throw failure;
                        await new Promise<void>((resolve) => (wake = resolve));
                    }
                } finally {
                    kit.signal.removeEventListener('abort', stop);
                    client.end(true);
                }
            },
        };
    },
});
