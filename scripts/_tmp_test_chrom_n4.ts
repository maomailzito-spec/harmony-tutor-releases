import * as fs from 'fs';
import * as path from 'path';
import { calculateNoteBeats } from '../src/utils/musicTheory';
import { detectChromaticModulations } from '../src/utils/chromaticModulationDetector';

const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../tests/Dubois n4 p73.htp'), 'utf8'));
const ts = data.timeSignature || { numerator: 3, denominator: 4 };
const tsc = data.timeSignatureChanges || [];
const notes = (calculateNoteBeats(data.notes || [], ts, tsc) as any[]).filter((n: any) => !n.isRest);

const results = detectChromaticModulations(notes as any, 'F', true, ts, tsc, []);
console.log('Results:', results.length);
for (const r of results) {
  console.log(`  m${r.startMeasure+1}–m${r.endMeasure+1}: ${r.newTonicName}${r.newIsMinor ? 'm' : ''} (fit=${r.fitPercent}%, home=${r.homeFitPercent}%)`);
}
