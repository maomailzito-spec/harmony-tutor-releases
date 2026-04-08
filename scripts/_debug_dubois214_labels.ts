/**
 * Debug: trace label pipeline for Dubois Note sfuggite p.214, m21-m24
 */
import * as fs from 'fs';
import { applyHarmonyRules, getKeySignature } from '../src/utils/musicTheory';
const proj = JSON.parse(fs.readFileSync('tests/Dubois Note sfuggite p.214.htp', 'utf-8'));
import { computeHarmonyLabelsBySystem } from '../src/utils/computeHarmonyLabelsBySystem';

const notes = (proj as any).notes || [];
const ts = (proj as any).timeSignature || { numerator: 4, denominator: 4 };
const tonic = String((proj as any).keySignatureRoot || 'C');
const isMinor = Boolean((proj as any).isMinorMode);
const contexts = (proj as any).analysisContexts || [];
const doubleBarlines = (proj as any).doubleBarlineMeasures || [];
const ornamentOverrides = (proj as any).ornamentOverrides || [];
const tsChanges = (proj as any).timeSignatureChanges || [];
const harmonyOverrides = (proj as any).harmonyOverrides || [];

const keySig = getKeySignature(tonic, isMinor ? 'Minor' : 'Major');
const result = applyHarmonyRules(notes as any, keySig as any, tonic, isMinor, contexts, ts as any, doubleBarlines, ornamentOverrides);
const analyzed = (result as any).analyzedNotes || notes;
const inferred = (result as any).inferredAnalysisContexts || [];
const autoOverrides = (result as any).autoHarmonyLabelOverrides || [];

console.log('Tonic:', tonic, '| Minor:', isMinor);
console.log('TS changes:', JSON.stringify(tsChanges));
console.log('Inferred contexts:', inferred.length, inferred.map((c: any) => `absBeat=${c.absBeat}→${c.newTonic}`).join(', '));
console.log('Auto overrides:', autoOverrides.length);

// Build effective analysis contexts
const effectiveContexts = [...contexts, ...inferred].sort((a: any, b: any) =>
    (a.absBeat ?? a.measureIndex ?? 0) - (b.absBeat ?? b.measureIndex ?? 0)
);

// Build a single system with all measures
const maxMi = Math.max(...analyzed.map((n: any) => n.measureIndex ?? 0));
const measureIndices = Array.from({ length: maxMi + 1 }, (_, i) => i);

// Build layout data skeleton
const systemsParams = [{
    measureIndices,
    startMeasuresX: measureIndices.map((_, i) => 50 + i * 200),
    width: 50 + (maxMi + 1) * 200,
    startX: 50,
}];

const layoutData = {
    systemsParams,
    positionedNotes: analyzed,
};

// Context absBeat helper — compute absBeat from measureIndex and beat
const getAbsBeatForMeasure = (mi: number, beat: number = 1): number => {
    let abs = 0;
    let curTs = ts;
    let curMi = 0;
    for (const c of tsChanges) {
        if (c.measureIndex > mi) break;
        const measBefore = c.measureIndex - curMi;
        const bpm = curTs.numerator * (4 / curTs.denominator);
        abs += measBefore * bpm;
        curTs = { numerator: c.numerator, denominator: c.denominator };
        curMi = c.measureIndex;
    }
    const bpm = curTs.numerator * (4 / curTs.denominator);
    abs += (mi - curMi) * bpm;
    abs += (beat - 1);
    return abs;
};

const analysisContextAbsBeat = (ctx: any) => {
    if (typeof ctx.absBeat === 'number') return ctx.absBeat;
    return getAbsBeatForMeasure(ctx.measureIndex ?? 0, 1);
};

const _noteNameToChromaticIndex = (name: string): number => {
    const map: Record<string, number> = {
        'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3,
        'E': 4, 'Fb': 4, 'E#': 5, 'F': 5, 'F#': 6, 'Gb': 6,
        'G': 7, 'G#': 8, 'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10,
        'B': 11, 'Cb': 11, 'B#': 0,
    };
    return map[name] ?? 0;
};

// Compute ornament override map
const ornOvMap = new Map<string, string>();
for (const ov of ornamentOverrides) {
    if (ov.noteId && ov.label) ornOvMap.set(ov.noteId, ov.label);
}

console.log('\nCalling computeHarmonyLabelsBySystem...');
const labels = computeHarmonyLabelsBySystem({
    isAnalysisEnabled: true,
    layoutData,
    timeSignature: ts,
    timeSignatureChanges: tsChanges,
    effectiveAnalysisContexts: effectiveContexts,
    analysisContextAbsBeat,
    currentTonic: tonic,
    isMinorMode: isMinor,
    harmonyOverrides: [...harmonyOverrides, ...autoOverrides],
    analysisResult: result,
    analyzedNotes: analyzed,
    noteNameToChromaticIndex: _noteNameToChromaticIndex,
    startX: 50,
    measurePaddingX: 10,
    ornamentOverrideMap: ornOvMap,
});

// Print labels for m20-24
console.log('\n=== ALL labels m20-m24 (including hidden) ===');
const allLabels = (labels?.[0] || []);
console.log('Total labels in system 0:', allLabels.length);

// Only show m22-m23 to reduce noise
for (const l of allLabels) {
    const abs = l.absBeat ?? 0;
    let meas = -1;
    let beatInMeas = -1;
    let runningAbs = 0;
    let curTs2 = ts;
    let curMi2 = 0;
    for (const c of tsChanges) {
        const bpmC = curTs2.numerator * (4 / curTs2.denominator);
        const endAbs = runningAbs + (c.measureIndex - curMi2) * bpmC;
        if (abs < endAbs) break;
        runningAbs = endAbs;
        curTs2 = { numerator: c.numerator, denominator: c.denominator };
        curMi2 = c.measureIndex;
    }
    const bpm2 = curTs2.numerator * (4 / curTs2.denominator);
    meas = curMi2 + Math.floor((abs - runningAbs) / bpm2);
    beatInMeas = ((abs - runningAbs) % bpm2) + 1;

    if (meas >= 21 && meas <= 23) {
        const vis = l.hiddenMarker ? 'HIDDEN' : 'VISIBLE';
        console.log(`  m${meas + 1} b=${beatInMeas.toFixed(2)} abs=${abs.toFixed(2)} roman="${l.roman}" fig=[${(l.figures || []).join(',')}] ${vis} id=${l.id?.substring(0, 40)}`);
    }
}
