/**
 * Does a MEASURED category axis buy real bars on the AUTO path? - an experiment.
 *
 * ⚑ THE POINT. `joinAcrossHatch` needs one input the automatic path cannot
 * supply: which way the categories run. orientation-probe.mjs measured two ways
 * of reading it off the pixels and found them almost exactly complementary -
 *
 *     rule                          Adobe (hatched)   PMC (real)
 *     A, modal baseline edge             32.7%          93.7%
 *     B, distinct perpendicular extents  85.5%          27.5%
 *
 * - and found that rule B's own ratio says when it should speak: above 2.0 it is
 * right on 93.4% of Adobe figures, and only 25 of 189 PMC figures reach that bar
 * at all.
 *
 * ⚑⚑ BUT AXIS ACCURACY IS A PROXY, AND THIS MEASURES THE THING ITSELF. A wrong
 * axis only costs anything if the join then merges something it should not, and
 * a right axis only earns anything if fragments were there to rejoin. So this
 * runs the app's real detector both ways and counts BARS, on both corpora, which
 * is the only number that decides it.
 *
 * ⚠️ PMC IS THE CONTROL AND IT HAS TEETH: defaulting this same axis once cost 24
 * real bars across 5 figures. An arm that gains on Adobe and loses on PMC has
 * traded one corpus for the other rather than fixed anything.
 *
 * Usage: measured-axis-probe.mjs --gt <dir> --rgba <dir> [--gate 2.0] [--limit N]
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  readRgba, dedupeColours, boxFillColour, gtBox, predBox, barsAreHorizontal,
  TOLERANCE, MIN_BLOB_DIAMETER,
} from './score.mjs';
import { boxRecallIoU } from './lib/metric.mjs';

function parseArgs(argv) {
  const o = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') ? true : argv[++i];
  }
  return o;
}

/** Rule B, lifted from orientation-probe.mjs: fragments of one bar are slices
 *  of the same rectangle, so they share their perpendicular extent exactly. */
function distinctExtents(boxes, axis, tolPx) {
  const lo = (b) => (axis === 'x' ? b.minX : b.minY);
  const hi = (b) => (axis === 'x' ? b.maxX : b.maxY);
  const seen = [];
  for (const b of boxes) {
    const l = lo(b), h = hi(b);
    if (!seen.some((s) => Math.abs(s[0] - l) <= tolPx && Math.abs(s[1] - h) <= tolPx)) seen.push([l, h]);
  }
  return seen.length;
}
function readAxis(boxes, tolPx) {
  if (boxes.length < 4) return null;
  const asX = distinctExtents(boxes, 'x', tolPx);
  const asY = distinctExtents(boxes, 'y', tolPx);
  if (!asX || !asY) return null;
  return {
    axis: asX <= asY ? 'x' : 'y',
    ratio: Math.max(asX, asY) / Math.min(asX, asY),
  };
}

async function main() {
  const a = parseArgs(process.argv);
  const gate = Number(a.gate ?? 2.0);
  const engineDir = path.resolve(a.engine ?? 'work/engine-js');
  const { runBarDetect } = await import(path.join(engineDir, 'engine/barDetectRun.js'));
  const gtDir = path.resolve(a.gt), rgbaDir = path.resolve(a.rgba);
  const limit = Number(a.limit ?? 0);

  const files = readdirSync(gtDir).filter((f) => f.endsWith('.json')).sort();
  let n = 0, gtTotal = 0, before = 0, after = 0, fired = 0, firedRight = 0;
  const moved = [];
  for (const f of files) {
    if (limit && n >= limit) break;
    const gt = JSON.parse(readFileSync(path.join(gtDir, f), 'utf8'));
    const ct = (gt.task1?.output?.chart_type ?? '').toLowerCase();
    if (!ct.endsWith('bar')) continue;
    const bars = gt.task6?.output?.['visual elements']?.bars ?? [];
    if (bars.length === 0) continue;
    let img;
    try { img = readRgba(path.join(rgbaDir, f.replace(/\.json$/, '.rgba'))); } catch { continue; }
    const bb = gt.task4?.output?._plot_bb;
    const region = bb && bb.width > 0 && bb.height > 0
      ? { x: bb.x0, y: bb.y0, width: bb.width, height: bb.height } : undefined;
    const picks = dedupeColours(bars.map((b) => boxFillColour(img, b)));
    const truth = bars.map(gtBox);
    const opts = { minDiameter: MIN_BLOB_DIAMETER };

    const run = (cats) => {
      const boxes = [];
      for (const target of picks) {
        const r = runBarDetect(img.data, img.width, img.height, target, TOLERANCE,
          'foreground', region, opts, cats ?? undefined, undefined);
        if ('error' in r) continue;
        boxes.push(...r.boxes.map(predBox));
      }
      return boxes;
    };

    const autoBoxes = run(null);
    const tolPx = Math.max(2, Math.round(0.005 * Math.min(img.width, img.height)));
    const read = readAxis(autoBoxes, tolPx);
    // ⚑ REFUSE unless the reading is decisive. Below the gate the arm does
    // nothing at all, so the figures it cannot read are provably untouched.
    const useAxis = read && read.ratio >= gate ? read.axis : null;
    const armBoxes = useAxis ? run({ dividers: [], categoryAxis: useAxis }) : autoBoxes;

    const b0 = boxRecallIoU(truth, autoBoxes, 0.5);
    const b1 = boxRecallIoU(truth, armBoxes, 0.5);
    n++; gtTotal += b0.gt; before += b0.matched; after += b1.matched;
    if (useAxis) {
      fired++;
      if (useAxis === (barsAreHorizontal(gt) ? 'y' : 'x')) firedRight++;
      if (b1.matched !== b0.matched) {
        moved.push({ file: f, delta: b1.matched - b0.matched, gt: b0.gt,
          before: b0.matched, after: b1.matched, axis: useAxis,
          ratio: Number(read.ratio.toFixed(2)) });
      }
    }
  }
  const pc = (x) => `${(100 * x / (gtTotal || 1)).toFixed(1)}%`;
  console.log(`gate ratio >= ${gate}`);
  console.log(`  figures                ${n}`);
  console.log(`  arm fired on           ${fired}  (${(100 * fired / (n || 1)).toFixed(1)}%),` +
    ` axis right on ${firedRight}/${fired}` + (fired ? ` (${(100 * firedRight / fired).toFixed(1)}%)` : ''));
  console.log(`  bars AUTO              ${before}/${gtTotal}  ${pc(before)}`);
  console.log(`  bars WITH measured axis ${after}/${gtTotal}  ${pc(after)}` +
    `   ${after >= before ? '+' : ''}${(100 * (after - before) / (gtTotal || 1)).toFixed(1)} pts` +
    `  (${after - before >= 0 ? '+' : ''}${after - before} bars)`);
  const lost = moved.filter((m) => m.delta < 0).sort((x, y) => x.delta - y.delta);
  const won = moved.filter((m) => m.delta > 0).sort((x, y) => y.delta - x.delta);
  console.log(`  figures better ${won.length}, worse ${lost.length}`);
  for (const m of lost.slice(0, 6)) {
    console.log(`    LOST ${m.delta}  ${m.file}  ${m.before}->${m.after} of ${m.gt}  axis ${m.axis} ratio ${m.ratio}`);
  }
  if (a.out) writeFileSync(a.out, JSON.stringify({ gate, n, gtTotal, before, after, fired, firedRight, moved }, null, 2));
}
main();
