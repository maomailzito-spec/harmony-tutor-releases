/**
 * Quick test: C→D→A over C chord, does D get isEscape?
 * soprano: C5(q) D5(eighth) A4(q)
 * alto: E4(dotted half)
 * tenor: G3(dotted half)  
 * bass: C3(dotted half)
 */
import { applyHarmonyRules, getKeySignature } from '../src/utils/musicTheory';

const ts = { numerator: 4, denominator: 4 };
const ks = getKeySignature('C', 'Major');
const notes: any[] = [
    // Beat 1: I chord
    { id: 's1', pitch: 'C', octave: 5, midi: 72, noteIndex: 0, voice: 1, beat: 1, measureIndex: 0, duration: 'quarter', startTick: 0, durationTicks: 480, clef: 'treble', accidental: '', isRest: false },
    { id: 'a1', pitch: 'E', octave: 4, midi: 64, noteIndex: 4, voice: 2, beat: 1, measureIndex: 0, duration: 'half', startTick: 0, durationTicks: 1440, clef: 'treble', accidental: '', isRest: false, isDotted: true },
    { id: 't1', pitch: 'G', octave: 3, midi: 55, noteIndex: 7, voice: 3, beat: 1, measureIndex: 0, duration: 'half', startTick: 0, durationTicks: 1440, clef: 'bass', accidental: '', isRest: false, isDotted: true },
    { id: 'b1', pitch: 'C', octave: 3, midi: 48, noteIndex: 0, voice: 4, beat: 1, measureIndex: 0, duration: 'half', startTick: 0, durationTicks: 1440, clef: 'bass', accidental: '', isRest: false, isDotted: true },
    // Beat 2: D5 (escape candidate)
    { id: 's2', pitch: 'D', octave: 5, midi: 74, noteIndex: 2, voice: 1, beat: 2, measureIndex: 0, duration: 'eighth', startTick: 480, durationTicks: 240, clef: 'treble', accidental: '', isRest: false },
    // Beat 2.5: A4 (leap down - resolution)
    { id: 's3', pitch: 'A', octave: 4, midi: 69, noteIndex: 9, voice: 1, beat: 2.5, measureIndex: 0, duration: 'quarter', startTick: 720, durationTicks: 480, clef: 'treble', accidental: '', isRest: false },
];

const result = applyHarmonyRules(notes as any, ks, 'C', false, [], ts, [], []);
const analyzed = (result as any).analyzedNotes || result;
const d = (analyzed as any[]).find((n: any) => n.id === 's2');
console.log('D note after analysis:');
console.log(`  isEscape=${(d as any)?.isEscape}`);
console.log(`  isPassing=${(d as any)?.isPassing}`);
console.log(`  isNeighbor=${(d as any)?.isNeighbor}`);
console.log(`  isAppoggiatura=${(d as any)?.isAppoggiatura}`);
console.log(`  isAnticipation=${(d as any)?.isAnticipation}`);
console.log(`  ornamentMark=${(d as any)?.ornamentMark}`);
console.log(`  learnedOrnament=${(d as any)?.learnedOrnament}`);
// Check all notes
for (const n of (analyzed as any[])) {
    const a = n as any;
    const marks = [a.isPassing && 'P', a.isNeighbor && 'N', a.isAppoggiatura && 'App', a.isEscape && 'Esc', a.isAnticipation && 'Ant', a.isSuspension && 'Sus'].filter(Boolean).join(',');
    console.log(`  ${a.pitch}${a.accidental||''}${a.octave} v${a.voice} b${a.beat} ${marks || 'structural'} ${a.ornamentMark || ''}`);
}
