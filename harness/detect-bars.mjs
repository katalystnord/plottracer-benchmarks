/**
 * The detector's bar boxes for every bar figure of a corpus, through the app's own path (ui/electron-figdet.cjs on
 * onnxruntime-web, the model the app ships in ui/figdet-model/detector.onnx), written once so score.mjs reads them as
 * the app's Colour trace receives them (v2.7, "Bars seen whole by the detector"). No answer is used: the figure's
 * pixels go in, boxes come out.
 *
 * usage: node harness/detect-bars.mjs --plottracer <checkout> --gt <annotations dir> --rgba <dir> --out <file.json>
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const PT = args.get('plottracer'), GT = args.get('gt'), RGBA = args.get('rgba'), OUT = args.get('out');
if (!PT || !GT || !RGBA || !OUT) {
  console.error('usage: detect-bars.mjs --plottracer <checkout> --gt <dir> --rgba <dir> --out <file.json>');
  process.exit(2);
}
const require_ = createRequire(path.join(PT, 'package.json'));
const figdet = require_('./ui/electron-figdet.cjs');
const models = await figdet.startDetector(require_('onnxruntime-web'));
const out = {};
let n = 0;
for (const f of readdirSync(GT).sort()) {
  if (!f.endsWith('.json')) continue;
  const gt = JSON.parse(readFileSync(path.join(GT, f), 'utf8'));
  if (!(gt.task1?.output?.chart_type ?? '').toLowerCase().endsWith('bar')) continue;
  const file = path.join(RGBA, f.replace(/\.json$/, '.rgba'));
  if (!existsSync(file)) continue;
  const b = readFileSync(file);
  const width = b.readUInt32LE(0), height = b.readUInt32LE(4);
  const r = await figdet.detect(models, { data: new Uint8ClampedArray(b.buffer, b.byteOffset + 8, width * height * 4), width, height });
  out[f.replace(/\.json$/, '')] = r.detections.filter((d) => d.cls === 'bar').map((d) => ({ ...d.box, score: d.score }));
  if (++n % 50 === 0) console.log(n, 'figures');
}
writeFileSync(OUT, JSON.stringify(out));
console.log(`wrote ${OUT}: ${n} figures`);
