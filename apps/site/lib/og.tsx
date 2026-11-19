import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Logo, LOGO_RATIO } from '@/components/logo';

/**
 * The picture a link to sedge.sh shows when it's shared: the tuft, the page's title and what it's
 * about, in the site's dark colours. Drawn at build time, so the site stays static files.
 */

const COLORS = {
    background: '#0d1117',
    foreground: '#e6edf3',
    muted: '#8b949e',
    border: '#30363d',
    primary: '#3fb950',
    faint: '#16301e',
};

const fonts = async () =>
    Promise.all(
        ([400, 600] as const).map(async (weight) => ({
            name: 'Geist',
            weight,
            style: 'normal' as const,
            data: await readFile(join(process.cwd(), 'assets', `geist-${weight}.ttf`)),
        })),
    );

export const socialImage = async (options: {
    readonly title: string;
    readonly description?: string | undefined;
    /** A small line above the title, like "Docs". */
    readonly section?: string | undefined;
}) =>
    new ImageResponse(
        <div
            style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                position: 'relative',
                background: COLORS.background,
                color: COLORS.foreground,
                fontFamily: 'Geist',
                padding: '72px 80px',
            }}
        >
            {/* The tuft again, large and faint, off the right edge. */}
            <Logo
                fill={COLORS.faint}
                style={{
                    position: 'absolute',
                    right: -60,
                    bottom: -40,
                    height: 520,
                    width: 520 * LOGO_RATIO,
                }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, maxWidth: 860 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                    <Logo fill={COLORS.primary} style={{ height: 48, width: 48 * LOGO_RATIO }} />
                    <span style={{ fontSize: 40, fontWeight: 600, letterSpacing: -1 }}>sedge</span>
                    {options.section ? (
                        <span style={{ fontSize: 40, color: COLORS.muted, letterSpacing: -1 }}>
                            {options.section}
                        </span>
                    ) : null}
                </div>
                <div
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        flex: 1,
                        justifyContent: 'center',
                    }}
                >
                    <div
                        style={{
                            fontSize: options.title.length > 40 ? 64 : 76,
                            fontWeight: 600,
                            letterSpacing: -2.5,
                            lineHeight: 1.08,
                        }}
                    >
                        {options.title}
                    </div>
                    {options.description ? (
                        <div
                            style={{
                                marginTop: 24,
                                fontSize: 32,
                                lineHeight: 1.35,
                                color: COLORS.muted,
                            }}
                        >
                            {options.description}
                        </div>
                    ) : null}
                </div>
                <div style={{ display: 'flex', fontSize: 28, color: COLORS.muted }}>
                    <span style={{ color: COLORS.primary }}>sedge.sh</span>
                </div>
            </div>
        </div>,
        { width: 1200, height: 630, fonts: await fonts() },
    );
