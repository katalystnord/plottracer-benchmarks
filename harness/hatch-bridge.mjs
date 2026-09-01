/**
 * Can a hatched bar be made readable BEFORE detection sees it? - an experiment.
 *
 * ⚑ THE PROBLEM, already diagnosed and measured in this repo: Adobe's bars are
 * hatched, flood-fill connectivity sees ~34 fragments per bar, none overlaps the
 * true bar by half, and a perfectly drawn bar scores zero. Bar recall on that
 * corpus is 35.3% against 76.1% on real published figures. ASSISTED changes
 * nothing (35.3% -> 35.3%): the fragmentation happens before any declaration can
 * help.
 *
 * ⚑ AND DETECTION OF THE HATCH ITSELF IS SETTLED (hatch-probe.py): a hatch is a
 * 1D frequency peak ALONG the bar, period ~32px, Adobe median prominence 23.2
 * against PMC's 2.65. What was never built is USING that to stop the
 * fragmentation.
 *
 * ⚑⚑ THIS PREPROCESSES PIXELS AND RE-SCORES, the shape `greyscale-normalise.mjs`
 * already uses - so the app is not touched until an arm earns it. Each arm
 * writes a new RGBA directory that `score.mjs` then reads exactly as it reads
 * the originals.
 *
 * ⚠️ EVERY ARM IS RUN ON BOTH CORPORA. Adobe is hatched and PMC mostly is not,
 * so PMC is the CONTROL: an arm that gains on Adobe and loses on PMC has traded
 * one corpus for another rather than fixed anything. That control is the whole
 * reason this can be believed.
 *
 * Usage: hatch-bridge.mjs <in-rgba-dir> <out-rgba-dir> <arm> [limit]
 *   arms: sq2 sq3 sq4 v3 h3
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const [inDir, outDir, arm, limitArg] = process.argv.slice(2);
if (!inDir || !outDir || !arm) {
  console.error('usage: hatch-bridge.mjs <in> <out> <arm> [limit]');
  process.exit(2);
}
const limit = Number(limitArg ?? 0);
mkdirSync(outDir, { recursive: true });

function readRgba(file) {
  const b = readFileSync(file);
  return { width: b.readUInt32LE(0), height: b.readUInt32LE(4), data: Buffer.from(b.subarray(8)) };
}
function writeRgba(file, img) {
  const head = Buffer.alloc(8);
  head.writeUInt32LE(img.width, 0);
  head.writeUInt32LE(img.height, 4);
  writeFileSync(file, Buffer.concat([head, img.data]));
}

/**
 * Grayscale CLOSING on each channel: dilate (take the lighter neighbour) then
 * erode (take the darker). A dark structure thinner than the element vanishes
 * and everything else returns to where it was.
 *
 * ⚑ Separable 1D passes rather than a square element, so the direction can be
 * chosen: a hatch line is removed by closing ACROSS it, and closing only across
 * one axis leaves features running the other way untouched.
 */
/** One morphological pass along one axis: `pick` chooses dilate or erode. */
function pass1d(img, radius, horizontal, pick) {
  const { width, height, data } = img;
  const out = Buffer.alloc(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) {
        let best = data[(y * width + x) * 4 + c];
        for (let d = -radius; d <= radius; d++) {
          const nx = horizontal ? x + d : x;
          const ny = horizontal ? y : y + d;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const v = data[(ny * width + nx) * 4 + c];
          if (pick(v, best)) best = v;
        }
        out[(y * width + x) * 4 + c] = best;
      }
      out[(y * width + x) * 4 + 3] = data[(y * width + x) * 4 + 3];
    }
  }
  return { width, height, data: out };
}
const dilate = (img, r, h) => pass1d(img, r, h, (v, b) => v > b);
const erode = (img, r, h) => pass1d(img, r, h, (v, b) => v < b);

/**
 * ⚠️ CLOSING WITH A SQUARE ELEMENT IS **NOT** TWO 1D CLOSINGS, and the first
 * version of this file did the latter: dilate/erode horizontally, then
 * dilate/erode vertically. That cannot bridge a gap needing support from both
 * axes at once, and it measured 34.8% against a 35.3% baseline - a change that
 * looked like "bridging does not help" and was really "this is not a closing".
 * ▶ A square closing is ALL the dilations, then ALL the erosions.
 */
const closeSquare = (img, r) => erode(erode(dilate(dilate(img, r, true), r, false), r, true), r, false);
/** 1D closing across one axis - what removes a hatch line running the other way. */
const closeAxis = (img, r, horizontal) => erode(dilate(img, r, horizontal), r, horizontal);

const ARMS = {
  // ⚑ The radii are chosen from the INK, not swept blindly: a hatch line
  // measured on Adobe 1996.json is ~2px of pure black with anti-aliased
  // shoulders either side - `83 6 0 0 25 99` across it - so the dark band to
  // bridge is 4 to 6px wide and an element must exceed that.
  sq2: (img) => closeSquare(img, 2),
  sq3: (img) => closeSquare(img, 3),
  sq4: (img) => closeSquare(img, 4),
  v3: (img) => closeAxis(img, 3, false),
  h3: (img) => closeAxis(img, 3, true),
};
if (!ARMS[arm]) {
  console.error(`unknown arm ${arm}; have ${Object.keys(ARMS).join(' ')}`);
  process.exit(2);
}

const files = readdirSync(inDir).filter((f) => f.endsWith('.rgba')).sort();
let n = 0;
for (const f of files) {
  if (limit && n >= limit) break;
  const img = readRgba(path.join(inDir, f));
  writeRgba(path.join(outDir, f), ARMS[arm](img));
  n++;
}
console.log(`${arm}: wrote ${n} figures to ${outDir}`);
