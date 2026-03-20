import * as fs from 'fs';
import { applyHarmonyRules, getKeySignature } from '../src/utils/musicTheory';

const d = JSON.parse(fs.readFileSync('tests/Dubois 5 p 13.json', 'utf8'));
console.log('Notes:', (d.notes || []).length);
const ks = getKeySignature(d.keySignatureRoot || 'C', 'Major');
const ts = d.timeSignature || { numerator: 4, denominator: 4 };
const t0 = Date.now();
console.log('Starting...');
const res = applyHarmonyRules(d.notes, ks, d.keySignatureRoot || 'C', !!d.isMinorMode, d.analysisContexts || [], ts, d.doubleBarlineMeasures || [], d.ornamentOverrides || []);
console.log(`Done in ${Date.now() - t0}ms`);
