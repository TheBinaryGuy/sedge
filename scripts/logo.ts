/*
 * Writes docs/logo.svg from the same quadrant-block glyphs the TUI header draws, so the README
 * logo and the terminal one stay identical. Run after changing either: `bun scripts/logo.ts`.
 */
import { LOGO } from '../packages/core/src/logo';

// Each character is a 2×2 cell: [top-left, top-right, bottom-left, bottom-right].
const QUADRANTS: Record<string, [number, number, number, number]> = {
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
const pixels: Array<[number, number]> = [];
LOGO.forEach((row, y) =>
    Array.from(row).forEach((char, x) => {
        const q = QUADRANTS[char];
        if (!q) throw new Error(`No quadrant mapping for ${JSON.stringify(char)}`);
        q.forEach((on, i) => {
            if (on) pixels.push([x * 2 + (i % 2), y * 2 + Math.floor(i / 2)]);
        });
    }),
);
const xs = pixels.map(([x]) => x);
const ys = pixels.map(([, y]) => y);
const [minX, minY] = [Math.min(...xs), Math.min(...ys)];
const width = (Math.max(...xs) - minX + 1) * PX;
const height = (Math.max(...ys) - minY + 1) * PY;
const rects = pixels
    .map(
        ([x, y]) =>
            `<rect x="${(x - minX) * PX}" y="${(y - minY) * PY}" width="${PX}" height="${PY}"/>`,
    )
    .join('');

await Bun.write(
    new URL('../docs/logo.svg', import.meta.url),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" shape-rendering="crispEdges"><title>sedge</title><g fill="#3fb950">${rects}</g></svg>\n`,
);
console.log(`docs/logo.svg: ${pixels.length} pixels, ${width}×${height}`);
