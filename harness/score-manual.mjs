/**
 * Manual drag-box capture, scored in DATA space against the corpus's own values.
 *
 * ⚑ WHY SEPARATE FROM score.mjs: that one measures AUTO-EXTRACT in image space,
 * isolating the detector from calibration. This measures the other half of the
 * product — a person calibrating the axes and dragging a box across each bar —
 * and the only honest question there is whether the NUMBER comes back right. So
 * it scores in data space, against `task6.output["data series"]`.
 *
 * ⚑ It drives the REAL `CalibrationSession` through the same calls the UI makes:
 * `handleCalibrationClick` → `confirmCalibrationValues` → `runCalibration`, then
 * `addDataPoint` twice per bar (the two corners a drag-box commits) and reads
 * `getTupleRows()`. Nothing about the capture path is reimplemented.
 *
 * ⚑⚑ THE CALIBRATION IS RECOVERED FROM THE GROUND TRUTH, not invented — which is
 * what makes this a measurement rather than a self-consistency check:
 *   task4.axes[y-axis][].tick_pt   pixel position of each tick, with an id
 *   task2.text_blocks[]            the id'd text of every label
 *   task3.text_roles[]             which of those ids are `tick_label`
 * Joining on id gives real (pixel, value) pairs off the figure. Two of them
 * calibrate a BarAxes exactly as a user's two clicks would.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

function args(argv) {
  const o = {};
  for (let i = 2; i < argv.length; i += 2) o[argv[i].replace(/^--/, '')] = argv[i + 1];
  return o;
}
const a = args(process.argv);
const engineDir = path.resolve(a.engine);
const gtDir = path.resolve(a.gt);

const { CalibrationSession, BAR_AXES_CONFIG } = await import(path.join(engineDir, 'engine/calibrationSession.js'));

/** Numeric tick labels with their pixel positions, from the three tasks. */
function ticks(gt, axis) {
  const roles = new Map((gt.task3?.output?.text_roles ?? []).map((r) => [r.id, r.role]));
  const texts = new Map((gt.task2?.output?.text_blocks ?? []).map((t) => [t.id, t.text]));
  const out = [];
  for (const t of gt.task4?.output?.axes?.[axis] ?? []) {
    if (roles.get(t.id) !== 'tick_label') continue;
    const raw = (texts.get(t.id) ?? '').replace(/[\s,]/g, '');
    const v = Number(raw);
    if (!Number.isFinite(v)) continue;
    out.push({ px: t.tick_pt.x, py: t.tick_pt.y, value: v });
  }
  return out;
}

/** The two ticks furthest apart along the value axis — the pair a user would
 *  pick, and the pair that minimises the effect of a one-pixel misread. */
function calibrationPair(list, vertical) {
  if (list.length < 2) return null;
  const key = (t) => (vertical ? t.py : t.px);
  const sorted = [...list].sort((x, y) => key(x) - key(y));
  const lo = sorted[0];
  const hi = sorted[sorted.length - 1];
  if (lo.value === hi.value || key(lo) === key(hi)) return null;
  return [lo, hi];
}

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

  const pair = calibrationPair(ticks(gt, vertical ? 'y-axis' : 'x-axis'), vertical);
  if (!pair) {
    // Not every figure carries two numeric tick labels the GT has typed out.
    rows.push({ file: f, status: 'no-calibration' });
    continue;
  }

  const session = new CalibrationSession(BAR_AXES_CONFIG);
  if (!vertical) session.setOptionValue('isRotated', true);
  let ok = true;
  for (const t of pair) {
    // ⚑ Bar returns 'awaiting-value', not 'point-placed': its steps carry a
    // typed value, so the click opens the prompt rather than committing. A
    // first draft gated on 'point-placed' and rejected all 134 figures.
    const res = session.handleCalibrationClick(t.px, t.py);
    if (res !== 'awaiting-value' && res !== 'point-placed') ok = false;
    if (!session.confirmCalibrationValues([String(t.value)])) ok = false;
  }
  if (!ok || !session.runCalibration()) {
    rows.push({ file: f, status: 'refused', error: session.getCalibrationError() });
    continue;
  }

  // Two corners per bar — exactly what a drag-box commits.
  for (const b of bars) {
    session.addDataPoint(b.x0, b.y0);
    session.addDataPoint(b.x0 + b.width, b.y0 + b.height);
  }

  const read = session
    .getTupleRows()
    .map((r) => r.derived)
    .filter((v) => typeof v === 'number');

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
    // 1% of the value range — tighter than the competition's 5% image tolerance,
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
