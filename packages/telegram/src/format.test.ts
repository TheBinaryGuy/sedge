import { describe, expect, it } from 'vitest';
import { toTelegramHtml } from './format';

describe('toTelegramHtml', () => {
    it('formats what the agent writes', () => {
        expect(toTelegramHtml('The repo is at `sedge-hq/sedge`.')).toBe(
            'The repo is at <code>sedge-hq/sedge</code>.',
        );
        expect(toTelegramHtml('**Done** and *quick*: [site](https://sedge.sh)')).toBe(
            '<b>Done</b> and <i>quick</i>: <a href="https://sedge.sh">site</a>',
        );
        expect(toTelegramHtml('## Status\n- one\n- two')).toBe('<b>Status</b>\n• one\n• two');
        expect(toTelegramHtml('```sh\necho <hi>\n```')).toBe(
            '<pre><code class="language-sh">echo &lt;hi&gt;</code></pre>',
        );
    });

    it('escapes everything else, so text cannot inject markup', () => {
        expect(toTelegramHtml('a < b & c > d')).toBe('a &lt; b &amp; c &gt; d');
        expect(toTelegramHtml('`<b>not bold</b>`')).toBe(
            '<code>&lt;b&gt;not bold&lt;/b&gt;</code>',
        );
        expect(toTelegramHtml('snake_case_name and 2*3*4')).toBe('snake_case_name and 2*3*4');
    });
});
