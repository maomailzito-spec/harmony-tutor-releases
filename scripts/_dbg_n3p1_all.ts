import { applyHarmonyRules, getRomanAnalysis } from '../src/utils/musicTheory';
import { structuralNotes, qAbsBeat, filterTimelineForHarmonyLabels } from '../src/utils/harmonyLabelPipeline';
import * as fs from 'fs';

const raw = JSON.parse(fs.readFileSync('./tests/Dubois n3 p1 .htp', 'utf-8'));
const notes = raw.notes || raw.staffNotes || [];
const ks = { type: 'natural' as const, count: 0 };
const result = applyHarmonyRules(notes, ks, 'A', true, [], { beats: 4, beatValue: 4 });

// Build timeline manually
const analyzedNotes = result.analyzedNotes;
const beatsPerMeasure = 4;

// Group notes by absBeat
const byBeat = new Map<number, any[]>();
for (const n of analyzedNotes) {
    const abs = (n.measureIndex ?? 0) * beatsPerMeasure + (n.beat ?? 1);
    const q = Math.round(abs * 192) / 192;
    const list = byBeat.get(q) || [];
    list.push(n);
    byBeat.set(q, list);
}

const sortedBeats = [...byBeat.keys()].sort((a, b) => a - b);
for (const ab of sortedBeats.slice(0, 12)) {
    const evNotes = byBeat.get(ab) || [];
    const struct = evNotes.filter((n: any) => !n.isRest);
    
    // Test in Am
    const rAm = getRomanAnalysis(struct, 'A', true);
    // Test in F major
    const rF = getRomanAnalysis(struct, 'F', false);
    // Test in C major
    const rC = getRomanAnalysis(struct, 'C', false);
    
    const mi = Math.floor(ab / beatsPerMeasure);
    const bt = ab - mi * beatsPerMeasure;
    const pitches = struct.map((n: any) => n.pitch).join(',');
    console.log(`m${mi + 1} b${bt + 1} [${pitches}] Am=${rAm?.roman || '?'} F=${rF?.roman || '?'} C=${rC?.roman || '?'}`);
}
