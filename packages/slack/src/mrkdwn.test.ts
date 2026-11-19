import { describe, expect, it } from 'vitest';
import { toMrkdwn } from './mrkdwn';

describe('toMrkdwn', () => {
    it('turns the agent’s Markdown into Slack’s', () => {
        expect(
            toMrkdwn(
                '## CI\n**main** is red, see [run 812](https://gh/812)\n- *lint* failed\n- ~~e2e~~ ok',
            ),
        ).toBe('*CI*\n*main* is red, see <https://gh/812|run 812>\n• _lint_ failed\n• ~e2e~ ok');
    });

    it('leaves code alone, and escapes what Slack would read as markup', () => {
        expect(toMrkdwn('a < b && `x **y**`\n```ts\nconst a = 1 < 2;\n```')).toBe(
            'a &lt; b &amp;&amp; `x **y**`\n```\nconst a = 1 < 2;\n```',
        );
    });
});
