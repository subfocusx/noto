// Reports the size of the main (entry) chunk of the build output.
// Usage: node scripts/measure-bundle.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '..', 'dist');

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const match = html.match(/src="\/assets\/([^"]+\.js)"/);
if (!match) {
  console.error('measure-bundle: no entry chunk found in dist/index.html');
  process.exit(1);
}

const entry = match[1];
const buffer = readFileSync(join(dist, 'assets', entry));
const gzip = gzipSync(buffer, { level: 9 }).length;
const chunks = readdirSync(join(dist, 'assets')).filter((f) => f.endsWith('.js'));

console.log(`entry chunk : ${entry}`);
console.log(`raw bytes   : ${buffer.length} (${(buffer.length / 1024).toFixed(2)} kB)`);
console.log(`gzip bytes  : ${gzip} (${(gzip / 1024).toFixed(2)} kB)`);
console.log(`js chunks   : ${chunks.length}`);
