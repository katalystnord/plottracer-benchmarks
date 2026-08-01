#!/usr/bin/env bash
# End-to-end reproduction of the published table. See README.md.
set -euo pipefail
PT="${PLOTTRACER_SRC:-$HOME/code/plottracer}"
cd "$(dirname "$0")/.."
mkdir -p work out

harness/build-engine.sh "$PT" work/engine-js

PMC=work/ICPR2022_CHARTINFO_UB_UNITEC_PMC_TEST_v2.1
if [ -d "$PMC" ]; then
  python3 harness/decode.py "$PMC/chart_images/split_4/images" work/rgba/pmc-test-split4
  node harness/score.mjs --engine work/engine-js \
    --gt "$PMC/final_full_GT/split_4/annotations_JSON" \
    --rgba work/rgba/pmc-test-split4 --type bar,line,scatter --out out/pmc.json
fi

ADOBE=work/adobe/test_release/task6
if [ -d "$ADOBE" ]; then
  python3 harness/decode.py "$ADOBE/png" work/rgba/adobe-test
  node harness/score.mjs --engine work/engine-js \
    --gt "$ADOBE/gt_json" --rgba work/rgba/adobe-test \
    --type bar,line,scatter --out out/adobe.json
fi

echo; echo "===== UB-UNITEC PMC";        [ -f out/pmc.json ]   && node harness/report.mjs out/pmc.json
echo; echo "===== Adobe CHART-Synthetic"; [ -f out/adobe.json ] && node harness/report.mjs out/adobe.json
