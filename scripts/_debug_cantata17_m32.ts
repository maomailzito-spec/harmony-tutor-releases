/**
 * Debug script: analyze Bach Cantata 17, measures 30-34
 * Focus on m32 b3 where F#m (F#,A,F#,C#) is labeled "V" instead of "vi"
 */
import proj from '../tests/Cantata 17 Bach.json';
import { applyHarmonyRules, getKeySignature, getRomanAnalysis } from '../src/utils/musicTheory';

const notes = (proj as any).notes || [];
const ts = (proj as any).timeSignature;
const tonic = String((proj as any).keySignatureRoot || 'C');
const isMinor = Boolean((proj as any).isMinorMode);
const contexts = (proj as any).analysisContexts || [];

console.log('=== Project Info ===');
console.log('Tonic:', tonic, '| Minor:', isMinor, '| Time Sig:', JSON.stringify(ts));
console.log('Total notes:', notes.length);
console.log('Analysis contexts:', JSON.stringify(contexts, null, 2));

const keySig = getKeySignature(tonic, isMinor ? 'Minor' : 'Major');
const res = applyHarmonyRules(notes as any, keySig as any, tonic, isMinor, contexts, ts as any);
const analyzed = (res as any).analyzedNotes || notes;
const inferred = (res as any).inferredAnalysisContexts || [];

console.log('\n=== Inferred Analysis Contexts ===');
for (const ctx of inferred) {
    console.log(JSON.stringify(ctx));
}

// Extract notes and labels for measures 30-34
console.log('\n=== Notes at measures 30-34 ===');
for (let mi = 30; mi <= 34; mi++) {
    for (const b of [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5]) {
        const beatNotes = analyzed.filter((n: any) =>
            n && !n.isRest && n.measureIndex === mi && Math.abs(Number(n.beat) - b) < 0.05
        );
        if (beatNotes.length === 0) continue;
        const pitches = beatNotes.map((n: any) => `${n.pitch}${n.octave}(v${n.voice ?? '?'},m${n.midi})`).join(', ');
        const ornaments = beatNotes.filter((n: any) => n.isPassing || n.isNeighbor || n.isAppoggiatura || n.isSuspension || n.isAnticipation || n.isEscape);
        const ornStr = ornaments.length > 0 ? ` [orn: ${ornaments.map((n: any) => `${n.pitch}${n.octave}=${n.ornamentMark||'?'}`).join(',')}]` : '';
        console.log(`  m${mi} b${b}: ${pitches}${ornStr}`);
    }
}

// Focus on m32 b3
console.log('\n=== Focus: m32 b3 ===');
const m32b3 = analyzed.filter((n: any) =>
    n && !n.isRest && n.measureIndex === 32 && Math.abs(Number(n.beat) - 3) < 0.05
);
for (const n of m32b3) {
    console.log(`  ${n.pitch}${n.octave} v${n.voice ?? '?'} midi=${n.midi} pass=${!!n.isPassing} neigh=${!!n.isNeighbor} app=${!!n.isAppoggiatura} susp=${!!n.isSuspension}`);
}

// Check what Roman analysis gives for m32 b3
const structural = m32b3.filter((n: any) => !n.isPassing && !n.isNeighbor && !n.isAppoggiatura && !n.isSuspension && !n.isAnticipation && !n.isEscape);
console.log('\nStructural notes at m32 b3:', structural.map((n: any) => `${n.pitch}${n.octave}(m${n.midi})`).join(', '));

// Try getRomanAnalysis in different keys
if (structural.length > 0) {
    const romanA = getRomanAnalysis(structural as any, 'A', false);
    console.log('Roman in A major:', JSON.stringify(romanA));
    
    const romanB = getRomanAnalysis(structural as any, 'B', false);
    console.log('Roman in B major:', JSON.stringify(romanB));
    
    const romanD = getRomanAnalysis(structural as any, 'D', false);
    console.log('Roman in D major:', JSON.stringify(romanD));
}

// Check sequence detection
console.log('\n=== Sequence/Modulation info around m31-32 ===');
const violations = (res as any).violations || [];
const seqViolations = violations.filter((v: any) => 
    v && (v.type?.includes('sequence') || v.message?.includes('sequence') || v.type?.includes('modulation'))
);
console.log('Sequence-related violations:', seqViolations.length);
for (const v of seqViolations.slice(0, 10)) {
    console.log('  ', JSON.stringify(v));
}
