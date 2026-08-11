/**
 * WHY normalisation does not convert — the hypothesis, stated so it can fail.
 *
 * `greyscale-normalise.mjs` measured every app-realizable contrast stretch and
 * none of them beat the crude one they were meant to beat. This asks whether
 * that is an accident of these particular arms or something structural.
 *
 * THE HYPOTHESIS: a linear stretch cannot improve colour SEPARABILITY at all,
 * because the tolerance is a distance in the very units being stretched.
 * Multiplying every pixel by s multiplies the gap between two series by s AND
 * the spread inside one bar by s. At a fixed tolerance of 60 the detector is
 * therefore doing exactly what it would do on the ORIGINAL image at a tolerance
 * of 60/s — no more, no less. If that is right, normalisation is not a new
 * mechanism; it is the tolerance sweep already on the spent list, wearing a hat.
 *
 * THE PREDICTION, which is sharp enough to be wrong: for each figure, take the
 * scale factor s the stretch actually chose, and run the UNTOUCHED image at
 * tolerance 60/s. Per figure, the two should match. A pooled agreement would
 * prove little — two different mechanisms can land on the same total — so this
 * reports the per-figure disagreement, which is what can refute it.
 *
 * ⚑ Clipping is the one part of a stretch that is NOT a rescale: values outside
 * [lo,hi] are flattened together, and no tolerance reproduces that. So exact
 * agreement is not expected on figures whose ink leaves the mapped range; the
 * question is whether the residue is small and confined to those.
 *
 * Usage: node harness/greyscale-equivalence.mjs --engine <dir> --gt <dir> --rgba <dir>
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { boxRecallIoU } from './lib/metric.mjs';

function args(argv) {
  const o = {};
  for (let i = 2; i < argv.length; i += 2) o[argv[i].replace(/^--/, '')] = argv[i + 1];
  return o;
}
const a = args(process.argv);
const { runBarDetect } = await import(path.join(path.resolve(a.engine), 'engine/barDetectRun.js'));

const TOLERANCE = 60;
const MIN_BLOB_DIAMETER = 3;
const DEDUPE = TOLERANCE / 2;

function readRgba(file) {
  const buf = readFileSync(file);
  const width = buf.readUInt32LE(0);
  const height = buf.readUInt32LE(4);
  return {
    data: new Uint8ClampedArray(buf.buffer, buf.byteOffset + 8, width * height * 4),
    width,
    height,
  };
}
const sample = (img, x, y) => {
  const px = Math.max(0, Math.min(img.width - 1, Math.round(x)));
  const py = Math.max(0, Math.min(img.height - 1, Math.round(y)));
  const i = (py * img.width + px) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};
function fill(img, b) {
  const inset = Math.min(1, Math.floor(b.width / 4), Math.floor(b.height / 4));
  const buckets = new Map();
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      const c = sample(
        img,
        b.x0 + inset + ((i + 0.5) * Math.max(1, b.width - 2 * inset)) / 5,
        b.y0 + inset + ((j + 0.5) * Math.max(1, b.height - 2 * inset)) / 5
      );
      const k = c.map((v) => v >> 3).join(',');
      const hit = buckets.get(k);
      if (hit) hit.n++;
      else buckets.set(k, { n: 1, c });
    }
  }
  let best = null;
  for (const v of buckets.values()) if (!best || v.n > best.n) best = v;
  return best.c;
}
const gtBox = (b) => ({ minX: b.x0, minY: b.y0, maxX: b.x0 + b.width, maxY: b.y0 + b.height });
const predBox = (b) => ({ minX: b.start.x, minY: b.start.y, maxX: b.end.x, maxY: b.end.y });
const mono = (cs) => cs.every((c) => Math.max(...c) - Math.min(...c) < 30);

/** The `fg-range` arm from greyscale-normalise.mjs, returning its scale too. */
function fgRange(img, region) {
  const x0 = Math.max(0, Math.floor(region.x));
  const y0 = Math.max(0, Math.floor(region.y));
  const x1 = Math.min(img.width, Math.ceil(region.x + region.width));
  const y1 = Math.min(img.height, Math.ceil(region.y + region.height));
  const hist = new Float64Array(256);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * img.width + x) * 4;
      hist[Math.round((img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3)]++;
    }
  }
  let mode = 0;
  for (let v = 1; v < 256; v++) if (hist[v] > hist[mode]) mode = v;
  for (let v = Math.max(0, mode - 8); v <= Math.min(255, mode + 8); v++) hist[v] = 0;
  let n = 0;
  for (const c of hist) n += c;
  if (n < 32) return { lut: null, scale: 1 };
  const at = (frac) => {
    let seen = 0;
    for (let v = 0; v < 256; v++) {
      seen += hist[v];
      if (seen >= n * frac) return v;
    }
    return 255;
  };
  const lo = at(0.02);
  const hi = at(0.98);
  if (!(hi - lo > 1)) return { lut: null, scale: 1 };
  const scale = 255 / (hi - lo);
  const lut = Uint8ClampedArray.from({ length: 256 }, (_, i) => Math.round((i - lo) * scale));
  return { lut, scale };
}
const applyLut = (img, lut) => {
  const out = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < img.data.length; i += 4) {
    out[i] = lut[img.data[i]];
    out[i + 1] = lut[img.data[i + 1]];
    out[i + 2] = lut[img.data[i + 2]];
    out[i + 3] = img.data[i + 3];
  }
  return { data: out, width: img.width, height: img.height };
};

const gtDir = path.resolve(a.gt);
const rgbaDir = path.resolve(a.rgba);
const rows = [];
for (const f of readdirSync(gtDir).filter((n) => n.endsWith('.json')).sort()) {
  const gt = JSON.parse(readFileSync(path.join(gtDir, f), 'utf8'));
  if (!(gt.task1?.output?.chart_type ?? '').toLowerCase().endsWith('bar')) continue;
  const bars = gt.task6?.output?.['visual elements']?.bars ?? [];
  if (!bars.length) continue;
  let img;
  try {
    img = readRgba(path.join(rgbaDir, f.replace(/\.json$/, '.rgba')));
  } catch {
    continue;
  }
  const bb = gt.task4?.output?._plot_bb;
  if (!(bb?.width > 0)) continue;
  const region = { x: bb.x0, y: bb.y0, width: bb.width, height: bb.height };
  const picks = [];
  for (const c of bars.map((b) => fill(img, b))) {
    if (!picks.some((k) => k.every((v, i) => Math.abs(v - c[i]) <= DEDUPE))) picks.push(c);
  }
  const { lut, scale } = fgRange(img, region);
  if (!lut) continue;

  const run = (image, targets, tol) => {
    const boxes = [];
    for (const t of targets) {
      const r = runBarDetect(image.data, image.width, image.height, t, tol, 'foreground', region, {
        minDiameter: MIN_BLOB_DIAMETER,
      });
      if (!('error' in r)) boxes.push(...r.boxes.map(predBox));
    }
    return boxRecallIoU(bars.map(gtBox), boxes, 0.5).matched;
  };

  const stretched = run(applyLut(img, lut), picks.map((p) => [lut[p[0]], lut[p[1]], lut[p[2]]]), TOLERANCE);
  const equivalent = run(img, picks, Math.max(1, TOLERANCE / scale));
  rows.push({ name: f.replace(/\.json$/, ''), grey: mono(picks), scale, bars: bars.length, stretched, equivalent });
}

const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
const bars = sum('bars');
console.log(`figures ${rows.length}  bars ${bars}`);
console.log(`  stretch at tol 60          ${sum('stretched')}/${bars}  ${((100 * sum('stretched')) / bars).toFixed(1)}%`);
console.log(`  original at tol 60/scale   ${sum('equivalent')}/${bars}  ${((100 * sum('equivalent')) / bars).toFixed(1)}%`);

const disagree = rows.filter((r) => r.stretched !== r.equivalent);
console.log(`\nper-figure agreement: ${rows.length - disagree.length}/${rows.length} identical`);
const off = disagree.reduce((s, r) => s + Math.abs(r.stretched - r.equivalent), 0);
console.log(`bars accounted for differently: ${off} of ${bars} (${((100 * off) / bars).toFixed(1)}%)`);
console.log(`\nmedian scale factor: ${rows.map((r) => r.scale).sort((x, y) => x - y)[rows.length >> 1].toFixed(2)}`);
console.log('\nworst disagreements (scale, stretched vs equivalent):');
for (const r of disagree.sort((x, y) => Math.abs(y.stretched - y.equivalent) - Math.abs(x.stretched - x.equivalent)).slice(0, 12)) {
  console.log(`  ${r.name.padEnd(28)} s=${r.scale.toFixed(2)}  ${r.stretched} vs ${r.equivalent}  of ${r.bars}`);
}
