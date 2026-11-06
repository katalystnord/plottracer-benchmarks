#!/usr/bin/env bash
# End-to-end reproduction of the published table. See README.md.
set -euo pipefail
PT="${PLOTTRACER_SRC:-$HOME/code/plottracer}"
cd "$(dirname "$0")/.."
mkdir -p work out

harness/build-engine.sh "$PT" work/engine-js

# ⚑ The harness's own cases run first. It has produced five numbers that looked
# like measurements and were not, so "the scorer compiled" is not the bar.
node --test harness/__tests__/assisted.test.mjs

# ⚑⚑ BOTH PMC SPLITS, POOLED. The published table is 384 bar figures over splits
# 4 AND 5, and this script used to decode and score split_4 alone -- so the one
# command the README points at ("Reproduce with harness/run.sh") produced
# DIFFERENT NUMBERS from the table it claimed to reproduce. Anyone checking our
# work would have found a mismatch and had no way to tell whether the tool or
# the table was wrong. `report.mjs` already pools any number of result files, so
# the fix is to score each split and hand it both.
PMC=work/ICPR2022_CHARTINFO_UB_UNITEC_PMC_TEST_v2.1
PMC_OUT=()
MANUAL_OUT=()
OCR_OUT=()
LINES27_OUT=()
LINES27_NOSTYLE_OUT=()
if [ -d "$PMC" ]; then
  for split in split_4 split_5; do
    images="$PMC/chart_images/$split/images"
    gt="$PMC/final_full_GT/$split/annotations_JSON"
    if [ ! -d "$images" ] || [ ! -d "$gt" ]; then
      echo "!! $split missing ($images / $gt) -- the pooled numbers will NOT match the published table" >&2
      continue
    fi
    python3 harness/decode.py "$images" "work/rgba/pmc-test-${split}"
    # ⚑ v2.7: the detector's bar boxes, through the app's own detector path, as Colour trace receives them
    node harness/detect-bars.mjs --plottracer "$PT" --gt "$gt" --rgba "work/rgba/pmc-test-${split}" \
      --out "out/bars-detected-${split}.json"
    node harness/score.mjs --engine work/engine-js \
      --gt "$gt" --rgba "work/rgba/pmc-test-${split}" --bars-detected "out/bars-detected-${split}.json" \
      --type bar,line,scatter --out "out/pmc-${split}.json"
    # ⚑ THE OTHER HALF OF THE PRODUCT, and it is not optional. `score.mjs`
    # measures detection in IMAGE space; this drives the app's real
    # `CalibrationSession` through the whole four-step bar walk and asks whether
    # the NUMBER comes back right, in data space.
    node harness/score-manual.mjs --engine work/engine-js \
      --gt "$gt" --out "out/manual-${split}.json"
    # ⚑ READING THE TEXT is its own capability and its own number: what the app
    # recovers of a chart's NAMES rather than its values. Scored against the
    # corpus's own typed text and role labels, horizontal tick labels only -
    # which is 95.7% of these charts, measured.
    node harness/score-ocr.mjs \
      --gt "$gt" --rgba "work/rgba/pmc-test-${split}" \
      --plottracer "$PT" --out "out/ocr-${split}.json"
    # ⚑ Line charts as the app reads them since 2.7 (Find lines; Auto-extract
    # with the legend marked), and the same read with the line style unused.
    node harness/score-lines-v27.mjs --engine work/engine-js \
      --gt "$gt" --rgba "work/rgba/pmc-test-${split}" --out "out/lines-v27-${split}.json"
    NOSTYLE=1 node harness/score-lines-v27.mjs --engine work/engine-js \
      --gt "$gt" --rgba "work/rgba/pmc-test-${split}" --out "out/lines-v27-nostyle-${split}.json"
    LINES27_OUT+=("out/lines-v27-${split}.json")
    LINES27_NOSTYLE_OUT+=("out/lines-v27-nostyle-${split}.json")
    PMC_OUT+=("out/pmc-${split}.json")
    MANUAL_OUT+=("out/manual-${split}.json")
    OCR_OUT+=("out/ocr-${split}.json")
  done
fi

ADOBE=work/adobe/test_release/task6
if [ -d "$ADOBE" ]; then
  python3 harness/decode.py "$ADOBE/png" work/rgba/adobe-test
  node harness/detect-bars.mjs --plottracer "$PT" --gt "$ADOBE/gt_json" --rgba work/rgba/adobe-test \
    --out out/bars-detected-adobe.json
  node harness/score.mjs --engine work/engine-js \
    --gt "$ADOBE/gt_json" --rgba work/rgba/adobe-test --bars-detected out/bars-detected-adobe.json \
    --type bar,line,scatter --out out/adobe.json
fi

echo; echo "===== UB-UNITEC PMC (splits 4 + 5, pooled)"
[ ${#PMC_OUT[@]} -gt 0 ] && node harness/report.mjs "${PMC_OUT[@]}"
echo; echo "===== Adobe CHART-Synthetic"
[ -f out/adobe.json ] && node harness/report.mjs out/adobe.json

# ⚑ ONE canonical results file, because the website table is generated from it
# and a percentage retyped into HTML will eventually be retyped wrong.
if [ ${#PMC_OUT[@]} -eq 2 ]; then
  node harness/emit-results.mjs \
    --version "$(node -p "require('$PT/package.json').version")" \
    --date "$(date +%F)" \
    --pmc "${PMC_OUT[0]}" --pmc5 "${PMC_OUT[1]}" \
    --adobe out/adobe.json \
    --manual "$(IFS=,; echo "${MANUAL_OUT[*]}")" \
    --ocr "$(IFS=,; echo "${OCR_OUT[*]}")" \
    --lines27 "$(IFS=,; echo "${LINES27_OUT[*]}")" \
    --lines27nostyle "$(IFS=,; echo "${LINES27_NOSTYLE_OUT[*]}")" \
    --out results/latest.json
fi
