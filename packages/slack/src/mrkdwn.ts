/**
 * Markdown, as the agent writes it, in Slack's own "mrkdwn": *bold*, _italic_, ~strike~,
 * <url|links>, and code as it is. Code is set aside first so nothing inside it changes.
 */
export const toMrkdwn = (markdown: string) => {
    const code: Array<string> = [];
    const keep = (text: string) => `\uE000${code.push(text) - 1}\uE000`;
    let text = markdown
        .replace(/```[\s\S]*?```/g, (block) => keep(block.replace(/^```\w*\n?/, '```\n')))
        .replace(/`[^`\n]+`/g, keep);
    // Slack wants &, < and > escaped outside its own markup.
    text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    text = text
        .replace(/^#{1,6}\s+(.+)$/gm, '\uE001$1\uE001')
        .replace(
            /\*\*(.+?)\*\*|__(.+?)__/g,
            (_, a: string | undefined, b: string | undefined) => `\uE001${a ?? b}\uE001`,
        )
        .replace(/(?<![*\w])\*(?!\s)([^*\n]+?)\*(?!\w)/g, '_$1_')
        .replace(/\uE001/g, '*')
        .replace(/~~(.+?)~~/g, '~$1~')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<$2|$1>')
        .replace(/^(\s*)[-*]\s+/gm, '$1• ');
    return text.replace(/\uE000(\d+)\uE000/g, (_, i: string) => code[Number(i)]!);
};
