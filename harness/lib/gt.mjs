/**
 * Reading the corpus's own annotation. One definition per fact, used by every
 * scorer -- so a harness bug shows up in both numbers rather than in one.
 *
 * ⚑ WHY THIS FILE EXISTS. `score-manual.mjs` recovered (pixel, value) tick pairs
 * to calibrate a real `CalibrationSession`; `score.mjs` now needs the SAME pairs
 * to recover the declared baseline. Two copies of "what counts as a tick" would
 * be two experiments wearing one name.
 */

/**
 * Numeric tick labels with their pixel positions, joined across three tasks:
 *
 *   task4.axes[axis][].tick_pt   pixel position of each tick, with an id
 *   task2.text_blocks[]          the id'd text of every label
 *   task3.text_roles[]           which of those ids are `tick_label`
 *
 * ⚑ The join is what makes this a MEASUREMENT off the figure rather than an
 * invention: every pair is a number a reader can see printed beside a position
 * a reader can point at. A tick whose label is not numeric (a category name, a
 * date the corpus did not type out) is dropped rather than guessed at.
 */
export function numericTicks(gt, axis) {
  const roles = idMap(gt.task3?.output?.text_roles ?? [], (r) => r.role);
  const texts = idMap(gt.task2?.output?.text_blocks ?? [], (t) => t.text);
  const out = [];
  for (const t of axisPoints(gt, axis)) {
    if (roles.get(t.id) !== 'tick_label') continue;
    const raw = (texts.get(t.id) ?? '').replace(/[\s,]/g, '');
    const v = Number(raw);
    if (raw === '' || !Number.isFinite(v)) continue;
    out.push({ px: t.tick_pt.x, py: t.tick_pt.y, value: v });
  }
  return out;
}

/**
 * Index a corpus list by its `id`, FALLING BACK TO ARRAY POSITION.
 *
 * ⚠️⚑⚑ THE TWO CORPORA DO NOT AGREE ABOUT THIS, and the disagreement is silent.
 * PMC stamps every `text_blocks` entry with an `id`; Adobe's carry none and are
 * identified by their POSITION, which its `text_roles` list mirrors one-for-one.
 * Joining on `id` alone therefore returned `undefined` for every Adobe label, so
 * not one of its 498 bar figures could produce a baseline -- and the harness
 * reported that as "this corpus has no numeric ticks" rather than as a bug. A
 * missing join reads exactly like an absent feature.
 */
function idMap(list, value) {
  const m = new Map();
  list.forEach((item, i) => m.set(item.id ?? i, value(item)));
  return m;
}

/** Every annotated tick of one axis that carries a usable pixel position. */
function axisPoints(gt, axis) {
  return (gt.task4?.output?.axes?.[axis] ?? []).filter(
    (t) => t.tick_pt && Number.isFinite(t.tick_pt.x) && Number.isFinite(t.tick_pt.y)
  );
}

/** How far a list of ticks spreads in each screen direction. */
function spread(points) {
  if (!points.length) return { x: 0, y: 0 };
  const xs = points.map((t) => t.tick_pt.x);
  const ys = points.map((t) => t.tick_pt.y);
  return { x: Math.max(...xs) - Math.min(...xs), y: Math.max(...ys) - Math.min(...ys) };
}

/**
 * Which annotated axis actually RUNS ALONG a given screen direction.
 *
 * ⚠️⚑⚑ READ OFF THE GEOMETRY, BECAUSE THE KEY NAME IS NOT A DIRECTION. PMC's
 * `x-axis` is the horizontal one; Adobe's is the CATEGORY one, so on a
 * horizontal bar chart its `x-axis` ticks run DOWN the image and its `y-axis`
 * ticks run across it. Choosing by name read Adobe's category axis as its value
 * axis on every horizontal figure. This is the same lesson `declaredDividers`
 * already records about `_x-tick-type`: the corpus's label is a claim, the
 * pixels are the fact.
 *
 * Falls back to the name only when the geometry cannot decide -- a single tick,
 * or two axes that spread the same way.
 */
export function axisKeyAlong(gt, direction) {
  const other = direction === 'x' ? 'y' : 'x';
  const scored = ['x-axis', 'y-axis'].map((key) => ({ key, s: spread(axisPoints(gt, key)) }));
  const along = scored.filter((c) => c.s[direction] > c.s[other]);
  if (along.length === 1) return along[0].key;
  if (along.length > 1) return along.reduce((a, b) => (b.s[direction] > a.s[direction] ? b : a)).key;
  return direction === 'x' ? 'x-axis' : 'y-axis';
}

/** The numeric ticks of whichever axis runs along `direction`. */
export function numericTicksAlong(gt, direction) {
  return numericTicks(gt, axisKeyAlong(gt, direction));
}

/** Every annotated tick position of whichever axis runs along `direction`,
 *  numeric label or not -- dividers need positions, not values. */
export function axisPointsAlong(gt, direction) {
  return axisPoints(gt, axisKeyAlong(gt, direction));
}

/**
 * The two ticks furthest apart along the value axis -- the pair a user would
 * pick, and the pair that minimises the effect of a one-pixel misread.
 *
 * Returns them in PIXEL order (lowest pixel coordinate first), or null when the
 * figure does not carry two usable ones. `vertical` says the value axis runs
 * down the image, which is a vertical bar chart's y axis.
 */
export function extremeTickPair(list, vertical) {
  if (list.length < 2) return null;
  const key = (t) => (vertical ? t.py : t.px);
  const sorted = [...list].sort((x, y) => key(x) - key(y));
  const lo = sorted[0];
  const hi = sorted[sorted.length - 1];
  if (lo.value === hi.value || key(lo) === key(hi)) return null;
  return [lo, hi];
}
