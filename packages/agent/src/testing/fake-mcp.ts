/*
 * A tiny MCP server over stdio for tests: one tool, `get_weather`, which appends each call to the
 * file in FAKE_MCP_LOG and answers with the forecast.
 */
import { appendFileSync } from 'node:fs';

const send = (message: unknown) => process.stdout.write(`${JSON.stringify(message)}\n`);
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const message = JSON.parse(line) as {
            id?: number;
            method: string;
            params?: Record<string, unknown>;
        };
        if (message.id === undefined) continue;
        if (message.method === 'initialize') {
            send({
                jsonrpc: '2.0',
                id: message.id,
                result: {
                    protocolVersion: message.params?.protocolVersion,
                    capabilities: { tools: {} },
                    serverInfo: { name: 'fake', version: '1.0.0' },
                },
            });
        } else if (message.method === 'tools/list') {
            send({
                jsonrpc: '2.0',
                id: message.id,
                result: {
                    tools: [
                        {
                            name: 'get_weather',
                            description: 'The weather forecast for a city',
                            inputSchema: {
                                type: 'object',
                                properties: { city: { type: 'string' } },
                                required: ['city'],
                            },
                        },
                    ],
                },
            });
        } else if (message.method === 'tools/call') {
            const args = message.params?.arguments as { city: string };
            appendFileSync(process.env.FAKE_MCP_LOG!, `${args.city}\n`);
            send({
                jsonrpc: '2.0',
                id: message.id,
                result: { content: [{ type: 'text', text: `Sunny in ${args.city}` }] },
            });
        } else {
            send({
                jsonrpc: '2.0',
                id: message.id,
                error: { code: -32601, message: 'unknown method' },
            });
        }
    }
});
