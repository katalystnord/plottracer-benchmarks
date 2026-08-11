/**
 * How much of the conditional split's 82.2% ceiling survives a REAL test?
 *
 * `subdivide-probe.mjs` measured that per-bar dividers fix 197 bars and break
 * 577, because the split cuts every run crossing a divider — including runs that
 * were already one correct bar. An oracle that never cut a correct bar would
 * reach 82.2% from 76.1%. That oracle does not exist. The app's version of it is
 * a WIDTH TEST: a run wider than one slot is a run holding more than one bar, so
 * cut it; a run that already fits a slot is one bar, so leave it alone.
 *
 * ⚑ THE PIECES MUST BE THE APP'S OWN. A split piece is boxed by its INK, not by
 * its band (commit 2dc2a57) — bars rarely fill their bands, and a harness that
 * cut boxes geometrically would score a piece the app never produces. So this
 * runs the detector TWICE per colour, unsplit and per-bar-split, and composes:
 * keep the unsplit run where the width test says one bar, and take the app's own
 * split pieces inside it where the test says more. Every box scored here is a
 * box `runBarDetect` actually returned.
 *
 * ⚑ THE THRESHOLD IS TUNED ON ONE SPLIT AND CHECKED ON THE OTHER. A ratio picked
 * on the same 192 figures it is then reported against is a fitted parameter
 * wearing a measurement's clothes. Run with --gt split_4 to choose it and --gt
 * split_5 to see whether it holds.
 *
 * Still a CEILING in one respect, stated so it is not misread: the per-bar
 * dividers come from the ground truth's own bar counts. This isolates the
 * question asked — how much of the prize the WIDTH TEST costs — from the
 * separate question of whether a user can declare the count.
 *
 * Usage: node harness/conditional-split-probe.mjs --engine <dir> --gt <dir> --rgba <dir>
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

/** The width ratios to try. 1.0 would cut anything a hair over a slot. */
const RATIOS = [1.15, 1.25, 1.4, 1.5, 1.75, 2.0, 2.5];

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

const median = (xs) => (xs.length ? xs.slice().sort((p, q) => p - q)[xs.length >> 1] : 0);

function bestIou(g, boxes) {
  let bv = 0;
  for (const p of boxes) {
    const x0 = Math.max(p.minX, g.minX);
    const y0 = Math.max(p.minY, g.minY);
    const x1 = Math.min(p.maxX, g.maxX);
    const y1 = Math.min(p.maxY, g.maxY);
    if (x1 <= x0 || y1 <= y0) continue;
    const inter = (x1 - x0) * (y1 - y0);
    const ap = (p.maxX - p.minX) * (p.maxY - p.minY);
    const ag = (g.maxX - g.minX) * (g.maxY - g.minY);
    const v = inter / (ap + ag - inter);
    if (v > bv) bv = v;
  }
  return bv;
}
const matchedIndexes = (gts, boxes) =>
  new Set(gts.map((g, i) => (bestIou(g, boxes) >= 0.5 ? i : -1)).filter((i) => i >= 0));

const gtDir = path.resolve(a.gt);
const rgbaDir = path.resolve(a.rgba);

const arms = ['base', 'always', ...RATIOS.map((r) => `w${r}`), 'greyOnly'];
const acc = Object.fromEntries(arms.map((k) => [k, [0, 0, 0]]));
const grey = Object.fromEntries(arms.map((k) => [k, [0, 0]]));
const colour = Object.fromEntries(arms.map((k) => [k, [0, 0]]));
const effect = Object.fromEntries(arms.map((k) => [k, { fixed: 0, broke: 0, cut: 0 }]));
let figures = 0;

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
  const picks = dedupeColours(bars.map((b) => boxFillColour(img, b)));
  const cats = declaredDividers(gt, 'bar', bb);
  if (!cats) continue;
  const fine = subdivide(cats, bars);
  figures++;

  const horizontal = cats.categoryAxis === 'y';
  const lo = horizontal ? 'minY' : 'minX';
  const hi = horizontal ? 'maxY' : 'maxX';
  const gaps = fine.dividers.slice(1).map((d, i) => d - fine.dividers[i]);
  const slot = median(gaps.filter((g) => g > 0));

  const detect = (withCats) => {
    const out = [];
    for (const target of picks) {
      const r = runBarDetect(
        img.data, img.width, img.height, target, TOLERANCE, 'foreground', region,
        { minDiameter: MIN_BLOB_DIAMETER }, withCats ?? undefined
      );
      out.push(('error' in r ? [] : r.boxes.map(predBox)));
    }
    return out;
  };
  const basePer = detect(null);   // per pick, so a piece is matched to its own run
  const finePer = detect(fine);
  const gts = bars.map(gtBox);
  const isGrey = isMonochrome(picks);

  /** Keep a run whole unless it is wider than `ratio` slots; then take the app's
   * OWN pieces from inside it. */
  const compose = (ratio) => {
    const out = [];
    let cut = 0;
    basePer.forEach((runs, p) => {
      for (const run of runs) {
        if (!(slot > 0) || run[hi] - run[lo] <= ratio * slot) {
          out.push(run);
          continue;
        }
        const inside = finePer[p].filter((piece) => {
          const c = (piece[lo] + piece[hi]) / 2;
          return c >= run[lo] && c <= run[hi];
        });
        if (inside.length > 1) {
          out.push(...inside);
          cut++;
        } else {
          out.push(run);
        }
      }
    });
    return { boxes: out, cut };
  };

  const armBoxes = {
    base: { boxes: basePer.flat(), cut: 0 },
    always: { boxes: finePer.flat(), cut: 0 },
    ...Object.fromEntries(RATIOS.map((r) => [`w${r}`, compose(r)])),
  };
  // ⚑ A gate the APP can apply: the user's own picks say whether this figure
  // encodes its series by shade. Splitting is where the shades merge; a colour
  // figure has nothing to gain and something to lose.
  armBoxes.greyOnly = isGrey ? compose(1.15) : { boxes: basePer.flat(), cut: 0 };
  const baseMatched = matchedIndexes(gts, armBoxes.base.boxes);
  for (const key of arms) {
    const { boxes, cut } = armBoxes[key];
    const m = boxRecallIoU(gts, boxes, 0.5);
    acc[key][0] += m.matched;
    acc[key][1] += m.gt;
    acc[key][2] += m.pred;
    const bucket = isGrey ? grey : colour;
    bucket[key][0] += m.matched;
    bucket[key][1] += m.gt;
    effect[key].cut += cut;
    const mine = matchedIndexes(gts, boxes);
    for (const i of mine) if (!baseMatched.has(i)) effect[key].fixed++;
    for (const i of baseMatched) if (!mine.has(i)) effect[key].broke++;
  }
}

console.log(`figures ${figures}   bars ${acc.base[1]}\n`);
const pc = (x) => `${((100 * x[0]) / Math.max(1, x[1])).toFixed(1)}%`.padStart(6);
console.log('rule                 recall  greyscale   colour   fixed  broke   net   runs cut');
for (const key of arms) {
  const e = effect[key];
  const label = key === 'base' ? 'no split'
    : key === 'always' ? 'always (per-bar)'
    : key === 'greyOnly' ? '> 1.15, GREY only'
    : `only if > ${key.slice(1)} slots`;
  console.log(
    `${label.padEnd(20)} ${pc(acc[key])}   ${pc(grey[key])}   ${pc(colour[key])}   ${String(e.fixed).padStart(4)}  ${String(e.broke).padStart(5)}` +
      `  ${String(e.fixed - e.broke).padStart(5)}   ${String(e.cut).padStart(6)}`
  );
}
