/**
 * If normalising the PIXELS cannot help, can choosing the RULER?
 *
 * ⚑⚑ WHY THIS FOLLOWS FROM THE LAST RESULT, RATHER THAN BEING ANOTHER GUESS.
 * `greyscale-equivalence.mjs` showed that a contrast stretch IS a tolerance
 * change (163 of 192 figures behave identically to the untouched image at
 * tolerance 60/scale). That kills preprocessing as a mechanism — but it also
 * says where the mechanism actually lives: in the TOLERANCE. And the tolerance
 * today is one global constant, 60, serving two populations that want different
 * numbers. Measured: at 60 greyscale gets 66.6% and colour 82.2%; at 25
 * greyscale rises to 72.2% and colour COLLAPSES to 76.7%. One ruler cannot serve
 * both, which is why the global sweep settled on 60 and stopped.
 *
 * THE IDEA: stop using a global constant. The app already knows the colours the
 * user clicked, and the failure mode is two of them sitting inside one ball —
 * so give each pick a radius that CANNOT reach its nearest neighbour. Half the
 * distance to the closest other pick is the largest radius for which no two
 * picks can claim the same pixel. On a colour figure the picks are far apart, so
 * the radius stays at the shipped 60 and nothing changes; on a greyscale figure
 * whose shades sit 30 apart it tightens to 15, where it has to.
 *
 * ⚑ It obeys the same rule as every other arm: it uses ONLY what the app has —
 * the picks are the user's own clicks, not the ground truth.
 *
 * ⚑ THE PRIZE IS BOUNDED, and the bound is measured here as the `tol-25` arm:
 * fixing every merge cannot be worth more than about 6 points of greyscale
 * recall (66.6 -> 72.2), which is ~2 points pooled. Worth knowing BEFORE
 * building, so the result can be read against what was available.
 *
 * `tolerance` in colorFilter.ts is a Euclidean RGB distance, so that is the
 * metric used here — the same one the detector will apply.
 *
 * Usage: node harness/greyscale-picktol.mjs --engine <dir> --gt <dir> --rgba <dir>
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { boxRecallIoU } from './lib/metric.mjs';

function args(argv) {
  const o = {};
  for (let i = 2; i < argv.length; i += 2) o[argv[i].replace(/^--/, '')] = argv[i + 1];
  return o;
}
const a = args(process.argv);
const { runBarDetect } = await import(path.join(path.resolve(a.engine), 'engine/barDetectRun.js'));

const SHIPPED_TOLERANCE = 60;
const MIN_BLOB_DIAMETER = 3;
const DEDUPE = SHIPPED_TOLERANCE / 2;

function readRgba(file) {
  const buf = readFileSync(file);
  const width = buf.readUInt32LE(0);
  const height = buf.readUInt32LE(4);
  return {
    data: new Uint8ClampedArray(buf.buffer, buf.byteOffset + 8, width * height * 4),
    width,
    height,
  };
}
const sample = (img, x, y) => {
  const px = Math.max(0, Math.min(img.width - 1, Math.round(x)));
  const py = Math.max(0, Math.min(img.height - 1, Math.round(y)));
  const i = (py * img.width + px) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};
function fill(img, b) {
  const inset = Math.min(1, Math.floor(b.width / 4), Math.floor(b.height / 4));
  const buckets = new Map();
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      const c = sample(
        img,
        b.x0 + inset + ((i + 0.5) * Math.max(1, b.width - 2 * inset)) / 5,
        b.y0 + inset + ((j + 0.5) * Math.max(1, b.height - 2 * inset)) / 5
      );
      const k = c.map((v) => v >> 3).join(',');
      const hit = buckets.get(k);
      if (hit) hit.n++;
      else buckets.set(k, { n: 1, c });
    }
  }
  let best = null;
  for (const v of buckets.values()) if (!best || v.n > best.n) best = v;
  return best.c;
}
const gtBox = (b) => ({ minX: b.x0, minY: b.y0, maxX: b.x0 + b.width, maxY: b.y0 + b.height });
const predBox = (b) => ({ minX: b.start.x, minY: b.start.y, maxX: b.end.x, maxY: b.end.y });
const mono = (cs) => cs.every((c) => Math.max(...c) - Math.min(...c) < 30);
/** The detector's own metric: Euclidean RGB. */
const rgbDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Half the distance to the nearest OTHER pick — the largest radius for which no
 * two picks can claim the same pixel. Capped at the shipped tolerance so this can
 * only ever tighten, never loosen; floored so a bar's own JPEG noise still fits. */
function voronoiTolerances(picks, floor) {
  return picks.map((p, i) => {
    let nearest = Infinity;
    picks.forEach((q, j) => {
      if (i !== j) nearest = Math.min(nearest, rgbDist(p, q));
    });
    if (!Number.isFinite(nearest)) return SHIPPED_TOLERANCE; // a lone pick keeps the default
    return Math.max(floor, Math.min(SHIPPED_TOLERANCE, nearest / 2));
  });
}

const ARMS = {
  /** The shipped behaviour. */
  'tol-60': (picks) => picks.map(() => 60),
  /** The bound: what fixing every merge is worth, and what it costs colour. */
  'tol-25': (picks) => picks.map(() => 25),
  /** Per-pick radius that cannot reach its neighbour. Three floors, because a
   * radius below a bar's own interior noise fragments the bar instead. */
  'voronoi-f8': (picks) => voronoiTolerances(picks, 8),
  'voronoi-f15': (picks) => voronoiTolerances(picks, 15),
  'voronoi-f25': (picks) => voronoiTolerances(picks, 25),
};

const gtDir = path.resolve(a.gt);
const rgbaDir = path.resolve(a.rgba);
const figures = [];
for (const f of readdirSync(gtDir).filter((n) => n.endsWith('.json')).sort()) {
  const gt = JSON.parse(readFileSync(path.join(gtDir, f), 'utf8'));
  if (!(gt.task1?.output?.chart_type ?? '').toLowerCase().endsWith('bar')) continue;
  const bars = gt.task6?.output?.['visual elements']?.bars ?? [];
  if (!bars.length) continue;
  let img;
  try {
    img = readRgba(path.join(rgbaDir, f.replace(/\.json$/, '.rgba')));
  } catch {
    continue;
  }
  const bb = gt.task4?.output?._plot_bb;
  if (!(bb?.width > 0)) continue;
  const region = { x: bb.x0, y: bb.y0, width: bb.width, height: bb.height };
  const picks = [];
  for (const c of bars.map((b) => fill(img, b))) {
    if (!picks.some((k) => k.every((v, i) => Math.abs(v - c[i]) <= DEDUPE))) picks.push(c);
  }
  figures.push({ name: f.replace(/\.json$/, ''), img, bars, region, picks, grey: mono(picks) });
}

console.log(
  `figures ${figures.length}  (greyscale ${figures.filter((f) => f.grey).length}, colour ${
    figures.filter((f) => !f.grey).length
  })\n`
);

const perFigure = {};
for (const [name, tolsFor] of Object.entries(ARMS)) {
  const acc = { grey: [0, 0], colour: [0, 0] };
  perFigure[name] = {};
  let tightened = 0;
  let picksSeen = 0;
  for (const fig of figures) {
    const tols = tolsFor(fig.picks);
    const boxes = [];
    fig.picks.forEach((pick, i) => {
      picksSeen++;
      if (tols[i] < SHIPPED_TOLERANCE) tightened++;
      const r = runBarDetect(fig.img.data, fig.img.width, fig.img.height, pick, tols[i], 'foreground', fig.region, {
        minDiameter: MIN_BLOB_DIAMETER,
      });
      if (!('error' in r)) boxes.push(...r.boxes.map(predBox));
    });
    const m = boxRecallIoU(fig.bars.map(gtBox), boxes, 0.5);
    perFigure[name][fig.name] = m.matched;
    const bucket = fig.grey ? acc.grey : acc.colour;
    bucket[0] += m.matched;
    bucket[1] += m.gt;
  }
  const all = [acc.grey[0] + acc.colour[0], acc.grey[1] + acc.colour[1]];
  const pc = (x) => `${((100 * x[0]) / x[1]).toFixed(1)}%`.padStart(6);
  console.log(
    `${name.padEnd(12)} grey ${pc(acc.grey)}   colour ${pc(acc.colour)}   all ${pc(all)}   ` +
      `picks tightened ${tightened}/${picksSeen}`
  );
}

console.log('\nper-figure movement vs the shipped tol-60 (better / worse / same):');
for (const name of Object.keys(ARMS).slice(1)) {
  let better = 0;
  let worse = 0;
  let same = 0;
  let greyBetter = 0;
  let colourWorse = 0;
  for (const fig of figures) {
    const b = perFigure['tol-60'][fig.name];
    const v = perFigure[name][fig.name];
    if (v > b) {
      better++;
      if (fig.grey) greyBetter++;
    } else if (v < b) {
      worse++;
      if (!fig.grey) colourWorse++;
    } else same++;
  }
  console.log(
    `  ${name.padEnd(12)} +${String(better).padStart(3)}  -${String(worse).padStart(3)}  =${String(same).padStart(3)}` +
      `   (of the wins ${greyBetter} are greyscale; of the losses ${colourWorse} are colour)`
  );
}
