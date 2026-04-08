/**
 * Debug script: trace label pipeline for Bach Cantata 17, UI m32 b3
 * The analysis engine returns "vi" in A major but the UI shows "V"
 * Need to check useHarmonyLabels / harmonyLabelPipeline outputs
 */
import proj from '../tests/Cantata 17 Bach.json';
import { applyHarmonyRules, getKeySignature, getRomanAnalysis } from '../src/utils/musicTheory';
import { computeHarmonyLabelsBySystem } from '../src/utils/computeHarmonyLabelsBySystem';

const notes = (proj as any).notes || [];
const ts = (proj as any).timeSignature || { numerator: 3, denominator: 4 };
const tonic = String((proj as any).keySignatureRoot || 'C');
const isMinor = Boolean((proj as any).isMinorMode);
const contexts = (proj as any).analysisContexts || [];
const doubleBarlines = (proj as any).doubleBarlineMeasures || [];
const ornamentOverrides = (proj as any).ornamentOverrides || [];

const keySig = getKeySignature(tonic, isMinor ? 'Minor' : 'Major');
const result = applyHarmonyRules(notes as any, keySig as any, tonic, isMinor, contexts, ts as any, doubleBarlines, ornamentOverrides);
const analyzed = (result as any).analyzedNotes || notes;
const inferred = (result as any).inferredAnalysisContexts || [];

console.log('Tonic:', tonic, '| Minor:', isMinor);
console.log('Inferred contexts:', inferred.map((c: any) => `absBeat=${c.absBeat}→${c.newTonic}`).join(', '));

// Check what the analysis marks on the notes themselves around UI m32
console.log('\n=== Analyzed note properties at UI m32 b3 (measureIndex=31, beat=3) ===');
const targetNotes = analyzed.filter((n: any) =>
    n && !n.isRest && n.measureIndex === 31 && Math.abs(Number(n.beat) - 3) < 0.05
);
for (const n of targetNotes) {
    const acc = n.explicitAccidental || n.accidental || '';
    console.log(`  ${n.pitch}${acc}${n.octave} v${n.voice} midi=${n.midi}`);
    console.log(`    roman: ${JSON.stringify((n as any).roman)}`);
    console.log(`    chordLabel: ${JSON.stringify((n as any).chordLabel)}`);
    console.log(`    harmonyLabel: ${JSON.stringify((n as any).harmonyLabel)}`);
    console.log(`    tonicAtBeat: ${JSON.stringify((n as any).tonicAtBeat)}`);
    console.log(`    analysisKey: ${JSON.stringify((n as any).analysisKey)}`);
    console.log(`    isNCT: pass=${!!n.isPassing} neigh=${!!n.isNeighbor} app=${!!n.isAppoggiatura} susp=${!!n.isSuspension}`);
    
    // Check all unusual properties
    const specialKeys = Object.keys(n).filter(k => 
        !['id','pitch','octave','noteIndex','duration','isRest','isDotted','isTriplet','isDuplet',
        'measureIndex','beat','startTick','durationTicks','voice','midi','clef','explicitAccidental',
        'accidental','isPassing','isNeighbor','isAppoggiatura','isSuspension','isAnticipation','isEscape',
        'ornamentMark','isTiedToNext','isTiedFromPrevious','chordId','groupId','manualBeamGroupId',
        'velocity','userAccidental'].includes(k)
    );
    if (specialKeys.length > 0) {
        console.log('    extra props:', specialKeys.map(k => `${k}=${JSON.stringify(n[k])}`).join(', '));
    }
}

// Also check UI m31 b3 and m33 b3 for comparison
console.log('\n=== Analyzed notes at UI m31 b3 (measureIndex=30, beat=3) ===');
const m31b3 = analyzed.filter((n: any) => n && !n.isRest && n.measureIndex === 30 && Math.abs(Number(n.beat) - 3) < 0.05);
for (const n of m31b3) {
    const acc = n.explicitAccidental || n.accidental || '';
    console.log(`  ${n.pitch}${acc}${n.octave} v${n.voice}: roman=${JSON.stringify((n as any).roman)} chordLabel=${JSON.stringify((n as any).chordLabel)} harmonyLabel=${JSON.stringify((n as any).harmonyLabel)}`);
}

console.log('\n=== Analyzed notes at UI m33 b3 (measureIndex=32, beat=3) ===');
const m33b3 = analyzed.filter((n: any) => n && !n.isRest && n.measureIndex === 32 && Math.abs(Number(n.beat) - 3) < 0.05);
for (const n of m33b3) {
    const acc = n.explicitAccidental || n.accidental || '';
    console.log(`  ${n.pitch}${acc}${n.octave} v${n.voice}: roman=${JSON.stringify((n as any).roman)} chordLabel=${JSON.stringify((n as any).chordLabel)} harmonyLabel=${JSON.stringify((n as any).harmonyLabel)}`);
}

// Direct Roman analysis for the specific chord
console.log('\n=== Direct getRomanAnalysis for UI m32 b3 ===');
const structural = targetNotes.filter((n: any) => !n.isPassing && !n.isNeighbor && !n.isAppoggiatura && !n.isSuspension);
const romanResult = getRomanAnalysis(structural as any, tonic, isMinor);
console.log('In A major:', JSON.stringify(romanResult));

// Check more beats around the sequence area to see the pattern
console.log('\n=== Roman analysis pattern UI m30-35 ===');
for (let uiM = 30; uiM <= 35; uiM++) {
    const mi = uiM - 1;
    for (const b of [1, 3]) {
        const beatNotes = analyzed.filter((n: any) =>
            n && !n.isRest && n.measureIndex === mi && Math.abs(Number(n.beat) - b) < 0.05
        );
        const str = beatNotes.filter((n: any) => !n.isPassing && !n.isNeighbor && !n.isAppoggiatura && !n.isSuspension);
        if (str.length === 0) continue;
        const pitches = str.map((n: any) => `${n.pitch}${n.explicitAccidental || ''}${n.octave}`).join(',');
        const roman = getRomanAnalysis(str as any, tonic, isMinor);
        const romanE = getRomanAnalysis(str as any, 'E', false);
        // Check what label this beat actually shows
        const label = (str[0] as any)?.harmonyLabel || (str[0] as any)?.chordLabel || (str[0] as any)?.roman || '-';
        console.log(`  UI m${uiM} b${b}: [${pitches}] A→${roman?.roman||'-'} E→${romanE?.roman||'-'} label=${JSON.stringify(label)}`);
    }
}
