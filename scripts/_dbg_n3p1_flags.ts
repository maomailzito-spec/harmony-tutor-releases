import { applyHarmonyRules, getRomanAnalysis } from '../src/utils/musicTheory';
import { structuralNotes } from '../src/utils/harmonyLabelPipeline';
import * as fs from 'fs';

const raw = JSON.parse(fs.readFileSync('./tests/Dubois n3 p1 .htp', 'utf-8'));
const notes = raw.notes || raw.staffNotes || [];
const ks = { type: 'sharp' as const, count: 0 };
const result = applyHarmonyRules(notes, ks, 'A', true, [], { beats: 4, beatValue: 4 });

const an = result.analyzedNotes;
const beatsPerMeasure = 4;

// Group by absBeat
const byBeat = new Map<number, any[]>();
for (const n of an) {
    const abs = (n.measureIndex ?? 0) * beatsPerMeasure + (n.beat ?? 1);
    const q = Math.round(abs * 192) / 192;
    const list = byBeat.get(q) || [];
    list.push(n);
    byBeat.set(q, list);
}

const sortedBeats = [...byBeat.keys()].sort((a, b) => a - b);

// Show first 6 beats with NCT flags + structuralNotes result
for (const ab of sortedBeats.slice(0, 6)) {
    const evNotes = byBeat.get(ab) || [];
    const mi = Math.floor(ab / beatsPerMeasure);
    const bt = ab - mi * beatsPerMeasure;
    
    console.log(`\n=== m${mi + 1} b${bt + 1} (absBeat=${ab}) ===`);
    for (const n of evNotes.sort((a: any, b: any) => (a.voice ?? 0) - (b.voice ?? 0))) {
        const flags = [];
        if ((n as any).isNeighbor) flags.push('neighbor');
        if ((n as any).isAnticipation) flags.push('anticipation');
        if ((n as any).isAppoggiatura) flags.push('appoggiatura');
        if ((n as any).isPassing) flags.push('passing');
        if ((n as any).isSuspension) flags.push('suspension');
        if ((n as any).ornamentType) flags.push(`orn:${(n as any).ornamentType}`);
        console.log(`  v${n.voice} ${n.pitch} midi=${n.midi} noteIdx=${n.noteIndex} ${flags.length ? '[' + flags.join(',') + ']' : ''}`);
    }
    
    const struct = structuralNotes(evNotes);
    console.log(`  structural: [${struct.map((n: any) => n.pitch).join(',')}]`);
    
    const rAm = getRomanAnalysis(struct, 'A', true);
    console.log(`  Am roman: ${rAm?.roman || '?'}`);
    
    // Also test directly with all notes
    const rAmAll = getRomanAnalysis(evNotes as any, 'A', true);
    console.log(`  Am roman (all): ${rAmAll?.roman || '?'}`);
}
