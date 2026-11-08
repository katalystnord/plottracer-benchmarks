// The LineFormer line score, reimplemented (harness/lib/linescore.mjs): its sanity checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { lineScore, compareContinuous } from '../lib/linescore.mjs';

const line = (pts) => pts.map(([x, y]) => ({ x, y }));
const A = line([[0, 100], [50, 120], [100, 140]]);
const B = line([[0, 300], [50, 280], [100, 260]]);

test('a line against itself is 1', () => {
  assert.equal(compareContinuous(A, A), 1);
});

test('given the true lines as the prediction, 6a and 6b are 1', () => {
  assert.equal(lineScore([A, B], [A, B], '6a'), 1);
  assert.equal(lineScore([B, A], [A, B], '6b'), 1);
});

test('given an extra line, 6a ignores it and 6b counts it', () => {
  const extra = line([[0, 500], [100, 500]]);
  assert.equal(lineScore([A, extra], [A], '6a'), 1);
  assert.equal(lineScore([A, extra], [A], '6b'), 0.5);
});

test('given a missed line, both count it', () => {
  assert.equal(lineScore([A], [A, B], '6a'), 0.5);
  assert.equal(lineScore([A], [A, B], '6b'), 0.5);
});

test('given the corpora, every line figure scored against its own truth is 1, 6a and 6b', () => {
  const roots = [
    'work/ICPR2022_CHARTINFO_UB_UNITEC_PMC_TEST_v2.1/final_full_GT/split_4/annotations_JSON',
    'work/ICPR2022_CHARTINFO_UB_UNITEC_PMC_TEST_v2.1/final_full_GT/split_5/annotations_JSON',
    'work/adobe/test_release/task6/gt_json',
  ].filter((d) => existsSync(d));
  let n = 0;
  for (const d of roots) {
    for (const f of readdirSync(d)) {
      const g = JSON.parse(readFileSync(path.join(d, f), 'utf8'));
      if ((g.task1?.output?.chart_type ?? '').toLowerCase() !== 'line') continue;
      const lines = (g.task6?.output?.['visual elements']?.lines ?? []).filter((L) => L.length);
      if (!lines.length) continue;
      assert.ok(Math.abs(lineScore(lines, lines, '6a') - 1) < 1e-9, f);
      assert.ok(Math.abs(lineScore(lines, lines, '6b') - 1) < 1e-9, f);
      n++;
    }
  }
  if (roots.length) assert.ok(n > 400, `${n} figures`);
});
