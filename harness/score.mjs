/**
 * The scorer. Runs PlotTracer's REAL extraction code over a corpus and scores
 * it against that corpus's own ground truth.
 *
 * ⚑ It imports the app's own modules -- `runBarDetect`, `runBlobDetect`,
 * `runColorTrace` -- from a compiled checkout. Nothing here reimplements
 * extraction. If this harness and the app ever disagree, the harness is wrong
 * by construction, which is the only arrangement worth publishing a number from.
 *
 * ⚑ WHAT THE HARNESS SUPPLIES, AND WHY. PlotTracer is human-in-the-loop: a
 * person calibrates the axes and picks the curve/bar/marker colour, then the
 * app extracts. To measure the app rather than the person, the harness supplies
 * exactly those two human inputs and nothing else:
 *
 *   1. the PLOT BOX  -- from the corpus's own `task4.output._plot_bb`, which is
 *      what a user has after clicking the axes.
 *   2. the COLOUR(S) -- sampled FROM THE IMAGE at ground-truth element
 *      positions, then deduplicated to visually distinct colours. This models
 *      "the user clicks each colour they can see". It hands over a location to
 *      sample, never an answer: the detector still has to find every element of
 *      that colour by itself, and is scored on all of them.
 *
 * Everything after that is the app's own code, at the app's own default
 * settings (tolerance 60, minimum blob diameter 3).
 *
 * Usage:
 *   node harness/score.mjs --engine <dir> --gt <dir> --rgba <dir> [--type bar,line,scatter]
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { boxRecallIoU, pointScore, toleranceFor } from './lib/metric.mjs';

// The app's own defaults, not tuned for this run -- see Workspace.tsx.
export const TOLERANCE = 60;
export const MIN_BLOB_DIAMETER = 3;
/** Two picks closer than this in every channel are the same colour to the eye. */
const DEDUPE_CHEBYSHEV = TOLERANCE / 2;
/** A resampled trace point must sit within this many px of the GT vertex's x. */
const RESAMPLE_X_WINDOW = 2;

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 2) out[argv[i].replace(/^--/, '')] = argv[i + 1];
  return out;
}

/** Read the <u32 w><u32 h><rgba> plane written by decode.py. */
export function readRgba(file) {
  const buf = readFileSync(file);
  const width = buf.readUInt32LE(0);
  const height = buf.readUInt32LE(4);
  const data = new Uint8ClampedArray(buf.buffer, buf.byteOffset + 8, width * height * 4);
  return { data, width, height };
}

/** An [r,g,b] triple -- the app's own `RGB` shape, so picks pass straight in. */
function samplePixel(img, x, y) {
  const px = Math.max(0, Math.min(img.width - 1, Math.round(x)));
  const py = Math.max(0, Math.min(img.height - 1, Math.round(y)));
  const i = (py * img.width + px) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

/** Collapse picks that are the same colour to the eye. Order-stable. */
export function dedupeColours(picks) {
  const kept = [];
  for (const c of picks) {
    const dup = kept.some((k) => k.every((v, i) => Math.abs(v - c[i]) <= DEDUPE_CHEBYSHEV));
    if (!dup) kept.push(c);
  }
  return kept;
}

/**
 * The one colour a user would pick for this series: the most common of the
 * sampled pixels, bucketed coarsely so JPEG ringing around a marker's edge does
 * not split one visual colour into a dozen near-identical ones.
 *
 * ⚑ WHY MODAL, AND NOT "every distinct colour, unioned" (which is what BARS
 * get). A bar chart's ground truth is a FLAT list of every bar in the figure,
 * and those bars legitimately differ in colour, so a user picks each one and the
 * union is the honest model. A scatter or line SERIES is one thing a user picks
 * ONCE. Unioning per-point picks there ran the detector N times over the same
 * plot box and unioned N overlapping answers -- 2,270 predictions against 24
 * real points in the worst figure. That is the harness inventing a false
 * positive rate the app does not have: measured before this was fixed, the
 * competition score read 0.425 while 86.6% of real points were being found.
 */
/**
 * The colour a user would click inside this ground-truth box: the modal colour
 * of a grid of pixels sampled INSIDE it, inset by a pixel to stay off the
 * outline.
 *
 * ⚑ WHY NOT JUST THE CENTRE PIXEL, which is what this harness did first. Chart
 * libraries draw bars with a stroked outline, and the synthetic corpus contains
 * segments as thin as 2 PIXELS. The centre pixel of a 2px-wide segment IS the
 * outline -- so the pick came back near-black, and a near-black pick at
 * tolerance 60 matches every axis line, tick and label in the figure: one such
 * pick returned a single blob of 914,064 px², essentially the whole plot box.
 * That manufactured a 30x false-positive rate (median 356 predicted boxes
 * against 12 real bars) and dragged the measured bar recall on this corpus down
 * to 37.2%. Sampling the FILL is what a person does with an eyedropper.
 */
export function boxFillColour(img, box) {
  const inset = Math.min(1, Math.floor(box.width / 4), Math.floor(box.height / 4));
  const x0 = box.x0 + inset;
  const y0 = box.y0 + inset;
  const w = Math.max(1, box.width - 2 * inset);
  const h = Math.max(1, box.height - 2 * inset);
  const samples = [];
  const steps = 5;
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < steps; j++) {
      samples.push(samplePixel(img, x0 + ((i + 0.5) * w) / steps, y0 + ((j + 0.5) * h) / steps));
    }
  }
  return modalColour(samples);
}

function modalColour(samples) {
  const buckets = new Map();
  for (const c of samples) {
    const key = c.map((v) => v >> 3).join(',');
    const hit = buckets.get(key);
    if (hit) hit.n++;
    else buckets.set(key, { n: 1, colour: c });
  }
  let best = null;
  for (const b of buckets.values()) if (!best || b.n > best.n) best = b;
  return best ? best.colour : [0, 0, 0];
}

export const gtBox = (b) => ({ minX: b.x0, minY: b.y0, maxX: b.x0 + b.width, maxY: b.y0 + b.height });
export const predBox = (b) => ({ minX: b.start.x, minY: b.start.y, maxX: b.end.x, maxY: b.end.y });

/** Is every sampled element pixel effectively grey? (Strict: one coloured
 *  element puts the figure in the COLOUR bucket, so colour numbers are if
 *  anything pessimistic.) */
export function isMonochrome(colours) {
  return colours.every((c) => Math.max(...c) - Math.min(...c) < 30);
}

/**
 * Do this figure's bars mostly TOUCH their neighbours?
 *
 * Bars of the same colour with no gap between them flood into a single blob and
 * come back as one oversized bar, so separating "touching" from "separated" is
 * what turns one recall number into a diagnosis. Measured along the category
 * axis: bars are grouped into rows/columns by their shared extent, and a figure
 * counts as touching when more than half of the adjacent pairs have zero or
 * negative gap.
 */
export function barsTouch(bars) {
  if (bars.length < 2) return false;
  // Vertical bars share a baseline (y0+height); horizontal bars share x0.
  const vertical = new Set(bars.map((b) => Math.round(b.y0 + b.height))).size <= new Set(bars.map((b) => Math.round(b.x0))).size;
  const lo = (b) => (vertical ? b.x0 : b.y0);
  const hi = (b) => (vertical ? b.x0 + b.width : b.y0 + b.height);
  const sorted = [...bars].sort((a, b) => lo(a) - lo(b));
  let pairs = 0;
  let touching = 0;
  for (let i = 1; i < sorted.length; i++) {
    pairs++;
    if (lo(sorted[i]) - hi(sorted[i - 1]) <= 0) touching++;
  }
  return pairs > 0 && touching / pairs > 0.5;
}

/**
 * Resample a dense trace at the ground truth's own x positions.
 *
 * ⚑ WHY THIS IS A FAIRNESS CORRECTION, NOT A THUMB ON THE SCALE. The competition
 * metric divides by max(#GT, #pred), so a tracer that emits one point per pixel
 * COLUMN (hundreds) against a ground truth digitised at ~20 vertices would score
 * near zero however perfectly it followed the curve -- it would be measuring
 * sampling density, not accuracy. Resampling asks the only question that means
 * anything here: at the x positions the annotator chose, is our y the same as
 * theirs? A vertex our trace never covered stays unmatched and still counts
 * against us.
 */
function resampleAtGtX(trace, gtPoints) {
  const out = [];
  for (const g of gtPoints) {
    let best = null;
    let bestDx = Infinity;
    for (const p of trace) {
      const dx = Math.abs(p.x - g.x);
      if (dx < bestDx) {
        bestDx = dx;
        best = p;
      }
    }
    if (best && bestDx <= RESAMPLE_X_WINDOW) out.push({ x: g.x, y: best.y });
  }
  return out;
}

/**
 * The DECLARED category dividers for a bar figure, built from the corpus's own
 * axis annotation (v2.1).
 *
 * ⚑ WHAT THIS MODELS, AND WHAT IT DOES NOT. PlotTracer asks the user to mark the
 * category axis and say how many categories there are; the app then generates
 * the dividers. Here the corpus's own tick locations stand in for that marking,
 * which measures the CEILING -- what the feature gives when the categories are
 * marked exactly right. A real user placing two ends and a count lands near it
 * on an evenly spaced chart and further away on an irregular one. This is a
 * "how much is on the table" number, not a "what a user gets" number, and must
 * be reported as such.
 *
 * ⚑ The corpus distinguishes the two tick conventions itself (`_x-tick-type`):
 * `separators` sit BETWEEN categories and are already dividers; `markers` sit
 * under each one, so the dividers are their midpoints. Same rule as the app's
 * own `dividerParamsFrom`. Closed at both ends by the plot box.
 */
export function declaredDividers(gt, family, bb) {
  const t4 = gt.task4?.output;
  if (!t4 || !bb) return null;
  const horizontal = (gt.task1?.output?.chart_type ?? '').toLowerCase().includes('horizontal');
  const axisKey = horizontal ? 'y-axis' : 'x-axis';
  const typeKey = horizontal ? '_y-tick-type' : '_x-tick-type';
  // ⚑ THE CORPUS'S OWN LABEL IS NOT TRUSTWORTHY. Measured across 276 vertical
  // bar figures, `_x-tick-type` disagrees with the figure's own geometry in 39%
  // of cases -- PMC5715234 is annotated `separators` while its six ticks sit
  // dead centre of its six bars. Trusting it put a divider through the middle of
  // every bar and CUT EACH ONE IN HALF: the prediction count doubled exactly,
  // which is what gave the fault away.
  //
  // So the convention is read off the geometry: do the ticks fall inside bars,
  // or between them? That is the same question a user answers by looking, and it
  // is the one thing the harness supplies here beyond the plot box and colours.
  // It hands over no position -- the detector still has to find every bar.
  const bars = gt.task6?.output?.['visual elements']?.bars ?? [];
  const labelled = t4.axes?.[typeKey];
  const ticks = (t4.axes?.[axisKey] ?? [])
    .map((t) => (horizontal ? t.tick_pt?.y : t.tick_pt?.x))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  if (ticks.length < 2 || bars.length === 0) return null;
  const inside = ticks.filter((t) =>
    bars.some((b) =>
      horizontal ? b.y0 <= t && t <= b.y0 + b.height : b.x0 <= t && t <= b.x0 + b.width
    )
  ).length;
  const kind = inside > ticks.length / 2 ? 'markers' : 'separators';
  const lo = horizontal ? bb.y0 : bb.x0;
  const hi = horizontal ? bb.y0 + bb.height : bb.x0 + bb.width;
  const interior =
    kind === 'separators'
      ? ticks.filter((t) => t > lo && t < hi)
      : ticks.slice(0, -1).map((t, i) => (t + ticks[i + 1]) / 2);
  const dividers = [lo, ...interior, hi];
  return { dividers, categoryAxis: horizontal ? 'y' : 'x', ticks: ticks.length, kind, labelled };
}

async function main() {
  const args = parseArgs(process.argv);
  const engineDir = path.resolve(args.engine);
  const gtDir = path.resolve(args.gt);
  const rgbaDir = path.resolve(args.rgba);
  const wanted = new Set((args.type ?? 'bar,line,scatter').split(','));
  // v2.1: supply the corpus's own category ticks as declared dividers, so a
  // merged run of touching bars is cut. Off by default -- the published numbers
  // measure the app as a user without ticks gets it.
  const useTicks = args.ticks === true || args.ticks === 'true';

  const { runBarDetect } = await import(path.join(engineDir, 'engine/barDetectRun.js'));
  const { runBlobDetect } = await import(path.join(engineDir, 'engine/blobDetectRun.js'));
  const { runColorTrace } = await import(path.join(engineDir, 'engine/colorTraceRun.js'));

  const files = readdirSync(gtDir).filter((f) => f.endsWith('.json')).sort();
  const rows = [];

  for (const f of files) {
    const gt = JSON.parse(readFileSync(path.join(gtDir, f), 'utf8'));
    const chartType = gt.task1?.output?.chart_type ?? '?';
    // The two corpora spell their type labels differently -- PMC writes
    // "vertical bar"/"line"/"scatter", Adobe writes "Grouped vertical bar"/
    // "Line"/"Scatter" -- so normalise before mapping to a family rather than
    // maintaining two tables.
    const ct = chartType.toLowerCase();
    const family = ct.endsWith('bar') ? 'bar' : ct === 'line' ? 'line' : ct === 'scatter' ? 'scatter' : 'other';
    if (!wanted.has(family)) continue;

    const rgbaFile = path.join(rgbaDir, f.replace(/\.json$/, '.rgba'));
    let img;
    try {
      img = readRgba(rgbaFile);
    } catch {
      rows.push({ file: f, chartType, family, status: 'no-image' });
      continue;
    }

    const bb = gt.task4?.output?._plot_bb;
    const region = bb && bb.width > 0 && bb.height > 0 ? { x: bb.x0, y: bb.y0, width: bb.width, height: bb.height } : undefined;
    const ve = gt.task6?.output?.['visual elements'] ?? {};
    const T = toleranceFor(img.width, img.height);

    if (family === 'bar') {
      const bars = ve.bars ?? [];
      if (bars.length === 0) {
        rows.push({ file: f, chartType, family, status: 'no-gt' });
        continue;
      }
      const picks = dedupeColours(bars.map((b) => boxFillColour(img, b)));
      const cats = useTicks ? declaredDividers(gt, family, bb) : null;
      const boxes = [];
      for (const target of picks) {
        const r = runBarDetect(img.data, img.width, img.height, target, TOLERANCE, 'foreground', region, {
          minDiameter: MIN_BLOB_DIAMETER,
        }, cats ?? undefined);
        if (!('error' in r)) boxes.push(...r.boxes.map(predBox));
      }
      const m = boxRecallIoU(bars.map(gtBox), boxes, 0.5);
      rows.push({
        file: f, chartType, family, status: 'ok',
        picks: picks.length,
        monochrome: isMonochrome(picks),
        touching: barsTouch(bars),
        matched: m.matched, gt: m.gt, pred: m.pred,
        ticks: cats ? cats.ticks : 0,
        tickKind: cats ? cats.kind : null,
      });
      continue;
    }

    const seriesList = family === 'line' ? ve.lines ?? [] : ve['scatter points'] ?? [];
    if (seriesList.length === 0) {
      rows.push({ file: f, chartType, family, status: 'no-gt' });
      continue;
    }

    // ⚑ SCATTER IS SCORED PER FIGURE, exactly like bars, and NOT per series.
    // The corpus does not agree with itself about what a scatter "series" is:
    // several figures record each individual point as its own series (24 series
    // of one point each). Looping per series there ran the detector 24 times
    // over the same plot box and unioned 24 overlapping answers, manufacturing
    // a 94x false-positive rate out of an annotation convention. Detection is
    // not series-aware anyway -- it returns every marker of a colour inside the
    // region -- so "find all the markers, score against all the markers" is
    // both the honest question and the one task 6a actually asks.
    if (family === 'scatter') {
      const gtPoints = seriesList.flat();
      const picks = dedupeColours(gtPoints.map((p) => samplePixel(img, p.x, p.y)));
      const preds = [];
      for (const target of picks) {
        const r = runBlobDetect(img.data, img.width, img.height, target, TOLERANCE, 'foreground', region, {
          minDiameter: MIN_BLOB_DIAMETER,
        });
        if (!('error' in r)) preds.push(...r.points);
      }
      const m = pointScore(gtPoints, preds, T);
      rows.push({
        file: f, chartType, family, status: 'ok',
        picks: picks.length,
        monochrome: isMonochrome(picks),
        score: m.score, within: m.within, gt: m.gt, pred: m.pred,
        series: seriesList.length,
      });
      continue;
    }

    // Lines stay per series: a line IS a curve, and `resampleAtGtX` needs its
    // own curve for context. That also caps predictions at one per GT vertex,
    // so the inflation above is structurally impossible here.
    let sumScore = 0;
    let sumWithin = 0;
    let sumGt = 0;
    let sumPred = 0;
    let picksTotal = 0;
    const allColours = [];
    for (const series of seriesList) {
      if (!series.length) continue;
      // ONE pick per series -- see modalColour for why this, and not the union
      // that bars get.
      const target = modalColour(series.map((p) => samplePixel(img, p.x, p.y)));
      picksTotal += 1;
      allColours.push(target);
      let preds = [];
      if (family === 'line') {
        const r = runColorTrace(img.data, img.width, img.height, target, TOLERANCE, 'foreground', region);
        if (!('error' in r)) preds = r.points;
      } else {
        const r = runBlobDetect(img.data, img.width, img.height, target, TOLERANCE, 'foreground', region, {
          minDiameter: MIN_BLOB_DIAMETER,
        });
        if (!('error' in r)) preds = r.points;
      }
      const usable = family === 'line' ? resampleAtGtX(preds, series) : preds;
      const m = pointScore(series, usable, T);
      // Weight each series by its own point count: one 80-point series should
      // not count the same as one 4-point series in the figure's own average.
      sumScore += m.score * series.length;
      sumWithin += m.within;
      sumGt += m.gt;
      sumPred += m.pred;
    }
    rows.push({
      file: f, chartType, family, status: 'ok',
      picks: picksTotal,
      monochrome: isMonochrome(allColours),
      score: sumGt > 0 ? sumScore / sumGt : 0,
      within: sumWithin, gt: sumGt, pred: sumPred,
      series: seriesList.length,
    });
  }

  const outFile = args.out ?? 'out/report.json';
  writeFileSync(outFile, JSON.stringify(rows, null, 1));
  summarise(rows);
}

function summarise(rows) {
  const ok = rows.filter((r) => r.status === 'ok');
  const byFamily = {};
  for (const r of ok) (byFamily[r.family] ??= []).push(r);

  for (const [family, list] of Object.entries(byFamily)) {
    console.log(`\n=== ${family}  (${list.length} figures)`);
    if (family === 'bar') {
      const tot = list.reduce((a, r) => ({ m: a.m + r.matched, g: a.g + r.gt }), { m: 0, g: 0 });
      console.log(`  recall (IoU>=0.5): ${((100 * tot.m) / tot.g).toFixed(1)}%  (${tot.m}/${tot.g} bars)`);
      for (const mono of [false, true]) {
        const sub = list.filter((r) => r.monochrome === mono);
        if (!sub.length) continue;
        const t = sub.reduce((a, r) => ({ m: a.m + r.matched, g: a.g + r.gt }), { m: 0, g: 0 });
        console.log(
          `    ${mono ? 'greyscale' : 'colour   '}: ${((100 * t.m) / t.g).toFixed(1)}%  (${t.m}/${t.g}, ${sub.length} figures)`
        );
      }
    } else {
      const meanScore = list.reduce((a, r) => a + r.score, 0) / list.length;
      const tot = list.reduce((a, r) => ({ w: a.w + r.within, g: a.g + r.gt }), { w: 0, g: 0 });
      console.log(`  mean competition score: ${meanScore.toFixed(3)}`);
      console.log(`  points within tolerance: ${((100 * tot.w) / tot.g).toFixed(1)}%  (${tot.w}/${tot.g})`);
      for (const mono of [false, true]) {
        const sub = list.filter((r) => r.monochrome === mono);
        if (!sub.length) continue;
        const ms = sub.reduce((a, r) => a + r.score, 0) / sub.length;
        console.log(`    ${mono ? 'greyscale' : 'colour   '}: ${ms.toFixed(3)}  (${sub.length} figures)`);
      }
    }
  }
  const skipped = rows.filter((r) => r.status !== 'ok');
  if (skipped.length) {
    const why = {};
    for (const r of skipped) why[r.status] = (why[r.status] ?? 0) + 1;
    console.log(`\nexcluded: ${JSON.stringify(why)}`);
  }
}

// ⚑ Run only when this file IS the program. Diagnostics import it so they use
// THESE helpers -- a trace that re-implemented `declaredDividers` would be
// diagnosing a different experiment from the one that produced the numbers.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
