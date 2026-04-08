/**
 * Profile applyHarmonyRules to find the slowest phases.
 * Usage: npx tsx scripts/_profile_analysis.ts [testfile.json]
 */
import { applyHarmonyRules, getKeySignature } from '../src/utils/musicTheory';

const file = process.argv[2] || './tests/Cantata 17 Bach.json';
import { readFileSync } from 'fs';
import { resolve } from 'path';
const proj = JSON.parse(readFileSync(resolve(file), 'utf-8'));

const notes = (proj as any).notes || [];
const ts = (proj as any).timeSignature;
const tonic = String((proj as any).keySignatureRoot || 'C');
const isMinor = Boolean((proj as any).isMinorMode);
const keySig = getKeySignature(tonic, isMinor ? 'Minor' : 'Major');
const contexts = (proj as any).analysisContexts || [];
const dblBars = (proj as any).doubleBarlineMeasures;

// Warm up (JIT)
applyHarmonyRules(notes as any, keySig as any, tonic, isMinor, contexts, ts as any, dblBars);

// Profile
const RUNS = 3;
const times: number[] = [];
for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    applyHarmonyRules(notes as any, keySig as any, tonic, isMinor, contexts, ts as any, dblBars);
    times.push(performance.now() - t0);
}

const avg = times.reduce((s, t) => s + t, 0) / times.length;
console.log(`File: ${file}`);
console.log(`Notes: ${notes.length}`);
console.log(`Runs: ${RUNS}, avg=${avg.toFixed(0)}ms, min=${Math.min(...times).toFixed(0)}ms, max=${Math.max(...times).toFixed(0)}ms`);

// Profile with internal markers (set env flag)
(globalThis as any).__HARMONY_PROFILE = true;
const t0 = performance.now();
const result = applyHarmonyRules(notes as any, keySig as any, tonic, isMinor, contexts, ts as any, dblBars);
console.log(`\nProfiled run: ${(performance.now() - t0).toFixed(0)}ms`);

// Show internal timings if collected
if ((globalThis as any).__HARMONY_TIMINGS) {
    const timings = (globalThis as any).__HARMONY_TIMINGS as Record<string, number>;
    const sorted = Object.entries(timings).sort((a, b) => b[1] - a[1]);
    console.log('\n--- Phase timings (sorted by duration) ---');
    for (const [phase, ms] of sorted) {
        console.log(`  ${ms.toFixed(1).padStart(8)}ms  ${phase}`);
    }
}
