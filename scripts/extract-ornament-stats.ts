#!/usr/bin/env npx tsx
/**
 * extract-ornament-stats.ts
 *
 * Phase 1 of the Ornament Pattern Learning system.
 *
 * Reads every project file in tests/, finds user-applied ornamentOverrides,
 * extracts a "geometric pattern" for each one (duration, beat strength,
 * entry/exit interval, voice, consonance, …), and writes a statistical
 * database to  src/data/ornamentLearning.json.
 *
 * Run:  npx tsx scripts/extract-ornament-stats.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Note {
    id: string;
    pitch: string;
    octave: number;
    midi: number;
    voice: number;
    beat: number;
    measureIndex: number;
    duration: string;
    isDotted?: boolean;
    isTriplet?: boolean;
    isDuplet?: boolean;
    startTick?: number;
    isRest?: boolean;
}

interface Override {
    noteId: string;
    type: string;          // "passing" | "neighbor" | "appoggiatura" | "anticipation" | "escape" | "structural"
    midi?: number;
    measureIndex?: number;
    beat?: number;
}

interface TimeSig { numerator: number; denominator: number }

interface Project {
    notes: Note[];
    ornamentOverrides?: Override[];
    timeSignature?: TimeSig;
    keySignatureRoot?: string;
    isMinorMode?: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DURATION_VALUES: Record<string, number> = {
    whole: 4,
    half: 2,
    quarter: 1,
    eighth: 0.5,
    sixteenth: 0.25,
    'thirty-second': 0.125,
    'sixty-fourth': 0.0625,
};

/** Consonant intervals (mod 12): P1, m3, M3, P4, P5, m6, M6 */
const CONSONANT_INTERVALS = new Set([0, 3, 4, 5, 7, 8, 9]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getDurationValue(dur: string, isDotted?: boolean, isTriplet?: boolean, isDuplet?: boolean): number {
    let val = DURATION_VALUES[dur] ?? 1;
    if (isDotted) val *= 1.5;
    if (isTriplet) val *= 2 / 3;
    if (isDuplet) val *= 3 / 2;
    return val;
}

function beatStrength(beat: number, ts: TimeSig): 'strong' | 'moderate' | 'weak' {
    // Subdivision → always weak
    if (beat !== Math.floor(beat)) return 'weak';

    const num = ts.numerator;
    const den = ts.denominator;

    // Simple meters
    if (num === 4 && den === 4) return (beat === 1 || beat === 3) ? 'strong' : 'moderate';
    if (num === 3 && den === 4) return beat === 1 ? 'strong' : 'weak';
    if (num === 2 && den === 4) return beat === 1 ? 'strong' : 'weak';
    if (num === 2 && den === 2) return beat === 1 ? 'strong' : 'weak';

    // Compound meters
    if (num === 6 && den === 8) return (beat === 1 || beat === 4) ? 'strong' : 'weak';
    if (num === 9 && den === 8) return (beat === 1 || beat === 4 || beat === 7) ? 'strong' : 'weak';
    if (num === 12 && den === 8) return (beat === 1 || beat === 4 || beat === 7 || beat === 10) ? 'strong' : 'weak';

    // Default: beat 1 strong, rest weak
    return beat === 1 ? 'strong' : 'weak';
}

function intervalBucket(semitones: number): string {
    if (semitones === 0) return 'unison';
    const abs = Math.abs(semitones);
    const dir = semitones > 0 ? 'up' : 'down';
    if (abs <= 2) return `step-${dir}`;
    if (abs <= 4) return `skip-${dir}`;    // 3rds
    return `leap-${dir}`;                   // 4ths and larger
}

function durationCategory(dur: string): string {
    switch (dur) {
        case 'sixty-fourth':
        case 'thirty-second':
        case 'sixteenth': return 'very-short';
        case 'eighth':    return 'short';
        case 'quarter':   return 'medium';
        case 'half':
        case 'whole':     return 'long';
        default:          return 'medium';
    }
}

// ─── Main ────────────────────────────────────────────────────────────────────

const testsDir = path.resolve(__dirname, '..', 'tests');
const jsonFiles = fs.readdirSync(testsDir).filter(f => f.endsWith('.json') || f.endsWith('.htp'));

console.log(`\n🎵  Ornament Pattern Extractor`);
console.log(`   Scanning ${jsonFiles.length} files in tests/\n`);

const patterns: Record<string, Record<string, number>> = {};
const detailedPatterns: Record<string, Record<string, number>> = {};
let totalSamples = 0;
let totalFiles = 0;
const samples: any[] = [];
const typeCounts: Record<string, number> = {};

for (const file of jsonFiles) {
    let proj: Project;
    try {
        const raw = fs.readFileSync(path.join(testsDir, file), 'utf-8');
        proj = JSON.parse(raw);
    } catch {
        // Not valid JSON – skip silently (e.g. binary .htp)
        continue;
    }

    if (!proj.ornamentOverrides?.length || !proj.notes?.length) continue;
    totalFiles++;

    const ts: TimeSig = proj.timeSignature || { numerator: 4, denominator: 4 };
    const noteById = new Map<string, Note>();
    for (const n of proj.notes) {
        if (n?.id) noteById.set(n.id, n);
    }

    // Build voice chains (sorted by tick / measure+beat)
    const voiceChains = new Map<number, Note[]>();
    for (const n of proj.notes) {
        if (!n || n.isRest) continue;
        const v = n.voice ?? 1;
        if (!voiceChains.has(v)) voiceChains.set(v, []);
        voiceChains.get(v)!.push(n);
    }
    for (const chain of voiceChains.values()) {
        chain.sort((a, b) => {
            const ta = a.startTick ?? (a.measureIndex * 10000 + a.beat * 100);
            const tb = b.startTick ?? (b.measureIndex * 10000 + b.beat * 100);
            return ta - tb;
        });
    }

    // Bass MIDI at each (measureIndex, beat) for consonance check
    const bassAtBeat = new Map<string, number>();
    const bassChain = voiceChains.get(4) || [];
    for (const bn of bassChain) {
        bassAtBeat.set(`${bn.measureIndex}-${bn.beat}`, bn.midi);
    }

    for (const ov of proj.ornamentOverrides) {
        if (!ov?.noteId || !ov?.type) continue;
        if (ov.type === 'structural') continue;   // "structural" is an undo, not a pattern

        const n = noteById.get(ov.noteId);
        if (!n || n.isRest) continue;

        const v = n.voice ?? 1;
        const chain = voiceChains.get(v) || [];
        const idx = chain.findIndex(c => c.id === n.id);

        // Predecessor / successor in same voice
        const prev = idx > 0 ? chain[idx - 1] : null;
        const next = idx >= 0 && idx < chain.length - 1 ? chain[idx + 1] : null;

        // Intervals
        const entryInterval = prev ? (n.midi - prev.midi) : null;
        const exitInterval  = next ? (next.midi - n.midi) : null;

        // Beat strength
        const bs = beatStrength(n.beat, ts);

        // Duration
        const dur = n.duration || 'quarter';
        const durCat = durationCategory(dur);
        const durVal = getDurationValue(dur, n.isDotted, n.isTriplet, n.isDuplet);

        // Duration ratio vs predecessor
        const prevDurVal = prev ? getDurationValue(prev.duration || 'quarter', prev.isDotted, prev.isTriplet, prev.isDuplet) : null;
        const durationRatio = prevDurVal && prevDurVal > 0 ? durVal / prevDurVal : null;
        const durationRatioCategory = durationRatio == null ? 'unknown'
            : durationRatio < 0.4 ? 'much-shorter'
            : durationRatio < 0.8 ? 'shorter'
            : durationRatio < 1.25 ? 'same'
            : durationRatio < 2.5 ? 'longer'
            : 'much-longer';

        // Consonance vs bass
        const bassMidi = bassAtBeat.get(`${n.measureIndex}-${n.beat}`);
        let isDissonantVsBass: boolean | null = null;
        if (bassMidi != null && v !== 4) {
            const interval = Math.abs(n.midi - bassMidi) % 12;
            isDissonantVsBass = !CONSONANT_INTERVALS.has(interval);
        }

        // ── Pattern keys ──
        const entryBucket = entryInterval != null ? intervalBucket(entryInterval) : 'none';
        const exitBucket  = exitInterval != null ? intervalBucket(exitInterval) : 'none';

        // Compact key (for statistical aggregation)
        const patternKey = `${durCat}_${bs}_${entryBucket}_${exitBucket}`;

        // Detailed key (includes voice + consonance for finer analysis)
        const detailedKey = `${durCat}_${bs}_${entryBucket}_${exitBucket}_v${v}_${isDissonantVsBass ? 'diss' : isDissonantVsBass === false ? 'cons' : 'unk'}_${durationRatioCategory}`;

        // Record compact pattern
        if (!patterns[patternKey]) patterns[patternKey] = {};
        patterns[patternKey][ov.type] = (patterns[patternKey][ov.type] || 0) + 1;

        // Record detailed pattern
        if (!detailedPatterns[detailedKey]) detailedPatterns[detailedKey] = {};
        detailedPatterns[detailedKey][ov.type] = (detailedPatterns[detailedKey][ov.type] || 0) + 1;

        // Global type counts
        typeCounts[ov.type] = (typeCounts[ov.type] || 0) + 1;

        totalSamples++;

        samples.push({
            file,
            noteId: n.id,
            type: ov.type,
            patternKey,
            detailedKey,
            pitch: `${n.pitch}${n.octave}`,
            midi: n.midi,
            voice: v,
            duration: dur,
            durationCategory: durCat,
            beat: n.beat,
            measureIndex: n.measureIndex,
            beatStrength: bs,
            entryInterval,
            exitInterval,
            entryBucket,
            exitBucket,
            durationRatio: durationRatio ? +durationRatio.toFixed(3) : null,
            durationRatioCategory,
            isDissonantVsBass,
        });
    }

    console.log(`  ✓ ${file}: ${proj.ornamentOverrides.length} overrides`);
}

// ── Build final output ──────────────────────────────────────────────────────

function addTotals(pats: Record<string, Record<string, number>>) {
    const result: Record<string, any> = {};
    for (const [key, counts] of Object.entries(pats)) {
        const total = Object.values(counts).reduce((s, v) => s + v, 0);
        // Compute dominant type and its probability
        let maxType = '';
        let maxCount = 0;
        for (const [t, c] of Object.entries(counts)) {
            if (c > maxCount) { maxType = t; maxCount = c; }
        }
        result[key] = {
            ...counts,
            _total: total,
            _dominant: maxType,
            _probability: total > 0 ? +(maxCount / total).toFixed(3) : 0,
        };
    }
    // Sort by total descending
    return Object.fromEntries(
        Object.entries(result).sort((a, b) => (b[1] as any)._total - (a[1] as any)._total)
    );
}

const output = {
    version: 1,
    extractedAt: new Date().toISOString().slice(0, 10),
    totalFiles,
    totalSamples,
    typeCounts,
    patterns: addTotals(patterns),
    detailedPatterns: addTotals(detailedPatterns),
    samples,
};

const outDir = path.resolve(__dirname, '..', 'src', 'data');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'ornamentLearning.json');
fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

// ── Auto-generate ornamentPatterns.ts ────────────────────────────────────────
const tsLines: string[] = [
    '// Auto-generated by scripts/extract-ornament-stats.ts — re-run with:',
    '//   npm run extract-ornament-stats',
    '// DO NOT EDIT MANUALLY.',
    '',
    'export const ORNAMENT_LEARNED_PATTERNS: Record<string, {',
    '    _total: number; _dominant: string; _probability: number;',
    '    [type: string]: string | number;',
    '}> = {',
];
for (const [key, counts] of Object.entries(patterns)) {
    const total = Object.values(counts as Record<string, number>).reduce((s, v) => s + v, 0);
    let dominant = '';
    let maxCount = 0;
    for (const [t, c] of Object.entries(counts as Record<string, number>)) {
        if ((c as number) > maxCount) { maxCount = c as number; dominant = t; }
    }
    const probability = total > 0 ? Math.round((maxCount / total) * 1000) / 1000 : 0;
    const parts: string[] = [];
    for (const [t, c] of Object.entries(counts as Record<string, number>)) {
        parts.push(`"${t}": ${c}`);
    }
    parts.push(`"_total": ${total}`);
    parts.push(`"_dominant": "${dominant}"`);
    parts.push(`"_probability": ${probability}`);
    tsLines.push(`    "${key}": { ${parts.join(', ')} },`);
}
tsLines.push('};');
tsLines.push('');
const tsPath = path.join(outDir, 'ornamentPatterns.ts');
fs.writeFileSync(tsPath, tsLines.join('\n'));

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(60)}`);
console.log(`✅  Ornament Pattern Learning — Phase 1 Complete`);
console.log(`${'═'.repeat(60)}`);
console.log(`   Files scanned:     ${jsonFiles.length}`);
console.log(`   Files with data:   ${totalFiles}`);
console.log(`   Total samples:     ${totalSamples}`);
console.log(`   Compact patterns:  ${Object.keys(patterns).length}`);
console.log(`   Detailed patterns: ${Object.keys(detailedPatterns).length}`);
console.log(`\n   Type distribution:`);
for (const [t, c] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`     ${t.padEnd(16)} ${c} (${(c / totalSamples * 100).toFixed(1)}%)`);
}
console.log(`\n   Top compact patterns (by frequency):`);
const sortedPatterns = Object.entries(patterns)
    .map(([k, counts]) => ({ key: k, total: Object.values(counts).reduce((s, v) => s + v, 0), counts }))
    .sort((a, b) => b.total - a.total);
for (const p of sortedPatterns.slice(0, 15)) {
    const parts = Object.entries(p.counts).map(([t, c]) => `${t}:${c}`).join(', ');
    console.log(`     ${p.key.padEnd(45)} ${String(p.total).padStart(3)}  (${parts})`);
}
console.log(`\n   Output: ${outPath}`);
console.log(`           ${tsPath}`);
console.log();
