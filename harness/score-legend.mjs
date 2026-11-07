/**
 * The legend as [Auto detect legend] finds it (ui/src/Workspace.tsx `autoDetectLegend`: the detector, then
 * engine/pictureAxes.ts `legendFromDetections`), scored against the corpus's own legend entries (David, 2026-11-07:
 * "we need to measure against legends").
 *
 * The corpora give no legend box, but every entry: its marker (task 5 `legend_pairs`) and its label (the task-2 text
 * block the pair names). A legend is right when it holds every entry; it is scored three ways:
 *   found      a legend is returned at all, on a figure that has one
 *   holds all  every entry's marker and label lie inside it (90% of each box, 2 px of play)
 *   IoU >= 0.5 against the entries' outline (their union)
 * and on a figure the corpus says has no legend (task 5 present, no pairs), whether one is reported anyway.
 *
 * Detectors, each through the app's own module: rfdetr (ui/figdet-model/detector.onnx, or --model another export),
 * chartdete (its 8-bit pieces).
 *
 * usage: node harness/score-legend.mjs --plottracer <checkout> --engine <compiled engine> --gt <dir> --rgba <dir>
 *          --detector rfdetr|chartdete [--model file.onnx] --out <file.json>
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const a = new Map();
for (let i = 2; i < process.argv.length; i += 2) a.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const PT = path.resolve(a.get('plottracer') ?? ''), GT = a.get('gt'), RGBA = a.get('rgba'), OUT = a.get('out'), DET = a.get('detector') ?? 'rfdetr';
const require_ = createRequire(path.join(PT, 'package.json'));
const ort = require_('onnxruntime-web');
const { legendFromDetections } = await import(path.join(path.resolve(a.get('engine')), 'engine/pictureAxes.js'));

let detect;
// ⚑ --detections: the detector's boxes already computed, by rfdetr_infer.py on the GPU (plottracer-ref
// research/v2.7-figdet; same model at 768 px, its boxes twinned with the app's path 44 of 44, 2026-11-06), for the
// super-resolution arms, where running the app's CPU path on every figure of every arm took most of the time. Its
// class names are mapped back to the app's.
const AS_APP = { xlabel: 'x_tick_label', ylabel: 'y_tick_label', legend_patch: 'legend_marker' };
const given = a.get('detections') ? JSON.parse(readFileSync(a.get('detections'), 'utf8')) : null;
if (given) {
  detect = async (_img, stem) => {
    const d = given[stem + '.png'] ?? given[stem + '.jpg'] ?? { dets: [] };
    return { detections: d.dets.map((x) => ({ cls: AS_APP[x.class] ?? x.class, box: { x0: x.bbox[0], y0: x.bbox[1], x1: x.bbox[2], y1: x.bbox[3] }, score: x.score })) };
  };
} else if (DET === 'chartdete') {
  const cd = require_('./ui/electron-chartdete-onnx.cjs');
  const models = await cd.startChartDete(ort);
  detect = (img) => cd.detect(models, img);
} else {
  const fd = require_('./ui/electron-figdet.cjs');
  const model = a.get('model') ?? fd.MODEL;
  const session = await ort.InferenceSession.create(readFileSync(model), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  detect = (img) => fd.detect({ ort, session }, img);
}

const boxOfText = (b) => {
  if (b.polygon) {
    const p = b.polygon, xs = [p.x0, p.x1, p.x2, p.x3], ys = [p.y0, p.y1, p.y2, p.y3];
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  }
  const bb = b.bb;
  return bb ? { x0: bb.x0, y0: bb.y0, x1: bb.x0 + bb.width, y1: bb.y0 + bb.height } : null;
};
const inside = (b, r, play = 2) => {
  const w = Math.min(b.x1, r.x + r.width + play) - Math.max(b.x0, r.x - play);
  const h = Math.min(b.y1, r.y + r.height + play) - Math.max(b.y0, r.y - play);
  const area = (b.x1 - b.x0) * (b.y1 - b.y0);
  return area > 0 && w > 0 && h > 0 && (w * h) / area >= 0.9;
};
const iou = (u, r) => {
  const w = Math.min(u.x1, r.x + r.width) - Math.max(u.x0, r.x), h = Math.min(u.y1, r.y + r.height) - Math.max(u.y0, r.y);
  if (w <= 0 || h <= 0) return 0;
  const i = w * h;
  return i / ((u.x1 - u.x0) * (u.y1 - u.y0) + r.width * r.height - i);
};

const rows = [];
for (const f of readdirSync(GT).sort()) {
  if (!f.endsWith('.json')) continue;
  const gt = JSON.parse(readFileSync(path.join(GT, f), 'utf8'));
  const t5 = gt.task5?.output ?? gt.task6?.input?.task5_output;
  const t2 = gt.task2?.output ?? gt.task6?.input?.task2_output;
  if (!t5 || !t2) continue;
  const file = path.join(RGBA, f.replace(/\.json$/, '.rgba'));
  if (!existsSync(file)) continue;
  // Adobe's top-level text blocks carry no id; the copy under task6.input numbers them in order, so a block's id is its
  // place in the list
  const texts = new Map((t2.text_blocks ?? []).map((b, i) => [b.id ?? i, boxOfText(b)]));
  const entries = [];
  for (const p of t5.legend_pairs ?? []) {
    const m = p.bb ? { x0: p.bb.x0, y0: p.bb.y0, x1: p.bb.x0 + p.bb.width, y1: p.bb.y0 + p.bb.height } : null;
    const l = texts.get(p.id) ?? null;
    entries.push(...[m, l].filter(Boolean));
  }
  const buf = readFileSync(file);
  const width = buf.readUInt32LE(0), height = buf.readUInt32LE(4);
  const r = await detect({ data: new Uint8ClampedArray(buf.buffer, buf.byteOffset + 8, width * height * 4), width, height }, f.replace(/\.json$/, ''));
  const legend = legendFromDetections(r.detections ?? []);
  const row = { file: f, chartType: gt.task1?.output?.chart_type ?? gt.task6?.input?.task1_output?.chart_type, entries: entries.length / 2, found: !!legend };
  if (entries.length) {
    const union = { x0: Math.min(...entries.map((b) => b.x0)), y0: Math.min(...entries.map((b) => b.y0)), x1: Math.max(...entries.map((b) => b.x1)), y1: Math.max(...entries.map((b) => b.y1)) };
    row.holdsAll = !!legend && entries.every((b) => inside(b, legend));
    row.held = legend ? entries.filter((b) => inside(b, legend)).length / entries.length : 0;
    row.iou = legend ? +iou(union, legend).toFixed(3) : 0;
  }
  rows.push(row);
  if (rows.length % 100 === 0) console.log(rows.length, 'figures');
}
const withL = rows.filter((r) => r.entries > 0), without = rows.filter((r) => r.entries === 0);
const pct = (n, d) => (d ? +((100 * n) / d).toFixed(1) : null);
const summary = {
  detector: DET + (a.get('model') ? ` (${path.basename(a.get('model'))})` : ''),
  figures: rows.length,
  withLegend: withL.length,
  found: pct(withL.filter((r) => r.found).length, withL.length),
  holdsAll: pct(withL.filter((r) => r.holdsAll).length, withL.length),
  iou50: pct(withL.filter((r) => r.iou >= 0.5).length, withL.length),
  withoutLegend: without.length,
  falseLegend: pct(without.filter((r) => r.found).length, without.length),
};
writeFileSync(OUT, JSON.stringify({ summary, rows }));
console.log(JSON.stringify(summary));
