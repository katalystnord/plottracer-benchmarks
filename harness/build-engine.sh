#!/usr/bin/env bash
# Compile a PlotTracer checkout's pure modules (core/, algorithms/, engine/) to
# plain ES modules the scorer can import.
#
# ⚑ Why compile rather than run the TypeScript directly: the sources import each
# other with .js specifiers (the ESM-TypeScript convention), which Node's type
# stripping does not rewrite. Emitting real .js files makes every specifier
# resolve for free, with no bundler and no extra dependency -- the checkout's own
# tsconfig already lists exactly these three directories.
#
# Usage: build-engine.sh <plottracer-checkout> <out-dir>
set -euo pipefail

SRC="${1:?usage: build-engine.sh <plottracer-checkout> <out-dir>}"
OUT="${2:?usage: build-engine.sh <plottracer-checkout> <out-dir>}"
OUT="$(mkdir -p "$OUT" && cd "$OUT" && pwd)"

cd "$SRC"
npx tsc -p tsconfig.json --outDir "$OUT" --declaration false --sourceMap false

# The checkout is CommonJS by default; the emitted files are ES modules.
echo '{"type":"module"}' > "$OUT/package.json"

echo "compiled $SRC -> $OUT"
