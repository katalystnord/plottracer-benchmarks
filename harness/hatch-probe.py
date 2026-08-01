#!/usr/bin/env python3
"""Is a hatch pattern detectable as a frequency peak? — an experiment, not a feature.

David's hypothesis: a hatch fill is a directional repeating pattern, so it is a
wave, so a Fourier/wavelet method should see it where flood-fill connectivity
cannot.

THE TEST, and it needs a control or it proves nothing: take the ground truth's
own bar boxes, cut the patch inside each one, and ask the 2D FFT how strong the
strongest periodic component is. Run it over BOTH corpora. Adobe's bars are
hatched; PMC's mostly are not. If the hypothesis holds, the two distributions
separate — and if they do not, the idea is dead cheaply.

Measured per bar:
  prominence  peak magnitude / median magnitude in the annulus. How much the
              pattern stands out from everything else in the patch.
  period      pixels per repeat, from the peak's radius.
  angle       degrees, from the peak's position. The hatch direction.

⚑ Deliberately plain FFT rather than a Gabor bank. Gabor buys LOCALISATION —
knowing where in the image a texture sits — and here the ground truth already
says where each bar is. The question at this stage is only whether the signal
exists at all; localisation is the next problem, not this one.

Usage: hatch-probe.py <gt-dir> <rgba-dir> <label> [limit]
"""

import json
import struct
import sys
from pathlib import Path

import numpy as np


def read_rgba(path: Path):
    b = path.read_bytes()
    w, h = struct.unpack("<II", b[:8])
    a = np.frombuffer(b, dtype=np.uint8, offset=8, count=w * h * 4)
    return a.reshape(h, w, 4)


def luma(patch):
    # Rec. 601 — a hatch is usually black ink on a light or mid fill, so
    # luminance is where the pattern lives regardless of the fill's hue.
    return (0.299 * patch[:, :, 0] + 0.587 * patch[:, :, 1] + 0.114 * patch[:, :, 2]).astype(np.float64)


def hatch_signature_1d(gray, horizontal):
    """Strongest periodic interruption ALONG the bar, as (prominence, period_px).

    ⚑ 1D, AND THAT IS THE CORRECTION THAT MADE THIS WORK. The first version took
    a 2D FFT of the patch and looked for the strongest off-origin peak. On the
    one bar measured by hand it was right, but in aggregate it was meaningless:
    most bars are solid or small, so their "peak" is noise at an arbitrary
    angle — which is exactly what the diagnostics said, an angle IQR of 88-90
    degrees over a 0-180 range, i.e. uniform.

    A hatch crossing a bar is a periodic signal ALONG THE BAR'S LENGTH. Collapse
    the short axis and the question becomes one-dimensional and far better
    conditioned: on the hand-checked bar the 1D peak stands 545x above the
    median where the 2D peak was buried in noise from the bar's own edges.
    """
    h, w = gray.shape
    if h < 8 or w < 24:
        return None

    # Average out the SHORT axis. A hatch runs across the bar, so averaging along
    # it strengthens the pattern while averaging away noise; the bar's own smooth
    # fill contributes a constant, which the mean-subtraction below removes.
    prof = gray.mean(axis=0) if horizontal else gray.mean(axis=1)
    if len(prof) < 24:
        return None
    prof = prof - prof.mean()
    if prof.std() < 1e-6:
        return None  # a perfectly flat fill: no pattern, and no divide by zero

    # Hann window: without it the profile's own ends ring across the spectrum.
    spec = np.abs(np.fft.rfft(prof * np.hanning(len(prof))))
    freqs = np.fft.rfftfreq(len(prof))

    # Skip the first few bins: those are the bar's overall shading, not a hatch.
    # Cap at 4px per repeat -- finer than that is anti-aliasing, not a pattern.
    lo_bin = 3
    hi_bin = np.searchsorted(freqs, 0.25)
    if hi_bin - lo_bin < 4:
        return None
    band = spec[lo_bin:hi_bin]
    med = np.median(spec[1:])
    if med <= 0:
        return None
    k = int(np.argmax(band)) + lo_bin
    period = 1.0 / freqs[k] if freqs[k] > 0 else float("inf")
    return float(spec[k] / med), float(period)


def main() -> int:
    gt_dir, rgba_dir, label = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
    limit = int(sys.argv[4]) if len(sys.argv) > 4 else 10**9

    rows = []
    figs = 0
    for f in sorted(gt_dir.glob("*.json")):
        if figs >= limit:
            break
        gt = json.loads(f.read_text())
        ctype = (gt.get("task1", {}).get("output", {}).get("chart_type") or "").lower()
        if not ctype.endswith("bar"):
            continue
        bars = gt.get("task6", {}).get("output", {}).get("visual elements", {}).get("bars") or []
        if not bars:
            continue
        rgba_path = rgba_dir / (f.stem + ".rgba")
        if not rgba_path.exists():
            continue
        img = read_rgba(rgba_path)
        figs += 1
        for b in bars:
            # Inset by 2px so the bar's own outline is not part of the patch.
            y0, y1 = b["y0"] + 2, b["y0"] + b["height"] - 2
            x0, x1 = b["x0"] + 2, b["x0"] + b["width"] - 2
            if y1 - y0 < 8 or x1 - x0 < 8:
                continue
            # A bar is "horizontal" for this purpose when it is wider than tall:
            # the hatch is then periodic along x.
            sig = hatch_signature_1d(luma(img[y0:y1, x0:x1]), (x1 - x0) >= (y1 - y0))
            if sig:
                rows.append(sig)

    if not rows:
        print(f"{label}: no scorable bars")
        return 1

    prom = np.array([r[0] for r in rows])
    per = np.array([r[1] for r in rows])

    print(f"=== {label}  ({figs} figures, {len(rows)} bars big enough to analyse)")
    for q in (50, 75, 90):
        print(f"  prominence p{q:<3d} {np.percentile(prom, q):8.2f}")
    for thr in (4, 6, 10):
        print(f"  bars with prominence > {thr:<3d} {100 * (prom > thr).mean():5.1f}%")
    strong = prom > 10
    if strong.any():
        print(f"  among prominence>10: median period {np.median(per[strong]):5.1f} px "
              f"(IQR {np.percentile(per[strong], 25):.1f}-{np.percentile(per[strong], 75):.1f})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
