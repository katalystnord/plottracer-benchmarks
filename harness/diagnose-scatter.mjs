/**
 * Diagnostic, not part of the published score: WHERE do the extra scatter
 * detections sit? If unmatched predictions cluster on top of real markers, the
 * detector is splintering one marker into several. If they are spread out, it
 * is picking up other ink (grid lines, error bars, text inside the plot box).
 * The two mean completely different things and only one of them is our bug.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const engineDir = path.resolve(process.argv[2]);
const gtDir = path.resolve(process.argv[3]);
const rgbaDir = path.resolve(process.argv[4]);

const { runBlobDetect } = await import(path.join(engineDir, 'engine/blobDetectRun.js'));

function readRgba(file) {
  const buf = readFileSync(file);
  const width = buf.readUInt32LE(0);
  const height = buf.readUInt32LE(4);
  return { data: new Uint8ClampedArray(buf.buffer, buf.byteOffset + 8, width * height * 4), width, height };
}
const sample = (img, x, y) => {
  const px = Math.max(0, Math.min(img.width - 1, Math.round(x)));
  const py = Math.max(0, Math.min(img.height - 1, Math.round(y)));
  const i = (py * img.width + px) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};
function dedupe(picks, tol = 30) {
  const kept = [];
  for (const c of picks) if (!kept.some((k) => k.every((v, i) => Math.abs(v - c[i]) <= tol))) kept.push(c);
  return kept;
}

const buckets = { onMarker: 0, near: 0, far: 0 };
let totalUnmatched = 0;
let figures = 0;

for (const f of readdirSync(gtDir).filter((n) => n.endsWith('.json')).sort()) {
  const gt = JSON.parse(readFileSync(path.join(gtDir, f), 'utf8'));
  if (gt.task1?.output?.chart_type !== 'scatter') continue;
  let img;
  try {
    img = readRgba(path.join(rgbaDir, f.replace(/\.json$/, '.rgba')));
  } catch {
    continue;
  }
  const bb = gt.task4?.output?._plot_bb;
  const region = bb?.width > 0 ? { x: bb.x0, y: bb.y0, width: bb.width, height: bb.height } : undefined;
  const gtPts = (gt.task6?.output?.['visual elements']?.['scatter points'] ?? []).flat();
  if (!gtPts.length) continue;
  figures++;

  const picks = dedupe(gtPts.map((p) => sample(img, p.x, p.y)));
  const preds = [];
  for (const t of picks) {
    const r = runBlobDetect(img.data, img.width, img.height, t, 60, 'foreground', region, { minDiameter: 3 });
    if (!('error' in r)) preds.push(...r.points);
  }
  // Greedy one-to-one at the competition tolerance, then look at the leftovers.
  const T = 0.05 * Math.min(img.width, img.height);
  const pairs = [];
  for (let g = 0; g < gtPts.length; g++)
    for (let p = 0; p < preds.length; p++) {
      const d = Math.hypot(gtPts[g].x - preds[p].x, gtPts[g].y - preds[p].y);
      if (d < T) pairs.push({ g, p, d });
    }
  pairs.sort((a, b) => a.d - b.d);
  const ug = new Set();
  const up = new Set();
  for (const { g, p } of pairs) {
    if (ug.has(g) || up.has(p)) continue;
    ug.add(g);
    up.add(p);
  }
  for (let p = 0; p < preds.length; p++) {
    if (up.has(p)) continue;
    totalUnmatched++;
    let best = Infinity;
    for (const g of gtPts) best = Math.min(best, Math.hypot(g.x - preds[p].x, g.y - preds[p].y));
    if (best <= 3) buckets.onMarker++;
    else if (best <= T) buckets.near++;
    else buckets.far++;
  }
}

console.log(`figures: ${figures}, unmatched predictions: ${totalUnmatched}`);
for (const [k, v] of Object.entries(buckets)) {
  console.log(`  ${k.padEnd(9)} ${v} (${((100 * v) / totalUnmatched).toFixed(1)}%)`);
}
console.log('\nonMarker = within 3px of a real marker (splintering)');
console.log('near     = within the competition tolerance but already taken by another prediction');
console.log('far      = other ink entirely');
