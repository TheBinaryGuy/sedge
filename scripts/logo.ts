import { deflateSync } from 'node:zlib';

/*
 * Writes docs/logo.svg (and docs/logo.png, a square avatar for the GitHub org and npm) from the same quadrant-block glyphs the TUI header draws, so the README
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

// A 512×512 avatar: the same pixels, scaled to keep the terminal's tall cells, centred on dark.
const SIZE = 512;
const unitW = 30;
const unitH = Math.round((unitW * PY) / PX);
const gridW = width / PX;
const gridH = height / PY;
const offX = Math.round((SIZE - gridW * unitW) / 2);
const offY = Math.round((SIZE - gridH * unitH) / 2);
const [bg, fg] = [
    [13, 17, 23],
    [63, 185, 80],
] as const;
const raw = Buffer.alloc((SIZE * 3 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 3 + 1)] = 0;
    for (let x = 0; x < SIZE; x++) {
        const gx = Math.floor((x - offX) / unitW) + minX;
        const gy = Math.floor((y - offY) / unitH) + minY;
        const on = x >= offX && y >= offY && pixels.some(([px, py]) => px === gx && py === gy);
        const [r, g, b] = on ? fg : bg;
        raw.set([r, g, b], y * (SIZE * 3 + 1) + 1 + x * 3);
    }
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});
const crc32 = (bytes: Uint8Array) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), 8 + data.length);
    return out;
};
const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header.set([8, 2, 0, 0, 0], 8);
await Bun.write(
    new URL('../docs/logo.png', import.meta.url),
    Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(raw)),
        chunk('IEND', Buffer.alloc(0)),
    ]),
);
console.log('docs/logo.png: 512×512');
