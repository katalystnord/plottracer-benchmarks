"""
A super-resolution arm of the benchmark (David, 2026-11-07: "run a synthetic benchmark as if we were to implement a
super-resolution capability, how would that affect the benchmarks?").

Each arm is the corpus's figures transformed, with a copy of its annotation in which every PIXEL coordinate is scaled
by the same factor (text and legend boxes, the plot box, tick points, bars, line and scatter points), and no data value
(task 6's `data series`, an axis's tick values) is touched. The existing scorers then run on the arm unchanged; their
tolerances are fractions of the image, so they scale with it.

Arms:
  orig            the figures as they are (the same detector and scorers, for a like-for-like base)
  bicubic2        every figure enlarged x2 by bicubic interpolation: more pixels, no model (the control)
  esrgan2         x2 by Real-ESRGAN (realesr-animevideov3, made for flat drawn images)
  half            every figure halved (area-averaged): a figure that arrived small
  half-bicubic2   halved, then x2 by bicubic
  half-esrgan2    halved, then x2 by Real-ESRGAN

usage: python3 -I harness/sr-arm.py ARM IMAGES_DIR GT_DIR OUT_DIR [--limit N]
  writes OUT_DIR/images/<stem>.png and OUT_DIR/gt/<stem>.json
"""
import json, os, subprocess, sys, tempfile, shutil
from PIL import Image

ESRGAN = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'work', 'realesrgan')
PIXEL_KEYS = {'x', 'y', 'x0', 'y0', 'x1', 'y1', 'x2', 'y2', 'x3', 'y3', 'width', 'height'}


def scaled(node, s, key=None):
    """Every pixel coordinate scaled by s; a `data series` (values, not pixels) left as it is."""
    if isinstance(node, dict):
        return {k: (v if k == 'data series' else scaled(v, s, k)) for k, v in node.items()}
    if isinstance(node, list):
        return [scaled(v, s, key) for v in node]
    if key in PIXEL_KEYS and isinstance(node, (int, float)) and not isinstance(node, bool):
        return node * s
    return node


def esrgan(src_dir, out_dir):
    subprocess.run([os.path.join(ESRGAN, 'realesrgan-ncnn-vulkan'), '-i', src_dir, '-o', out_dir, '-s', '2',
                    '-n', 'realesr-animevideov3', '-m', os.path.join(ESRGAN, 'models'), '-f', 'png'],
                   check=True, capture_output=True)


def main():
    arm, images, gtdir, out = sys.argv[1:5]
    limit = int(sys.argv[sys.argv.index('--limit') + 1]) if '--limit' in sys.argv else 0
    factor = {'orig': 1, 'bicubic2': 2, 'esrgan2': 2, 'half': 0.5, 'half-bicubic2': 1, 'half-esrgan2': 1}[arm]
    os.makedirs(os.path.join(out, 'images'), exist_ok=True)
    os.makedirs(os.path.join(out, 'gt'), exist_ok=True)
    stems = sorted(os.path.splitext(f)[0] for f in os.listdir(gtdir) if f.endswith('.json'))
    if limit:
        stems = stems[:limit]
    found = {}
    for f in os.listdir(images):
        st, ext = os.path.splitext(f)
        if ext.lower() in ('.png', '.jpg', '.jpeg'):
            found[st] = os.path.join(images, f)
    stems = [s for s in stems if s in found]
    with tempfile.TemporaryDirectory() as td:
        stage = os.path.join(td, 'in')
        os.makedirs(stage)
        for st in stems:
            im = Image.open(found[st]).convert('RGB')
            if arm.startswith('half'):
                im = im.resize((max(1, round(im.width / 2)), max(1, round(im.height / 2))), Image.BOX)
            if arm.endswith('bicubic2'):
                im = im.resize((im.width * 2, im.height * 2), Image.BICUBIC)
            im.save(os.path.join(stage if arm.endswith('esrgan2') else os.path.join(out, 'images'), st + '.png'))
        if arm.endswith('esrgan2'):
            esrgan(stage, os.path.join(out, 'images'))
    for st in stems:
        g = json.load(open(os.path.join(gtdir, st + '.json')))
        # the real factor, from the image as written (rounding when halved)
        im = Image.open(os.path.join(out, 'images', st + '.png'))
        w0 = Image.open(found[st]).width
        json.dump(scaled(g, im.width / w0), open(os.path.join(out, 'gt', st + '.json'), 'w'))
    print(f'{arm}: {len(stems)} figures, x{factor} -> {out}')


if __name__ == '__main__':
    main()
