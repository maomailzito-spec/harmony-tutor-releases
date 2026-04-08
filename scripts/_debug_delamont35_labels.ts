import * as fs from 'fs';
import { computeHarmonyLabelsBySystem } from '../src/utils/computeHarmonyLabelsBySystem';

const d = JSON.parse(fs.readFileSync('tests/Delamont C 35 4 .htp', 'utf8'));
const result = computeHarmonyLabelsBySystem(d);
const labels = (result.labelsBySystem?.[0] || []) as any[];

// Show all labels
console.log('=== ALL Labels ===');
for (const l of labels) {
    console.log(`  abs=${l.absBeat} roman="${l.roman}" fig=${JSON.stringify(l.figures)} hidden=${l.hiddenMarker || false}`);
}
