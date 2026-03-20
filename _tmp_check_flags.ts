import * as fs from 'fs';
import { applyHarmonyRules } from './src/utils/musicTheory';

const data = JSON.parse(fs.readFileSync('tests/Delachi n2 p36:71.htp', 'utf8'));
const notes = data.notes || [];
const ts = data.timeSignature || { numerator: 3, denominator: 2 };
const ks = { tonic: 'Ab', mode: 'Major', sharpsOrFlats: -4 };
const result = applyHarmonyRules(notes, ks as any, 'Ab', false, [], ts);
const analyzed = result.analyzedNotes || [];
const bpm = ts.numerator * (4 / ts.denominator);

for (const n of analyzed) {
    const ab = (n.measureIndex || 0) * bpm + ((n.beat || 1) - 1);
    if ([30, 42, 78].some(t => Math.abs(ab - t) < 0.1)) {
        const flags: string[] = [];
        if ((n as any).isPassing) flags.push('P');
        if ((n as any).isNeighbor) flags.push('N');
        if ((n as any).isAppoggiatura) flags.push('App');
        if ((n as any).isAnticipation) flags.push('Ant');
        if ((n as any).isEscape) flags.push('Esc');
        if ((n as any).isSuspension) {
            const s = (n as any).isSuspension;
            flags.push('Sus:fromAb=' + s.fromAbsBeat + ' resM=' + s.resolvedMidi + ' resP=' + s.resolvedPitch + (s.resolvedAccidental||''));
        }
        if ((n as any).isTiedToNext) flags.push('tie→');
        if ((n as any).isTiedFromPrev) flags.push('←tie');
        console.log(`ab=${ab.toFixed(1)} v${n.voice || 1} midi=${n.midi} ${n.pitch}${(n as any).accidental || ''}${n.octave} dur=${n.duration} [${flags.join(',')}]`);
    }
}
