#!/usr/bin/env python3
"""Decode corpus images to raw RGBA planes.

Node has no JPEG decoder in the standard library, and the whole point of this
harness is that it calls PlotTracer's REAL extraction code rather than a
reimplementation of it -- so the decode step happens here, in Pillow, and the
scorer reads a trivial binary format it cannot get wrong:

    <u32 LE width><u32 LE height><width*height*4 bytes RGBA>

That is byte-identical to what a browser canvas hands PlotTracer via
getImageData(), which is what the app itself feeds these algorithms.

Usage:
    decode.py <image-dir> <out-dir> [--ext .jpg]
"""

import struct
import sys
from pathlib import Path

from PIL import Image


def decode_one(src: Path, dst: Path) -> tuple[int, int]:
    with Image.open(src) as im:
        rgba = im.convert("RGBA")
        w, h = rgba.size
        dst.write_bytes(struct.pack("<II", w, h) + rgba.tobytes())
    return w, h


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    src_dir, out_dir = Path(sys.argv[1]), Path(sys.argv[2])
    out_dir.mkdir(parents=True, exist_ok=True)

    images = sorted(p for p in src_dir.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png"})
    for i, src in enumerate(images, 1):
        dst = out_dir / (src.stem + ".rgba")
        if dst.exists():
            continue
        try:
            decode_one(src, dst)
        except Exception as exc:  # a corrupt image is a corpus fact, not a crash
            print(f"SKIP {src.name}: {exc}", file=sys.stderr)
        if i % 50 == 0:
            print(f"  decoded {i}/{len(images)}", file=sys.stderr)
    print(f"decoded {len(images)} images -> {out_dir}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
