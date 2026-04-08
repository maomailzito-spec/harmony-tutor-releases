#!/bin/bash
FILE="src/components/GrandStaffEditor.tsx"

echo "=== LINE 2787 ==="
sed -n '2787p' "$FILE"

echo ""
echo "=== LINE 4532 ==="
sed -n '4532p' "$FILE"

echo ""
echo "=== LINES 4533-4537 ==="
sed -n '4533,4537p' "$FILE"

echo ""
echo "=== LINE 5963 ==="
sed -n '5963p' "$FILE"

echo ""
echo "=== LINES 5964-5967 ==="
sed -n '5964,5967p' "$FILE"

echo ""
echo "=== FUNCTION SEARCHES IN BLOCK 2787-5963 ==="
for fn in getActiveNotesTimeline detectVoiceLeadingSequences identifyChordCandidates calculateRomanFromChordInfo getRomanAnalysis computeFiguredBassFromNotes FIGURED_BASS_UI_OPTIONS getRomanAnalysisDebugSnapshot normalizeNotePitchFieldsWithKey; do
  count=$(sed -n '2787,5963p' "$FILE" | grep -c "$fn")
  echo "$fn: $count occurrences"
done

echo ""
echo "=== CONSTANTS FROM constants.ts USED IN BLOCK ==="
for c in NOTE_NAMES DURATION_VALUES ALL_NOTE_SPELLINGS CHORD_FORMULAS TICKS_PER_QUARTER DEFAULT_PX_PER_TICK; do
  count=$(sed -n '2787,5963p' "$FILE" | grep -c "$c")
  echo "$c: $count occurrences"
done

echo ""
echo "=== LAYOUT CONSTANTS USED IN BLOCK ==="
for c in START_X MEASURE_PADDING_X TOP_STAFF_TOP VF_SATB_SOPRANO_Y STAFF_MARGIN; do
  count=$(sed -n '2787,5963p' "$FILE" | grep -c "$c")
  echo "$c: $count occurrences"
done

echo ""
echo "=== MUSIC THEORY FUNCTIONS USED IN BLOCK ==="
for fn in applyHarmonyRules getKeySignature calculateNoteBeats getRomanAnalysis getRomanAnalysisDebugSnapshot computeFiguredBassFromNotes FIGURED_BASS_UI_OPTIONS getNotePropertiesFromDiatonicPosition getNotePropertiesFromMidi getChordSymbol calculateAccidental getActiveNotesTimeline identifyChordCandidates calculateRomanFromChordInfo ticksToBeats beatsToTicks rebuildMeasureTimelineForVoice normalizeNotePitchFieldsWithKey; do
  count=$(sed -n '2787,5963p' "$FILE" | grep -c "$fn")
  if [ "$count" -gt 0 ]; then
    echo "  $fn: $count"
  fi
done

echo ""
echo "=== useMemo DECLARATIONS IN BLOCK ==="
sed -n '2787,5963p' "$FILE" | grep -n 'const .* = useMemo' | head -30

echo ""
echo "=== BLOCK LINE COUNT ==="
sed -n '2787,5963p' "$FILE" | wc -l
