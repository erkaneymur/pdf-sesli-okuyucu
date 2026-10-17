// Draws the app icon (page + sound waves) and writes PNGs with a tiny encoder,
// so no image tooling is needed. Usage: node scripts/make-icons.mjs
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const ACCENT = [160, 64, 28];
const PAPER = [246, 241, 231];
const INK = [120, 46, 18];

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x / size, y / size);
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Artwork in unit coordinates, kept inside the central 70% (maskable safe zone). */
function icon(u, v) {
  const inPage = u > 0.22 && u < 0.56 && v > 0.24 && v < 0.76;
  if (inPage) {
    const line = [0.36, 0.46, 0.56, 0.66].some((y, i) => Math.abs(v - y) < 0.022 && u > 0.28 && u < (i === 3 ? 0.44 : 0.5));
    return line ? INK : PAPER;
  }
  const d = Math.hypot(u - 0.58, v - 0.5);
  const inArc = (r) => Math.abs(d - r) < 0.025 && u > 0.6 && Math.abs(v - 0.5) < r * 0.75;
  if (inArc(0.1) || inArc(0.18)) return PAPER;
  return ACCENT;
}

const dir = fileURLToPath(new URL("../web/icons/", import.meta.url));
await mkdir(dir, { recursive: true });
for (const size of [192, 512]) await writeFile(`${dir}icon-${size}.png`, png(size, icon));
console.log(`Icons written to ${dir}`);
