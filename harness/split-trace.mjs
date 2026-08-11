/**
 * WHY does the category-tick splitter fire and change nothing?
 *
 * Measured 2026-08-10 across 882 figures / 13,233 bars in three corpora: the
 * split FIRES on a large minority of figures and pooled recall moves by −0.05.
 * A fourth corpus would not answer that; a per-figure trace will. This is that
 * trace, and it asks one question the pooled number cannot:
 *
 *   ⚑⚑ OF THE BARS THAT WERE ACTUALLY LOST TO A MERGE, HOW MANY DOES THE SPLIT
 *      RECOVER — and for the ones it does not, how close does it get?
 *
 * "Lost to a merge" is defined from the data, not assumed: a ground-truth bar
 * that the BASELINE fails to match, whose best-overlapping predicted box also
 * covers another ground-truth bar. That is a merge, and it is the only failure
 * this feature could ever fix. Everything else the splitter does is noise on
 * bars that were already right or already hopeless — which is exactly what a
 * pooled recall number cannot separate.
 *
 * It imports score.mjs's OWN helpers (that file now runs `main()` only when it
 * is the program), so the dividers, the colour picks and the metric are the
 * same ones that produced the published numbers. Re-implementing them here
 * would diagnose a different experiment.
 *
 * Usage: node harness/split-trace.mjs --engine <dir> --gt <dir> --rgba <dir>
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  readRgba,
  dedupeColours,
  boxFillColour,
  isMonochrome,
  barsTouch,
  declaredDividers,
  gtBox,
  predBox,
  TOLERANCE,
  MIN_BLOB_DIAMETER,
} from './score.mjs';
import { boxRecallIoU } from './lib/metric.mjs';

function parseArgs(argv) {
  const o = {};
  for (let i = 2; i < argv.length; i += 2) o[argv[i].replace(/^--/, '')] = argv[i + 1];
  return o;
}
const a = parseArgs(process.argv);
const { runBarDetect } = await import(path.join(path.resolve(a.engine), 'engine/barDetectRun.js'));

function iou(p, q) {
  const x0 = Math.max(p.minX, q.minX);
  const y0 = Math.max(p.minY, q.minY);
  const x1 = Math.min(p.maxX, q.maxX);
  const y1 = Math.min(p.maxY, q.maxY);
  if (x1 <= x0 || y1 <= y0) return 0;
  const inter = (x1 - x0) * (y1 - y0);
  const areaP = (p.maxX - p.minX) * (p.maxY - p.minY);
  const areaQ = (q.maxX - q.minX) * (q.maxY - q.minY);
  return inter / (areaP + areaQ - inter);
}
/** Does this predicted box overlap the ground-truth bar at all, materially? */
const covers = (pred, g) => {
  const x0 = Math.max(pred.minX, g.minX);
  const y0 = Math.max(pred.minY, g.minY);
  const x1 = Math.min(pred.maxX, g.maxX);
  const y1 = Math.min(pred.maxY, g.maxY);
  if (x1 <= x0 || y1 <= y0) return false;
  const gArea = (g.maxX - g.minX) * (g.maxY - g.minY);
  return gArea > 0 && ((x1 - x0) * (y1 - y0)) / gArea > 0.5;
};
const best = (g, boxes) => {
  let bi = -1;
  let bv = 0;
  boxes.forEach((p, i) => {
    const v = iou(p, g);
    if (v > bv) {
      bv = v;
      bi = i;
    }
  });
  return { i: bi, v: bv };
};
/** Which ground-truth bars a predicted box swallows. */
const swallowed = (pred, gts) => gts.filter((g) => covers(pred, g)).length;

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
  const region = bb && bb.width > 0 && bb.height > 0 ? { x: bb.x0, y: bb.y0, width: bb.width, height: bb.height } : undefined;
  const picks = dedupeColours(bars.map((b) => boxFillColour(img, b)));
  const cats = declaredDividers(gt, 'bar', bb);

  const detect = (withCats) => {
    const boxes = [];
    for (const target of picks) {
      const r = runBarDetect(
        img.data, img.width, img.height, target, TOLERANCE, 'foreground', region,
        { minDiameter: MIN_BLOB_DIAMETER },
        withCats ?? undefined
      );
      if (!('error' in r)) boxes.push(...r.boxes.map(predBox));
    }
    return boxes;
  };
  const gts = bars.map(gtBox);
  const baseBoxes = detect(null);
  const tickBoxes = detect(cats);
  const mBase = boxRecallIoU(gts, baseBoxes, 0.5);
  const mTick = boxRecallIoU(gts, tickBoxes, 0.5);

  // The bars this feature could ever fix: unmatched at baseline, and the box
  // that best covers them also swallows another bar. That IS a merge.
  const mergeLost = [];
  for (const g of gts) {
    if (best(g, baseBoxes).v >= 0.5) continue;
    const owner = baseBoxes.find((p) => covers(p, g));
    if (owner && swallowed(owner, gts) >= 2) mergeLost.push(g);
  }
  const recovered = mergeLost.filter((g) => best(g, tickBoxes).v >= 0.5);
  const stillLost = mergeLost.filter((g) => best(g, tickBoxes).v < 0.5);

  // ⚑⚑ THE QUESTION THE WIDTH RATIO RAISES: is the merged run something a
  // CATEGORY divider could ever cut? A run that lies wholly inside one band is
  // two bars of the same category — adjacent series in a grouped chart whose
  // shades fell inside one tolerance ball. No category divider crosses it, so
  // this mechanism cannot touch it however well it is placed.
  const interior = cats ? cats.dividers.slice(1, -1) : [];
  const along = cats?.categoryAxis === 'y' ? ['minY', 'maxY'] : ['minX', 'maxX'];
  const crossesADivider = (box) => interior.some((d) => d > box[along[0]] && d < box[along[1]]);
  let insideOneBand = 0;
  for (const g of mergeLost) {
    const owner = baseBoxes.find((p) => covers(p, g));
    if (owner && !crossesADivider(owner)) insideOneBand++;
  }

  rows.push({
    file: f.replace(/\.json$/, ''),
    gt: gts.length,
    grey: isMonochrome(picks),
    touching: barsTouch(bars),
    fired: cats ? tickBoxes.length !== baseBoxes.length : false,
    dividers: cats ? cats.dividers.length : 0,
    tickKind: cats ? cats.kind : null,
    base: mBase.matched,
    tick: mTick.matched,
    predBase: baseBoxes.length,
    predTick: tickBoxes.length,
    mergeLost: mergeLost.length,
    recovered: recovered.length,
    insideOneBand,
    bands: cats ? Math.max(1, cats.dividers.length - 1) : 0,
    // For the ones still lost, how close did the split get, and how is the
    // piece shaped against the bar it should be?
    nearMiss: stillLost.map((g) => {
      const b = best(g, tickBoxes);
      const p = b.i >= 0 ? tickBoxes[b.i] : null;
      return {
        iou: +b.v.toFixed(3),
        wRatio: p ? +((p.maxX - p.minX) / Math.max(1, g.maxX - g.minX)).toFixed(2) : null,
        hRatio: p ? +((p.maxY - p.minY) / Math.max(1, g.maxY - g.minY)).toFixed(2) : null,
      };
    }),
  });
}

const sum = (k, f = () => true) => rows.filter(f).reduce((s, r) => s + r[k], 0);
const fired = rows.filter((r) => r.fired);
console.log(`figures ${rows.length}   bars ${sum('gt')}`);
console.log(`baseline matched ${sum('base')}   with ticks ${sum('tick')}   delta ${sum('tick') - sum('base')}`);
console.log(`\nthe split FIRED on ${fired.length} figures (${sum('gt', (r) => r.fired)} bars)`);
console.log(`  of those, recall CHANGED on ${fired.filter((r) => r.tick !== r.base).length}` +
  `  (up ${fired.filter((r) => r.tick > r.base).length}, down ${fired.filter((r) => r.tick < r.base).length})`);

const ML = sum('mergeLost');
const REC = sum('recovered');
console.log(`\n⚑ BARS ACTUALLY LOST TO A MERGE: ${ML} of ${sum('gt')} (${((100 * ML) / sum('gt')).toFixed(1)}%)`);
console.log(`  recovered by the split: ${REC}  (${ML ? ((100 * REC) / ML).toFixed(1) : '0.0'}% of what was there to win)`);
console.log(`  on figures where the split fired: ${sum('mergeLost', (r) => r.fired)} lost, ${sum('recovered', (r) => r.fired)} recovered`);

const IB = sum('insideOneBand');
console.log(`\n⚑⚑ OF THOSE ${ML} MERGED BARS, ${IB} (${((100 * IB) / Math.max(1, ML)).toFixed(1)}%) SIT WHOLLY INSIDE ONE CATEGORY BAND`);
console.log(`  -- no category divider crosses them, so this mechanism cannot cut them at any placement.`);
console.log(`  bars per band, median: ${(() => { const v = rows.filter((r) => r.bands > 1).map((r) => r.gt / r.bands).sort((x, y) => x - y); return v.length ? v[v.length >> 1].toFixed(1) : 'n/a'; })()}`);

const misses = rows.flatMap((r) => r.nearMiss);
const band = (lo, hi) => misses.filter((m) => m.iou >= lo && m.iou < hi).length;
console.log(`\nthe ${misses.length} merge-lost bars the split did NOT recover, by best IoU reached:`);
console.log(`  0.00-0.10 ${band(0, 0.1)}   0.10-0.30 ${band(0.1, 0.3)}   0.30-0.50 ${band(0.3, 0.5)}  <- 0.30-0.50 means "nearly"`);
const med = (xs) => (xs.length ? xs.slice().sort((p, q) => p - q)[xs.length >> 1] : null);
console.log(`  median width ratio (piece / bar):  ${med(misses.map((m) => m.wRatio).filter((v) => v != null))}`);
console.log(`  median height ratio (piece / bar): ${med(misses.map((m) => m.hRatio).filter((v) => v != null))}`);

console.log(`\nfigures with the most to win, and what happened:`);
for (const r of rows.filter((x) => x.mergeLost > 0).sort((x, y) => y.mergeLost - x.mergeLost).slice(0, 15)) {
  console.log(
    `  ${r.file.padEnd(30)} gt ${String(r.gt).padStart(3)}  lost ${String(r.mergeLost).padStart(3)}` +
      `  recovered ${String(r.recovered).padStart(3)}  base ${String(r.base).padStart(3)}->${String(r.tick).padStart(3)}` +
      `  pred ${r.predBase}->${r.predTick}  div ${r.dividers}  ${r.grey ? 'grey' : 'colour'} ${r.fired ? 'FIRED' : '-'}`
  );
}

if (a.out) {
  writeFileSync(path.resolve(a.out), JSON.stringify(rows, null, 1));
  console.log(`\nwrote ${a.out}`);
}
