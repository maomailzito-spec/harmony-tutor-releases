/**
 * Debug: Dubois n1 p71 — beat-by-beat roman analysis in C vs F
 * Run: npx tsx scripts/_debug_dubois_n1p71.ts
 */
import * as fs from 'fs';
import proj from '../tests/Dubois n1 p 71.json';
import { applyHarmonyRules, getKeySignature, getRomanAnalysis } from '../src/utils/musicTheory';

const notes = (proj as any).notes || [];
const ts = (proj as any).timeSignature;
const tonic = String((proj as any).keySignatureRoot || 'C');
const isMinor = Boolean((proj as any).isMinorMode);
const keySig = getKeySignature(tonic, isMinor ? 'Minor' : 'Major');
const res = applyHarmonyRules(notes as any, keySig as any, tonic, isMinor, (proj as any).analysisContexts || [], ts as any);
const an: any[] = (res as any).analyzedNotes || notes;

type BI = { mi: number; beat: number; notes: any[] };
const bm = new Map<string, BI>();
for (const n of an) {
    if (!n || n.isRest) continue;
    const k = n.measureIndex + '_' + n.beat;
    if (!bm.has(k)) bm.set(k, { mi: n.measureIndex, beat: n.beat, notes: [] });
    bm.get(k)!.notes.push(n);
}
const sorted = [...bm.values()].sort((a, b) => (a.mi - b.mi) || (a.beat - b.beat));

console.log(`Tonic: ${tonic}, isMinor: ${isMinor}, TS: ${ts?.numerator}/${ts?.denominator}`);
console.log(`Total beats: ${sorted.length}\n`);

for (const info of sorted) {
    const st = info.notes.filter((nn: any) =>
        !nn.isPassing && !nn.isNeighbor && !nn.isAppoggiatura && !nn.isAnticipation && !nn.isEscape
    );
    let rC = '?', rF = '?';
    try { const r = getRomanAnalysis(st as any, 'C', false); rC = r?.roman || '?'; } catch { rC = 'err'; }
    try { const r = getRomanAnalysis(st as any, 'F', false); rF = r?.roman || '?'; } catch { rF = 'err'; }
    const ns = info.notes.map((x: any) =>
        (x.pitch || '') + (x.octave || '') + (x.isPassing ? '(P)' : '') + (x.isNeighbor ? '(N)' : '') + (x.isAppoggiatura ? '(A)' : '')
    ).join(' ');
    console.log(`m${info.mi} b${info.beat}  C:${rC.padEnd(6)} F:${rF.padEnd(6)} | ${ns}`);
}

console.log('\nModulations:', JSON.stringify((res as any).modulationSegments || []));
console.log('AutoOverrides:', JSON.stringify(((res as any).autoHarmonyLabelOverrides || []).map((o: any) => ({ ab: o.absBeat, r: o.roman })).slice(0, 15)));
