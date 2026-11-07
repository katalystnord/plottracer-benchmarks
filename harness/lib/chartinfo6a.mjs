/**
 * The CHART-Infographics Task 6a score for bars, reimplemented (David, 2026-11-07: "reimplement it please, including
 * sanity check"), so PlotTracer's bar read can be set beside published results.
 *
 * Source read, not run: chartinfo/chartinfo.github.io, metrics/metric6a.py (`compare_bar`, `create_dist_mat`,
 * `get_score`, `pad_mat`), and the task page (chartinfo.github.io/tasks_2022.html): "The score is max(0, 1 - (D/T))
 * ... T ... 5% of the smallest image dimension ... we will find the minimum cost pairing ... For Bar chart bars, we
 * will use the distances between corresponding BB corners ... summed and divided by max(#GT, #Predictions)".
 *
 * Two versions:
 *   intended   what the task page describes, with the script's distance: a pair's cost is min(1, D / T), D the
 *              city-block distance between [y0, x0, y1, x1] of the two boxes (as `compare_bar`), T = 5% of the
 *              figure's own smaller side; the pairing is the minimum-cost one over the matrix padded square with cost
 *              1 (a miss or an extra costs 1); the score is 1 - total cost / max(#GT, #pred).
 *   published  the script's own arithmetic, kept to say what it gives: `create_dist_mat` passes 1 - cost/beta, a
 *              SIMILARITY, to `get_score`, which minimises it as a cost (so the pairing picks the worst pairs); T from
 *              a fixed 1280x960 (`img_dim` default) whatever the figure's size; beta = 1 (the command line's default).
 *              The sanity check below shows what that does to the truth scored against itself.
 */

/** Minimum-cost assignment on a square matrix (Hungarian algorithm, potentials; O(n^3)). Returns col for each row. */
export function assign(cost) {
  const n = cost.length;
  const INF = Infinity;
  const u = new Float64Array(n + 1), v = new Float64Array(n + 1);
  const p = new Int32Array(n + 1), way = new Int32Array(n + 1);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(n + 1).fill(INF);
    const used = new Uint8Array(n + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = INF, j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const rowToCol = new Array(n);
  for (let j = 1; j <= n; j++) if (p[j]) rowToCol[p[j] - 1] = j - 1;
  return rowToCol;
}

/** `get_score`: pad square with 1, minimum-cost assignment, 1 - cost / k. */
function getScore(mat, rows, cols) {
  const k = Math.max(rows, cols);
  if (k === 0) return 1;
  const sq = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i < rows && j < cols ? mat[i][j] : 1)));
  const a = assign(sq);
  let c = 0;
  for (let i = 0; i < k; i++) c += sq[i][a[i]];
  return 1 - c / k;
}

/** A bar as `bar_arr_to_np`: [y0, x0, y1, x1]. Boxes are {x0, y0, width, height} (the corpus's form). */
const corners = (b) => [b.y0, b.x0, b.y0 + b.height, b.x0 + b.width];
const cityblock = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) + Math.abs(a[3] - b[3]);

/**
 * The Task 6a bar score of one figure.
 * @param pred predicted bars, {x0, y0, width, height}
 * @param gt   true bars, the same form
 * @param size the figure's {width, height}
 * @param version 'intended' | 'published'
 */
export function barScore6a(pred, gt, size, version = 'intended') {
  const minDim = version === 'published' ? Math.min(1280, 960) : Math.min(size.width, size.height);
  const T = 0.05 * minDim;
  const cost = gt.map((g) => pred.map((p) => Math.min(1, cityblock(corners(g), corners(p)) / T)));
  if (version === 'published') {
    const beta = 1;
    const sim = cost.map((r) => r.map((c) => 1 - c / beta));
    return getScore(sim, gt.length, pred.length);
  }
  return getScore(cost, gt.length, pred.length);
}
