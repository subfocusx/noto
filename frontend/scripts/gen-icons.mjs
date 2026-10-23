// Generates the PWA icons (192/512 PNG) without any image dependency.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '..', 'public', 'icons');

function crc32(buf) {
  let crc = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i];
    for (let k = 0; k < 8; k += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function png(width, height, pixels) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Draws a rounded square with a simple "N" glyph. */
function drawIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const bg = [17, 24, 39, 255]; // #111827
  const fg = [244, 244, 245, 255];
  const radius = Math.round(size * 0.22);
  const stroke = Math.max(2, Math.round(size * 0.09));

  const insideRounded = (x, y) => {
    const rx = Math.min(x, size - 1 - x);
    const ry = Math.min(y, size - 1 - y);
    if (rx >= radius || ry >= radius) return true;
    const dx = radius - rx;
    const dy = radius - ry;
    return dx * dx + dy * dy <= radius * radius;
  };

  // "N" geometry: two vertical strokes plus a diagonal.
  const left = Math.round(size * 0.3);
  const right = Math.round(size * 0.7);
  const top = Math.round(size * 0.26);
  const bottom = Math.round(size * 0.74);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const idx = (y * size + x) * 4;
      if (!insideRounded(x, y)) {
        pixels[idx + 3] = 0;
        continue;
      }
      let colour = bg;
      const inStroke =
        (x >= left && x < left + stroke && y >= top && y < bottom) ||
        (x >= right - stroke && x < right && y >= top && y < bottom);
      if (inStroke) colour = fg;
      else {
        // diagonal from top-left to bottom-right inside the glyph box
        if (y >= top && y < bottom) {
          const t = (y - top) / (bottom - top);
          const x0 = left + stroke;
          const x1 = right - stroke * 2;
          const diagX = x0 + t * (x1 - x0);
          if (x >= diagX && x < diagX + stroke) colour = fg;
        }
      }
      pixels[idx] = colour[0];
      pixels[idx + 1] = colour[1];
      pixels[idx + 2] = colour[2];
      pixels[idx + 3] = colour[3];
    }
  }
  return png(size, size, pixels);
}

mkdirSync(outDir, { recursive: true });
for (const size of [192, 512]) {
  const file = resolve(outDir, `icon-${size}.png`);
  writeFileSync(file, drawIcon(size));
  console.log(`icons: wrote ${file}`);
}
