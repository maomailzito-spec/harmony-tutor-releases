/**
 * Detailed escape-tone audit: show each escape note with melodic context
 */
import * as fs from 'fs';
import * as path from 'path';
import { applyHarmonyRules, getKeySignature } from '../src/utils/musicTheory';

const targets = [
    'Dubois 2 p 55.htp',
    'Piston 9.19 p147.htp',
    'Cantata 40 bach.json',
    'Dubois Note sfuggite p.214.htp',
];

const dir = 'tests';

for (const f of targets) {
    const fp = path.join(dir, f);
    if (!fs.existsSync(fp)) { console.log(`SKIP: ${f} not found`); continue; }
    const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (!d.notes?.length) continue;
    const ks = getKeySignature(d.keySignatureRoot || 'C', 'Major');
    const ts = d.timeSignature || { numerator: 4, denominator: 4 };
    const res = applyHarmonyRules(
        d.notes, ks, d.keySignatureRoot || 'C', !!d.isMinorMode,
        d.analysisContexts || [], ts, d.doubleBarlineMeasures || [],
        d.ornamentOverrides || []
    );
    const notes = ((res as any).analyzedNotes || res) as any[];

    // Build voice chains for melodic context
    const byVoice = new Map<number, any[]>();
    for (const n of notes) {
        if (!n || n.isRest) continue;
        const v = n.voice ?? 1;
        if (!byVoice.has(v)) byVoice.set(v, []);
        byVoice.get(v)!.push(n);
    }
    for (const ch of byVoice.values()) ch.sort((a: any, b: any) => (a.startTick ?? 0) - (b.startTick ?? 0));

    const escapes = notes.filter((n: any) => n && n.isEscape);
    console.log(`\n=== ${f} — ${escapes.length} escape tones ===`);
    for (const n of escapes) {
        const v = n.voice ?? 1;
        const ch = byVoice.get(v) || [];
        const idx = ch.indexOf(n);
        const prev = idx > 0 ? ch[idx - 1] : null;
        const next = idx < ch.length - 1 ? ch[idx + 1] : null;
        const fmt = (x: any) => x ? `${x.pitch}${x.accidental || ''}${x.octave}` : '?';
        const interval = (a: any, b: any) => a && b ? (b.midi - a.midi) : '?';
        const learned = n.learnedOrnament ? ' [LEARNED]' : '';
        const override = n.ornamentOverride === 'escape' ? ' [OVERRIDE]' : '';
        console.log(
            `  m${(n.measureIndex ?? 0) + 1} b${n.beat} v${v}: ` +
            `${fmt(prev)} →[${interval(prev, n)}]→ ${fmt(n)} →[${interval(n, next)}]→ ${fmt(next)} ` +
            `dur=${n.duration}${learned}${override}`
        );
    }
}
