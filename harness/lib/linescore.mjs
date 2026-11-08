/**
 * The line score LineFormer reports (Lal et al. 2023, arXiv 2305.01837, Table 1: UB-PMC22 6a 93.1, 6b 88.25),
 * reimplemented so PlotTracer's line reads can be set beside it (David, 2026-11-07: "should we not score that first
 * of all?").
 *
 * Source read, not run: TheJaeLal/LineFormer, metric6a.py (`get_cont_recall`, `compare_continuous`, `compare_line_6a`,
 * `compare_line_6b`, `pad_mat`) and eval.py (`metric_6a_indv` / `metric_6b_indv` over each line figure's
 * `task6.output['visual elements'].lines`, in pixels). Ported as it runs, including what it does that its names do
 * not say: `compare_line_*` calls `compare_continuous(gt, pred)` where the function's parameters are (pred, gt), so
 * the tolerance epsilon is taken from the PREDICTED line's y range; and the error of a point is relative to its y
 * value in pixels. The pair score is the F-measure of the two interpolated recalls, so it is symmetric otherwise.
 *
 *   6a  lines paired one to one for the highest total, divided by the number of true lines (extra lines cost nothing)
 *   6b  the same over the matrix padded square with zeros, divided by max(#true, #predicted): an extra line costs
 */
import { assign } from './chartinfo6a.mjs';

/** `get_cont_recall`: the share of the second line's x range on which the first, interpolated, is close to it. */
function contRecall(px, py, gx, gy, eps) {
  let total = 0, span = 0;
  for (let i = 0; i < gx.length; i++) {
    const x = gx[i];
    const interval = gx.length === 1 ? 1 : i === 0 ? (gx[i + 1] - x) / 2 : i === gx.length - 1 ? (x - gx[i - 1]) / 2 : (gx[i + 1] - gx[i - 1]) / 2;
    const yi = interp(x, px, py);
    const err = Math.min(1, Math.abs((gy[i] - yi) / (Math.abs(gy[i]) + eps)));
    total += (1 - err) * interval;
    span += interval;
  }
  return span > 0 ? total / span : 0;
}

/** numpy.interp: linear between the points (xs ascending), the end values beyond them. */
function interp(x, xs, ys) {
  const n = xs.length;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
  const t = xs[hi] === xs[lo] ? 0 : (x - xs[lo]) / (xs[hi] - xs[lo]);
  return ys[lo] + t * (ys[hi] - ys[lo]);
}

/** `compare_continuous(pred_ds, gt_ds)`, with its own parameter names. */
export function compareContinuous(predDs, gtDs) {
  const p = [...predDs].sort((a, b) => a.x - b.x), g = [...gtDs].sort((a, b) => a.x - b.x);
  if (!p.length && !g.length) return 1;
  if (!p.length || !g.length) return 0;
  const px = p.map((q) => q.x), py = p.map((q) => q.y), gx = g.map((q) => q.x), gy = g.map((q) => q.y);
  const eps = (Math.max(...gy) - Math.min(...gy)) / 100;
  const recall = contRecall(px, py, gx, gy, eps);
  const precision = contRecall(gx, gy, px, py, eps);
  return precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
}

/**
 * One figure's line score.
 * @param pred predicted lines, each [{x, y}] in image pixels
 * @param gt   true lines (`visual elements`.lines), the same form
 * @param version '6a' | '6b'
 */
export function lineScore(pred, gt, version = '6a') {
  if (!gt.length) return pred.length ? 0 : 1;
  // as LineFormer calls it: compare_continuous(gt line, predicted line)
  const S = gt.map((g) => pred.map((p) => compareContinuous(g, p)));
  if (version === '6a') {
    if (!pred.length) return 0;
    const k = Math.max(gt.length, pred.length);
    // the highest-total pairing, rectangular (scipy pairs min(#gt, #pred) of them)
    const cost = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i < gt.length && j < pred.length ? -S[i][j] : 0)));
    const a = assign(cost);
    let sum = 0;
    for (let i = 0; i < gt.length; i++) if (a[i] < pred.length) sum += S[i][a[i]];
    return sum / gt.length;
  }
  const k = Math.max(gt.length, pred.length);
  const cost = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i < gt.length && j < pred.length ? -S[i][j] : 0)));
  const a = assign(cost);
  let sum = 0;
  for (let i = 0; i < gt.length; i++) if (a[i] < pred.length) sum += S[i][a[i]];
  return sum / k;
}
