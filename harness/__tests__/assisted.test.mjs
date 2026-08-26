/**
 * The assisted path's cases, named for the CASE and not for the function.
 *
 * ⚑⚑ WHY A HARNESS HAS TESTS AT ALL. This one has produced four numbers that
 * looked like measurements and were not -- three outright bugs, and one
 * undeclared scope that read as coverage for a whole release. A benchmark
 * harness is code, and its shortcuts become the product's published numbers.
 *
 * Run: node --test harness/__tests__/
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { declaredBaseline, declaredDividers, barsAreHorizontal } from '../score.mjs';
import { recall, suppliedKey, AUTO, ASSISTED } from '../report.mjs';

const TOL = 2;

/** A ground truth carrying nothing but the tick labels of one axis. */
function gtWith({ axis = 'y-axis', ticks = [], chartType = 'vertical bar' } = {}) {
  return {
    task1: { output: { chart_type: chartType } },
    task2: { output: { text_blocks: ticks.map((t, i) => ({ id: i, text: t.text })) } },
    task3: { output: { text_roles: ticks.map((t, i) => ({ id: i, role: t.role ?? 'tick_label' })) } },
    task4: { output: { axes: { [axis]: ticks.map((t, i) => ({ id: i, tick_pt: { x: t.x, y: t.y } })) } } },
  };
}
const BOX = { x0: 100, y0: 50, width: 400, height: 300 }; // y spans 50..350

test('a value axis spanning zero puts the baseline at the pixel of value 0', () => {
  // 10 at y=100, -10 at y=300  =>  0 sits halfway, at y=200.
  const gt = gtWith({ ticks: [{ text: '10', x: 90, y: 100 }, { text: '-10', x: 90, y: 300 }] });
  const b = declaredBaseline(gt, BOX, false, TOL);
  assert.equal(b.source, 'zero');
  assert.equal(b.atPixel, 200);
  assert.equal(b.tolerancePx, TOL);
});

test('a value axis that never reaches zero puts the baseline on the axis line the bars stand on', () => {
  // 100 at y=100, 60 at y=300: five pixels per unit, so zero would fall at
  // y=600 -- well below the box. The bars stand on the axis line instead.
  const gt = gtWith({ ticks: [{ text: '100', x: 90, y: 100 }, { text: '60', x: 90, y: 300 }] });
  const b = declaredBaseline(gt, BOX, false, TOL);
  assert.equal(b.source, 'axis-end');
  // Value falls as y rises, so the low-value end is the BOTTOM of the box.
  assert.equal(b.atPixel, BOX.y0 + BOX.height);
});

test('an inverted value axis puts the axis-line baseline at the other end of the box', () => {
  // Values RISE with y -- the annotation says so, and convention does not get a
  // vote. The bars then stand on the TOP edge.
  const gt = gtWith({ ticks: [{ text: '60', x: 90, y: 100 }, { text: '100', x: 90, y: 300 }] });
  const b = declaredBaseline(gt, BOX, false, TOL);
  assert.equal(b.source, 'axis-end');
  assert.equal(b.atPixel, BOX.y0);
});

test('a horizontal bar figure reads its baseline along x', () => {
  const gt = gtWith({
    axis: 'x-axis',
    chartType: 'horizontal bar',
    ticks: [{ text: '-5', x: 200, y: 360 }, { text: '5', x: 400, y: 360 }],
  });
  assert.equal(barsAreHorizontal(gt), true);
  const b = declaredBaseline(gt, BOX, true, TOL);
  assert.equal(b.source, 'zero');
  assert.equal(b.atPixel, 300);
});

test('a figure with fewer than two numeric tick labels has no baseline to declare', () => {
  const gt = gtWith({ ticks: [{ text: '10', x: 90, y: 100 }] });
  assert.equal(declaredBaseline(gt, BOX, false, TOL), null);
});

test('a tick label that is not a number is not a tick', () => {
  // A category name beside a value: one usable pair is not a pair.
  const gt = gtWith({ ticks: [{ text: '10', x: 90, y: 100 }, { text: 'Control', x: 90, y: 300 }] });
  assert.equal(declaredBaseline(gt, BOX, false, TOL), null);
});

test('a tick whose label did not join is dropped, not read as the value zero', () => {
  // ⚑⚑ THE SILENT ONE. `Number('')` is 0 and 0 is finite, so a tick whose text
  // could not be found used to arrive as a MEASUREMENT OF ZERO at that pixel --
  // and a fabricated zero is exactly the value a baseline is looked for at. It
  // would calibrate, and nothing would look wrong.
  const gt = gtWith({ ticks: [{ text: '10', x: 90, y: 100 }, { text: '', x: 90, y: 300 }] });
  assert.equal(declaredBaseline(gt, BOX, false, TOL), null);
});

test('a label the corpus does not call a tick_label is not a tick', () => {
  const gt = gtWith({
    ticks: [{ text: '10', x: 90, y: 100 }, { text: '20', x: 90, y: 300, role: 'axis_title' }],
  });
  assert.equal(declaredBaseline(gt, BOX, false, TOL), null);
});

test('two ticks at the same pixel cannot calibrate a baseline', () => {
  const gt = gtWith({ ticks: [{ text: '10', x: 90, y: 100 }, { text: '20', x: 90, y: 100 }] });
  assert.equal(declaredBaseline(gt, BOX, false, TOL), null);
});

// ---- the two corpora disagree about their own annotation, silently ----

/**
 * Adobe's shape: `text_blocks` carry NO id and are identified by POSITION, and
 * the axis keys name the VARIABLE rather than the screen direction -- so on a
 * horizontal bar chart its `x-axis` ticks run down the image and its `y-axis`
 * ticks run across it.
 */
function adobeStyleGt() {
  return {
    task1: { output: { chart_type: 'stacked horizontal bar' } },
    task2: {
      output: {
        text_blocks: [
          { text: 'A title' },
          { text: '0' }, { text: '200' }, { text: '400' },
          { text: 'Punjab' }, { text: 'Tripura' },
        ],
      },
    },
    task3: {
      output: {
        text_roles: [
          { id: 0, role: 'chart_title' },
          { id: 1, role: 'tick_label' }, { id: 2, role: 'tick_label' }, { id: 3, role: 'tick_label' },
          { id: 4, role: 'tick_label' }, { id: 5, role: 'tick_label' },
        ],
      },
    },
    task4: {
      output: {
        // The CATEGORY axis, filed under `x-axis`, running DOWN the image.
        axes: {
          'x-axis': [
            { id: 4, tick_pt: { x: 163, y: 200 } },
            { id: 5, tick_pt: { x: 163, y: 300 } },
          ],
          // The VALUE axis, filed under `y-axis`, running ACROSS the image.
          'y-axis': [
            { id: 1, tick_pt: { x: 200, y: 875 } },
            { id: 2, tick_pt: { x: 400, y: 875 } },
            { id: 3, tick_pt: { x: 600, y: 875 } },
          ],
        },
        _plot_bb: { x0: 150, y0: 100, width: 500, height: 300 },
      },
    },
    task6: { output: { 'visual elements': { bars: [{ x0: 200, y0: 180, width: 100, height: 40 }] } } },
  };
}

test('a corpus whose text blocks carry no id is joined by position', () => {
  // Every Adobe label would otherwise read as `undefined` and be dropped, and
  // the harness would report "this corpus has no numeric ticks" -- a bug wearing
  // an absent feature's clothes.
  const b = declaredBaseline(adobeStyleGt(), adobeStyleGt().task4.output._plot_bb, true, TOL);
  assert.notEqual(b, null);
  // 0 at x=200, 400 at x=600 => value 0 is at x=200, inside the box.
  assert.equal(b.source, 'zero');
  assert.equal(b.atPixel, 200);
});

test('the value axis is the one that runs along the value direction, whatever its key is called', () => {
  const gt = adobeStyleGt();
  // Filed under `y-axis`, read because its ticks spread across the image, which
  // is where a horizontal bar's value runs. Reading `x-axis` by name would
  // return the two CATEGORY ticks and calibrate the baseline off them.
  const b = declaredBaseline(gt, gt.task4.output._plot_bb, true, TOL);
  assert.equal(b.ticks, 3);
});

test('the category dividers come from the axis the categories run along', () => {
  const gt = adobeStyleGt();
  const cats = declaredDividers(gt, 'bar', gt.task4.output._plot_bb);
  assert.notEqual(cats, null);
  assert.equal(cats.categoryAxis, 'y');
  // Two category ticks at y=200 and y=300, closed by the box at 100 and 400.
  assert.equal(cats.ticks, 2);
  assert.equal(cats.dividers[0], 100);
  assert.equal(cats.dividers[cats.dividers.length - 1], 400);
});

// ---- the reporting half: the two paths must never pool into one number ----

const row = (auto, assisted, supplied) => ({
  family: 'bar', status: 'ok', gt: 10, matched: auto, touching: false, monochrome: false,
  assisted: supplied ? { matched: assisted, supplied, pred: 0, joined: 0, swatchSuspects: 0, baseline: null } : null,
});

test('the assisted path is pooled apart from the auto path, never with it', () => {
  const list = [row(6, 9, ['categories', 'baseline']), row(7, 8, ['categories', 'baseline'])];
  assert.equal(recall(list, AUTO).m, 13);
  assert.equal(recall(list, ASSISTED).m, 17);
  // The denominators are the SAME figures -- a subset scored against a
  // different denominator is not a comparison.
  assert.equal(recall(list, AUTO).g, recall(list, ASSISTED).g);
});

test('a figure missing one declaration is not counted as the full assisted path', () => {
  assert.equal(suppliedKey(row(6, 9, ['categories', 'baseline'])), 'both');
  assert.equal(suppliedKey(row(6, 7, ['categories'])), 'categories');
  assert.equal(suppliedKey(row(6, 7, ['baseline'])), 'baseline');
  assert.equal(suppliedKey(row(6, 0, null)), 'none');
});

test('an auto-only figure contributes no assisted matches, not zero of them', () => {
  // ⚑ The distinction that matters: a figure the assisted path could not be
  // driven on must be EXCLUDED from that pool, never folded in as a zero, which
  // would report a fabricated failure as a measurement.
  const list = [row(6, 9, ['categories', 'baseline']), row(7, 0, null)];
  const drivable = list.filter((r) => suppliedKey(r) === 'both');
  assert.equal(drivable.length, 1);
  assert.equal(recall(drivable, ASSISTED).g, 10);
});
