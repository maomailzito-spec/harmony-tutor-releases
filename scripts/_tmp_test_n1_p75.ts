import * as fs from 'fs';
import * as path from 'path';
import { calculateNoteBeats } from '../src/utils/musicTheory';
import { detectChromaticModulations } from '../src/utils/chromaticModulationDetector';

const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../tests/Dubois n1 p75.htp'), 'utf8'));
const ts = data.timeSignature || { numerator: 4, denominator: 4 };
const tsc = data.timeSignatureChanges || [];
const notes = (calculateNoteBeats(data.notes || [], ts, tsc) as any[]).filter((n: any) => !n.isRest);

console.log('key:', data.keySignatureRoot, 'minor:', data.isMinorMode);
console.log('notes:', notes.length);

const results = detectChromaticModulations(notes as any, 'F', false, ts, tsc, []);
console.log('Chromatic results:', results.length);
for (const r of results) {
  console.log(`  m${r.startMeasure+1}-m${r.endMeasure+1}: ${r.newTonicName}${r.newIsMinor ? 'm' : ''} (fit=${r.fitPercent}%, home=${r.homeFitPercent}%)`);
}
