/**
 * Smoke test: verifies Because (E minor) tonicizations are spelled with sharps.
 * Before this fix, chromaticModulationDetector returned "Dbm" for a
 * tonicization to pc=1 because of `isMinorMode → preferFlats` heuristic.
 * After: it returns "C#m" (sharp side, matching the home key signature).
 */
import { detectChromaticModulations } from '../src/utils/chromaticModulationDetector';
import fs from 'node:fs';

function fmtModulation(r: any): string {
  return `m${r.startMeasure + 1}-${r.endMeasure + 1}: ${r.newTonicName}${r.newIsMinor ? 'm' : ''} (fit ${r.fitPercent}%)`;
}

const path = './tests/Because.htp';
if (!fs.existsSync(path)) {
  console.error(`Skip: ${path} missing`);
  process.exit(0);
}

const fx = JSON.parse(fs.readFileSync(path, 'utf8'));
const results = detectChromaticModulations(
  fx.notes,
  fx.keySignatureRoot,
  fx.isMinorMode,
  fx.timeSignature,
  fx.timeSignatureChanges || [],
  fx.analysisContexts || [],
);

console.log(`Because (key=${fx.keySignatureRoot} ${fx.isMinorMode ? 'min' : 'maj'}) — detected modulations:`);
for (const r of results) {
  console.log('  ' + fmtModulation(r));
}

// Spelling-aware assertion: in E minor (sharp-side), any tonicization to a
// sharp pitch class (1, 6, 8, 3, 10) MUST use sharp-side spelling
// (C#, F#, G#, D#, A#), NOT flat (Db, Gb, Ab, Eb, Bb).
const SHARP_EXPECTED: Record<number, string> = {
  1: 'C#', 6: 'F#', 8: 'G#', 3: 'D#', 10: 'A#',
};
let failures = 0;
for (const r of results) {
  const exp = SHARP_EXPECTED[r.newTonicPc];
  if (exp && r.newTonicName !== exp) {
    console.error(`  FAIL: pc=${r.newTonicPc} got '${r.newTonicName}', expected '${exp}' (sharp-side for E minor)`);
    failures++;
  }
}
if (failures === 0) console.log('✓ All tonicizations use sharp-side spelling');
else { console.error(`✗ ${failures} spelling regression(s)`); process.exit(1); }
