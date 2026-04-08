/**
 * Test: modal interchange progression
 * Expected: I - IV - iv - I - V - ♭VI - ♭VII - V7 - I
 *
 * Usage: npx tsx scripts/_test_modal_interchange_progression.ts
 */
import { getRomanAnalysis } from '../src/utils/musicTheory';

// Progression in C major (4 voices, simple SATB voicing)
const chords = [
  { label: 'I',    tonic: 'C', notes: [
    { pitch: 'C', octave: 3, midi: 48 },
    { pitch: 'G', octave: 3, midi: 55 },
    { pitch: 'E', octave: 4, midi: 64 },
    { pitch: 'C', octave: 5, midi: 72 },
  ]},
  { label: 'IV',   tonic: 'C', notes: [
    { pitch: 'F', octave: 3, midi: 53 },
    { pitch: 'A', octave: 3, midi: 57 },
    { pitch: 'C', octave: 4, midi: 60 },
    { pitch: 'F', octave: 4, midi: 65 },
  ]},
  { label: 'iv',   tonic: 'C', notes: [
    { pitch: 'F', octave: 3, midi: 53 },
    { pitch: 'A', octave: 3, accidental: 'flat', explicitAccidental: 'flat', midi: 56 },
    { pitch: 'C', octave: 4, midi: 60 },
    { pitch: 'F', octave: 4, midi: 65 },
  ]},
  { label: 'I',    tonic: 'C', notes: [
    { pitch: 'C', octave: 3, midi: 48 },
    { pitch: 'G', octave: 3, midi: 55 },
    { pitch: 'E', octave: 4, midi: 64 },
    { pitch: 'C', octave: 5, midi: 72 },
  ]},
  { label: 'V',    tonic: 'C', notes: [
    { pitch: 'G', octave: 2, midi: 43 },
    { pitch: 'B', octave: 3, midi: 59 },
    { pitch: 'D', octave: 4, midi: 62 },
    { pitch: 'G', octave: 4, midi: 67 },
  ]},
  { label: '♭VI',  tonic: 'C', notes: [
    { pitch: 'A', octave: 2, accidental: 'flat', explicitAccidental: 'flat', midi: 44 },
    { pitch: 'C', octave: 3, midi: 48 },
    { pitch: 'E', octave: 3, accidental: 'flat', explicitAccidental: 'flat', midi: 51 },
    { pitch: 'A', octave: 3, accidental: 'flat', explicitAccidental: 'flat', midi: 56 },
  ]},
  { label: '♭VII', tonic: 'C', notes: [
    { pitch: 'B', octave: 2, accidental: 'flat', explicitAccidental: 'flat', midi: 46 },
    { pitch: 'D', octave: 3, midi: 50 },
    { pitch: 'F', octave: 3, midi: 53 },
    { pitch: 'B', octave: 3, accidental: 'flat', explicitAccidental: 'flat', midi: 58 },
  ]},
  { label: 'V7',   tonic: 'C', notes: [
    { pitch: 'G', octave: 2, midi: 43 },
    { pitch: 'B', octave: 3, midi: 59 },
    { pitch: 'D', octave: 4, midi: 62 },
    { pitch: 'F', octave: 4, midi: 65 },
  ]},
  { label: 'I',    tonic: 'C', notes: [
    { pitch: 'C', octave: 3, midi: 48 },
    { pitch: 'G', octave: 3, midi: 55 },
    { pitch: 'E', octave: 4, midi: 64 },
    { pitch: 'C', octave: 5, midi: 72 },
  ]},
];

console.log('\n── Modal interchange: I - IV - iv - I - V - ♭VI - ♭VII - V7 - I (C major) ──\n');

let allOk = true;
for (const ch of chords) {
  const r = getRomanAnalysis(ch.notes as any, 'C', false);
  const roman = r?.roman || '(none)';
  const ok = roman === ch.label || 
    // Accept equivalent labels
    (ch.label === '♭VI' && roman === '♭VI') ||
    (ch.label === '♭VII' && roman === '♭VII') ||
    (ch.label === 'V7' && (roman === 'V' || roman === 'V7'));
  const status = ok ? 'OK ' : 'FAIL';
  if (!ok) allOk = false;
  console.log(`  ${status}  expected=${ch.label.padEnd(4)}  got=${roman.padEnd(8)}  figures=${(r?.figures || []).join('/')}`);
}

console.log(allOk ? '\n  ✓ All correct\n' : '\n  ✗ Some mismatches\n');
