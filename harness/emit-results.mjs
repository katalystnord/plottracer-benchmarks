/**
 * Turn the per-figure score reports into ONE canonical results file.
 *
 * ⚑ WHY THIS EXISTS: the published numbers must come from a measurement, not
 * from someone retyping a percentage into HTML. The first version of the website
 * table was hand-written and one of its figures was wrong — it quoted the
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
 *  per-figure ratios — see harness/report.mjs for why the two differ here. */
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
const split4 = load(a.pmc);
const split5 = load(a.pmc5);

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
 * 76.1% and 76.0% — a tenth of a point apart on 3,234 and 3,260 bars. A number
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
  replication: split5.length
    ? ['bar', 'line', 'scatter'].map((f) => replication(split4, split5, f)).filter(Boolean)
    : undefined,
  corpora: corpora.map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    figures: c.rows.length,
    types: ['bar', 'line', 'scatter'].map((f) => summarise(c.rows, f)).filter(Boolean),
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
