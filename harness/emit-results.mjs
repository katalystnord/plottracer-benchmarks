/**
 * Turn the per-figure score reports into ONE canonical results file.
 *
 * ⚑ WHY THIS EXISTS: the published numbers must come from a measurement, not
 * from someone retyping a percentage into HTML. The first version of the website
 * table was hand-written and one of its figures was wrong - it quoted the
 * colour+touching cell (81.6%) as if it were the all-figures row (76.9%). A
 * number that is copied by hand will eventually be copied wrong, and there is no
 * way to notice.
 *
 * So: score -> report JSON -> THIS -> results/latest.json -> the website table is
 * generated from that file. Re-running the harness after an improvement updates
 * the site by regenerating, never by editing prose.
 *
 * Usage:
 *   node harness/emit-results.mjs --version 2.0.0-rc1 --date 2026-08-01 \
 *        --pmc out/pmc-bar.json,out/pmc-line.json,out/pmc-scatter.json \
 *        --adobe out/adobe-bar.json,out/adobe-linescatter.json \
 *        --out results/latest.json
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

// ⚑ The SAME pooling the printed table uses. Two implementations of "which
// figures can carry an assisted number" would eventually disagree, and the file
// the website is generated from is the copy nobody re-reads.
import { recall, suppliedKey, AUTO, ASSISTED } from './report.mjs';

function args(argv) {
  const o = {};
  for (let i = 2; i < argv.length; i += 2) o[argv[i].replace(/^--/, '')] = argv[i + 1];
  return o;
}

const load = (list) =>
  (list ?? '')
    .split(',')
    .filter(Boolean)
    .flatMap((f) => JSON.parse(readFileSync(f, 'utf8')))
    .filter((r) => r.status === 'ok');

/** Pool a family's rows into the numbers the site shows. Pooled, never a mean of
 *  per-figure ratios - see harness/report.mjs for why the two differ here. */
function summarise(rows, family) {
  const list = rows.filter((r) => r.family === family);
  if (!list.length) return null;
  const sub = (pred) => {
    const s = list.filter(pred);
    if (!s.length) return null;
    if (family === 'bar') {
      const m = s.reduce((a, r) => a + r.matched, 0);
      const g = s.reduce((a, r) => a + r.gt, 0);
      return { pct: +((100 * m) / g).toFixed(1), matched: m, total: g, figures: s.length };
    }
    const w = s.reduce((a, r) => a + r.within, 0);
    const g = s.reduce((a, r) => a + r.gt, 0);
    const p = s.reduce((a, r) => a + r.pred, 0);
    return {
      pct: +((100 * w) / g).toFixed(1),
      matched: w,
      total: g,
      figures: s.length,
      predPerGt: +(p / g).toFixed(2),
    };
  };
  return {
    family,
    metric: family === 'bar' ? 'recall at IoU >= 0.5' : 'points within 5% tolerance',
    unit: family === 'bar' ? 'bars' : 'points',
    all: sub(() => true),
    colour: sub((r) => !r.monochrome),
    greyscale: sub((r) => r.monochrome),
    ...(family === 'bar'
      ? { separated: sub((r) => r.touching === false), touching: sub((r) => r.touching === true) }
      : {}),
  };
}

const a = args(process.argv);

/**
 * READING THE TEXT, reported on its own (David, 2026-08-31: *"We want to add the
 * OCR numbers to the benchmark results as a separate reported value"*).
 *
 * ⚑⚑ SEPARATE BECAUSE IT IS A DIFFERENT CAPABILITY. Every other number here is
 * about recovering VALUES; this is about recovering the NAMES a chart carries. A
 * tool can be excellent at one and useless at the other, and pooling them would
 * hide both. It is scored by harness/score-ocr.mjs against the corpus's own
 * typed text (`task2`) and role labels (`task3`) - not against anything of ours.
 *
 * ⚑ HORIZONTAL LABELS ONLY, and the scope is itself a measurement: 95.7% of the
 * 887 annotated charts print their tick labels horizontally, and 95.4% of
 * individual labels sit at 0 degrees. The angled remainder is a separate
 * capability, so `anglesSkipped` is reported rather than folded in - a number
 * that quietly mixes two abilities is the thing this file exists to prevent.
 */
function ocrSummary(files) {
  if (!files) return undefined;
  const rows = String(files)
    .split(',')
    .filter(Boolean)
    .map((f) => JSON.parse(readFileSync(f, 'utf8')));
  if (rows.length === 0) return undefined;
  const sum = (k) => rows.reduce((n, r) => n + (r[k] ?? 0), 0);
  const labels = sum('labels');
  return {
    scope: 'tick labels, horizontal only (within 5 degrees of level)',
    match: 'exact string, after folding the corpus own literal \\n line-break marker to a space',
    charts: sum('charts'),
    labels,
    exact: sum('exact'),
    pct: labels ? Math.round((1000 * sum('exact')) / labels) / 10 : 0,
    anglesSkipped: sum('anglesSkipped'),
    splits: rows.map((r) => ({ split: r.split, charts: r.charts, labels: r.labels, exact: r.exact, pct: r.pct })),
  };
}
const split4 = load(a.pmc);
const split5 = load(a.pmc5);

/**
 * Manual drag-box capture, scored in DATA space by harness/score-manual.mjs.
 *
 * ⚑ This exists because the website carried "31 of 32 exact" from a 32-figure
 * pass in July whose harness no longer existed - the one number on the page that
 * could not be regenerated while every other one could. An unreproducible
 * figure is the one a reader is entitled to doubt.
 */
function manualSummary(files) {
  const rows = (files ?? '')
    .split(',')
    .filter(Boolean)
    .flatMap((f) => JSON.parse(readFileSync(f, 'utf8')));
  const ok = rows.filter((r) => r.status === 'ok');
  if (!ok.length) return undefined;
  const within = ok.reduce((s, r) => s + r.within, 0);
  const total = ok.reduce((s, r) => s + r.truth, 0);
  const exact = ok.filter((r) => r.within === r.truth).length;
  const excluded = {};
  for (const r of rows.filter((r) => r.status !== 'ok')) excluded[r.status] = (excluded[r.status] ?? 0) + 1;
  return {
    tolerance: '1% of the value range',
    figures: ok.length,
    bars: total,
    barsWithin: within,
    barsPct: +((100 * within) / total).toFixed(1),
    figuresFullyWithin: exact,
    figuresPct: +((100 * exact) / ok.length).toFixed(1),
    excluded,
  };
}

/**
 * The ASSISTED path, pooled -- and kept in its own object rather than folded
 * into the per-type numbers above.
 *
 * ⚑⚑ WHY IT IS SEPARATE IN THE FILE AND NOT ONLY IN THE PRINTOUT. This file IS
 * the published table; the website is generated from it. An assisted number
 * blended into `types[].all.pct` would put the ceiling on the page under the
 * label of the path a user gets with two clicks, which is the exact mistake this
 * whole exercise exists to correct.
 */
function assistedSummary(rows) {
  const bars = rows.filter((r) => r.family === 'bar' && r.status === 'ok');
  const full = bars.filter((r) => suppliedKey(r) === 'both');
  if (!full.length) return undefined;
  const auto = recall(full, AUTO);
  const assisted = recall(full, ASSISTED);
  const notDrivable = {};
  for (const r of bars) {
    const k = suppliedKey(r);
    if (k !== 'both') notDrivable[k] = (notDrivable[k] ?? 0) + 1;
  }
  return {
    supplies: 'the marked category axis and the declared baseline, from the corpus\'s own annotation',
    caveat: 'A CEILING: the declarations are the annotator\'s, placed exactly. A person marking an axis and clicking a baseline lands near them, not on them.',
    figures: full.length,
    figuresInFamily: bars.length,
    bars: auto.g,
    autoPct: +auto.pct.toFixed(1),
    assistedPct: +assisted.pct.toFixed(1),
    deltaPts: +(assisted.pct - auto.pct).toFixed(1),
    joinedAcrossBaseline: full.reduce((a, r) => a + (r.assisted?.joined ?? 0), 0),
    swatchSuspectsReported: full.reduce((a, r) => a + (r.assisted?.swatchSuspects ?? 0), 0),
    baselineAtAxisLine: full.filter((r) => r.assisted?.baseline?.source === 'axis-end').length,
    notDrivable,
  };
}

const corpora = [
  {
    id: 'pmc',
    name: 'UB-UNITEC PMC',
    kind: 'Real published figures',
    rows: [...split4, ...split5],
    splits: ['split_4 (Tasks 6a/6b)', 'split_5 (Task 7, end-to-end)'],
  },
  {
    id: 'adobe',
    name: 'Adobe CHART-Synthetic',
    kind: 'Generated figures',
    rows: load(a.adobe),
  },
].filter((c) => c.rows.length);

/**
 * Agreement between two DISJOINT splits of the same corpus.
 *
 * ⚑ This is the strongest single piece of evidence in the file and it is not a
 * headline number, so it would be easy to lose. PMC split_4 (Tasks 6a/6b) and
 * split_5 (Task 7) share no images. Scored identically, bar recall came back
 * 76.1% and 76.0% - a tenth of a point apart on 3,234 and 3,260 bars. A number
 * that reproduces on data it has never seen is a measurement; one that does not
 * is a property of the sample.
 */
function replication(a, b, family) {
  const one = summarise(a, family);
  const two = summarise(b, family);
  if (!one || !two) return null;
  return {
    family,
    splitA: { pct: one.all.pct, total: one.all.total, figures: one.all.figures },
    splitB: { pct: two.all.pct, total: two.all.total, figures: two.all.figures },
    delta: +Math.abs(one.all.pct - two.all.pct).toFixed(1),
  };
}

const results = {
  // Stamped so a stale table is visible as stale rather than merely wrong.
  appVersion: a.version ?? 'unknown',
  measured: a.date ?? 'unknown',
  harness: 'plottracer-benchmarks',
  settings: { tolerance: 60, minBlobDiameter: 3, space: 'image (Task 6a)' },
  // Which human inputs each reported path supplies. Stated in the file itself,
  // because a number without this line drawn is not comparable to anything --
  // the README asks every other digitiser for exactly this and had better carry
  // it too.
  paths: {
    auto: 'the plot box and the element colours, and nothing else',
    assisted: 'AUTO plus the two declarations a bar calibration walk asks for: the marked category axis and the baseline the bars stand on (bars only)',
    manual: 'a full calibration from two tick labels plus the category axis, then two corners per bar; scored in DATA space',
  },
  manual: manualSummary(a.manual),
  ocr: ocrSummary(a.ocr),
  replication: split5.length
    ? ['bar', 'line', 'scatter'].map((f) => replication(split4, split5, f)).filter(Boolean)
    : undefined,
  corpora: corpora.map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    figures: c.rows.length,
    types: ['bar', 'line', 'scatter'].map((f) => summarise(c.rows, f)).filter(Boolean),
    assisted: assistedSummary(c.rows),
  })),
};

const out = a.out ?? 'results/latest.json';
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(results, null, 2) + '\n');

for (const c of results.corpora) {
  console.log(`${c.name}: ${c.figures} figures`);
  for (const t of c.types) console.log(`  ${t.family.padEnd(8)} ${String(t.all.pct).padStart(5)}%  (${t.all.matched}/${t.all.total} ${t.unit})`);
}
console.log(`\nwrote ${out}`);
