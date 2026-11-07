#!/usr/bin/env bash
# One super-resolution arm through the scorers (harness/sr-arm.py makes it): bars with the detector's boxes, lines,
# scatter, the tick labels read, and the legend found. Each scorer is the published one, unchanged.
# usage: harness/run-arm.sh ARM_DIR TAG    (ARM_DIR holds images/ and gt/; PLOTTRACER_SRC the checkout)
set -euo pipefail
PT="${PLOTTRACER_SRC:-$HOME/code/plottracer}"
ARM="$1"; TAG="$2"
cd "$(dirname "$0")/.."
python3 harness/decode.py "$ARM/images" "work/rgba/arm-$TAG"
# the detector once, on the GPU (rfdetr_infer.py, the shipped model's training run at 768 px; twinned with the app's
# CPU path), for both the bars and the legend
FIGDET="${FIGDET:-$HOME/store/code/katalystnord/plottracer-ref/research/v2.7-figdet}"
"$HOME/.cache/figdet/rfdetr-rocm-venv/bin/python" -I "$FIGDET/rfdetr_infer.py" "$HOME/.cache/figdet/train-bar-768/checkpoint_best_total.pth" \
  "out/arm-$TAG-det" "$ARM"/images/*.png --thr 0.1 > "out/arm-$TAG-det.log" 2>&1
node -e '
const d = require(process.argv[1]), out = {};
for (const [k, v] of Object.entries(d)) out[k.replace(/\.[^.]+$/, "")] = v.dets.filter((x) => x.class === "bar").map((x) => ({ x0: x.bbox[0], y0: x.bbox[1], x1: x.bbox[2], y1: x.bbox[3], score: x.score }));
require("fs").writeFileSync(process.argv[2], JSON.stringify(out));' "$PWD/out/arm-$TAG-det/detections.json" "out/arm-$TAG-bars-detected.json"
node harness/score.mjs --engine work/engine-js --gt "$ARM/gt" --rgba "work/rgba/arm-$TAG" \
  --bars-detected "out/arm-$TAG-bars-detected.json" --type bar,line,scatter --out "out/arm-$TAG.json"
node harness/score-ocr.mjs --gt "$ARM/gt" --rgba "work/rgba/arm-$TAG" --plottracer "$PT" --out "out/arm-$TAG-ocr.json"
node harness/score-legend.mjs --plottracer "$PT" --engine work/engine-js --gt "$ARM/gt" --rgba "work/rgba/arm-$TAG" \
  --detections "out/arm-$TAG-det/detections.json" --out "out/arm-$TAG-legend.json"
echo "arm $TAG done"
