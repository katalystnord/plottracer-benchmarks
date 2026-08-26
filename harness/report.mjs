/**
 * Turn the per-figure JSON reports into the published table.
 *
 * ⚑ Reports POOLED figures, not a mean of per-figure ratios. The two differ a
 * lot here -- a corpus where a handful of figures carry hundreds of points and
 * most carry a dozen makes "mean of per-figure score" and "score over all
 * points" tell different stories, and quoting whichever is higher would be
 * exactly the kind of number this project exists not to publish. Both are
 * printed; the pooled one is the headline.
 *
 * ⚑⚑ AND IT REPORTS THE TWO PATHS APART. `score.mjs` scores every bar figure
 * twice -- AUTO (plot box + colours) and ASSISTED (+ the marked category axis
 * and the declared baseline a person supplies in the calibration walk). One
 * blended number would hide exactly the half that moved, which is how this
 * harness came to report the auto path under the product's name for a whole
 * release. So the two never share a row, and the assisted comparison is always
 * printed against the AUTO number FOR THE SAME FIGURES: a subset scored on a
 * different denominator is not a comparison.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function bucket(list) {
  const colour = list.filter((r) => !r.monochrome);
  const grey = list.filter((r) => r.monochrome);
  return { all: list, colour, grey };
}

/** Pooled bar recall over a list of rows, reading matched from `pick`. */
export function recall(list, pick) {
  const m = list.reduce((a, r) => a + (pick(r) ?? 0), 0);
  const g = list.reduce((a, r) => a + r.gt, 0);
  return { m, g, pct: g > 0 ? (100 * m) / g : 0 };
}
export const AUTO = (r) => r.matched;
export const ASSISTED = (r) => r.assisted?.matched;

/** Which declarations a figure's ground truth could supply, as a stable key. */
export function suppliedKey(r) {
  if (!r.assisted) return 'none';
  const s = r.assisted.supplied ?? [];
  return s.includes('categories') && s.includes('baseline')
    ? 'both'
    : s.includes('categories')
      ? 'categories'
      : s.includes('baseline')
        ? 'baseline'
        : 'none';
}

export const SUPPLIED_LABEL = {
  both: 'full assisted path (category axis + baseline)',
  categories: 'category axis only  (no two numeric tick labels for a baseline)',
  baseline: 'baseline only        (no usable category ticks)',
  none: 'no declarable input',
};

export function reportBar(list) {
  console.log('  AUTO -- plot box + colours only (the published path)');
  const b = bucket(list);
  for (const [label, sub] of Object.entries(b)) {
    if (!sub.length) continue;
    const a = recall(sub, AUTO);
    console.log(
      `    ${label.padEnd(9)} ${String(sub.length).padStart(4)} figs  recall ${a.pct.toFixed(1)}%  (${a.m}/${a.g} bars)`
    );
    for (const t of [false, true]) {
      const s2 = sub.filter((r) => r.touching === t);
      if (!s2.length) continue;
      const a2 = recall(s2, AUTO);
      console.log(
        `        ${t ? 'touching ' : 'separated'} ${String(s2.length).padStart(4)} figs  recall ${a2.pct.toFixed(1)}%  (${a2.m}/${a2.g})`
      );
    }
  }

  console.log('\n  ASSISTED -- + the marked category axis and the declared baseline');
  console.log('             (a CEILING: the declarations are the annotator\'s, placed exactly)');
  const groups = { both: [], categories: [], baseline: [], none: [] };
  for (const r of list) groups[suppliedKey(r)].push(r);

  for (const key of ['both', 'categories', 'baseline']) {
    const sub = groups[key];
    if (!sub.length) continue;
    const a = recall(sub, AUTO);
    const s = recall(sub, ASSISTED);
    const delta = s.pct - a.pct;
    console.log(`    ${SUPPLIED_LABEL[key]}  --  ${sub.length} figs`);
    console.log(`        same figures, AUTO      recall ${a.pct.toFixed(1)}%  (${a.m}/${a.g} bars)`);
    console.log(
      `        same figures, ASSISTED  recall ${s.pct.toFixed(1)}%  (${s.m}/${s.g} bars)   ${delta >= 0 ? '+' : ''}${delta.toFixed(1)} pts`
    );
    if (key !== 'categories') {
      // What the baseline actually DID, so a moved number can be attributed
      // rather than guessed at. `joined` acted; suspects were only reported.
      const joined = sub.reduce((x, r) => x + (r.assisted?.joined ?? 0), 0);
      const susp = sub.reduce((x, r) => x + (r.assisted?.swatchSuspects ?? 0), 0);
      const ends = sub.filter((r) => r.assisted?.baseline?.source === 'axis-end').length;
      console.log(
        `        baseline acted: ${joined} bars rejoined across it · ${susp} swatch suspects reported (none dropped)`
      );
      console.log(`        baseline at value 0 on ${sub.length - ends} figs, at the axis line on ${ends}`);
    }
    for (const t of [false, true]) {
      const s2 = sub.filter((r) => r.touching === t);
      if (!s2.length) continue;
      const a2 = recall(s2, AUTO);
      const b2 = recall(s2, ASSISTED);
      console.log(
        `        ${t ? 'touching ' : 'separated'} ${String(s2.length).padStart(4)} figs  ${a2.pct.toFixed(1)}% -> ${b2.pct.toFixed(1)}%`
      );
    }
  }
  if (groups.none.length) {
    const a = recall(groups.none, AUTO);
    console.log(
      `    ${SUPPLIED_LABEL.none}  --  ${groups.none.length} figs, AUTO only  recall ${a.pct.toFixed(1)}%  (${a.m}/${a.g} bars)`
    );
  }
}

function main(files) {
  const rows = files.flatMap((f) => JSON.parse(readFileSync(f, 'utf8')));
  const byFamily = {};
  for (const r of rows.filter((r) => r.status === 'ok')) (byFamily[r.family] ??= []).push(r);

  for (const [family, list] of Object.entries(byFamily)) {
    console.log(`\n## ${family} -- ${list.length} figures`);
    if (family === 'bar') {
      reportBar(list);
      continue;
    }
    const b = bucket(list);
    for (const [label, sub] of Object.entries(b)) {
      if (!sub.length) continue;
      const w = sub.reduce((a, r) => a + r.within, 0);
      const g = sub.reduce((a, r) => a + r.gt, 0);
      const p = sub.reduce((a, r) => a + r.pred, 0);
      const meanScore = sub.reduce((a, r) => a + r.score, 0) / sub.length;
      console.log(
        `  ${label.padEnd(7)} ${String(sub.length).padStart(4)} figs  ` +
          `found ${((100 * w) / g).toFixed(1)}%  (${w}/${g} pts)  ` +
          `pred/gt ${(p / g).toFixed(2)}x  mean-score ${meanScore.toFixed(3)}`
      );
    }
    // ⚑ Said once per family rather than buried in every row: the assisted path
    // adds nothing here, because this walk asks for the axes and the colour and
    // the auto path already supplies both. That is why there is one number.
    console.log('  (AUTO only -- this family has no further user declaration to supply)');
  }
}

// ⚑ Run only when this file IS the program, so a test can import the pooling
// helpers without the module printing a table as a side effect.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2));
