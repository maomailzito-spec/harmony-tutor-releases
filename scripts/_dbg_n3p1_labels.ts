import { applyHarmonyRules } from '../src/utils/musicTheory';
import { computeHarmonyLabels } from '../src/utils/harmonyLabelPipeline';
import * as fs from 'fs';

const raw = JSON.parse(fs.readFileSync('./tests/Dubois n3 p1 .htp', 'utf-8'));
const notes = raw.notes || raw.staffNotes || [];
const ks = { type: 'natural' as const, count: 0 };
const result = applyHarmonyRules(notes, ks, 'A', true, [], { beats: 4, beatValue: 4 });

const labels = computeHarmonyLabels(
    result.analyzedNotes,
    ks,
    'A',
    true,
    [],  // analysisContexts
    (result as any).inferredAnalysisContexts || [],
    [],  // harmonyOverrides
    (result as any).autoHarmonyLabelOverrides || [],
    { beats: 4, beatValue: 4 }
);

for (const l of labels) {
    if ((l as any).measureIndex <= 3) {
        console.log(`m${((l as any).measureIndex ?? 0) + 1} b${(l as any).beat} roman="${(l as any).roman || ''}" symbol="${(l as any).symbol || ''}" ctx="${(l as any).contextTonic || ''}" minor=${(l as any).contextIsMinor ?? ''}`);
    }
}
