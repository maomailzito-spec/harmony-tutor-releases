import fs from 'node:fs';
import {
  identifyChordCandidates,
  calculateRomanFromChordInfo,
  getRomanAnalysis,
} from './src/utils/musicTheory';

// Load the file
const data = JSON.parse(fs.readFileSync('tests/Delamont C60 1g.htp', 'utf8'));
const notes = data.notes as any[];

// Show ALL notes in measures 1-2
console.log('=== All notes in m0 and m1 ===');
for (const n of notes) {
  if (n.measureIndex > 1 || n.isRest) continue;
  const acc = n.accidental === 'sharp' ? '#' : n.accidental === 'flat' ? 'b' : n.accidental === 'natural' ? '(nat)' : '';
  console.log(`  m${n.measureIndex} b${n.beat} ${n.pitch}${acc}${n.octave} midi=${n.midi} voice=${n.voice} dur=${n.duration} noteIndex=${n.noteIndex}`);
}

// Find notes at measure 1 (0-indexed), beat 2
const targetMeasure = 1;
const targetBeat = 2;
console.log(`\nLooking at m${targetMeasure} b${targetBeat}:`);

const beatNotes = notes.filter((n: any) => 
  n.measureIndex === targetMeasure && n.beat === targetBeat && !n.isRest
);
console.log('Notes at beat:', beatNotes.map((n: any) =>
  `${n.pitch}${n.accidental === 'sharp' ? '#' : n.accidental === 'flat' ? 'b' : ''}${n.octave} midi=${n.midi} acc=${n.accidental} explicit=${n.explicitAccidental} noteIndex=${n.noteIndex}`
));

// Get candidates
const candidates = identifyChordCandidates(beatNotes);
console.log(`\n${candidates.length} candidates:`);
for (const c of candidates.slice(0, 8)) {
  const rootP = (c.root as any).pitch;
  const rootAcc = (c.root as any).accidental;
  const rootStr = `${rootP}${rootAcc === 'sharp' ? '#' : rootAcc === 'flat' ? 'b' : ''}`;
  console.log(`  root=${rootStr} type=${c.type} score=${c.score} matchType=${c.matchType} intervals=[${[...c.intervals]}]`);
}

// Get roman analysis
const keyTonic = 'B'; // B minor
const ra = getRomanAnalysis(beatNotes, keyTonic, true);
console.log(`\nRoman analysis: ${ra?.roman} figures=[${ra?.figures}]`);

// Check what roman the top candidates would give
for (const c of candidates.slice(0, 3)) {
  const roman = calculateRomanFromChordInfo(
    { root: c.root, type: c.type, intervals: c.intervals },
    keyTonic, true
  );
  const rootP = (c.root as any).pitch;
  const rootAcc = (c.root as any).accidental;
  console.log(`  candidate root=${rootP}${rootAcc === 'sharp' ? '#' : rootAcc === 'flat' ? 'b' : ''} type=${c.type} → roman=${roman}`);
}
