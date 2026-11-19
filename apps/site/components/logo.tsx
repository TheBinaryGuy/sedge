import type { CSSProperties } from 'react';
import { LOGO } from '../../../packages/core/src/logo';

// Each character is a 2×2 cell of quadrants: [top-left, top-right, bottom-left, bottom-right].
const QUADRANTS: Record<string, readonly [number, number, number, number]> = {
    ' ': [0, 0, 0, 0],
    '▗': [0, 0, 0, 1],
    '▖': [0, 0, 1, 0],
    '▝': [0, 1, 0, 0],
    '▘': [1, 0, 0, 0],
    '▐': [0, 1, 0, 1],
    '▌': [1, 0, 1, 0],
    '▞': [0, 1, 1, 0],
    '▚': [1, 0, 0, 1],
    '▜': [1, 1, 0, 1],
    '▛': [1, 1, 1, 0],
    '▙': [1, 0, 1, 1],
    '▟': [0, 1, 1, 1],
    '█': [1, 1, 1, 1],
};

// Terminal cells are about 2.25× taller than wide, so a quadrant pixel is too.
const PX = 16;
const PY = 36;
const pixels = LOGO.flatMap((row, y) =>
    Array.from(row).flatMap((char, x) =>
        (QUADRANTS[char] ?? [0, 0, 0, 0]).flatMap((on, i) =>
            on ? [[x * 2 + (i % 2), y * 2 + Math.floor(i / 2)] as const] : [],
        ),
    ),
);
const minX = Math.min(...pixels.map(([x]) => x));
const minY = Math.min(...pixels.map(([, y]) => y));
const width = (Math.max(...pixels.map(([x]) => x)) - minX + 1) * PX;
const height = (Math.max(...pixels.map(([, y]) => y)) - minY + 1) * PY;

/** Width over height, for sizing it where CSS can't (the social images). */
export const LOGO_RATIO = width / height;

/** The sedge tuft, drawn from the same glyphs as the TUI header, in the current colour. */
export function Logo({
    className,
    style,
    fill = 'currentColor',
}: {
    className?: string;
    style?: CSSProperties;
    fill?: string;
}) {
    return (
        <svg
            viewBox={`0 0 ${width} ${height}`}
            className={className}
            style={style}
            shapeRendering="crispEdges"
            aria-hidden="true"
        >
            <g fill={fill}>
                {pixels.map(([x, y]) => (
                    <rect
                        key={`${x}-${y}`}
                        x={(x - minX) * PX}
                        y={(y - minY) * PY}
                        width={PX}
                        height={PY}
                    />
                ))}
            </g>
        </svg>
    );
}
