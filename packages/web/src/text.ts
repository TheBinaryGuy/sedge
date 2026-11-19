/** Decodes the few entities pages and feeds use most. */
export const decode = (text: string) =>
    text
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
        .replace(/&#x([0-9a-f]+);/gi, (_, n: string) =>
            String.fromCodePoint(Number.parseInt(n, 16)),
        )
        .replace(/&nbsp;/g, ' ')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');

/** A page's readable text, one line per block, without scripts, styles or markup. */
export const pageText = (html: string) =>
    decode(
        html
            .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, '')
            .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)\b[^>]*>/gi, '\n')
            .replace(/<[^>]+>/g, ' '),
    )
        .split('\n')
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join('\n');
