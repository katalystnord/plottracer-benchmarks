/**
 * Greyscale figures encode series by SHADE, and 35% of the gaps between
 * adjacent bar greys are narrower than the app's default tolerance of 60 — so
 * two series sit in one tolerance ball and match as one colour. Lowering the
 * tolerance fixes that and breaks colour figures (measured: 72.2% grey / 76.7%
 * colour at tol 25, against 66.6 / 82.2 shipped). Stretching the greys widens
 * the GAPS instead, so the SAME ruler separates them.
 *
 * `greyscale-tolerance.mjs` already measured the crudest stretch — min/max over
 * the whole plot box — at 68.0% grey / 82.7% colour: both improve, no trade.
 * That is a FLOOR, and the reason is visible in the arithmetic: the extremes of
 * a plot box are axis INK (near 0) and paper WHITE (near 255), so the stretch is
 * very nearly the identity and the bar shades barely move. This file asks
 * whether a stretch aimed at the shades that actually matter does better.
 *
 * ⚑⚑ THE RULE EVERY ARM HERE OBEYS: an arm may use only what the APP has.
 * The harness knows where the bars are; the app does not — it has the plot box
 * and the colours the user clicked, and nothing else. So no arm may look at
 * `task6` to decide its range. `pick-range` is the interesting one precisely
 * because the user's own picks ARE "the bars' own range", declared by a human
 * without the app having to find anything first.
 *
 * ⚑ The human input is held IDENTICAL across arms: picks are sampled and
 * deduped on the ORIGINAL image, then mapped through the arm's own LUT. A user
 * looks at the figure on screen, not at our preprocessing, so letting an arm
 * earn extra picks would be measuring a different person, not a different
 * algorithm.
 *
 * Every arm is a 256-entry LUT applied to all three channels alike — a
 * near-neutral pixel stays near-neutral and nothing acquires a hue the figure
 * never drew.
 *
 * Usage: node harness/greyscale-normalise.mjs --engine <dir> --gt <dir> --rgba <dir>
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { boxRecallIoU } from './lib/metric.mjs';

function args(argv) {
  const o = {};
  for (let i = 2; i < argv.length; i += 2) o[argv[i].replace(/^--/, '')] = argv[i + 1];
  return o;
}
const a = args(process.argv);
const { runBarDetect } = await import(path.join(path.resolve(a.engine), 'engine/barDetectRun.js'));

/** The app's own defaults, not tuned for this run. */
const TOLERANCE = 60;
const MIN_BLOB_DIAMETER = 3;
const DEDUPE = TOLERANCE / 2;

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

/** The bar's fill, as the modal colour of a grid sampled inside it. */
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
const lum = (c) => (c[0] + c[1] + c[2]) / 3;

// ---------------------------------------------------------------------------
// The arms. Each returns a 256-entry LUT.
// ---------------------------------------------------------------------------

const IDENTITY = Uint8ClampedArray.from({ length: 256 }, (_, i) => i);

/** A linear stretch mapping [lo,hi] onto [0,255], clamped outside. */
function stretchLut(lo, hi) {
  if (!(hi - lo > 1)) return IDENTITY;
  const scale = 255 / (hi - lo);
  return Uint8ClampedArray.from({ length: 256 }, (_, i) => Math.round((i - lo) * scale));
}

/** Luminance histogram of the plot box, 256 bins. */
function boxHistogram(img, region) {
  const x0 = Math.max(0, Math.floor(region.x));
  const y0 = Math.max(0, Math.floor(region.y));
  const x1 = Math.min(img.width, Math.ceil(region.x + region.width));
  const y1 = Math.min(img.height, Math.ceil(region.y + region.height));
  const hist = new Float64Array(256);
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * img.width + x) * 4;
      hist[Math.round((img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3)]++;
      n++;
    }
  }
  return { hist, n };
}

/** The luminance at a given fraction of the population. */
function percentile(hist, n, frac) {
  const target = n * frac;
  let seen = 0;
  for (let v = 0; v < 256; v++) {
    seen += hist[v];
    if (seen >= target) return v;
  }
  return 255;
}

const ARMS = {
  /** The shipped behaviour: no preprocessing at all. */
  none: () => IDENTITY,

  /** The known floor — min/max over the whole plot box. */
  'box-minmax': (img, region) => {
    const { hist } = boxHistogram(img, region);
    let lo = 0;
    while (lo < 256 && hist[lo] === 0) lo++;
    let hi = 255;
    while (hi > 0 && hist[hi] === 0) hi--;
    return stretchLut(lo, hi);
  },

  /**
   * The same stretch, but ignoring the 2% tails. A single stray dark pixel — a
   * tick label's antialiasing, a JPEG artefact — pins min/max at the extremes
   * and makes the whole stretch a no-op; a percentile cannot be held hostage
   * that way.
   */
  'box-pct': (img, region) => {
    const { hist, n } = boxHistogram(img, region);
    return stretchLut(percentile(hist, n, 0.02), percentile(hist, n, 0.98));
  },

  /**
   * Stretch over the INK, not the paper. The plot box is mostly background, so
   * the dominant histogram mode IS the background; drop it and its immediate
   * neighbours, and what is left is what was drawn. This is the app-realizable
   * proxy for "the bars' own range" — no bar has to be found first.
   */
  'fg-range': (img, region) => {
    const { hist } = boxHistogram(img, region);
    let mode = 0;
    for (let v = 1; v < 256; v++) if (hist[v] > hist[mode]) mode = v;
    const kept = Float64Array.from(hist);
    for (let v = Math.max(0, mode - 8); v <= Math.min(255, mode + 8); v++) kept[v] = 0;
    let n = 0;
    for (const c of kept) n += c;
    if (n < 32) return IDENTITY;
    return stretchLut(percentile(kept, n, 0.02), percentile(kept, n, 0.98));
  },

  /**
   * ⚑ The bars' own range, DECLARED. The user's picks are the shades the figure
   * uses for its series — the app has them the moment the user has clicked, and
   * it never has to guess which pixels are bars. A margin either side keeps a
   * bar's own interior noise inside the mapped range instead of clipping it flat.
   */
  'pick-range': (_img, _region, picks) => {
    const ls = picks.map(lum);
    return stretchLut(Math.min(...ls) - 12, Math.max(...ls) + 12);
  },

  /**
   * Histogram equalisation over the plot box: spend the output range where the
   * pixels actually are. Unlike a stretch this pulls apart shades that are close
   * AND common, which is exactly the merged-series case — but it is non-linear,
   * so it can also compress a gap elsewhere.
   */
  equalise: (img, region) => {
    const { hist, n } = boxHistogram(img, region);
    const lut = new Uint8ClampedArray(256);
    let seen = 0;
    for (let v = 0; v < 256; v++) {
      seen += hist[v];
      lut[v] = Math.round((255 * seen) / n);
    }
    return lut;
  },
};

const applyLut = (img, lut) => {
  if (lut === IDENTITY) return img;
  const out = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < img.data.length; i += 4) {
    out[i] = lut[img.data[i]];
    out[i + 1] = lut[img.data[i + 1]];
    out[i + 2] = lut[img.data[i + 2]];
    out[i + 3] = img.data[i + 3];
  }
  return { data: out, width: img.width, height: img.height };
};

// ---------------------------------------------------------------------------

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

  // The human input, decided ONCE on the original image and shared by every arm.
  const picks = [];
  for (const c of bars.map((b) => fill(img, b))) {
    if (!picks.some((k) => k.every((v, i) => Math.abs(v - c[i]) <= DEDUPE))) picks.push(c);
  }
  figures.push({ name: f.replace(/\.json$/, ''), img, bars, region, picks, grey: mono(picks) });
}

console.log(
  `figures ${figures.length}  (greyscale ${figures.filter((f) => f.grey).length}, colour ${
    figures.filter((f) => !f.grey).length
  })  picks ${figures.reduce((s, f) => s + f.picks.length, 0)}\n`
);

const perFigure = {};
const rows = [];
for (const [name, buildLut] of Object.entries(ARMS)) {
  const acc = { grey: [0, 0], colour: [0, 0] };
  perFigure[name] = {};
  for (const fig of figures) {
    const lut = buildLut(fig.img, fig.region, fig.picks);
    const img = applyLut(fig.img, lut);
    const boxes = [];
    for (const pick of fig.picks) {
      const target = [lut[pick[0]], lut[pick[1]], lut[pick[2]]];
      const r = runBarDetect(img.data, img.width, img.height, target, TOLERANCE, 'foreground', fig.region, {
        minDiameter: MIN_BLOB_DIAMETER,
      });
      if (!('error' in r)) boxes.push(...r.boxes.map(predBox));
    }
    const m = boxRecallIoU(fig.bars.map(gtBox), boxes, 0.5);
    perFigure[name][fig.name] = { matched: m.matched, gt: m.gt, pred: m.pred, grey: fig.grey };
    const bucket = fig.grey ? acc.grey : acc.colour;
    bucket[0] += m.matched;
    bucket[1] += m.gt;
  }
  const all = [acc.grey[0] + acc.colour[0], acc.grey[1] + acc.colour[1]];
  rows.push({ name, grey: acc.grey, colour: acc.colour, all });
  const pc = (x) => `${((100 * x[0]) / x[1]).toFixed(1)}%`.padStart(6);
  console.log(
    `${name.padEnd(11)} grey ${pc(acc.grey)} (${acc.grey[0]}/${acc.grey[1]})   colour ${pc(acc.colour)} (${
      acc.colour[0]
    }/${acc.colour[1]})   all ${pc(all)}`
  );
}

// How the change is DISTRIBUTED matters as much as the total: an arm that lifts
// twelve figures and wrecks four is a different proposition from one that nudges
// everything up, even at the same pooled score.
console.log('\nper-figure movement vs `none` (figures better / worse / unchanged):');
for (const { name } of rows.slice(1)) {
  let better = 0;
  let worse = 0;
  let same = 0;
  for (const fig of figures) {
    const b = perFigure.none[fig.name].matched;
    const v = perFigure[name][fig.name].matched;
    if (v > b) better++;
    else if (v < b) worse++;
    else same++;
  }
  console.log(`  ${name.padEnd(11)} +${String(better).padStart(3)}  -${String(worse).padStart(3)}  =${same}`);
}

if (a.out) {
  writeFileSync(path.resolve(a.out), JSON.stringify({ rows, perFigure }, null, 2));
  console.log(`\nwrote ${a.out}`);
}
