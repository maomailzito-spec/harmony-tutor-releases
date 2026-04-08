import * as fs from 'fs';
import { parseMidi } from '../src/utils/midiParser';
import { getKeySignature, getNotePropertiesFromMidi } from '../src/utils/musicTheory';
import { TICKS_PER_QUARTER } from '../src/constants';

const filePath = 'tests/Haydin string-quartet-in-g-major-hobiii75-op76-no1-joseph-haydn.mid';
const buf = fs.readFileSync(filePath);
console.log('File size:', buf.length, 'bytes');

// Simulate base64 round-trip
const base64 = buf.toString('base64');
console.log('Base64 length:', base64.length);
const bin = Buffer.from(base64, 'base64');
console.log('Round-trip OK:', bin.length === buf.length);

const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const parsed = parseMidi(arrayBuffer);
console.log('Parsed OK, notes:', parsed.notes.length);

const tpq = Math.max(1, parsed.tpq);
const beatsPerMeasure = parsed.timeSignature.numerator * (4 / parsed.timeSignature.denominator);
console.log('TPQ:', tpq, 'beatsPerMeasure:', beatsPerMeasure);

const keySig = getKeySignature('C', 'Major');

// Test conversion for ALL notes
let errors = 0;
const errorDetails: string[] = [];
for (let i = 0; i < parsed.notes.length; i++) {
    const n = parsed.notes[i];
    try {
        const absBeats = n.tick / tpq;
        const durBeats = n.durationTicks / tpq;
        const measureIndex = Math.max(0, Math.floor(absBeats / Math.max(1, beatsPerMeasure)));
        const beat = 1 + (absBeats - (measureIndex * beatsPerMeasure));
        const clef = n.midi >= 60 ? 'treble' : 'bass';
        const props = getNotePropertiesFromMidi(n.midi, keySig, clef as any, null);
        if (!props) {
            errors++;
            if (errorDetails.length < 10) errorDetails.push(`Note ${i}: props=null midi=${n.midi}`);
        }
    } catch (e: any) {
        errors++;
        if (errorDetails.length < 10) errorDetails.push(`Note ${i}: ${e.message} midi=${n.midi} tick=${n.tick}`);
    }
}
console.log('Conversion test (all', parsed.notes.length, 'notes):', errors, 'errors');
if (errorDetails.length > 0) {
    console.log('Error details:');
    errorDetails.forEach(d => console.log(' ', d));
}

// Stats
const lastNote = parsed.notes[parsed.notes.length - 1];
const lastBeats = lastNote.tick / tpq;
const totalMeasures = Math.floor(lastBeats / beatsPerMeasure) + 1;
console.log('Total measures:', totalMeasures);
console.log('Notes per measure avg:', (parsed.notes.length / totalMeasures).toFixed(1));

// Check unique tracks and channels
const tracks = new Set(parsed.notes.map(n => n.track));
const channels = new Set(parsed.notes.map(n => n.channel));
console.log('Tracks:', [...tracks].sort());
console.log('Channels:', [...channels].sort());
console.log('Notes per track:');
for (const t of [...tracks].sort()) {
    const count = parsed.notes.filter(n => n.track === t).length;
    console.log(`  Track ${t}: ${count} notes`);
}
