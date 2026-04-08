import * as fs from 'fs';
import { applyHarmonyRules, getKeySignature, getActiveNotesTimeline } from '../src/utils/musicTheory';

const d = JSON.parse(fs.readFileSync('tests/Delamont C37 3b.htp', 'utf8'));
const ks = getKeySignature(d.keySignatureRoot || 'C', 'Major');
const ts = d.timeSignature || { numerator: 4, denominator: 4 };

const res = applyHarmonyRules(
    d.notes, ks, d.keySignatureRoot || 'C', !!d.isMinorMode,
    d.analysisContexts || [], ts, d.doubleBarlineMeasures || [],
    d.ornamentOverrides || []
) as any;

const notes = res.analyzedNotes || [];
const timeline = getActiveNotesTimeline(notes, ts);

for (const ev of timeline) {
    const abs = Number(ev.absBeat);
    if (abs < 10 || abs > 12) continue;
    const m = Math.floor(abs / 4) + 1;
    const b = (abs % 4) + 1;
    const evNotes = (ev.notes || []).filter((n: any) => n && !n.isRest);
    
    console.log(`\nm${m} b${b} abs=${abs}:`);
    for (const n of evNotes) {
        const s = (n as any).isSuspension;
        const susp = s ? `SUSP(type=${s.type} from=${s.fromAbsBeat} resolvedById=${s.resolvedById} resolvedMidi=${s.resolvedMidi})` : '';
        console.log(`  ${n.pitch}${n.accidental||''}${n.octave} v${n.voice} midi=${n.midi} beat=${n.beat} mIdx=${n.measureIndex} ${susp}`);
    }
    
    // Check for resolutions at this beat
    const resolvingHere = evNotes.filter((n: any) => {
        const s = (n as any)?.isSuspension;
        if (!s || typeof s.resolvedById !== 'string') return false;
        return !!(ev.notes && ev.notes.find((nn: any) => nn.id === s.resolvedById));
    });
    if (resolvingHere.length) {
        console.log(`  >> RESOLVING: ${resolvingHere.map((n: any) => n.pitch + (n.accidental||'') + n.octave + ' type=' + n.isSuspension.type).join(', ')}`);
    }
}
