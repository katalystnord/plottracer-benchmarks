/**
 * Can the CATEGORY AXIS be MEASURED instead of declared? - a probe.
 *
 * ⚑⚑ WHY THIS DECIDES WHETHER AUTO CAN HAVE THE HATCH JOIN. `joinAcrossHatch`
 * takes (blobs, categoryAxis, dividers?). The dividers are already optional. The
 * ONE thing the automatic path cannot supply is `categoryAxis`, so the join is
 * gated off and Adobe bar recall stays at 35.3% while the assisted path reaches
 * 62.0%. If the axis can be read off the pixels, the gate opens with no
 * declaration and no guess.
 *
 * ⚠️ AND A GUESS IS EXACTLY WHAT COST US BEFORE. Defaulting the axis to `x` was
 * tried and lost 24 real bars across 5 figures: `PMC6603941___5` went from a
 * perfect 21/21 to 9 of 12, because it is a HORIZONTAL chart whose consecutive
 * bars are geometrically identical to hatch fragments unless you know which way
 * the categories run. So this probe does not ask "does a default work". It asks
 * whether a MEASUREMENT recovers the truth, and it is scored against the
 * corpus's own chart_type, which neither corpus lets us peek at in production.
 *
 * ⚑ THE RULE UNDER TEST: bars stand on a shared baseline. In a vertical bar
 * chart every bar's BOTTOM edge lands on one horizontal line; in a horizontal
 * one every bar's LEFT edge lands on one vertical line. So across the detected
 * blobs, one of the four box edges has a far tighter mode than the other three,
 * and the axis that edge lies on is the VALUE direction - which makes the
 * category axis the perpendicular one.
 *
 * ⛔⛔ MEASURED 2026-09-01, AND THE RULE IS REFUTED FOR THE CASE IT WAS BUILT
 * FOR. This header used to predict that "hatch fragments do not break it and may
 * even help". They break it, and they break it confidently:
 *
 *   | figures                  | axis read right |
 *   |--------------------------|-----------------|
 *   | PMC split_4 (189)        | 93.7%           |
 *   | Adobe, NOT fragmented (22)| 95.5%          |
 *   | Adobe, FRAGMENTED (476)  | 29.8%           |
 *
 * ⚑ WHY, and it is the same arithmetic that made the prediction sound right. A
 * hatch cuts one bar into ~30 slabs. All 30 share that bar's LEFT and RIGHT
 * edges, while only the lowest one touches the baseline - so the side edges
 * carry 30 votes per bar and the baseline carries 1. The hatch does not hide the
 * baseline; it OUT-VOTES it, and the most populous edge family stops being the
 * baseline exactly when the bar is shredded.
 *
 * ⚠️ AND THE CONFIDENCE GATE DOES NOT RESCUE IT. On PMC the margin sorts truth
 * from error cleanly (100% correct on the 112 figures above margin 0.35). On
 * Adobe it does not: 82.6% at that same threshold, and the errors split evenly
 * in both directions (170 read x-for-y, 165 y-for-x), so there is no systematic
 * flip to exploit either. Reaching 100% on Adobe needs margin 0.7, which keeps
 * 25 figures of 498.
 *
 * ▶ WHAT IT LEAVES STANDING. The rule reads a WHOLE bar's baseline well on both
 * corpora, and cannot read a SHREDDED one - which is backwards from what the
 * join needs, since fragmentation is the precondition for wanting the join at
 * all. The orientation of a fragmented figure has to come from the fragmentation
 * itself: `hatch-probe.py` already measures the 1D collapse (Adobe median
 * prominence 23.2 against PMC's 2.65) and the direction that peak lies along IS
 * the value direction. That is the next thing to measure, not this.
 *
 * ⚑ KEPT, not deleted: it is the control for whatever replaces it, and the
 * 95.5%-vs-29.8% split is the measurement that says where the boundary is.
 *
 * Reports ACCURACY AGAINST THE TRUTH on both corpora separately. PMC is the
 * control: a rule that reads Adobe correctly and misreads PMC has traded one
 * corpus for the other, which is the failure this repo has recorded three times.
 *
 * Usage: orientation-probe.mjs --gt <dir> --rgba <dir> [--limit N] [--out f.json]
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  readRgba, dedupeColours, boxFillColour, predBox, barsAreHorizontal,
  TOLERANCE, MIN_BLOB_DIAMETER,
} from './score.mjs';

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') ? true : argv[++i];
  }
  return out;
}

/**
 * How tightly one set of coordinates clusters on its single commonest value.
 *
 * ⚑ A SHARE, NOT A VARIANCE. What a baseline does is put MANY edges on ONE
 * line; it says nothing about how the rest are spread, and a couple of far
 * outliers would wreck a variance while leaving the baseline perfectly visible.
 */
function modalShare(values, tolPx) {
  if (values.length === 0) return { share: 0, at: null };
  let best = { share: 0, at: null };
  for (const v of values) {
    const n = values.filter((w) => Math.abs(w - v) <= tolPx).length;
    if (n > best.share) best = { share: n, at: v };
  }
  return { share: best.share / values.length, at: best.at };
}

/**
 * Read the value direction off the blobs: the edge with the tightest mode is
 * the baseline, and the baseline lies ALONG the category axis.
 */
function measureCategoryAxis(boxes, tolPx) {
  if (boxes.length < 2) return null;
  const edges = {
    minY: modalShare(boxes.map((b) => b.minY), tolPx), // top edge, horizontal line
    maxY: modalShare(boxes.map((b) => b.maxY), tolPx), // bottom edge, horizontal line
    minX: modalShare(boxes.map((b) => b.minX), tolPx), // left edge, vertical line
    maxX: modalShare(boxes.map((b) => b.maxX), tolPx),
  };
  // A horizontal baseline (minY/maxY shared) means bars run vertically, so the
  // categories run along x. A vertical baseline means the opposite.
  const horizontalBaseline = Math.max(edges.minY.share, edges.maxY.share);
  const verticalBaseline = Math.max(edges.minX.share, edges.maxX.share);
  return {
    categoryAxis: horizontalBaseline >= verticalBaseline ? 'x' : 'y',
    horizontalBaseline, verticalBaseline,
    margin: Math.abs(horizontalBaseline - verticalBaseline),
    edges,
  };
}

async function main() {
  const a = parseArgs(process.argv);
  const engineDir = path.resolve(a.engine ?? 'work/engine-js');
  // ⚑ runBarDetect with NO declarations is exactly the AUTO path's own view of
  // the figure - the fragments as the automatic path actually sees them.
  // runBlobDetect returns centroids only, and an edge cannot be read off a
  // centroid.
  const { runBarDetect } = await import(path.join(engineDir, 'engine/barDetectRun.js'));
  const gtDir = path.resolve(a.gt), rgbaDir = path.resolve(a.rgba);
  const limit = Number(a.limit ?? 0);

  const files = readdirSync(gtDir).filter((f) => f.endsWith('.json')).sort();
  const rows = [];
  for (const f of files) {
    if (limit && rows.length >= limit) break;
    const gt = JSON.parse(readFileSync(path.join(gtDir, f), 'utf8'));
    const ct = (gt.task1?.output?.chart_type ?? '').toLowerCase();
    if (!ct.endsWith('bar')) continue;
    const bars = gt.task6?.output?.['visual elements']?.bars ?? [];
    if (bars.length < 2) continue;
    let img;
    try { img = readRgba(path.join(rgbaDir, f.replace(/\.json$/, '.rgba'))); } catch { continue; }

    // The TRUTH, from the corpus's own label plus its own bar geometry.
    const truthHorizontal = barsAreHorizontal(gt);
    const truthAxis = truthHorizontal ? 'y' : 'x';

    const bb = gt.task4?.output?._plot_bb;
    const region = bb && bb.width > 0 && bb.height > 0
      ? { x: bb.x0, y: bb.y0, width: bb.width, height: bb.height } : undefined;
    const picks = dedupeColours(bars.map((b) => boxFillColour(img, b)));
    const boxes = [];
    for (const target of picks) {
      const r = runBarDetect(img.data, img.width, img.height, target, TOLERANCE, 'foreground',
        region, { minDiameter: MIN_BLOB_DIAMETER });
      if ('error' in r) continue;
      for (const b of r.boxes ?? []) boxes.push(predBox(b));
    }
    // Tolerance scales with the figure, the way every other threshold here does.
    const tolPx = Math.max(2, Math.round(0.005 * Math.min(img.width, img.height)));
    const m = measureCategoryAxis(boxes, tolPx);
    if (!m) continue;
    rows.push({
      file: f, chartType: ct, truthAxis, measured: m.categoryAxis,
      correct: m.categoryAxis === truthAxis,
      margin: Number(m.margin.toFixed(3)),
      hz: Number(m.horizontalBaseline.toFixed(3)),
      vt: Number(m.verticalBaseline.toFixed(3)),
      blobs: boxes.length, gtBars: bars.length,
      fragmented: boxes.length > bars.length * 2,
    });
  }

  const ok = rows.filter((r) => r.correct);
  const frag = rows.filter((r) => r.fragmented);
  const fragOk = frag.filter((r) => r.correct);
  const horiz = rows.filter((r) => r.truthAxis === 'y');
  const horizOk = horiz.filter((r) => r.correct);
  console.log(`figures            ${rows.length}`);
  console.log(`axis read right    ${ok.length}  (${(100 * ok.length / (rows.length || 1)).toFixed(1)}%)`);
  console.log(`  of the FRAGMENTED (>2 blobs per bar): ${fragOk.length}/${frag.length}` +
    (frag.length ? `  (${(100 * fragOk.length / frag.length).toFixed(1)}%)` : ''));
  console.log(`  of the HORIZONTAL charts (the case that broke a default): ` +
    `${horizOk.length}/${horiz.length}` +
    (horiz.length ? `  (${(100 * horizOk.length / horiz.length).toFixed(1)}%)` : ''));
  const wrong = rows.filter((r) => !r.correct).sort((x, y) => y.margin - x.margin);
  if (wrong.length) {
    console.log(`\nworst misreads (margin = how confidently it was wrong):`);
    for (const w of wrong.slice(0, 8)) {
      console.log(`  ${w.file}  truth ${w.truthAxis} read ${w.measured}  ` +
        `margin ${w.margin}  blobs ${w.blobs} / ${w.gtBars} bars`);
    }
  }
  if (a.out) { writeFileSync(a.out, JSON.stringify(rows, null, 2)); console.log(`\nwrote ${a.out}`); }
}
main();
