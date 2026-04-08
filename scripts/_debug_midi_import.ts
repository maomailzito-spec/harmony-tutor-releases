import * as fs from 'fs';
import { parseMidi } from '../src/utils/midiParser';

const filePath = 'tests/Haydin string-quartet-in-g-major-hobiii75-op76-no1-joseph-haydn.mid';
const buf = fs.readFileSync(filePath);
console.log('File size:', buf.length, 'bytes');
console.log('Header:', buf.slice(0, 4).toString('ascii'));

const format = buf.readUInt16BE(8);
const tracks = buf.readUInt16BE(10);
const division = buf.readUInt16BE(12);
const isSMPTE = (division & 0x8000) !== 0;
console.log('Format:', format, '| Tracks:', tracks, '| Division:', division, '| SMPTE:', isSMPTE);

if (isSMPTE) {
    const framesPerSecond = -(division >> 8);  // negative = SMPTE
    const ticksPerFrame = division & 0xFF;
    console.log('SMPTE frames/sec:', framesPerSecond, '| ticks/frame:', ticksPerFrame);
    console.log('>>> SMPTE timing detected — this is why the parser rejects it!');
} else {
    console.log('TPQ:', division, '(ticks per quarter note)');
}

try {
    const parsed = parseMidi(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    console.log('Parsed OK!');
    console.log('  Notes:', parsed.notes.length);
    console.log('  TPQ:', parsed.tpq);
    console.log('  Tempo:', parsed.tempoBpm, 'BPM');
    console.log('  Time sig:', JSON.stringify(parsed.timeSignature));
    console.log('  Key sig:', JSON.stringify(parsed.keySignature));
    if (parsed.notes.length === 0) {
        console.log('>>> WARNING: No notes extracted! Check track/channel mapping.');
    }
    // Show first 5 notes
    for (const n of parsed.notes.slice(0, 5)) {
        console.log('  Note:', JSON.stringify(n));
    }
} catch (e: any) {
    console.error('Parse ERROR:', e.message);
    console.error('Stack:', e.stack?.split('\n').slice(0, 3).join('\n'));
}
