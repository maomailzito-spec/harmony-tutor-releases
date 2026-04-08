/**
 * Debug R-06 at Cantata 17: bass A (m36 b3) → D# (m37 b1) → E? (m37 b3)
 * UI measure N = measureIndex N-1
 */
import proj from '../tests/Cantata 17 Bach.json';
import { applyHarmonyRules, getKeySignature } from '../src/utils/musicTheory';

const notes = (proj as any).notes || [];
const ts = (proj as any).timeSignature;
const tonic = String((proj as any).keySignatureRoot || 'C');
const isMinor = Boolean((proj as any).isMinorMode);
const contexts = (proj as any).analysisContexts || [];

const keySig = getKeySignature(tonic, isMinor ? 'Minor' : 'Major');
const res = applyHarmonyRules(notes as any, keySig as any, tonic, isMinor, contexts, ts as any);
const analyzed = (res as any).analyzedNotes || notes;
const violations = (res as any).violations || [];

// Show bass notes around UI m36-37 (measureIndex 35-36)
console.log('=== Bass (voice 4) notes around UI m35-38 ===');
for (let mi = 34; mi <= 37; mi++) {
    const bassNotes = analyzed.filter((n: any) =>
        n && !n.isRest && (n.voice ?? 1) === 4 && n.measureIndex === mi
    ).sort((a: any, b: any) => (a.beat ?? 1) - (b.beat ?? 1));
    for (const n of bassNotes) {
        const acc = n.explicitAccidental || n.accidental || '';
        const orn = n.isPassing ? 'P' : n.isNeighbor ? 'N' : n.isAppoggiatura ? 'App' : n.isSuspension ? 'Sus' : '';
        console.log(`  UI m${mi+1} b${n.beat}: ${n.pitch}${acc}${n.octave} midi=${n.midi} ni=${n.noteIndex}${orn ? ` [${orn}]` : ''}`);
    }
}

// Find R-06 violations
console.log('\n=== R-06 violations ===');
const r06 = violations.filter((v: any) => v.ruleId === 'R-06');
console.log(`Total R-06 violations: ${r06.length}`);
for (const v of r06) {
    console.log(`  ${v.description}`);
    console.log(`  suggestion: ${v.suggestion}`);
    console.log(`  noteIds: ${JSON.stringify(v.noteIds)}`);
    // Find the notes
    for (const nid of (v.noteIds || [])) {
        const n = analyzed.find((nn: any) => nn.id === nid);
        if (n) {
            const acc = n.explicitAccidental || n.accidental || '';
            console.log(`    -> ${n.pitch}${acc}${n.octave} v${n.voice} midi=${n.midi} UI m${(n.measureIndex??0)+1} b${n.beat}`);
        }
    }
}

// Also look at ALL bass notes in order for m35-36 to see the sequence
console.log('\n=== Full bass sequence (voice 4), sorted by startTick ===');
const bassAll = analyzed.filter((n: any) =>
    n && !n.isRest && (n.voice ?? 1) === 4 && n.measureIndex >= 34 && n.measureIndex <= 37
).sort((a: any, b: any) => (a.startTick ?? 0) - (b.startTick ?? 0));
for (const n of bassAll) {
    const acc = n.explicitAccidental || n.accidental || '';
    console.log(`  ${n.pitch}${acc}${n.octave} midi=${n.midi} m${n.measureIndex}(UI ${(n.measureIndex??0)+1}) b${n.beat} tick=${n.startTick}`);
}
