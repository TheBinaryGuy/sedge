/**
 * The agent writes Markdown; Telegram shows it raw unless it's sent as Telegram's HTML subset.
 * This turns the common parts (code blocks, inline code, bold, italics, links, headings, bullets)
 * into that subset and escapes everything else, so a stray `<` can't break a message.
 */
const escape = (text: string) =>
    text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const inline = (text: string): string => {
    // Inline code first, held aside so nothing inside it is formatted.
    const codes: Array<string> = [];
    let out = text.replace(/`([^`\n]+)`/g, (_, code: string) => {
        codes.push(`<code>${escape(code)}</code>`);
        return `\uE000${codes.length - 1}\uE000`;
    });
    out = escape(out)
        .replace(
            /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
            (_, label: string, url: string) =>
                `<a href="${url.replaceAll('"', '&quot;')}">${label}</a>`,
        )
        .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
        .replace(/__([^_\n]+)__/g, '<b>$1</b>')
        .replace(/(^|[\s(])\*([^*\s][^*\n]*?)\*(?=[\s).,!?:;]|$)/g, '$1<i>$2</i>')
        .replace(/(^|[\s(])_([^_\s][^_\n]*?)_(?=[\s).,!?:;]|$)/g, '$1<i>$2</i>');
    return out.replace(/\uE000(\d+)\uE000/g, (_, i: string) => codes[Number(i)]!);
};

export const toTelegramHtml = (markdown: string): string =>
    markdown
        .split(/(```[^\n]*\n[\s\S]*?```)/g)
        .map((part) => {
            const block = /^```([^\n]*)\n([\s\S]*?)```$/.exec(part);
            if (block) {
                const lang = block[1]!.trim();
                const code = escape(block[2]!.replace(/\n$/, ''));
                return lang
                    ? `<pre><code class="language-${escape(lang)}">${code}</code></pre>`
                    : `<pre>${code}</pre>`;
            }
            return part
                .split('\n')
                .map((line) => {
                    const heading = /^#{1,6}\s+(.*)$/.exec(line);
                    if (heading) return `<b>${inline(heading[1]!)}</b>`;
                    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
                    if (bullet) return `${bullet[1]}• ${inline(bullet[2]!)}`;
                    return inline(line);
                })
                .join('\n');
        })
        .join('');
