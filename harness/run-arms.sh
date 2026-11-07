#!/usr/bin/env bash
# Every super-resolution arm, three at a time, each once built (harness/sr-arm.py, then harness/run-arm.sh).
set -uo pipefail
cd "$(dirname "$0")/.."
P=work/ICPR2022_CHARTINFO_UB_UNITEC_PMC_TEST_v2.1
for c in pmc4 adobe; do
  if [ "$c" = pmc4 ]; then IM=$P/chart_images/split_4/images; GT=$P/final_full_GT/split_4/annotations_JSON; else IM=work/adobe/test_release/task6/png; GT=work/adobe/test_release/task6/gt_json; fi
  [ -d "work/arms/$c-orig/gt" ] || python3 -I harness/sr-arm.py orig "$IM" "$GT" "work/arms/$c-orig"
done
until grep -q ARMS-BUILT out/arms-build.log 2>/dev/null; do sleep 30; done
ls -d work/arms/*/ | xargs -n1 basename | xargs -P 3 -I{} sh -c 'harness/run-arm.sh work/arms/{} {} > out/arm-{}.log 2>&1; echo "{} exit $?"'
echo ARMS-SCORED
