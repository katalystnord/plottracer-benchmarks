/**
 * Manual drag-box capture, scored in DATA space against the corpus's own values.
 *
 * ⚑ WHY SEPARATE FROM score.mjs: that one measures AUTO-EXTRACT in image space,
 * isolating the detector from calibration. This measures the other half of the
 * product - a person calibrating the axes and dragging a box across each bar -
 * and the only honest question there is whether the NUMBER comes back right. So
 * it scores in data space, against `task6.output["data series"]`.
 *
 * ⚑ It drives the REAL `CalibrationSession` through the same calls the UI makes:
 * `handleCalibrationClick` → `confirmCalibrationValues` → `runCalibration`, then
 * `addDataPoint` twice per bar (the two corners a drag-box commits) and reads
 * `getTupleRows()`. Nothing about the capture path is reimplemented.
 *
 * ⚑⚑ THE CALIBRATION IS RECOVERED FROM THE GROUND TRUTH, not invented - which is
 * what makes this a measurement rather than a self-consistency check:
 *   task4.axes[y-axis][].tick_pt   pixel position of each tick, with an id
 *   task2.text_blocks[]            the id'd text of every label
 *   task3.text_roles[]             which of those ids are `tick_label`
 * Joining on id gives real (pixel, value) pairs off the figure. Two of them
 * calibrate a BarAxes exactly as a user's two clicks would.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { numericTicksAlong, extremeTickPair } from './lib/gt.mjs';
import { declaredDividers, declaredBaseline } from './score.mjs';

function args(argv) {
  const o = {};
  for (let i = 2; i < argv.length; i += 2) o[argv[i].replace(/^--/, '')] = argv[i + 1];
  return o;
}
const a = args(process.argv);
const engineDir = path.resolve(a.engine);
const gtDir = path.resolve(a.gt);

const { CalibrationSession, BAR_AXES_CONFIG } = await import(path.join(engineDir, 'engine/calibrationSession.js'));

const files = readdirSync(gtDir).filter((f) => f.endsWith('.json')).sort();
const rows = [];

for (const f of files) {
  const gt = JSON.parse(readFileSync(path.join(gtDir, f), 'utf8'));
  const type = (gt.task1?.output?.chart_type ?? '').toLowerCase();
  if (!type.endsWith('bar')) continue;
  const vertical = type.startsWith('vertical');

  const bars = gt.task6?.output?.['visual elements']?.bars ?? [];
  const series = gt.task6?.output?.['data series'] ?? [];
  const truth = series.flatMap((s) => (s.data ?? []).map((d) => d.y)).filter((v) => typeof v === 'number');
  if (!bars.length || !truth.length) {
    rows.push({ file: f, status: 'no-gt' });
    continue;
  }

  const pair = extremeTickPair(numericTicksAlong(gt, vertical ? 'y' : 'x'), vertical);
  if (!pair) {
    // Not every figure carries two numeric tick labels the GT has typed out.
    rows.push({ file: f, status: 'no-calibration' });
    continue;
  }

  // ⚑⚑ THE WALK IS FOUR STEPS, NOT TWO, SINCE v2.4. The category axis stopped
  // being a fold-out offered after calibration and became a REQUIREMENT of the
  // walk, so a harness that clicks two value ticks and calls `runCalibration` is
  // describing a state the app can no longer be in -- it is refused, on every
  // figure. Measured the day this was found: `setOptionValue` had also not
  // existed on the session for some time and nothing noticed, because the only
  // branch that called it (a HORIZONTAL bar chart) had never been reached.
  // ⚑ Mirrors the app's own `walkCategoryAxis` test helper: two clicks on the
  // category axis, then the count typed on the second.
  const cats = declaredDividers(gt, 'bar', gt.task4?.output?._plot_bb);
  if (!cats || cats.dividers.length < 2) {
    rows.push({ file: f, status: 'no-categories' });
    continue;
  }

  const session = new CalibrationSession(BAR_AXES_CONFIG);
  if (!vertical) session.setOption('isRotated', 'true');
  let ok = true;
  for (const t of pair) {
    // ⚑ Bar returns 'awaiting-value', not 'point-placed': its steps carry a
    // typed value, so the click opens the prompt rather than committing. A
    // first draft gated on 'point-placed' and rejected all 134 figures.
    const res = session.handleCalibrationClick(t.px, t.py);
    if (res !== 'awaiting-value' && res !== 'point-placed') ok = false;
    if (!session.confirmCalibrationValues([String(t.value)])) ok = false;
  }
  // The two ENDS of the category axis, at the foot of the plot -- the outer edge
  // of the first category and of the last, which is what the two prompts ask
  // for. `declaredDividers` closes its list with the plot box, so those ends are
  // its first and last entries.
  const along = cats.dividers;
  const bb = gt.task4.output._plot_bb;
  const cross = cats.categoryAxis === 'y' ? bb.x0 : bb.y0 + bb.height;
  const catPoint = (v) => (cats.categoryAxis === 'y' ? { x: cross, y: v } : { x: v, y: cross });
  const c1 = catPoint(along[0]);
  const c2 = catPoint(along[along.length - 1]);
  session.handleCalibrationClick(c1.x, c1.y);
  session.handleCalibrationClick(c2.x, c2.y);
  if (!session.confirmCalibrationValues([String(along.length - 1)])) ok = false;

  if (!ok || !session.runCalibration()) {
    rows.push({ file: f, status: 'refused', error: session.getCalibrationError() });
    continue;
  }

  // Two corners per bar - exactly what a drag-box commits.
  for (const b of bars) {
    session.addDataPoint(b.x0, b.y0);
    session.addDataPoint(b.x0 + b.width, b.y0 + b.height);
  }

  // ⚑⚑ A BAR DOES NOT ALWAYS HAVE A `Value`, AND SINCE v2.3 IT SAYS SO. When a
  // bar's near end does not sit on the declared baseline the record stops
  // reporting one baseline-relative number and reports the INTERVAL's two
  // measured ends instead -- `derived` is null and `interval` carries min/max.
  // A truncated value axis (this corpus is full of them: bars drawn from 30 to
  // 60) is exactly that case.
  // ⚠️ Reading `derived` alone therefore scored NINE figures at zero that had
  // been perfect, and it looked like a regression in the app. It was this
  // harness reading a column the record no longer always fills.
  // ▶ The corpus's own `data series` y is the bar's VALUE -- its far end -- so
  // that is what is compared: the end further from the baseline. Measured off
  // the pixels, not chosen by which number looks better.
  const baseline = declaredBaseline(gt, bb, !vertical, 2);
  const valuePixel = (pt) => (vertical ? pt.py : pt.px);
  const farEnd = (r) => {
    if (typeof r.derived === 'number') return r.derived;
    if (!r.interval || r.points?.length !== 2) return null;
    if (!baseline) return null;
    const [a, b] = r.points;
    const far = Math.abs(valuePixel(a) - baseline.atPixel) >= Math.abs(valuePixel(b) - baseline.atPixel) ? a : b;
    const v = far.data?.[0];
    return typeof v === 'number' ? v : null;
  };
  const read = session.getTupleRows().map(farEnd).filter((v) => typeof v === 'number');

  // ⚑ Greedy nearest-match on VALUE, because bar order is capture order and the
  // corpus's series order is its own. Matching by position would score the
  // ordering convention rather than the reading.
  const remaining = [...truth];
  let within = 0;
  const errors = [];
  for (const v of read) {
    let bestI = -1;
    let bestD = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = Math.abs(remaining[i] - v);
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    if (bestI < 0) break;
    const target = remaining.splice(bestI, 1)[0];
    const span = Math.max(...truth) - Math.min(...truth) || Math.abs(target) || 1;
    const rel = bestD / span;
    errors.push(rel);
    // 1% of the value range - tighter than the competition's 5% image tolerance,
    // because a hand-placed corner should land on the bar's own edge.
    if (rel <= 0.01) within++;
  }

  rows.push({
    file: f,
    status: 'ok',
    vertical,
    bars: bars.length,
    truth: truth.length,
    read: read.length,
    within,
    medianRelError: errors.length ? +errors.sort((x, y) => x - y)[Math.floor(errors.length / 2)].toFixed(5) : null,
  });
}

const out = a.out ?? 'out/manual.json';
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(rows, null, 1));

const ok = rows.filter((r) => r.status === 'ok');
const tw = ok.reduce((s, r) => s + r.within, 0);
const tt = ok.reduce((s, r) => s + r.truth, 0);
const exact = ok.filter((r) => r.within === r.truth).length;
console.log(`figures scored : ${ok.length}`);
console.log(`  every bar within 1% : ${exact}/${ok.length}`);
console.log(`  bars within 1%      : ${tw}/${tt}  (${((100 * tw) / tt).toFixed(1)}%)`);
const skipped = rows.filter((r) => r.status !== 'ok');
const why = {};
for (const r of skipped) why[r.status] = (why[r.status] ?? 0) + 1;
console.log(`  excluded            : ${JSON.stringify(why)}`);
console.log(`\nwrote ${out}`);
