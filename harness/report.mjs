/**
 * Turn the per-figure JSON reports into the published table.
 *
 * ⚑ Reports POOLED figures, not a mean of per-figure ratios. The two differ a
 * lot here -- a corpus where a handful of figures carry hundreds of points and
 * most carry a dozen makes "mean of per-figure score" and "score over all
 * points" tell different stories, and quoting whichever is higher would be
 * exactly the kind of number this project exists not to publish. Both are
 * printed; the pooled one is the headline.
 */
import { readFileSync } from 'node:fs';

const files = process.argv.slice(2);
const rows = files.flatMap((f) => JSON.parse(readFileSync(f, 'utf8')));

function bucket(list) {
  const colour = list.filter((r) => !r.monochrome);
  const grey = list.filter((r) => r.monochrome);
  return { all: list, colour, grey };
}

const byFamily = {};
for (const r of rows.filter((r) => r.status === 'ok')) (byFamily[r.family] ??= []).push(r);

for (const [family, list] of Object.entries(byFamily)) {
  console.log(`\n## ${family} — ${list.length} figures`);
  const b = bucket(list);
  for (const [label, sub] of Object.entries(b)) {
    if (!sub.length) continue;
    if (family === 'bar') {
      const m = sub.reduce((a, r) => a + r.matched, 0);
      const g = sub.reduce((a, r) => a + r.gt, 0);
      console.log(
        `  ${label.padEnd(7)} ${String(sub.length).padStart(4)} figs  ` +
          `recall ${((100 * m) / g).toFixed(1)}%  (${m}/${g} bars)`
      );
      for (const t of [false, true]) {
        const s2 = sub.filter((r) => r.touching === t);
        if (!s2.length) continue;
        const m2 = s2.reduce((a, r) => a + r.matched, 0);
        const g2 = s2.reduce((a, r) => a + r.gt, 0);
        console.log(
          `      ${t ? 'touching ' : 'separated'} ${String(s2.length).padStart(4)} figs  ` +
            `recall ${((100 * m2) / g2).toFixed(1)}%  (${m2}/${g2})`
        );
      }
    } else {
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
  }
}
