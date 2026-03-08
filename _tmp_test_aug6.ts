import { getRomanAnalysis, getKeySignature, calculateNoteBeats, getActiveNotesTimeline } from './src/utils/musicTheory';
import * as fs from 'fs';

const data = JSON.parse(fs.readFileSync('./tests/seste ecc.htp', 'utf-8'));
const rawNotes = data.notes || data.rawNotes || [];
const keyRoot = data.keySignatureRoot || 'C';
const isMinor = !!data.isMinorMode;
const ts = data.timeSignature || { numerator: 4, denominator: 4 };

// Simulate normalizer
const keySig = getKeySignature(keyRoot, 'Major');
const basePcMap: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const sharpOrder = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const flatOrder = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
const keySigAcc = (letter: string): number => {
    if (keySig.type === 'sharp' && keySig.count > 0) return sharpOrder.slice(0, keySig.count).includes(letter) ? 1 : 0;
    if (keySig.type === 'flat' && keySig.count > 0) return flatOrder.slice(0, keySig.count).includes(letter) ? -1 : 0;
    return 0;
};
const accToD = (acc: any) => { switch(acc) { case 'sharp': return 1; case 'flat': return -1; case 'natural': return 0; case 'doubleSharp': return 2; case 'doubleFlat': return -2; default: return 0; } };

// With carry (new logic)
const sorted = rawNotes.slice().sort((a: any, b: any) => {
    const ma = a.measureIndex ?? 0, mb = b.measureIndex ?? 0;
    if (ma !== mb) return ma - mb;
    const ta = a.startTick ?? 0, tb = b.startTick ?? 0;
    if (ta !== tb) return ta - tb;
    return (a.voice ?? 1) - (b.voice ?? 1);
});
const accState = new Map<string, number>();
const normalizedNotes = sorted.map((n: any) => {
    if (!n || n.isRest) return n;
    const letter = String(n.pitch || '').charAt(0).toUpperCase();
    if (!basePcMap.hasOwnProperty(letter)) return n;
    const octave = Number(n.octave);
    if (!Number.isFinite(octave)) return n;
    const measureIdx = n.measureIndex ?? 0;
    const voice = n.voice ?? 1;
    const stateKey = `${measureIdx}-${voice}-${letter}-${octave}`;
    const explicit = (n.explicitAccidental ?? n.userAccidental ?? null);
    let delta: number;
    if (explicit != null) {
        delta = accToD(explicit);
        accState.set(stateKey, delta);
    } else {
        const carried = accState.get(stateKey);
        delta = (carried != null) ? carried : keySigAcc(letter);
    }
    const noteIndex = ((basePcMap[letter] + delta) % 12 + 12) % 12;
    const rawPc = basePcMap[letter] + delta;
    let octaveAdj = octave;
    if (rawPc < 0) octaveAdj -= 1;
    else if (rawPc >= 12) octaveAdj += 1;
    const midi = (octaveAdj + 1) * 12 + noteIndex;
    return { ...n, noteIndex, midi };
});

const notes = calculateNoteBeats(normalizedNotes, ts, []);
const timeline = getActiveNotesTimeline(notes, ts, []);

// Find the event at beat matching m2b1
const bpm = ts.numerator * (4 / ts.denominator);
const targetAbsBeat = 1 * bpm + 0; // measure 1 (0-indexed) beat 1 → absBeat = 4
console.log('Target absBeat:', targetAbsBeat);

for (const ev of timeline) {
    if (Math.abs(ev.absBeat - targetAbsBeat) < 0.01) {
        console.log('Timeline event notes:');
        for (const n of (ev as any).notes || []) {
            console.log(`  v=${(n as any).voice} ${(n as any).pitch}${(n as any).octave} acc=${(n as any).accidental} expl=${(n as any).explicitAccidental} midi=${(n as any).midi}`);
        }
        const r = getRomanAnalysis((ev as any).notes, keyRoot, isMinor);
        console.log('getRomanAnalysis via timeline:', JSON.stringify(r));
        break;
    }
}

