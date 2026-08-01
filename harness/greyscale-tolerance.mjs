/**
 * Is the default colour tolerance too coarse for GREYSCALE figures?
 *
 * The measurement that prompted this: across 101 greyscale bar figures, the
 * number of distinct grey LEVELS matches the series count 81% of the time — so
 * the figures do encode series by shade, and the signal is there. But 35% of the
 * gaps between adjacent bar greys are SMALLER than the app's default tolerance
 * of 60, meaning two different series sit inside one tolerance ball and match as
 * the same colour.
 *
 * ⚑ THIS IS NOT THE TOLERANCE SWEEP ALREADY ON THE SPENT LIST. That one swept
 * 20/30/40/50/60/75 across ALL figures asking about TOUCHING bars, and 60 won.
 * This asks a different question of a different subset: on GREYSCALE figures
 * specifically, where the failure is two shades merging rather than two bars
 * merging, is 60 the wrong ruler? A global optimum can hide a class-specific
 * one.
 *
 * Usage: node harness/greyscale-tolerance.mjs --engine <dir> --gt <dir> --rgba <dir>
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

function readRgba(file) {
  const buf = readFileSync(file);
  const width = buf.readUInt32LE(0);
  const height = buf.readUInt32LE(4);
  return { data: new Uint8ClampedArray(buf.buffer, buf.byteOffset + 8, width * height * 4), width, height };
}
const sample = (img, x, y) => {
  const px = Math.max(0, Math.min(img.width - 1, Math.round(x)));
  const py = Math.max(0, Math.min(img.height - 1, Math.round(y)));
  const i = (py * img.width + px) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};
/** The bar's fill, as the modal colour of a grid sampled inside it. */
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

const TOLERANCES = [60, 45, 35, 25, 18, 12, 8];

/**
 * Contrast-stretch a figure's PLOT BOX to the full range.
 *
 * ⚑ THE POINT, and it is why this beats lowering the tolerance: greyscale
 * figures encode series by shade, and 35% of the gaps between adjacent bar greys
 * are smaller than the tolerance — so two series merge. Lowering the tolerance
 * fixes that and breaks colour figures, because one global ruler cannot serve
 * both. Stretching the greys widens the GAPS instead, so the SAME tolerance
 * separates them. Colour figures are left alone.
 *
 * Per-channel on the same scale factor, so a near-neutral stays near-neutral and
 * nothing acquires a hue that the figure never drew.
 */
function normalisePlotBox(img, region) {
  const out = new Uint8ClampedArray(img.data);
  const x0 = Math.max(0, Math.floor(region?.x ?? 0));
  const y0 = Math.max(0, Math.floor(region?.y ?? 0));
  const x1 = Math.min(img.width, Math.ceil((region?.x ?? 0) + (region?.width ?? img.width)));
  const y1 = Math.min(img.height, Math.ceil((region?.y ?? 0) + (region?.height ?? img.height)));
  let lo = 255;
  let hi = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * img.width + x) * 4;
      const l = (out[i] + out[i + 1] + out[i + 2]) / 3;
      if (l < lo) lo = l;
      if (l > hi) hi = l;
    }
  }
  if (hi - lo < 1e-6) return img;
  const scale = 255 / (hi - lo);
  for (let i = 0; i < out.length; i += 4) {
    for (let c = 0; c < 3; c++) out[i + c] = (out[i + c] - lo) * scale;
  }
  return { data: out, width: img.width, height: img.height };
}
const gtDir = path.resolve(a.gt);
const rgbaDir = path.resolve(a.rgba);

const figures = [];
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
  const region = bb?.width > 0 ? { x: bb.x0, y: bb.y0, width: bb.width, height: bb.height } : undefined;
  const picks = bars.map((b) => fill(img, b));
  figures.push({ img, bars, region, picks, grey: mono(picks) });
}

console.log(`figures: ${figures.length}  (greyscale ${figures.filter((f) => f.grey).length})\n`);

// The comparison that matters: normalise the plot box, keep the DEFAULT
// tolerance, and see whether greyscale recovers without costing colour.
{
  const acc = { grey: [0, 0], colour: [0, 0] };
  for (const fig of figures) {
    const img = normalisePlotBox(fig.img, fig.region);
    const picks = fig.bars.map((b) => fill(img, b));
    const kept = [];
    for (const c of picks) if (!kept.some((k) => k.every((v, i) => Math.abs(v - c[i]) <= 30))) kept.push(c);
    const boxes = [];
    for (const target of kept) {
      const r = runBarDetect(img.data, img.width, img.height, target, 60, 'foreground', fig.region, { minDiameter: 3 });
      if (!('error' in r)) boxes.push(...r.boxes.map(predBox));
    }
    const m = boxRecallIoU(fig.bars.map(gtBox), boxes, 0.5);
    const bucket = fig.grey ? acc.grey : acc.colour;
    bucket[0] += m.matched;
    bucket[1] += m.gt;
  }
  const pc = (x) => `${((100 * x[0]) / x[1]).toFixed(1)}%`.padStart(6);
  console.log('NORMALISED plot box, tolerance 60 (the shipped default):');
  console.log(`      ${pc(acc.grey)} (${acc.grey[0]}/${acc.grey[1]})   ${pc(acc.colour)} (${acc.colour[0]}/${acc.colour[1]})\n`);
}
console.log('tol   greyscale recall      colour recall');
for (const tol of TOLERANCES) {
  const acc = { grey: [0, 0], colour: [0, 0] };
  for (const fig of figures) {
    // Dedupe picks at THIS tolerance — a user cannot distinguish two colours the
    // detector will merge anyway, so the pick count has to follow the setting.
    const kept = [];
    for (const c of fig.picks) {
      if (!kept.some((k) => k.every((v, i) => Math.abs(v - c[i]) <= tol / 2))) kept.push(c);
    }
    const boxes = [];
    for (const target of kept) {
      const r = runBarDetect(fig.img.data, fig.img.width, fig.img.height, target, tol, 'foreground', fig.region, {
        minDiameter: 3,
      });
      if (!('error' in r)) boxes.push(...r.boxes.map(predBox));
    }
    const m = boxRecallIoU(fig.bars.map(gtBox), boxes, 0.5);
    const bucket = fig.grey ? acc.grey : acc.colour;
    bucket[0] += m.matched;
    bucket[1] += m.gt;
  }
  const pc = (x) => `${((100 * x[0]) / x[1]).toFixed(1)}%`.padStart(6);
  const mark = tol === 60 ? '  <- shipped default' : '';
  console.log(`${String(tol).padStart(3)}   ${pc(acc.grey)} (${acc.grey[0]}/${acc.grey[1]})   ${pc(acc.colour)} (${acc.colour[0]}/${acc.colour[1]})${mark}`);
}
