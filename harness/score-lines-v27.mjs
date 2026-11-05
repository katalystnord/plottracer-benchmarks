/**
 * LINE CHARTS AS PLOTTRACER 2.7 READS THEM: Find lines, and Auto-extract all series with the legend marked.
 *
 * `score.mjs` scores line charts with Colour trace, the 2.3 line reader: every pixel of a series' ink, one series at a
 * time. 2.6 added Find lines (each line of an ink its own line) and 2.7 Auto-extract all series (each legend entry read
 * into a series of its name; entries in one ink told apart by their line style). Neither could show in that path, so
 * this script scores them, on the same figures, the same metric and the same tolerance.
 *
 * Two paths, each stated with what it is given:
 *
 *   FIND LINES  - the plot box and each series' ink, exactly what AUTO is given; Find lines in place of Colour trace.
 *                 Every line of the ink is the prediction for the series, as Colour trace's pixels are in AUTO.
 *   LEGEND      - the plot box, and the LEGEND as the user marks it with the Legend card: the corpus's own legend
 *                 pairs (each entry's mark box and its text) stand in for the marked legend, as its plot box stands in
 *                 for the calibration. Then the app's own steps: the sample's ink (`sampleInk`), the plan
 *                 (`planAutoExtract`), Find lines with the other series' inks, the line style matched to the samples
 *                 (`planStyleSeries`) and the pieces joined (`joinLines`). Each ground-truth series is scored against
 *                 the series of its name, and only that series: a line read into the wrong name scores nothing.
 *                 Figures with no legend pairs, or whose legend texts do not name the series, are not in this path.
 *
 * ⚑ Everything after the inputs is PlotTracer's own shipped code, imported from a compiled checkout; nothing here
 * reimplements extraction. Image space, Task 6a's metric, lines resampled at the ground truth's x, as in score.mjs.
 *
 *   node harness/score-lines-v27.mjs --engine <dir> --gt <dir> --rgba <dir> --out <file>
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readRgba, samplePixel, modalColour, resampleAtGtX, isMonochrome } from './score.mjs';
import { pointScore, toleranceFor } from './lib/metric.mjs';

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const engineDir = path.resolve(args.engine);
const { findLines } = await import(path.join(engineDir, 'algorithms/findLines/lines.js'));
const { planAutoExtract } = await import(path.join(engineDir, 'engine/autoExtract.js'));
const { ALL_AXES_TYPE_CONFIGS } = await import(path.join(engineDir, 'engine/axesTypeConfigs.js'));
const { sampleInk } = await import(path.join(engineDir, 'engine/legendRead.js'));
const { inkTest, paperColour, styleAlong, styleOfSample } = await import(path.join(engineDir, 'algorithms/lineStyle.js'));
const { planStyleSeries } = await import(path.join(engineDir, 'engine/styleSeries.js'));
const { joinLines } = await import(path.join(engineDir, 'engine/lineEdits.js'));
const XY = ALL_AXES_TYPE_CONFIGS.find((c) => c.id === 'xy');

const norm = (s) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const toXY = (pts) => pts.map(([x, y]) => ({ x, y }));

/** Score each GT series against `predOf(i)`, weighted by its own point count, as score.mjs does. */
function scoreSeries(seriesList, predOf, T) {
  let sumScore = 0, within = 0, gt = 0, pred = 0;
  seriesList.forEach((series, i) => {
    if (!series.length) return;
    const usable = resampleAtGtX(predOf(i), series);
    const m = pointScore(series, usable, T);
    sumScore += m.score * series.length;
    within += m.within;
    gt += m.gt;
    pred += m.pred;
  });
  return { score: gt ? sumScore / gt : 0, within, gt, pred };
}

const rows = [];
for (const f of readdirSync(args.gt).filter((n) => n.endsWith('.json')).sort()) {
  const gt = JSON.parse(readFileSync(path.join(args.gt, f), 'utf8'));
  if ((gt.task1?.output?.chart_type ?? '').toLowerCase() !== 'line') continue;
  let img;
  try {
    img = readRgba(path.join(args.rgba, f.replace(/\.json$/, '.rgba')));
  } catch {
    rows.push({ file: f, status: 'no-image' });
    continue;
  }
  const bb = gt.task4?.output?._plot_bb;
  if (!bb || !(bb.width > 0) || !(bb.height > 0)) {
    rows.push({ file: f, status: 'no-plot-box' });
    continue;
  }
  const box = { x0: bb.x0, y0: bb.y0, x1: bb.x0 + bb.width, y1: bb.y0 + bb.height };
  const seriesList = gt.task6?.output?.['visual elements']?.lines ?? [];
  const names = (gt.task6?.output?.['data series'] ?? []).map((s) => s.name);
  if (!seriesList.length) {
    rows.push({ file: f, status: 'no-gt' });
    continue;
  }
  const T = toleranceFor(img.width, img.height);
  const inks = seriesList.map((s) => (s.length ? modalColour(s.map((p) => samplePixel(img, p.x, p.y))) : null));
  const row = { file: f, status: 'ok', series: seriesList.length, monochrome: isMonochrome(inks.filter(Boolean)) };

  // FIND LINES: each series' ink, as AUTO picks it, read by Find lines
  const cache = new Map();
  const linesOf = (ink, opts) => {
    const k = `${ink}|${JSON.stringify(opts)}`;
    if (!cache.has(k)) cache.set(k, findLines(img.data, img.width, img.height, ink, box, opts).lines);
    return cache.get(k);
  };
  row.findLines = scoreSeries(seriesList, (i) => (inks[i] ? toXY(linesOf(inks[i], { contour: false }).flatMap((L) => L.points)) : []), T);

  // LEGEND: the corpus's legend pairs as the marked legend, then Auto-extract all series
  const blocks = new Map((gt.task2?.output?.text_blocks ?? []).map((b) => [b.id, b]));
  const pairs = (gt.task5?.output?.legend_pairs ?? []).map((p) => {
    const t = blocks.get(p.id);
    const poly = t?.polygon;
    const tb = poly ? { x0: Math.min(poly.x0, poly.x3), y0: Math.min(poly.y0, poly.y1), x1: Math.max(poly.x1, poly.x2), y1: Math.max(poly.y2, poly.y3) } : null;
    return { name: t?.text ?? '', mark: { x0: p.bb.x0, y0: p.bb.y0, x1: p.bb.x0 + p.bb.width, y1: p.bb.y0 + p.bb.height }, text: tb };
  });
  const named = pairs.length > 0 && names.every((n) => pairs.some((p) => norm(p.name) === norm(n)));
  if (named) {
    const xs = pairs.flatMap((p) => [p.mark.x0, p.mark.x1, ...(p.text ? [p.text.x0, p.text.x1] : [])]);
    const ys = pairs.flatMap((p) => [p.mark.y0, p.mark.y1, ...(p.text ? [p.text.y0, p.text.y1] : [])]);
    const legend = { x0: Math.min(...xs) - 3, y0: Math.min(...ys) - 3, x1: Math.max(...xs) + 3, y1: Math.max(...ys) + 3 };
    const entries = pairs.map((p) => ({ name: p.name, colour: sampleInk(img.data, img.width, img.height, p.mark), sample: null, textBox: p.text ?? p.mark, sampleBox: p.mark }));
    const plan = planAutoExtract(XY, entries, []);
    const seriesPts = new Map(); // entry name -> points
    const paper = paperColour(img.data, img.width, img.height);
    let toldApart = 0, sharedGroups = 0;
    for (const step of plan) {
      if (!('tool' in step)) continue;
      const otherInks = plan.flatMap((o) => ('colour' in o && o !== step ? [o.colour] : []));
      const lines = linesOf(step.colour, { contour: false, masks: [legend], otherInks });
      const group = [step.entry, ...(step.shares ?? [])];
      let sp = null;
      // NOSTYLE=1: the same read with the line style not used, as before 2.7 (every line of an ink to the first entry)
      if (group.length > 1 && !process.env.NOSTYLE) {
        sharedGroups++;
        const ink = inkTest(img.data, img.width, img.height, step.colour, paper);
        const styled = lines.map((L) => ({ style: styleAlong(L.points, ink), xMin: Math.min(...L.points.map((p) => p[0])), xMax: Math.max(...L.points.map((p) => p[0])) }));
        sp = planStyleSeries(styled, group.map((e) => styleOfSample(entries[e].sampleBox, ink)));
      }
      if (!sp) {
        // as the app does: every line of the ink is the first entry's, and the others are not read
        seriesPts.set(norm(step.name), toXY(lines.flatMap((L) => L.points)));
        continue;
      }
      toldApart++;
      group.forEach((e, gi) => {
        const mine = sp.perEntry[gi].map((k) => lines[k].points.map(([x, y]) => ({ x, y })));
        if (!mine.length) return;
        const joined = mine.slice(1).reduce((a, b) => joinLines(a, b), mine[0]);
        seriesPts.set(norm(plan[e].name), joined.map((p) => ({ x: p.x, y: p.y })));
      });
    }
    row.legend = { ...scoreSeries(seriesList, (i) => seriesPts.get(norm(names[i])) ?? [], T), entries: entries.length, sharedGroups, toldApart };
  } else {
    row.legend = null;
    row.legendSkipped = pairs.length ? 'legend-texts-do-not-name-the-series' : 'no-legend-pairs';
  }
  rows.push(row);
}
writeFileSync(args.out, JSON.stringify(rows, null, 1));

const ok = rows.filter((r) => r.status === 'ok');
const pool = (list, k) => list.reduce((a, r) => ({ w: a.w + r[k].within, g: a.g + r[k].gt }), { w: 0, g: 0 });
const pct = (t) => `${((100 * t.w) / Math.max(1, t.g)).toFixed(1)}% (${t.w}/${t.g})`;
console.log(`line figures scored: ${ok.length}`);
console.log(`  FIND LINES, points within tolerance: ${pct(pool(ok, 'findLines'))}`);
const leg = ok.filter((r) => r.legend);
console.log(`  LEGEND path on ${leg.length} figures: ${pct(pool(leg, 'legend'))}; Find lines on the same figures ${pct(pool(leg, 'findLines'))}`);
