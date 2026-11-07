// The Task 6a bar score, reimplemented (harness/lib/chartinfo6a.mjs): its sanity checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { assign, barScore6a } from '../lib/chartinfo6a.mjs';

const bar = (x0, y0, width, height) => ({ x0, y0, width, height });
const size = { width: 1000, height: 800 }; // T = 40 px

test('the assignment finds the minimum-cost pairing', () => {
  assert.deepEqual(assign([[4, 1, 3], [2, 0, 5], [3, 2, 2]]), [1, 0, 2]);
  assert.deepEqual(assign([[0, 9], [9, 0]]), [0, 1]);
});

test('given the truth scored against itself, the score is 1 (intended)', () => {
  const gt = [bar(10, 100, 40, 300), bar(60, 200, 40, 200), bar(110, 50, 40, 350)];
  assert.equal(barScore6a(gt, gt, size), 1);
  assert.equal(barScore6a([gt[0]], [gt[0]], size), 1);
});

test('given one bar off by T in all, it scores 0; half of T, 0.5', () => {
  const g = bar(10, 100, 40, 300);
  assert.equal(barScore6a([bar(10, 100, 40, 340)], [g], size), 0); // y1 off by 40 = T
  assert.equal(barScore6a([bar(10, 100, 40, 320)], [g], size), 0.5);
});

test('given an extra box beside a perfect one, the score is halved (divided by max(#GT, #pred))', () => {
  const g = bar(10, 100, 40, 300);
  assert.equal(barScore6a([g, bar(500, 500, 10, 10)], [g], size), 0.5);
  assert.equal(barScore6a([], [g], size), 0);
});

test('the script as published scores a lone perfect bar 0 (its similarity is minimised as a cost)', () => {
  const g = bar(10, 100, 40, 300);
  assert.equal(barScore6a([g], [g], size, 'published'), 0);
});

test('given the corpora, every bar figure scored against its own truth is 1 (intended)', () => {
  const roots = [
    'work/ICPR2022_CHARTINFO_UB_UNITEC_PMC_TEST_v2.1/final_full_GT/split_4/annotations_JSON',
    'work/ICPR2022_CHARTINFO_UB_UNITEC_PMC_TEST_v2.1/final_full_GT/split_5/annotations_JSON',
    'work/adobe/test_release/task6/gt_json',
  ].filter((d) => existsSync(d));
  let n = 0;
  for (const d of roots) {
    for (const f of readdirSync(d)) {
      const g = JSON.parse(readFileSync(path.join(d, f), 'utf8'));
      const t = (g.task1?.output?.chart_type ?? '').toLowerCase();
      const bars = g.task6?.output?.['visual elements']?.bars;
      if (!t.includes('bar') || !bars?.length) continue;
      assert.equal(barScore6a(bars, bars, { width: 1280, height: 960 }), 1, f);
      n++;
    }
  }
  if (roots.length) assert.ok(n > 800, `${n} figures`);
});
