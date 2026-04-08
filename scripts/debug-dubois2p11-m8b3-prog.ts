import fs from 'fs';
import { calculateNoteBeats, getActiveNotesTimeline, getRomanAnalysis, getRomanAnalysisDebugSnapshot } from '../src/utils/musicTheory';

const filePath = 'tests/Dubois 2 p.11.json';
const fx = JSON.parse(fs.readFileSync(filePath, 'utf8')) as any;

const timeSignature = fx.timeSignature || { numerator: 4, denominator: 4 };
const timeSignatureChanges = Array.isArray(fx.timeSignatureChanges) ? fx.timeSignatureChanges : [];
const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);

const notes = calculateNoteBeats(Array.isArray(fx.notes) ? fx.notes : [], timeSignature, timeSignatureChanges);
const timeline = getActiveNotesTimeline(notes as any, timeSignature, timeSignatureChanges);

const sampleAtAbsBeat = (absBeat: number) => {
    let best: any = null;
    for (const ev of (timeline || [])) {
        if (!ev || typeof ev.absBeat !== 'number') continue;
        if (ev.absBeat <= absBeat + 1e-6) best = ev;
        else break;
    }
    const chord = (best?.notes || []) as any[];
    const roman = getRomanAnalysis(chord as any, String(fx.keySignatureRoot || 'C'), !!fx.isMinorMode);
    const snap = getRomanAnalysisDebugSnapshot(chord as any, String(fx.keySignatureRoot || 'C'), !!fx.isMinorMode);

    const m1 = Math.floor(absBeat / beatsPerMeasure) + 1;
    const b1 = (absBeat - Math.floor(absBeat / beatsPerMeasure) * beatsPerMeasure) + 1;

    const pitchDump = chord
        .filter(n => n && !n.isRest)
        .map(n => ({
            id: n.id,
            voice: (n as any).voice,
            clef: (n as any).clef,
            pitch: (n as any).pitch,
            octave: (n as any).octave,
            midi: (n as any).midi,
            noteIndex: (n as any).noteIndex,
            accidental: (n as any).accidental,
            explicitAccidental: (n as any).explicitAccidental,
            userAccidental: (n as any).userAccidental,
            isSuspension: (n as any).isSuspension,
            isPassing: (n as any).isPassing,
            isNeighbor: (n as any).isNeighbor,
        }));

    console.log(`\n@m${m1} b${b1.toFixed(3)} abs=${absBeat}`);
    console.log({ roman: roman?.roman, figures: roman?.figures });
    console.log('notes', pitchDump);
    console.log('pcs', { pcsBase: snap.pcsBase, pcsFigures: snap.pcsFigures, pcsRoman: snap.pcsRoman });
    if (snap.removedForRoman?.length) {
        console.log('removedForRomanIds', snap.removedForRoman);
    }
};

// Expected progression around m8 b3: IV6 V6 I vi (user report).
// Sample every beat in the window to see whether the V6 (and/or vi) lands on weak beats.
const absBeats = [30, 31, 32, 33, 34, 35, 36];
console.log({ filePath, key: fx.keySignatureRoot, minor: fx.isMinorMode, timeSignature });
for (const ab of absBeats) sampleAtAbsBeat(ab);
