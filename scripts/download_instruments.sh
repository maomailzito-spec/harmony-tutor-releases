#!/usr/bin/env bash
# Download FluidR3_GM instrument samples from gleitz CDN
# into public/sounds/<instrument>/ — same structure as the existing piano folder.
set -euo pipefail

BASE_URL="https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM"
DEST_DIR="$(cd "$(dirname "$0")/.." && pwd)/public/sounds"

INSTRUMENTS=(
  church_organ
  harpsichord
  string_ensemble_1
  choir_aahs
  flute
  oboe
  clarinet
  trumpet
  french_horn
  violin
  cello
)

# Same note set that already exists in public/sounds/piano/
NOTES=(
  A0 Bb0 B0
  C1 Db1 D1 Eb1 E1 F1 Gb1 G1 Ab1 A1 Bb1 B1
  C2 Db2 D2 Eb2 E2 F2 Gb2 G2 Ab2 A2 Bb2 B2
  C3 Db3 D3 Eb3 E3 F3 Gb3 G3 Ab3 A3 Bb3 B3
  C4 Db4 D4 Eb4 E4 F4 Gb4 G4 Ab4 A4 Bb4 B4
  C5 Db5 D5 Eb5 E5 F5 Gb5 G5 Ab5 A5 Bb5 B5
  C6 Db6 D6 Eb6 E6 F6 Gb6 G6 Ab6 A6 Bb6 B6
  C7 Db7 D7 Eb7 E7 F7 Gb7 G7 Ab7 A7 Bb7 B7
  C8
)

total=${#INSTRUMENTS[@]}
idx=0

for instr in "${INSTRUMENTS[@]}"; do
  idx=$((idx + 1))
  dir="$DEST_DIR/$instr"
  mkdir -p "$dir"
  echo "[$idx/$total] Downloading $instr ..."
  for note in "${NOTES[@]}"; do
    outfile="$dir/${note}.mp3"
    if [[ -f "$outfile" ]]; then
      continue   # already downloaded
    fi
    url="$BASE_URL/${instr}-mp3/${note}.mp3"
    # curl silently, skip 404s (some instruments don't cover the full range)
    curl -fsSL "$url" -o "$outfile" 2>/dev/null || true
  done
  count=$(ls "$dir"/*.mp3 2>/dev/null | wc -l | tr -d ' ')
  echo "  → $count files in $dir"
done

echo "Done! All instruments downloaded."
