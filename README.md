# PlotTracer benchmarks

Measuring how much of a published chart a digitiser can recover **on its own**,
against two public, third-party chart-recognition corpora — and an open
invitation to every other digitiser to run the same test and publish the same
table.

Nothing here is our own ground truth. That is the point: a test that invents its
own figures proves self-consistency, not accuracy.

---

## The two corpora

Both come from the **CHART-Infographics** competition series (ICDAR 2019, ICPR
2020 / 2022), the field's standard benchmark for chart recognition. Its
data-extraction ground truth is, verbatim, *"a set of data series, and a data
series is a name and a list of (x, y) points"* — which is also PlotTracer's own
record shape, so scoring is arithmetic rather than a mapping exercise.

### 1. UB-UNITEC PMC — real charts from real papers

Figures taken from the open-access section of PubMed Central: JPEG-compressed,
inconsistently drawn, frequently greyscale. This is the corpus that matters.

> Kenny Davila, Fei Xu, Saleem Ahmed, David A. Mendoza, Srirangaraj Setlur and
> Venu Govindaraju. **"ICPR 2022: Challenge on Harvesting Raw Tables from
> Infographics (CHART-Infographics)."** *26th International Conference on
> Pattern Recognition (ICPR)*, 2022, pp. 4995–5001.
> doi:[10.1109/ICPR56361.2022.9956289](https://doi.org/10.1109/ICPR56361.2022.9956289)

Packages scored: `ICPR2022_CHARTINFO_UB_UNITEC_PMC_TEST_v2.1`, **split 4**
(Tasks 6a/6b, data extraction) and **split 5** (Task 7, end-to-end) — 887
annotated charts, and the two share no images.
Licence: **CC BY-NC-SA 4.0** (stated in `license.txt` inside the package).

### 2. Adobe CHART-Synthetic — generated charts

Synthetically generated with matplotlib from real data sources. Clean, exact,
and — as it turns out — systematically hatched, which is what makes it
interesting rather than merely easy.

> Kenny Davila, Bhargava Urala Kota, Srirangaraj Setlur, Venu Govindaraju,
> Christopher Tensmeyer, Sumit Shekhar and Ritwick Chaudhry. **"ICDAR 2019
> Competition on Harvesting Raw Tables from Infographics
> (CHART-Infographics)."** *International Conference on Document Analysis and
> Recognition (ICDAR)*, 2019, pp. 1594–1599.
> doi:[10.1109/ICDAR.2019.00203](https://doi.org/10.1109/ICDAR.2019.00203)

Package scored: `test_release/task6` from
<https://github.com/adobe-research/CHART-Synthetic> (release v1.0), 839
annotated charts. Licence: **CC BY-NC-ND 4.0**.

### ⚠️ Neither corpus is redistributable

Both are non-commercial, and one forbids derivatives outright. **This repository
contains no corpus data and never will** — `data/` is git-ignored. Download the
packages yourself from the sources above. Measured numbers are facts about a
program's behaviour and are not encumbered by either licence; the images and
annotations are, so they stay where they were downloaded.

---

## What is measured, and what is not

PlotTracer is human-in-the-loop. These corpora benchmark **fully automatic**
recognition. Pretending those are the same thing would make any number
meaningless, so the protocol states exactly where the human stops and the
program starts.

**The harness supplies the two things a person supplies, and nothing else:**

1. **The plot box** — taken from each corpus's own `task4.output._plot_bb`.
   This is what a user has after clicking the axes to calibrate.
2. **The colour(s)** — sampled *from the image* at ground-truth element
   positions, then deduplicated to visually distinct colours. This models "the
   user clicks each colour they can see". It hands the program a place to
   sample, never an answer: the detector still has to find every element of that
   colour by itself, across the whole plot box, and is scored on all of them.

**Everything after that is PlotTracer's own shipped code** — `runBarDetect`,
`runBlobDetect`, `runColorTrace` — imported from a compiled checkout, at the
app's own defaults (tolerance 60, minimum blob diameter 3). The harness
reimplements no extraction logic; if the two ever disagree, the harness is wrong
by construction.

Scoring is in **image space** (Task 6a), not data space. That isolates the
extraction algorithm from calibration, which a human does by hand and which is
exact arithmetic once done.

### Metrics

| chart type | rule | why |
|---|---|---|
| bar | greedy one-to-one match at **IoU ≥ 0.5**, reported as recall | a bar is an *area*, so overlap is the question |
| line, scatter | the competition's own Task 6a rule: `Σ max(0, 1 − D/T) / max(#GT, #pred)`, with **T = 5% of the smaller image dimension** | a marker is a *position*, so distance is |

Two numbers are reported for point types, because they answer different
questions and only quoting one would flatter or libel the tool depending on
which:

- **found** — what fraction of real ground-truth points were recovered within
  tolerance. *Did we get the data?*
- **pred/gt** — predictions emitted per real point. Above 1.0 is
  over-detection (strays the user must delete); below 1.0 is under-detection
  (data lost). The competition's own score folds this in by dividing by
  `max(#GT, #pred)`.

Line traces are resampled at the ground truth's own x positions before scoring.
PlotTracer emits roughly one point per pixel column, against ground truth
digitised at ~20 vertices; without resampling the metric would measure sampling
density rather than accuracy. A vertex the trace never covered stays unmatched
and still counts against us.

---

## Results

PlotTracer **2.0.0-rc1**, measured 2026-08-01. Reproduce with `harness/run.sh`.

### UB-UNITEC PMC — real published figures

| type | figures | result | colour | greyscale |
|---|---|---|---|---|
| **bar** | 384 (6,494 bars) | **76.1%** recall | 79.6% | 70.1% |
| **line** | 312 (29,688 pts) | **69.3%** found | 76.1% | 39.0% |
| **scatter** | 103 (5,409 pts) | **91.3%** found | 90.4% | 93.0% |

**⚑ The bar number reproduces on data it has never seen.** The two splits share
no images, and scored separately they give **76.1%** (3,234 bars) and **76.0%**
(3,260 bars) — a tenth of a point apart. Line and scatter move by about six
points between them, which is the honest width of those estimates. A number that
survives a disjoint sample is a measurement; one that does not is a property of
the sample.

### Adobe CHART-Synthetic — generated figures

| type | figures | result |
|---|---|---|
| **line** | 200 (2,236 pts) | **92.0%** found |
| **bar** | 498 (6,739 bars) | **35.3%** recall |
| **scatter** | 110 (11,996 pts) | **32.1%** found (0.37× — under-detection) |

### Where it fails, and why

The gaps are more useful than the headline, and each one has a diagnosed cause
rather than a shrug:

- **Greyscale costs about 10 points on bars and 37 on lines** (79.6 vs 70.1;
  76.1 vs 39.0). Colour-keyed
  extraction has nothing to key on when everything is black. This is a scope
  boundary, not a bug.
- **Hatched fills break bar detection — this is the whole Adobe bar story.**
  Scanning across one 967px-wide synthetic bar finds the fill colour running in
  ~28px stretches separated by 2–3px black hatch lines: **147 interruptions in a
  single bar.** Flood-fill connectivity sees 34 fragments, none of which
  overlaps the true bar by half, so a perfectly-drawn bar scores zero. Real
  published figures hatch far less often, which is the entire distance between
  76.1% and 35.3%. Line tracing is unaffected (92%) because it reads column
  runs, not connectivity.
- **Bars of identical colour that touch flood into one blob** and read as one
  oversized bar. Across 384 real bar figures: **82.2%** separated against
  **71.1%** touching, and on colour figures alone **89.2%** against **73.6%** —
  a bigger cost than greyscale, and the one on this list that is ours to fix
  rather than inherent.
- **Dense scatter over-detects on real figures (2.87×) and under-detects on
  synthetic ones (0.37×)** — the same overlap problem from both ends. On PMC,
  ~30% of the strays are one marker splintering, ~20% are markers already
  claimed by a neighbour, and ~50% are other ink inside the plot box (grid
  lines, error bars, trend lines). On the denser synthetic scatter, overlapping
  markers merge instead of splitting.

---

## An open invitation

If you build a chart digitiser — WebPlotDigitizer, Engauge, PlotDigitizer,
DataThief, im2graph, ChartOCR, anything — **run this and publish your table.**

The corpora are public and citable. The metric is the competition's own, not
ours. The harness is here, it is short, and it calls whatever extraction code
you point it at. There is no reason a field this old should have no comparable
numbers in it.

Two requests, both self-serving in the same direction:

1. **Report per chart type, not one aggregate.** A single number is misleading
   in both directions — it hides a tool that is excellent at one thing, and it
   punishes a tool that honestly declines a case it cannot measure.
2. **State what the human supplied.** Every digitiser draws the human/program
   line somewhere. Ours is written above in full. A number without that line
   drawn is not comparable to anything.

If we have got something wrong — a metric that flatters us, a corpus subset that
suits us, a bug in the harness — open an issue. Three separate harness bugs were
found and fixed while producing the table above, each one inflating or deflating
a published-looking number; there may be a fourth.

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

# 5. Table:
node harness/report.mjs out/<name>.json
```

Requires Node 20+, Python 3 with Pillow, and a PlotTracer checkout.

## Licence

Harness code: AGPL-3.0, matching PlotTracer itself.
Corpus data: not included, not redistributable — see above.
