/**
 * HOW MUCH OF A CHART'S TEXT CAN WE READ? - scored against third-party ground
 * truth, on real published charts.
 *
 * ⚑⚑ WHY IT IS ITS OWN NUMBER (David, 2026-08-31: *"We want to add the OCR
 * numbers to the benchmark results as a separate reported value"*). Reading a
 * label is not data extraction: it recovers the NAMES a chart carries, not the
 * values, and a tool can be excellent at one and useless at the other. Folding
 * it into the bar/line/scatter percentages would hide both.
 *
 * The corpus supplies both halves, so nothing here is our own ground truth:
 *   · `task2.output.text_blocks[]` - each block's polygon AND its typed text;
 *   · `task3.output.text_roles[]`  - which of those blocks are `tick_label`.
 *
 * ⚑ HORIZONTAL LABELS ONLY, and that is a measurement rather than a dodge:
 * across all 887 annotated charts, 95.7% have horizontal tick labels and 95.4%
 * of individual labels sit at 0 degrees. Angled text is a real 4% and a separate
 * feature; scoring it here would report one number for two capabilities.
 *
 * ⚑ THE READER IS THE SHIPPED ONE - `ui/electron-ocr.cjs`, which needs no
 * Electron (it is `tesseract.js` and `path`), so this measures what the app
 * does rather than a copy of its settings.
 *
 * ⚠️ EXACT MATCH, after folding the corpus's own literal `\n` line-break marker
 * to a space. Without that fold every multi-line label scores as wrong even when
 * read perfectly - 70 of them in the corpus, and it silently decided a
 * page-segmentation question the wrong way until it was found.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';

const require_ = createRequire(import.meta.url);

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const GT = args.get('gt');
const RGBA = args.get('rgba');
const OUT = args.get('out');
const PT = args.get('plottracer') ?? path.join(process.env.HOME, 'code/plottracer');
const LIMIT = Number(args.get('limit') ?? 0);
if (!GT || !RGBA || !OUT) {
  console.error('usage: score-ocr.mjs --gt <annotations_JSON> --rgba <dir> --out <file.json> [--limit N]');
  process.exit(2);
}
const { readText, shutdownOcr } = require_(path.join(PT, 'ui/electron-ocr.cjs'));

/** The app's own floor and rule - see engine/ocrRegion.ts `upscaleForOcr`. */
const OCR_MIN_HEIGHT = 48;
const PAD = 2;

const norm = (s) => (s || '').replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();

function readRgba(file) {
  const b = readFileSync(file);
  const width = b.readUInt32LE(0);
  const height = b.readUInt32LE(4);
  return { width, height, data: b.subarray(8) };
}

/**
 * Crop, then scale up by a whole factor - mirroring `upscaleForOcr` in
 * engine/ocrRegion.ts, BILINEAR.
 *
 * ⚠️ The app first did this with nearest neighbour, on the reasoning that text
 * is line art and smoothing would only blur it. Measured here on 876 labels:
 * nearest 65.2%, bilinear 75.1%. The engine is trained on scanned text, which
 * has soft edges.
 */
function cropAndScale(img, x, y, w, h) {
  const factor = h >= OCR_MIN_HEIGHT ? 1 : Math.min(6, Math.ceil(OCR_MIN_HEIGHT / h));
  const W = w * factor, H = h * factor;
  const out = Buffer.alloc(W * H * 4);
  const at = (yy, xx, c) => img.data[((y + yy) * img.width + (x + xx)) * 4 + c];
  for (let oy = 0; oy < H; oy++) {
    const fy = Math.min(h - 1, (oy + 0.5) / factor - 0.5);
    const y0 = Math.max(0, Math.floor(fy)), y1 = Math.min(h - 1, y0 + 1), wy = fy - y0;
    for (let ox = 0; ox < W; ox++) {
      const fx = Math.min(w - 1, (ox + 0.5) / factor - 0.5);
      const x0 = Math.max(0, Math.floor(fx)), x1 = Math.min(w - 1, x0 + 1), wx = fx - x0;
      for (let c = 0; c < 4; c++) {
        const top = at(y0, x0, c) * (1 - wx) + at(y0, x1, c) * wx;
        const bot = at(y1, x0, c) * (1 - wx) + at(y1, x1, c) * wx;
        out[(oy * W + ox) * 4 + c] = Math.round(top * (1 - wy) + bot * wy);
      }
    }
  }
  return { data: out, width: W, height: H };
}

let crcTable = null;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = [];
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c; }
  }
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, body) {
  const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** Minimal PNG encode - the reader takes encoded bytes and node has no encoder. */
function encodePng({ data, width, height }) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const angleOf = (pg) => {
  const dx = pg.x1 - pg.x0, dy = pg.y1 - pg.y0;
  return Math.abs((((Math.atan2(-dy, dx) * 180) / Math.PI + 90) % 180) - 90);
};

const rows = [];
let charts = 0, labels = 0, exact = 0, angled = 0, missing = 0;
const confHit = [], confMiss = [];

for (const f of readdirSync(GT).sort()) {
  if (!f.endsWith('.json')) continue;
  if (LIMIT && charts >= LIMIT) break;
  let gt;
  try { gt = JSON.parse(readFileSync(path.join(GT, f), 'utf8')); } catch { continue; }
  const rgbaFile = path.join(RGBA, `${f.replace(/\.json$/, '')}.rgba`);
  if (!existsSync(rgbaFile)) { missing++; continue; }
  const blocks = new Map();
  for (const b of gt.task2?.output?.text_blocks ?? []) blocks.set(b.id, b);
  const roles = gt.task3?.output?.text_roles ?? [];
  let img = null, used = false, chartExact = 0, chartLabels = 0;
  for (const r of roles) {
    if (r.role !== 'tick_label') continue;
    const b = blocks.get(r.id);
    if (!b?.polygon) continue;
    if (angleOf(b.polygon) > 5) { angled++; continue; }
    if (!img) img = readRgba(rgbaFile);
    const pg = b.polygon;
    const xs = [pg.x0, pg.x1, pg.x2, pg.x3], ys = [pg.y0, pg.y1, pg.y2, pg.y3];
    const x = Math.max(0, Math.round(Math.min(...xs)) - PAD);
    const y = Math.max(0, Math.round(Math.min(...ys)) - PAD);
    const w = Math.min(img.width - x, Math.round(Math.max(...xs) - Math.min(...xs)) + PAD * 2);
    const h = Math.min(img.height - y, Math.round(Math.max(...ys) - Math.min(...ys)) + PAD * 2);
    if (w < 4 || h < 4) continue;
    const answer = await readText(encodePng(cropAndScale(img, x, y, w, h)).toString('base64'));
    if (answer.error) continue;
    const got = norm(answer.text), want = norm(b.text);
    labels++; chartLabels++; used = true;
    if (got === want) { exact++; chartExact++; confHit.push(answer.confidence ?? 0); }
    else confMiss.push(answer.confidence ?? 0);
  }
  if (used) { charts++; rows.push({ file: f, labels: chartLabels, exact: chartExact }); }
}

const mean = (a) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null);
const result = {
  corpus: path.basename(path.dirname(path.dirname(GT))),
  split: path.basename(path.dirname(GT)),
  scope: 'tick_label, horizontal only (within 5 degrees)',
  charts, labels, exact,
  pct: labels ? Math.round((1000 * exact) / labels) / 10 : 0,
  anglesSkipped: angled,
  imagesMissing: missing,
  meanConfidence: { hit: mean(confHit), miss: mean(confMiss) },
  perChart: rows,
};
writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');
console.log(`${result.split}: ${exact}/${labels} = ${result.pct}% exact on ${charts} charts (${angled} angled labels skipped)`);
await shutdownOcr();
