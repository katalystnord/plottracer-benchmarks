#!/usr/bin/env python3
"""Can a hatch signature stand in for colour? — the experiment that decides it.

Detection is settled: a hatch shows up as a 1D frequency peak, ~32px period,
with a clean separation from unhatched bars. The question that matters is
different and harder: **can two hatches be told APART**, so that the pattern
identifies a series the way colour does?

That matters because greyscale is our largest scope boundary — colour-keyed
extraction loses ~10 points on bars and ~37 on lines when a figure is
monochrome — and hatching is exactly the channel authors reach for when colour
is unavailable. Same slot in the design, different encoding.

THE TEST: on GREYSCALE bar figures, compute a (period, angle) signature per bar,
cluster them within each figure, and compare the number of clusters to the
number of series the ground truth says the figure has. If hatch is carrying
series identity, those should agree more often than chance.

⚑ ANGLE IS GATED ON PROMINENCE, and that is the correction from the first probe.
Taking the strongest 2D peak of every bar produced angles uniform over
0-180 degrees — because a solid or small bar has no peak, only noise, and noise
has an arbitrary direction. An angle is only meaningful where the peak is
genuinely dominant, so bars below the threshold are dropped rather than clustered.

Usage: hatch-cluster.py <gt-dir> <rgba-dir> [prominence-threshold]
"""

import json
import struct
import sys
from pathlib import Path

import numpy as np

PROMINENCE_MIN = float(sys.argv[3]) if len(sys.argv) > 3 else 8.0


def read_rgba(path: Path):
    b = path.read_bytes()
    w, h = struct.unpack("<II", b[:8])
    return np.frombuffer(b, dtype=np.uint8, offset=8, count=w * h * 4).reshape(h, w, 4)


def luma(p):
    return (0.299 * p[:, :, 0] + 0.587 * p[:, :, 1] + 0.114 * p[:, :, 2]).astype(np.float64)


def signature(gray):
    """(prominence, period_px, angle_deg) of the dominant periodic component."""
    h, w = gray.shape
    if h < 12 or w < 12:
        return None
    g = gray - gray.mean()
    if g.std() < 1e-6:
        return None
    g = g / g.std()
    spec = np.abs(np.fft.fftshift(np.fft.fft2(g * np.hanning(h)[:, None] * np.hanning(w)[None, :])))

    cy, cx = h // 2, w // 2
    yy, xx = np.mgrid[0:h, 0:w]
    fy, fx = (yy - cy) / h, (xx - cx) / w
    r = np.hypot(fy, fx)
    # Above the bar's own shape, below the anti-aliasing floor.
    band = (r > 3.0 / min(h, w)) & (r < 0.25)
    if band.sum() < 20:
        return None
    mags = spec[band]
    med = np.median(mags)
    if med <= 0:
        return None
    i = int(np.argmax(mags))
    prom = float(mags[i] / med)
    ry, rx = float(fy[band][i]), float(fx[band][i])
    rad = np.hypot(ry, rx)
    if rad <= 0:
        return None
    # Angle mod 180: a grating and its 180-degree rotation are the same grating.
    return prom, float(1.0 / rad), float(np.degrees(np.arctan2(ry, rx)) % 180.0)


def cluster(sigs, period_tol=0.25, angle_tol=15.0):
    """Greedy grouping by (period within 25%, angle within 15 degrees)."""
    groups = []
    for _, per, ang in sigs:
        placed = False
        for g in groups:
            gp, ga = g["period"], g["angle"]
            d_ang = min(abs(ang - ga), 180 - abs(ang - ga))
            if abs(per - gp) / max(gp, 1e-9) <= period_tol and d_ang <= angle_tol:
                g["members"].append((per, ang))
                g["period"] = float(np.mean([m[0] for m in g["members"]]))
                g["angle"] = float(np.mean([m[1] for m in g["members"]]))
                placed = True
                break
        if not placed:
            groups.append({"period": per, "angle": ang, "members": [(per, ang)]})
    return groups


def main() -> int:
    gt_dir, rgba_dir = Path(sys.argv[1]), Path(sys.argv[2])
    agree = 0
    total = 0
    rows = []
    mono_figs = 0

    for f in sorted(gt_dir.glob("*.json")):
        gt = json.loads(f.read_text())
        if not (gt.get("task1", {}).get("output", {}).get("chart_type") or "").lower().endswith("bar"):
            continue
        bars = gt.get("task6", {}).get("output", {}).get("visual elements", {}).get("bars") or []
        series = gt.get("task6", {}).get("output", {}).get("data series") or []
        if len(bars) < 2 or not series:
            continue
        p = rgba_dir / (f.stem + ".rgba")
        if not p.exists():
            continue
        img = read_rgba(p)

        # Greyscale by the same strict rule the recall harness uses: EVERY bar's
        # centre pixel near-neutral. One coloured bar disqualifies the figure,
        # so this set is conservative.
        centres = []
        for b in bars:
            y = min(img.shape[0] - 1, max(0, b["y0"] + b["height"] // 2))
            x = min(img.shape[1] - 1, max(0, b["x0"] + b["width"] // 2))
            centres.append(img[y, x, :3].astype(int))
        if not centres or not all((c.max() - c.min()) < 30 for c in centres):
            continue
        mono_figs += 1

        sigs = []
        for b in bars:
            y0, y1 = b["y0"] + 2, b["y0"] + b["height"] - 2
            x0, x1 = b["x0"] + 2, b["x0"] + b["width"] - 2
            if y1 - y0 < 12 or x1 - x0 < 12:
                continue
            s = signature(luma(img[y0:y1, x0:x1]))
            if s and s[0] >= PROMINENCE_MIN:
                sigs.append(s)

        if len(sigs) < 2:
            continue
        groups = cluster(sigs)
        n_series = len(series)
        total += 1
        if len(groups) == n_series:
            agree += 1
        rows.append((f.stem, n_series, len(groups), len(sigs), len(bars)))

    print(f"greyscale bar figures                : {mono_figs}")
    print(f"  with >=2 bars carrying a strong hatch (prominence >= {PROMINENCE_MIN:g}) : {total}")
    if not total:
        print("\n  Nothing to cluster. Greyscale bars in this corpus are mostly SOLID,")
        print("  not hatched — which would answer the question in the negative.")
        return 0
    print(f"  clusters == series count           : {agree}/{total}  ({100 * agree / total:.0f}%)")
    diffs = [abs(r[1] - r[2]) for r in rows]
    print(f"  median |clusters - series|         : {np.median(diffs):.1f}")
    print("\n  figure                     series  clusters  hatched/total bars")
    for name, ns, ng, nh, nb in rows[:15]:
        print(f"  {name[:26]:28s} {ns:5d} {ng:9d}  {nh:4d}/{nb}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
