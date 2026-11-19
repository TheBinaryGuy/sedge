import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { matchesKey, truncateToWidth } from '@earendil-works/pi-tui';

/** Bracketed paste wraps pasted text in these markers. */
const PASTE_MARKERS = ['\u001b[200~', '\u001b[201~'];

const isPrintable = (text: string) => {
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code < 0x20 || code === 0x7f) return false;
    }
    return true;
};

/**
 * A text field that shows dots instead of what is typed, for a bot token or a password. What is
 * typed goes from this dialog to the daemon and into ~/.sedge/.env; it is never part of the
 * conversation, so the model never sees it. Enter saves, Esc cancels.
 */
export const askSecret = (ctx: ExtensionContext, title: string, detail?: string) =>
    ctx.ui.custom<string | undefined>((tui, theme, _keys, done) => {
        let value = '';
        return {
            render: (width: number) =>
                [
                    '',
                    theme.bold(title),
                    ...(detail ? [theme.fg('muted', detail)] : []),
                    '',
                    `${theme.fg('accent', '›')} ${'•'.repeat(value.length)}${theme.inverse(' ')}`,
                    '',
                    theme.fg(
                        'dim',
                        'enter save · esc cancel · hidden, and never sent to the model',
                    ),
                ].map((line) => truncateToWidth(line, width)),
            handleInput: (data: string) => {
                if (matchesKey(data, 'enter')) return done(value.trim() || undefined);
                if (matchesKey(data, 'escape')) return done(undefined);
                if (matchesKey(data, 'backspace')) value = value.slice(0, -1);
                else {
                    const text = PASTE_MARKERS.reduce(
                        (t, marker) => t.replaceAll(marker, ''),
                        data,
                    );
                    // Printable text only: control keys and escape sequences are ignored.
                    if (text && isPrintable(text)) value += text;
                }
                tui.requestRender();
            },
            invalidate: () => {},
        };
    });
