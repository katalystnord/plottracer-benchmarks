# PlotTracer benchmarks

Measuring how much of a published chart a digitiser can recover **on its own**,
against two public, third-party chart-recognition corpora - and an open
invitation to every other digitiser to run the same test and publish the same
table.

Nothing here is our own ground truth. That is the point: a test that invents its
own figures proves self-consistency, not accuracy.

---

## The two corpora

Both come from the **CHART-Infographics** competition series (ICDAR 2019, ICPR
2020 / 2022), the field's standard benchmark for chart recognition. Its
data-extraction ground truth is, verbatim, *"a set of data series, and a data
series is a name and a list of (x, y) points"* - which is also PlotTracer's own
record shape, so scoring is arithmetic rather than a mapping exercise.

### 1. UB-UNITEC PMC - real charts from real papers

Figures taken from the open-access section of PubMed Central: JPEG-compressed,
inconsistently drawn, frequently greyscale. This is the corpus that matters.

> Kenny Davila, Fei Xu, Saleem Ahmed, David A. Mendoza, Srirangaraj Setlur and
> Venu Govindaraju. **"ICPR 2022: Challenge on Harvesting Raw Tables from
> Infographics (CHART-Infographics)."** *26th International Conference on
> Pattern Recognition (ICPR)*, 2022, pp. 4995-5001.
> doi:[10.1109/ICPR56361.2022.9956289](https://doi.org/10.1109/ICPR56361.2022.9956289)

Packages scored: `ICPR2022_CHARTINFO_UB_UNITEC_PMC_TEST_v2.1`, **split 4**
(Tasks 6a/6b, data extraction) and **split 5** (Task 7, end-to-end) - 887
annotated charts, and the two share no images.
Licence: **CC BY-NC-SA 4.0** (stated in `license.txt` inside the package).

### 2. Adobe CHART-Synthetic - generated charts

Synthetically generated with matplotlib from real data sources. Clean, exact,
and - as it turns out - systematically hatched, which is what makes it
interesting rather than merely easy.

> Kenny Davila, Bhargava Urala Kota, Srirangaraj Setlur, Venu Govindaraju,
> Christopher Tensmeyer, Sumit Shekhar and Ritwick Chaudhry. **"ICDAR 2019
> Competition on Harvesting Raw Tables from Infographics
> (CHART-Infographics)."** *International Conference on Document Analysis and
> Recognition (ICDAR)*, 2019, pp. 1594-1599.
> doi:[10.1109/ICDAR.2019.00203](https://doi.org/10.1109/ICDAR.2019.00203)

Package scored: `test_release/task6` from
<https://github.com/adobe-research/CHART-Synthetic> (release v1.0), 839
annotated charts. Licence: **CC BY-NC-ND 4.0**.

### ⚠️ Neither corpus is redistributable

Both are non-commercial, and one forbids derivatives outright. **This repository
contains no corpus data and never will** - `data/` is git-ignored. Download the
packages yourself from the sources above. Measured numbers are facts about a
program's behaviour and are not encumbered by either licence; the images and
annotations are, so they stay where they were downloaded.

---

## What is measured, and what is not

### The protocol: the competition's own

Both corpora are the ICPR CHART-Info data, and the competition says what task 6
(data extraction) is given: the answers to tasks 1 to 5. Every task-6 record
carries them in its own `task6.input` block: the chart type (task 1), every text
block and its role (tasks 2 and 3), the plot box and the axes with their tick
positions and values (task 4), and the legend pairs (task 5). These results are
measured under that protocol, as any other tool's task-6 result is:

1. **The plot box** - `task4.output._plot_bb`.
2. **The axes** - for a bar chart, the category axis and the baseline the bars
   stand on, both from the task-4 axes: the category ticks, and the pixel where
   the value axis reaches zero (or, where it never does, the axis line the bars
   stand on). PlotTracer asks for exactly these in its bar calibration walk, and
   its Automatic axis detection finds them on the figure itself.
3. **The colour(s)** - each element's colour, as a person picks it in any
   digitiser: sampled from the image at an element, then deduplicated to visually
   distinct colours. The detector still has to find every element of that colour
   by itself, across the whole plot box, and is scored on all of them.

A bar figure whose task-4 axes give no category ticks (40 of PMC's 384) is read
with the plot box and colours alone.

### MANUAL - the other half of the product, in data space

A person calibrating and capturing by hand. This drives the application's own
`CalibrationSession` through the calls the UI makes - the full four-step bar walk
(two value ticks, then the two ends of the category axis and the count), then two
corners per bar - and compares the **read value** with the corpus's own numbers,
at 1% of the value range.

### Common to both

**Everything after the inputs is PlotTracer's own shipped code** - `runBarDetect`,
`runBlobDetect`, `runColorTrace`, `CalibrationSession` - imported from a compiled
checkout, at the app's own defaults (tolerance 60, minimum blob diameter 3). The
harness reimplements no extraction logic; if the two ever disagree, the harness is
wrong by construction.

Bars, lines and scatter score in **image space** (Task 6a). That isolates the
extraction algorithm from calibration, which MANUAL then measures on its own.

---

## Results

PlotTracer **2.7.0**, measured 2026-11-07. Reproduce with `harness/run.sh`, which
scores split 4 and split 5 separately and pools them, runs both paths, and
regenerates `results/latest.json`.

### UB-UNITEC PMC - real published figures

| type | figures | result | colour | greyscale |
|---|---|---|---|---|
| **bar** | 384 (6,494 bars) | **79.5%** recall | 75.0% | 86.9% |
| **line** | 312 (29,688 pts) | **69.3%** found | 76.1% | 39.0% |
| **scatter** | 103 (5,409 pts) | **93.6%** found | 92.6% | 95.3% |

**⚑ How far each number holds on data it has not seen.** The two splits share
no images. Scored separately, bars give **81.9%** (3,234 bars) and **77.1%**
(3,260 bars), 4.8 points apart; lines 72.5% and 66.3% (6.2 apart); scatter 91.0%
and 95.7% (4.7 apart). That spread is the honest width of these estimates. (At
2.3 the bar splits were a tenth of a point apart; the bar reader has changed
since, and the two splits now differ by more.)

Without the task-4 axes, reading the plot box and colours alone, the same bar
figures give 79.5%: the axes change nothing here. Since 2.7 the bars are found by
PlotTracer's own chart-element detector (its `bar` class; harness/detect-bars.mjs
runs it through the app's own path), which sees each drawn bar as one shape
whatever its fill; the colour a person picks says which series a bar belongs to.

**On the competition's own scale.** Recall counts the true bars found and ignores
extra boxes. The competition's Task 6a score and the F-measure at IoU 0.5 count
every extra box against the read, and Task 6a also how close each corner lands
(harness/lib/chartinfo6a.mjs, reimplemented from the published script and task
page; the corpus's own answers score 1.0 against themselves on every figure):

| bars | recall | precision | F at IoU 0.5 | Task 6a |
|---|---|---|---|---|
| PMC, PlotTracer 2.7 | 79.5% | 95.2% | **86.6** | **78.9** |
| Adobe, PlotTracer 2.7 | 79.6% | 92.4% | **85.5** | **70.5** |

Before the detector decided what is a bar, the colour read placed 85% of the bars
but only 1 box in 5 (PMC) to 1 in 9 (Adobe) was one: F 30.7 and 20.4. For
reference, the ChartDete paper (Yan et al. 2023, arXiv 2305.04151, Table 4)
reports, for models trained for bars alone on the PMC test set, F 89.3 and a
Task 6a score of 93.75 (ChartDete) and F 86.9 (Cascade R-CNN + FPN). Their test
set version and their Task 6a implementation are not ours to check, so the Task
6a numbers are the less comparable of the two.

### ⚑⚑ What the baseline was worth, measured for the first time

The zero-crossing join - putting back together a bar that the figure's own zero
rule painted through and severed - had been demonstrated once by hand on one
figure (17 detected pieces down to 12 bars) and never given a rate. Now it has
one, and the finding is about the CORPUS:

| | |
|---|---|
| PMC bar figures with a recoverable baseline | 348 (5,817 bars) |
| figures holding a bar that crosses the baseline at all | **6** |
| such bars | **75** (1.3%) |
| bars the join actually reassembled | **3** |

▶ **These corpora barely contain the case.** A benchmark that never shows a
technique its own subject cannot say whether the technique works; it can only
say the technique did not change the total. That is a gap in the instrument, and
it is stated here rather than reported as a zero.

The swatch test, which is the baseline's other consumer, **reports and never
acts** - PlotTracer files every box it finds and marks the suspicious ones, so
it cannot move a recall number in either direction by construction. On these
runs it flagged 9,334 of the predicted boxes on PMC and 26,496 on Adobe, none
dropped.

(The table above was measured on 2.3, 2026-08-26. Since 2.5 a bar is never joined
across the zero rule: a bar stands on its origin, so the rule cannot cut it, and
only a Span chart's floating bars are joined. The run now reports 0 joins for
bars.)

### Manual capture - measured in DATA space

Auto-extract is only half the product. This drives the application's own
`CalibrationSession` through the calls the UI makes - calibrate from two tick
labels, mark the category axis and its count, then two corners per bar - and
compares the READ VALUE with the corpus's own numbers.

| | |
|---|---|
| figures scored | **344** (splits 4 + 5) |
| bars within 1% of the corpus value | **80.9%** (4,674 / 5,778) |
| figures where every bar is within 1% | **79.4%** (273 / 344) |
| excluded | 40 figures: 33 with no two numeric tick labels, 4 with no usable category ticks, 3 with no ground truth |

⚑ **The calibration is recovered from the ground truth, not invented**: joining
`task4.axes[].tick_pt` (pixel) to `task2.text_blocks` (text) via
`task3.text_roles` (which are `tick_label`) gives real (pixel, value) pairs off
the figure. That is what makes this a measurement rather than a check that the
app agrees with itself.

⚑ Corners are placed at the ground truth's own bar boxes, so this isolates the
capture model and the arithmetic from a human's aim. Tolerance is 1% of the
value range - tighter than the 5% image tolerance used above, because a placed
corner should land on the bar's own edge.

⚠️ **These numbers replace the 2026-08-01 pair (262 figures, 83.8%), and the
change is mostly a HARNESS repair rather than the app moving.** Two of the five
bugs listed below were suppressing 82 figures from this table and reading one
column that the record no longer always fills. The scored sample is now a third
larger and harder; on the 262 figures common to both runs, nothing got worse.


### Adobe CHART-Synthetic - generated figures

| type | figures | result |
|---|---|---|
| **line** | 200 (2,236 pts) | **92.0%** found |
| **bar** | 498 (6,739 bars) | **79.6%** recall |
| **scatter** | 110 (11,996 pts) | **60.8%** found (0.69× - under-detection) |

Separated bars 82.6%, touching 78.6%. Without the task-4 axes, from the plot box and
colours alone, 79.6%. Most of these bars are hatched; the detector sees each as one
shape (at 2.7.0, before it, 62.1% with the axes and 45.6% without).

### Where it fails, and why

The gaps are more useful than the headline, and each one has a diagnosed cause
rather than a shrug:

- **Greyscale costs 37 points on lines** (76.1 vs 39.0); on bars, since the
  detector, greyscale figures read better than colour ones (86.9 vs 75.0). Colour-keyed
  extraction has nothing to key on when everything is black. This is a scope
  boundary, not a bug.
- **Hatched fills broke bar detection - this was the whole Adobe bar story until
  the detector took it over in 2.7.**
  Scanning across one 967px-wide synthetic bar finds the fill colour running in
  ~28px stretches separated by 2-3px black hatch lines: **147 interruptions in a
  single bar.** Flood-fill connectivity sees 34 fragments, none of which
  overlaps the true bar by half, so a perfectly-drawn bar scores zero. Real
  published figures hatch far less often; measured at 2.3, that was the entire
  distance between 76.1% and 35.3%. With the detector deciding what is a bar the
  two corpora read 79.5% and 79.6%, at 95% and 92% precision. Line tracing is unaffected (92%) because it reads column runs,
  not connectivity.
- **Bars of identical colour that touch flood into one blob** and read as one
  oversized bar, where the detector misses them. Across 384 real bar figures:
  **87.8%** separated against **72.6%** touching, and on colour figures alone
  **87.6%** against **67.1%** - the largest cost left on bars, and ours to fix
  rather than inherent.
- **Dense scatter over-detects on real figures (2.94×) and under-detects on
  synthetic ones (0.69×)** - the same overlap problem from both ends. On PMC
  (measured at 2.3), ~30% of the strays are one marker splintering, ~20% are
  markers already claimed by a neighbour, and ~50% are other ink inside the plot
  box (grid lines, error bars, trend lines). On the denser synthetic scatter,
  overlapping markers merge; since 2.7 Colour trace takes merged markers apart
  (0.37× and 32.1% found at 2.6, 0.69× and 60.8% now), and the rest still merge.

---

## An open invitation

If you build a chart digitiser - WebPlotDigitizer, Engauge, PlotDigitizer,
DataThief, im2graph, ChartOCR, anything - **run this and publish your table.**

The corpora are public and citable. The metric is the competition's own, not
ours. The harness is here, it is short, and it calls whatever extraction code
you point it at. There is no reason a field this old should have no comparable
numbers in it.

Two requests, both self-serving in the same direction:

1. **Report per chart type, not one aggregate.** A single number is misleading
   in both directions - it hides a tool that is excellent at one thing, and it
   punishes a tool that honestly declines a case it cannot measure.
2. **State what the human supplied.** Every digitiser draws the human/program
   line somewhere. Ours is written above in full. A number without that line
   drawn is not comparable to anything.

If we have got something wrong - a metric that flatters us, a corpus subset that
suits us, a bug in the harness - open an issue. **Five** separate harness bugs
have been found and fixed while producing the tables above, each one inflating or
deflating a published-looking number. There will be a sixth.

The three found in 2026-08 while first building the table: union-per-GT-point on
scatter, per-series scoring on figures that record one point per series, and a
centre-pixel colour pick that sampled a 2px segment's black outline. The two
found on 2026-08-26 while adding the assisted path, both in the same join:

1. **The two corpora identify their text differently, and nothing said so.** PMC
   stamps every `text_blocks` entry with an `id`; Adobe's carry none and are
   identified by array POSITION. Joining on `id` alone returned `undefined` for
   every Adobe label, and the harness reported that as *"this corpus has no
   numeric tick labels"*. **A missing join reads exactly like an absent feature.**
2. **The axis key is not a direction.** PMC's `x-axis` is the horizontal one;
   Adobe's is the CATEGORY one, so on a horizontal bar chart its `x-axis` ticks
   run down the image. Worse, **49 of 192 PMC bar figures also file their value
   ticks under the other key** - so choosing the axis by NAME threw out 45
   figures as uncalibratable that were nothing of the kind. The axis is now read
   off the pixels, which is the same lesson this harness already recorded about
   `_x-tick-type` and had not swept.

⚑ And a third, in the same sitting, which is the one worth copying: `Number('')`
is **0**, and 0 is finite. A tick label that failed to join arrived as a
MEASUREMENT OF ZERO at that pixel - a fabricated zero, at exactly the value a
baseline is looked for at. It would calibrate, and nothing would look wrong.

---

## Running it

```bash
# 1. Download the corpora into data/ (see links above). Not redistributable.
# 2. Compile a PlotTracer checkout to plain JS:
harness/build-engine.sh ~/code/plottracer work/engine-js

# 3. Decode images to raw RGBA (Node has no JPEG decoder):
python3 harness/decode.py <images-dir> work/rgba/<name>

# 4. Score:
node harness/score.mjs --engine work/engine-js \
     --gt <annotations-dir> --rgba work/rgba/<name> \
     --type bar,line,scatter --out out/<name>.json

# 5. Manual capture, in data space (bars only):
node harness/score-manual.mjs --engine work/engine-js \
     --gt <annotations-dir> --out out/manual-<name>.json

# 6. Table - AUTO and ASSISTED, reported apart:
node harness/report.mjs out/<name>.json

# 7. The harness's own cases:
node --test harness/__tests__/assisted.test.mjs
```

Or `harness/run.sh`, which does all of it and regenerates `results/latest.json`.

Requires Node 20+, Python 3 with Pillow, and a PlotTracer checkout.

## Licence

Harness code: AGPL-3.0, matching PlotTracer itself.
Corpus data: not included, not redistributable - see above.
