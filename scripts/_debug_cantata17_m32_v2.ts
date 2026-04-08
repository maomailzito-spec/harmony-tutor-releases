/**
 * Debug script: analyze Bach Cantata 17, UI measures 31-33 (0-based: 30-32)
 * Focus: F#m chord labeled as "V" instead of "vi"
 * Note: UI measure N = measureIndex N-1 (0-based)
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

const keySig = getKeySignature(tonic, isMinor ? 'Minor' : 'Major');
const res = applyHarmonyRules(notes as any, keySig as any, tonic, isMinor, contexts, ts as any);
const analyzed = (res as any).analyzedNotes || notes;
const inferred = (res as any).inferredAnalysisContexts || [];

console.log('\n=== Inferred Analysis Contexts ===');
for (const ctx of inferred) {
    // Convert absBeat to measure for easier reading (3/4 time = 3 beats per measure)
    const bpm = 3; // 3 beats per measure in 3/4
    const approxMeasure = Math.floor(ctx.absBeat / bpm);
    console.log(`  absBeat=${ctx.absBeat} (~UI m${approxMeasure + 1}) → ${ctx.newTonic} ${ctx.newIsMinor ? 'minor' : 'major'} (score=${ctx.score})`);
}

// Check UI measures 29-35 (data indices 28-34)
console.log('\n=== Notes by UI measure (with accidentals) ===');
for (let uiM = 29; uiM <= 35; uiM++) {
    const mi = uiM - 1; // 0-based
    for (const b of [1, 1.5, 2, 2.5, 3, 3.5]) {
        const beatNotes = analyzed.filter((n: any) =>
            n && !n.isRest && n.measureIndex === mi && Math.abs(Number(n.beat) - b) < 0.05
        );
        if (beatNotes.length === 0) continue;
        const pitches = beatNotes.map((n: any) => {
            const acc = n.explicitAccidental || n.accidental || '';
            const accStr = acc ? `(${acc})` : '';
            const orn = n.isPassing ? 'P' : n.isNeighbor ? 'N' : n.isAppoggiatura ? 'App' : n.isSuspension ? 'Sus' : '';
            return `${n.pitch}${accStr}${n.octave}[v${n.voice ?? '?'},ni=${n.noteIndex},m${n.midi}]${orn ? `{${orn}}` : ''}`;
        }).join(', ');
        console.log(`  UI m${uiM} b${b}: ${pitches}`);
    }
}

// Now check specifically where F#m could appear
console.log('\n=== Searching for F# notes in measures 28-35 ===');
for (let mi = 28; mi <= 35; mi++) {
    const fsharp = analyzed.filter((n: any) =>
        n && !n.isRest && n.measureIndex === mi && 
        ((n.noteIndex === 6 || n.noteIndex === 5) || // F# = noteIndex 6, F = 5
         (n.pitch === 'F' && (n.explicitAccidental === 'sharp' || n.accidental === 'sharp')) ||
         (n.pitch === 'F' && !n.explicitAccidental && !n.accidental && n.noteIndex === 6)) // F# in key sig
    );
    if (fsharp.length > 0) {
        console.log(`  measureIndex=${mi} (UI m${mi + 1}):`, fsharp.map((n: any) => 
            `${n.pitch}${n.explicitAccidental || n.accidental || ''}${n.octave} b${n.beat} v${n.voice} ni=${n.noteIndex} midi=${n.midi}`
        ).join(', '));
    }
}

// Find the specific beat where the user sees "V" label
// The label pipeline produces labels per beat — let's check what the analysis says for each beat
console.log('\n=== Roman analysis for each beat (UI m31-33, in different keys) ===');
for (let uiM = 31; uiM <= 33; uiM++) {
    const mi = uiM - 1;
    for (const b of [1, 2, 3]) {
        const beatNotes = analyzed.filter((n: any) =>
            n && !n.isRest && n.measureIndex === mi && Math.abs(Number(n.beat) - b) < 0.05
        );
        const structural = beatNotes.filter((n: any) => 
            !n.isPassing && !n.isNeighbor && !n.isAppoggiatura && !n.isSuspension && !n.isAnticipation && !n.isEscape
        );
        if (structural.length === 0) continue;

        const pcs = structural.map((n: any) => `${n.pitch}${n.explicitAccidental || ''}${n.octave}`).join(',');
        const romanA = getRomanAnalysis(structural as any, 'A', false);
        const romanE = getRomanAnalysis(structural as any, 'E', false);
        const romanD = getRomanAnalysis(structural as any, 'D', false);
        const romanB = getRomanAnalysis(structural as any, 'B', false);
        console.log(`  UI m${uiM} b${b} [${pcs}]: A=${romanA?.roman||'-'} E=${romanE?.roman||'-'} D=${romanD?.roman||'-'} B=${romanB?.roman||'-'}`);
    }
}

// Check the actual labels produced
console.log('\n=== Check which tonic is active per beat ===');
const bpm3 = 3; // beats per measure in 3/4
for (let uiM = 31; uiM <= 33; uiM++) {
    const mi = uiM - 1;
    for (const b of [1, 2, 3]) {
        const absBeat = mi * bpm3 + (b - 1);
        // Find which inferred context is active at this absBeat
        let activeTonic = tonic;
        let activeMinor = isMinor;
        for (const ctx of inferred) {
            if (ctx.absBeat <= absBeat) {
                activeTonic = ctx.newTonic;
                activeMinor = ctx.newIsMinor;
            }
        }
        console.log(`  UI m${uiM} b${b} (absBeat=${absBeat}): active tonic=${activeTonic} ${activeMinor ? 'minor' : 'major'}`);
    }
}
