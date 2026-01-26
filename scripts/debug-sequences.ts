import fs from 'fs';
import path from 'path';
import { detectVoiceLeadingSequences } from '../src/utils/sequenceDetector';
import { calculateNoteBeats } from '../src/utils/musicTheory';

const filePath = path.resolve(process.cwd(), 'tests', 'Dubois 1 p11.json');
const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as any;

const notes = Array.isArray(raw.notes) ? raw.notes : [];
const timeSignature = raw.timeSignature || { numerator: 4, denominator: 4 };
const timeSignatureChanges = Array.isArray(raw.timeSignatureChanges) ? raw.timeSignatureChanges : [];

const normalized = calculateNoteBeats(notes, timeSignature, timeSignatureChanges);

const matches = detectVoiceLeadingSequences(normalized, timeSignature, timeSignatureChanges, [], {
    minSteps: 2,
    maxSteps: 8,
    snapTicks: 8,
    maxMatches: 200,
});

const summary = matches.map((m, idx) => {
    const start = m.startMeasure + 1;
    const end = m.endMeasure + 1;
    return {
        idx,
        measures: start === end ? `${start}` : `${start}-${end}`,
        lengthSteps: m.lengthSteps,
        startTick: m.startTick,
        endTick: m.endTick,
    };
});

console.log(JSON.stringify(summary, null, 2));
