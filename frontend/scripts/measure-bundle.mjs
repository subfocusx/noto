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

/* ------------------------------------------------------------------ totals */
const assetsDir = join(dist, 'assets');
const allFiles = readdirSync(assetsDir);

function measure(file) {
  const buf = readFileSync(join(assetsDir, file));
  return {
    file,
    raw: buf.length,
    gzip: gzipSync(buf, { level: 9 }).length,
  };
}

const jsFiles = allFiles.filter((f) => f.endsWith('.js'));
const cssFiles = allFiles.filter((f) => f.endsWith('.css'));

const jsMeasures = jsFiles.map(measure);
const cssMeasures = cssFiles.map(measure);

const sum = (items, key) => items.reduce((acc, item) => acc + item[key], 0);
const kb = (bytes) => `${(bytes / 1024).toFixed(2)} kB`;

console.log(`css chunks  : ${cssFiles.length}`);
console.log(
  `js total    : raw ${kb(sum(jsMeasures, 'raw'))} / gzip ${kb(sum(jsMeasures, 'gzip'))}`,
);
console.log(
  `css total   : raw ${kb(sum(cssMeasures, 'raw'))} / gzip ${kb(sum(cssMeasures, 'gzip'))}`,
);

/* --------------------------------------------------------------- top chunks */
const top = [...jsMeasures].sort((a, b) => b.raw - a.raw).slice(0, 5);
console.log('top 5 js chunks (raw / gzip):');
for (const item of top) {
  console.log(`  ${item.file}  ${kb(item.raw)} / ${kb(item.gzip)}`);
}
