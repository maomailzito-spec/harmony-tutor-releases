/**
 * Debug: why is the harmony label missing at measure 8 beat 4 in Corale 1D Bach?
 * The chord is D3-D4-F#4-A4 = D major = V/V in C major.
 */
import proj from './Corale 1D Bach.json';
import { applyHarmonyRules, getKeySignature, getRomanAnalysis } from '../src/utils/musicTheory';

const notes = (proj as any).notes || [];
const ts = (proj as any).timeSignature || { numerator: 4, denominator: 4 };
const tonic = String((proj as any).keySignatureRoot || 'C');
const isMinor = Boolean((proj as any).isMinorMode);
const contexts = (proj as any).analysisContexts || [];
const doubleBarlines = (proj as any).doubleBarlineMeasures || [];
const ornamentOverrides = (proj as any).ornamentOverrides || [];

const keySig = getKeySignature(tonic, isMinor ? 'Minor' : 'Major');
const result = applyHarmonyRules(notes as any, keySig as any, tonic, isMinor, contexts, ts as any, doubleBarlines, ornamentOverrides);
const analyzed = (result as any).analyzedNotes || notes;
const inferred = (result as any).inferredAnalysisContexts || [];

console.log('Tonic:', tonic, '| Minor:', isMinor, '| TS:', JSON.stringify(ts));
console.log('Inferred contexts:', inferred.length ? inferred.map((c: any) => `absBeat=${c.absBeat}→${c.newTonic}`).join(', ') : 'NONE');

// === Check m8 b4 (measureIndex=7, beat=4) ===
console.log('\n=== Analyzed notes at m8 b4 (measureIndex=7, beat=4) ===');
const targetNotes = analyzed.filter((n: any) =>
    n && !n.isRest && n.measureIndex === 7 && Math.abs(Number(n.beat) - 4) < 0.05
);
for (const n of targetNotes) {
    const acc = n.explicitAccidental || n.accidental || '';
    console.log(`  ${n.pitch}${acc}${n.octave} v${n.voice} midi=${n.midi}`);
    console.log(`    roman: ${JSON.stringify((n as any).roman)}`);
    console.log(`    chordLabel: ${JSON.stringify((n as any).chordLabel)}`);
    console.log(`    harmonyLabel: ${JSON.stringify((n as any).harmonyLabel)}`);
    console.log(`    tonicAtBeat: ${JSON.stringify((n as any).tonicAtBeat)}`);
    console.log(`    analysisKey: ${JSON.stringify((n as any).analysisKey)}`);
    console.log(`    isNCT: pass=${!!n.isPassing} neigh=${!!n.isNeighbor} app=${!!n.isAppoggiatura} susp=${!!n.isSuspension} ant=${!!n.isAnticipation}`);
    console.log(`    ornamentMark: ${JSON.stringify((n as any).ornamentMark)}`);
}

// === Check surrounding beats ===
console.log('\n=== m8 all beats ===');
for (const b of [1, 2, 3, 4]) {
    const beatNotes = analyzed.filter((n: any) =>
        n && !n.isRest && n.measureIndex === 7 && Math.abs(Number(n.beat) - b) < 0.05
    );
    const structural = beatNotes.filter((n: any) => !n.isPassing && !n.isNeighbor && !n.isAppoggiatura && !n.isSuspension && !n.isAnticipation);
    const labels = structural.map((n: any) => (n as any).chordLabel || (n as any).roman || '?');
    const pitches = structural.map((n: any) => `${n.pitch}${n.explicitAccidental === 'sharp' ? '#' : n.explicitAccidental === 'flat' ? 'b' : ''}${n.octave}`);
    console.log(`  b${b}: ${pitches.join(' ')} → labels: ${JSON.stringify([...new Set(labels)])}`);
}

// === Direct getRomanAnalysis for the chord ===
console.log('\n=== Direct getRomanAnalysis for D-F#-A ===');
const structural = targetNotes.filter((n: any) => !n.isPassing && !n.isNeighbor && !n.isAppoggiatura && !n.isSuspension);
console.log('Structural notes:', structural.map((n: any) => `${n.pitch}${n.explicitAccidental || ''}${n.octave} v${n.voice}`).join(', '));
if (structural.length > 0) {
    const romanResult = getRomanAnalysis(structural as any, tonic, isMinor);
    console.log('Roman result in C major:', JSON.stringify(romanResult));
    // Also try in G major to see V detection
    const romanG = getRomanAnalysis(structural as any, 'G', false);
    console.log('Roman result in G major:', JSON.stringify(romanG));
} else {
    console.log('NO structural notes at m8 b4!');
}

// === Check m9 b1 to see if it's G (V) — i.e. the V/V→V resolution ===
console.log('\n=== m9 b1 check ===');
const m9b1 = analyzed.filter((n: any) =>
    n && !n.isRest && n.measureIndex === 8 && Math.abs(Number(n.beat) - 1) < 0.05
);
for (const n of m9b1) {
    const acc = n.explicitAccidental || n.accidental || '';
    console.log(`  ${n.pitch}${acc}${n.octave} v${n.voice}: roman=${JSON.stringify((n as any).roman)} chordLabel=${JSON.stringify((n as any).chordLabel)}`);
}
