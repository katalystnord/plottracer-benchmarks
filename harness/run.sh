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
if [ -d "$PMC" ]; then
  for split in split_4 split_5; do
    images="$PMC/chart_images/$split/images"
    gt="$PMC/final_full_GT/$split/annotations_JSON"
    if [ ! -d "$images" ] || [ ! -d "$gt" ]; then
      echo "!! $split missing ($images / $gt) -- the pooled numbers will NOT match the published table" >&2
      continue
    fi
    python3 harness/decode.py "$images" "work/rgba/pmc-test-${split}"
    node harness/score.mjs --engine work/engine-js \
      --gt "$gt" --rgba "work/rgba/pmc-test-${split}" \
      --type bar,line,scatter --out "out/pmc-${split}.json"
    # ⚑ THE OTHER HALF OF THE PRODUCT, and it is not optional. `score.mjs`
    # measures detection in IMAGE space; this drives the app's real
    # `CalibrationSession` through the whole four-step bar walk and asks whether
    # the NUMBER comes back right, in data space.
    node harness/score-manual.mjs --engine work/engine-js \
      --gt "$gt" --out "out/manual-${split}.json"
    PMC_OUT+=("out/pmc-${split}.json")
    MANUAL_OUT+=("out/manual-${split}.json")
  done
fi

ADOBE=work/adobe/test_release/task6
if [ -d "$ADOBE" ]; then
  python3 harness/decode.py "$ADOBE/png" work/rgba/adobe-test
  node harness/score.mjs --engine work/engine-js \
    --gt "$ADOBE/gt_json" --rgba work/rgba/adobe-test \
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
    --out results/latest.json
fi
