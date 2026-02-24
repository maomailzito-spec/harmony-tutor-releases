import { applyHarmonyRules } from '../src/utils/musicTheory';
import * as fs from 'fs';

const raw = JSON.parse(fs.readFileSync('./tests/Dubois n3 p1 .htp', 'utf-8'));
const notes = raw.notes || raw.staffNotes || [];
const ks = { type: 'natural' as const, count: 0 };
const result = applyHarmonyRules(notes, ks, 'A', true, [], { beats: 4, beatValue: 4 });

// Check autoHarmonyLabelOverrides
const overrides = (result as any).autoHarmonyLabelOverrides || [];
for (const o of overrides) {
    console.log(`override: m${(o.measureIndex ?? 0) + 1} b${o.beat} roman="${o.roman || o.label || ''}" symbol="${o.symbol || ''}" ctx="${o.contextTonic || ''}" isMinor=${o.isMinor ?? ''}`);
}

// Check inferredAnalysisContexts
const iac = (result as any).inferredAnalysisContexts || [];
for (const c of iac) {
    console.log(`inferred ctx: m${(c.measureIndex ?? 0) + 1} b${c.beat || c.startBeat || ''} tonic="${c.tonic || ''}" minor=${c.isMinor ?? ''}`);
}
