import * as fs from 'fs';
import * as path from 'path';
import { detectVoiceLeadingSequences } from '../src/utils/sequenceDetector';
import { calculateNoteBeats } from '../src/utils/musicTheory';

const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../tests/Dubois n2 p74.htp'), 'utf8'));
const ts = data.timeSignature || { upper: 3, lower: 4 };
const tsc = data.timeSignatureChanges || [];
const notes = calculateNoteBeats(data.notes || [], ts, tsc);

const relativeMinors: Record<string, string> = {
  'C': 'A', 'G': 'E', 'D': 'B', 'A': 'F#', 'E': 'C#', 'B': 'G#',
  'F': 'D', 'Bb': 'G', 'Eb': 'C', 'Ab': 'F', 'Db': 'Bb', 'Gb': 'Eb',
};
const currentTonic = data.isMinorMode ? (relativeMinors[data.keySignatureRoot] || 'A') : data.keySignatureRoot;
const isMinor = !!data.isMinorMode;
console.log('tonic:', currentTonic, 'minor:', isMinor);

const matches = detectVoiceLeadingSequences(notes as any, ts, tsc, undefined, undefined, {
  keySignatureRoot: currentTonic,
  isMinorMode: isMinor,
});

console.log(`Found ${matches.length} sequence(s)`);
for (const m of matches) {
  console.log(`\n--- Sequence ---`);
  console.log(`  measures: m${m.startMeasure + 1}–m${m.endMeasure + 1}`);
  console.log(`  model: m${m.modelStartMeasure + 1}–m${m.modelEndMeasure + 1}`);
  console.log(`  repeat: m${m.repeatStartMeasure + 1}–m${m.repeatEndMeasure + 1}`);
  console.log(`  repeatsCount: ${m.repeatsCount}`);
  console.log(`  transposition: ${m.transpositionSemitones} semitones`);
  console.log(`  isModulating: ${m.isModulating}`);
  console.log(`  modulationTonics: ${JSON.stringify(m.modulationTonics)}`);
  console.log(`  lengthSteps: ${m.lengthSteps}`);
}
