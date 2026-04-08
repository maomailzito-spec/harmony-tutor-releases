import { applyHarmonyRules } from '../src/utils/musicTheory';
import * as fs from 'fs';

const raw = JSON.parse(fs.readFileSync('./tests/Dubois n3 p1 .htp', 'utf-8'));
const notes = raw.notes || raw.staffNotes || [];
const ks = { type: 'natural' as const, count: 0 };
const result = applyHarmonyRules(notes, ks, 'A', true, [], { beats: 4, beatValue: 4 });

// Dump the result keys first
console.log('Result keys:', Object.keys(result));

// Try different fields
const an = result.analyzedNotes || [];
// Check a bass note for ANY key that might have a roman
const sample = an.find((n: any) => n.measureIndex === 1 && n.beat === 1);
if (sample) {
    console.log('Sample m2 b1 keys:', Object.keys(sample));
    console.log('Sample m2 b1:', JSON.stringify(sample, null, 2).slice(0, 500));
}
