/**
 * The splitter cuts at CATEGORY boundaries. The merges cost recall at
 * SERIES-WITHIN-CATEGORY boundaries. Is that the whole story?
 *
 * `split-trace.mjs` measured it: of 533 bars genuinely lost to a merge, the
 * shipped split recovers 8.8% (up to ~19% once pathological figures are
 * excluded), 29% of the merges sit wholly inside one band where no category
 * divider crosses them at all, and the pieces it fails on are a median of 2.0×
 * the width of the bar they should be. Meanwhile the corpus's median figure
 * carries 2.0 bars per category band and 93 of 142 figures carry more than 1.5.
 *
 * Every one of those numbers says the same thing: the cut is at the wrong
 * GRANULARITY. So this asks the question that decides whether to build
 * anything further — IF each band were subdivided into its own bars, what would
 * recall be?
 *
 * ⚑ THIS IS A CEILING, and deliberately so. It takes the number of bars per
 * band from the ground truth, which the app does not have. The app's version of
 * this input is a DECLARATION — the user already types a category count, and
 * "how many bars per category" is the same kind of answer about the same
 * figure. What the ceiling says is whether that declaration would be worth
 * asking for. If recall barely moves even when the count is perfect, no UI can
 * rescue it and the touching-bars line is finished.
 *
 * Usage: node harness/subdivide-probe.mjs --engine <dir> --gt <dir> --rgba <dir>
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  readRgba, dedupeColours, boxFillColour, isMonochrome,
  declaredDividers, gtBox, predBox, TOLERANCE, MIN_BLOB_DIAMETER,
} from './score.mjs';
import { boxRecallIoU } from './lib/metric.mjs';

function parseArgs(argv) {
  const o = {};
  for (let i = 2; i < argv.length; i += 2) o[argv[i].replace(/^--/, '')] = argv[i + 1];
  return o;
}
const a = parseArgs(process.argv);
const { runBarDetect } = await import(path.join(path.resolve(a.engine), 'engine/barDetectRun.js'));

/** Subdivide each band into the number of bars that band actually holds. */
function subdivide(cats, bars) {
  const horizontal = cats.categoryAxis === 'y';
  const centre = (b) => (horizontal ? b.y0 + b.height / 2 : b.x0 + b.width / 2);
  const out = [cats.dividers[0]];
  for (let i = 0; i < cats.dividers.length - 1; i++) {
    const lo = cats.dividers[i];
    const hi = cats.dividers[i + 1];
    const n = bars.filter((b) => centre(b) >= lo && centre(b) < hi).length;
    for (let k = 1; k < Math.max(1, n); k++) out.push(lo + ((hi - lo) * k) / n);
    out.push(hi);
  }
  return { ...cats, dividers: out };
}

const gtDir = path.resolve(a.gt);
const rgbaDir = path.resolve(a.rgba);
const acc = {
  base: [0, 0, 0],       // matched, gt, predictions
  cats: [0, 0, 0],
  subdiv: [0, 0, 0],
};
const greyAcc = { base: [0, 0], cats: [0, 0], subdiv: [0, 0] };
let figures = 0;
let subdividedFigures = 0;
const effect = { cats: { fixed: 0, broke: 0 }, subdiv: { fixed: 0, broke: 0 } };

/** Best IoU of any predicted box against one ground-truth bar. */
function bestIou(g, boxes) {
  let bv = 0;
  for (const p of boxes) {
    const x0 = Math.max(p.minX, g.minX), y0 = Math.max(p.minY, g.minY);
    const x1 = Math.min(p.maxX, g.maxX), y1 = Math.min(p.maxY, g.maxY);
    if (x1 <= x0 || y1 <= y0) continue;
    const inter = (x1 - x0) * (y1 - y0);
    const ap = (p.maxX - p.minX) * (p.maxY - p.minY);
    const ag = (g.maxX - g.minX) * (g.maxY - g.minY);
    const v = inter / (ap + ag - inter);
    if (v > bv) bv = v;
  }
  return bv;
}

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
  const region = bb && bb.width > 0 && bb.height > 0 ? { x: bb.x0, y: bb.y0, width: bb.width, height: bb.height } : undefined;
  const picks = dedupeColours(bars.map((b) => boxFillColour(img, b)));
  const cats = declaredDividers(gt, 'bar', bb);
  const fine = cats ? subdivide(cats, bars) : null;
  if (fine && fine.dividers.length > (cats?.dividers.length ?? 0)) subdividedFigures++;
  figures++;

  const run = (withCats) => {
    const boxes = [];
    for (const target of picks) {
      const r = runBarDetect(
        img.data, img.width, img.height, target, TOLERANCE, 'foreground', region,
        { minDiameter: MIN_BLOB_DIAMETER }, withCats ?? undefined
      );
      if (!('error' in r)) boxes.push(...r.boxes.map(predBox));
    }
    return boxes;
  };
  const gts = bars.map(gtBox);
  const grey = isMonochrome(picks);
  const matchedSet = {};
  for (const [key, withCats] of [['base', null], ['cats', cats], ['subdiv', fine]]) {
    const boxes = run(withCats);
    // Which INDIVIDUAL bars this arm got, so the two opposite effects of a finer
    // cut can be counted apart: bars it FIXED (merged before, right now) and bars
    // it BROKE (right before, cut through now). A pooled recall shows only the sum.
    matchedSet[key] = new Set(gts.map((g, i) => (bestIou(g, boxes) >= 0.5 ? i : -1)).filter((i) => i >= 0));
    const m = boxRecallIoU(gts, boxes, 0.5);
    acc[key][0] += m.matched;
    acc[key][1] += m.gt;
    acc[key][2] += m.pred;
    if (grey) {
      greyAcc[key][0] += m.matched;
      greyAcc[key][1] += m.gt;
    }
  }
  for (const key of ['cats', 'subdiv']) {
    for (const i of matchedSet[key]) if (!matchedSet.base.has(i)) effect[key].fixed++;
    for (const i of matchedSet.base) if (!matchedSet[key].has(i)) effect[key].broke++;
  }
}

console.log(`figures ${figures}   subdivided ${subdividedFigures}\n`);
const pc = (x) => `${((100 * x[0]) / x[1]).toFixed(1)}%`.padStart(6);
console.log('arm       recall   matched/gt      predictions   greyscale');
for (const [key, label] of [['base', 'none'], ['cats', 'category'], ['subdiv', 'per-bar']]) {
  console.log(
    `${label.padEnd(9)} ${pc(acc[key])}   ${String(acc[key][0]).padStart(4)}/${acc[key][1]}` +
      `      ${String(acc[key][2]).padStart(6)}       ${pc(greyAcc[key])}`
  );
}

console.log('\n⚑ the two opposite effects, counted apart (a pooled recall shows only their sum):');
for (const key of ['cats', 'subdiv']) {
  const e = effect[key];
  console.log(`  ${key.padEnd(7)} FIXED ${String(e.fixed).padStart(4)} bars (merged before, right now)   BROKE ${String(e.broke).padStart(4)} bars (right before, cut through now)`);
}
console.log('\n⚑ a split that never cuts an already-correct bar would keep the fixes and drop the breaks:');
const ceiling = (acc.base[0] + effect.subdiv.fixed) / acc.base[1];
console.log(`  ceiling for a CONDITIONAL per-bar split: ${(100 * ceiling).toFixed(1)}%  (from ${(100 * acc.base[0] / acc.base[1]).toFixed(1)}%)`);
