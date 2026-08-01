/**
 * Metrics. Kept in one file, separate from the runner, so anyone auditing a
 * published number can read the scoring rule without reading the plumbing.
 *
 * Two rules are used, and WHICH one applies to WHICH chart type is a deliberate
 * choice that is stated in README.md rather than buried here:
 *
 *   boxRecallIoU   — bars. A bar is an AREA, so overlap is the natural question.
 *   pointScore     — scatter and lines. A marker is a POSITION, so distance is.
 *
 * `pointScore` is the CHART-Infographics competition's own task-6a rule, adopted
 * rather than invented:  score = SUM max(0, 1 - D/T) / max(#GT, #pred),  where D
 * is Euclidean pixel distance and T is 5% of the image's smaller dimension.
 */

/** Competition tolerance: 5% of the smaller image dimension, in pixels. */
export function toleranceFor(width, height) {
  return 0.05 * Math.min(width, height);
}

function iou(a, b) {
  const x0 = Math.max(a.minX, b.minX);
  const y0 = Math.max(a.minY, b.minY);
  const x1 = Math.min(a.maxX, b.maxX);
  const y1 = Math.min(a.maxY, b.maxY);
  if (x1 <= x0 || y1 <= y0) return 0;
  const inter = (x1 - x0) * (y1 - y0);
  const areaA = (a.maxX - a.minX) * (a.maxY - a.minY);
  const areaB = (b.maxX - b.minX) * (b.maxY - b.minY);
  const union = areaA + areaB - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Greedy one-to-one box matching at an IoU threshold. Greedy-by-best-pair (not
 * by list order) so the score does not depend on which order the detector
 * happened to emit its boxes in.
 *
 * Returns matched count plus the two denominators, so a caller can report
 * recall and precision without re-deriving anything.
 */
export function boxRecallIoU(gtBoxes, predBoxes, threshold = 0.5) {
  const pairs = [];
  for (let g = 0; g < gtBoxes.length; g++) {
    for (let p = 0; p < predBoxes.length; p++) {
      const v = iou(gtBoxes[g], predBoxes[p]);
      if (v >= threshold) pairs.push({ g, p, v });
    }
  }
  pairs.sort((a, b) => b.v - a.v);
  const usedG = new Set();
  const usedP = new Set();
  let matched = 0;
  for (const { g, p } of pairs) {
    if (usedG.has(g) || usedP.has(p)) continue;
    usedG.add(g);
    usedP.add(p);
    matched++;
  }
  return { matched, gt: gtBoxes.length, pred: predBoxes.length };
}

/**
 * The competition's point rule. Greedy nearest-pair assignment, one-to-one,
 * scoring each matched pair by how far inside the tolerance it landed.
 *
 * ⚑ The denominator is max(#GT, #pred), so emitting SPURIOUS extra points is
 * penalised exactly as hard as missing real ones. That matters for lines --
 * see `resampleAtGtX` in score.mjs for why a dense tracer is resampled before
 * it reaches this function, and why that is a fairness correction rather than
 * a thumb on the scale.
 */
export function pointScore(gtPoints, predPoints, tolerance) {
  const pairs = [];
  for (let g = 0; g < gtPoints.length; g++) {
    for (let p = 0; p < predPoints.length; p++) {
      const dx = gtPoints[g].x - predPoints[p].x;
      const dy = gtPoints[g].y - predPoints[p].y;
      const d = Math.hypot(dx, dy);
      if (d < tolerance) pairs.push({ g, p, d });
    }
  }
  pairs.sort((a, b) => a.d - b.d);
  const usedG = new Set();
  const usedP = new Set();
  let sum = 0;
  let within = 0;
  for (const { g, p, d } of pairs) {
    if (usedG.has(g) || usedP.has(p)) continue;
    usedG.add(g);
    usedP.add(p);
    sum += Math.max(0, 1 - d / tolerance);
    within++;
  }
  const denom = Math.max(gtPoints.length, predPoints.length);
  return {
    score: denom > 0 ? sum / denom : 0,
    within,
    gt: gtPoints.length,
    pred: predPoints.length,
  };
}
