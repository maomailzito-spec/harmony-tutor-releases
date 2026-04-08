import * as fs from 'fs';
import { applyHarmonyRules, getKeySignature } from '../src/utils/musicTheory';

const d = JSON.parse(fs.readFileSync('tests/Gloria Vivaldi.json', 'utf8'));
console.log('Notes:', (d.notes || []).length);
console.log('Key:', d.keySignatureRoot, 'minor:', d.isMinorMode);

const ks = getKeySignature(d.keySignatureRoot || 'C', 'Major');
const ts = d.timeSignature || { numerator: 4, denominator: 4 };

const t0 = Date.now();
console.log('Starting applyHarmonyRules...');
const res = applyHarmonyRules(
    d.notes, ks, d.keySignatureRoot || 'C', !!d.isMinorMode,
    d.analysisContexts || [], ts, d.doubleBarlineMeasures || [],
    d.ornamentOverrides || []
);
const elapsed = Date.now() - t0;
const notes = ((res as any).analyzedNotes || res) as any[];
console.log(`Done in ${elapsed}ms, ${notes.length} notes analyzed`);
