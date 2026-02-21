// eslint-disable-next-line @typescript-eslint/no-var-requires
const proj = require('../tests/Dubois n2 p71.json');
const { applyHarmonyRules, getKeySignature, getRomanAnalysis } = require('../src/utils/musicTheory');

const notes = (proj as any).notes || [];
const ts = (proj as any).timeSignature;
const tonic = String((proj as any).keySignatureRoot || 'C');
const isMinor = Boolean((proj as any).isMinorMode);
const keySig = getKeySignature(tonic, isMinor ? 'Minor' : 'Major');
const res = applyHarmonyRules(notes as any, keySig as any, tonic, isMinor, (proj as any).analysisContexts || [], ts as any);
const analyzed = (res as any).analyzedNotes || notes;

const maxMeasure = Math.max(...analyzed.filter((n: any) => n != null && n.measureIndex != null).map((n: any) => n.measureIndex));

// Show analysisContexts
console.log('tonic:', tonic, 'isMinor:', isMinor, 'maxMeasure:', maxMeasure);
console.log('analysisContexts:', JSON.stringify((proj as any).analysisContexts || []));

// Show modulation segments from the analysis
const modulations = (res as any).modulationSegments || (res as any).modulations || [];
console.log('modulations:', JSON.stringify(modulations));

// Show auto overrides
const autoOverrides = (res as any).autoHarmonyLabelOverrides || [];
const lastAutoOvr = autoOverrides.filter((o: any) => {
    const ab = Number(o?.absBeat);
    const beatsPerMeasure = ts.numerator * (4 / ts.denominator);
    return ab >= (maxMeasure - 1) * beatsPerMeasure;
});
console.log('auto overrides near end:', JSON.stringify(lastAutoOvr));

// Show last 2 measures notes
const lastNotes = analyzed
    .filter((n: any) => n != null && n.measureIndex >= maxMeasure - 1)
    .map((n: any) => ({
        mi: n.measureIndex, b: n.beat, v: n.voice,
        p: (n.pitch || '') + (n.octave || ''), m: n.midi,
        rest: !!n.isRest, pass: !!n.isPassing, app: !!n.isAppoggiatura, susp: !!n.isSuspension
    }))
    .sort((a: any, b: any) => a.mi - b.mi || a.b - b.b || (a.v || 0) - (b.v || 0));
console.log('last notes:', JSON.stringify(lastNotes, null, 2));

// Direct getRomanAnalysis for the final beat
const finalBeatNotes = analyzed.filter((n: any) =>
    n != null && n.measureIndex === maxMeasure && Math.abs(Number(n.beat) - 1) < 0.01
);
if (finalBeatNotes.length > 0) {
    const romanG = getRomanAnalysis(finalBeatNotes, 'G', false);
    const romanF = getRomanAnalysis(finalBeatNotes, 'F', false);
    console.log('final beat getRomanAnalysis(G major):', JSON.stringify(romanG));
    console.log('final beat getRomanAnalysis(F major):', JSON.stringify(romanF));
}
