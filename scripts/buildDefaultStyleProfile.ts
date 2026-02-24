#!/usr/bin/env npx tsx
/**
 * buildDefaultStyleProfile.ts
 *
 * Reads all .json / .htp test files from tests/, extracts a StyleProfile
 * from each, merges them, and writes the result to
 * src/engine/defaultStyleProfile.json.
 *
 * Usage:  npx tsx scripts/buildDefaultStyleProfile.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Inline the extraction logic (can't import .ts from engine in raw tsx
//    without the full Vite pipeline, so we duplicate the minimal needed code) ──

const MIN_SAMPLES = 5;
const DIATONIC_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function noteNameToPc(name: string): number {
  const letter = name.charAt(0).toUpperCase();
  const base = DIATONIC_PC[letter];
  if (base == null) return 0;
  let offset = 0;
  for (const c of name.slice(1)) {
    if (c === '#' || c === '♯') offset++;
    else if (c === 'b' || c === '♭') offset--;
  }
  return ((base + offset) % 12 + 12) % 12;
}

function buildScalePcs(tonic: string, isMinor: boolean): number[] {
  const root = noteNameToPc(tonic);
  const intervals = isMinor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  return intervals.map(i => (root + i) % 12);
}

function classifyMotion(semitones: number): 'commonTone' | 'step' | 'skip' | 'leap' {
  if (semitones === 0) return 'commonTone';
  if (semitones <= 2) return 'step';
  if (semitones <= 4) return 'skip';
  return 'leap';
}

function pcToScaleDegree(pc: number, scalePcs: number[]): number {
  for (let i = 0; i < scalePcs.length; i++) {
    if (scalePcs[i] === pc) return i;
  }
  let best = 0, bestDist = 12;
  for (let i = 0; i < scalePcs.length; i++) {
    const d = Math.min(Math.abs(pc - scalePcs[i]), 12 - Math.abs(pc - scalePcs[i]));
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}

const DEGREE_NAMES_MAJOR = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];
const DEGREE_NAMES_MINOR = ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'];
function degreeName(degree: number, isMinor: boolean): string {
  return (isMinor ? DEGREE_NAMES_MINOR : DEGREE_NAMES_MAJOR)[degree % 7] || `${degree}`;
}

// ── Types ──
interface MotionStats { commonTone: number; step: number; skip: number; leap: number; total: number; }
interface DoublingStats { root: number; third: number; fifth: number; total: number; }
interface ContraryMotionStats { contrary: number; parallel: number; oblique: number; total: number; }
interface InversionStats { counts: Record<number, number>; total: number; }
interface StyleProfile {
  inversionByDegree: Record<string, InversionStats>;
  motionByVoice: Record<string, MotionStats>;
  contraryMotion: ContraryMotionStats;
  bassMotion: { sumSemitones: number; count: number };
  doubling: DoublingStats;
  lastUpdated: string;
  filesAnalyzed: number;
}

function createEmptyProfile(): StyleProfile {
  return {
    inversionByDegree: {},
    motionByVoice: {
      soprano: { commonTone: 0, step: 0, skip: 0, leap: 0, total: 0 },
      alto:    { commonTone: 0, step: 0, skip: 0, leap: 0, total: 0 },
      tenor:   { commonTone: 0, step: 0, skip: 0, leap: 0, total: 0 },
      bass:    { commonTone: 0, step: 0, skip: 0, leap: 0, total: 0 },
    },
    contraryMotion: { contrary: 0, parallel: 0, oblique: 0, total: 0 },
    bassMotion: { sumSemitones: 0, count: 0 },
    doubling: { root: 0, third: 0, fifth: 0, total: 0 },
    lastUpdated: '',
    filesAnalyzed: 0,
  };
}

function mergeProfiles(existing: StyleProfile | null, incoming: StyleProfile): StyleProfile {
  if (!existing) return { ...incoming };
  const merged = createEmptyProfile();
  const allDegrees = new Set([...Object.keys(existing.inversionByDegree), ...Object.keys(incoming.inversionByDegree)]);
  for (const deg of allDegrees) {
    const e = existing.inversionByDegree[deg];
    const n = incoming.inversionByDegree[deg];
    merged.inversionByDegree[deg] = { counts: {}, total: 0 };
    const allInv = new Set([...Object.keys(e?.counts || {}), ...Object.keys(n?.counts || {})]);
    for (const inv of allInv) {
      const ni = Number(inv);
      merged.inversionByDegree[deg].counts[ni] = ((e?.counts[ni]) || 0) + ((n?.counts[ni]) || 0);
    }
    merged.inversionByDegree[deg].total = (e?.total || 0) + (n?.total || 0);
  }
  for (const voice of ['soprano', 'alto', 'tenor', 'bass'] as const) {
    const e = existing.motionByVoice[voice] || { commonTone: 0, step: 0, skip: 0, leap: 0, total: 0 };
    const n = incoming.motionByVoice[voice] || { commonTone: 0, step: 0, skip: 0, leap: 0, total: 0 };
    merged.motionByVoice[voice] = { commonTone: e.commonTone + n.commonTone, step: e.step + n.step, skip: e.skip + n.skip, leap: e.leap + n.leap, total: e.total + n.total };
  }
  merged.contraryMotion = { contrary: existing.contraryMotion.contrary + incoming.contraryMotion.contrary, parallel: existing.contraryMotion.parallel + incoming.contraryMotion.parallel, oblique: existing.contraryMotion.oblique + incoming.contraryMotion.oblique, total: existing.contraryMotion.total + incoming.contraryMotion.total };
  merged.bassMotion = { sumSemitones: existing.bassMotion.sumSemitones + incoming.bassMotion.sumSemitones, count: existing.bassMotion.count + incoming.bassMotion.count };
  merged.doubling = { root: existing.doubling.root + incoming.doubling.root, third: existing.doubling.third + incoming.doubling.third, fifth: existing.doubling.fifth + incoming.doubling.fifth, total: existing.doubling.total + incoming.doubling.total };
  merged.filesAnalyzed = existing.filesAnalyzed + incoming.filesAnalyzed;
  merged.lastUpdated = new Date().toISOString();
  return merged;
}

interface BeatSnapshot {
  bass: number; tenor: number; alto: number; soprano: number;
  pcs: Set<number>; rootPc: number; inversion: number; degree: number;
}

function extractFromNotes(notes: any[], tonic: string, isMinor: boolean, beatsPerMeasure: number): StyleProfile {
  const profile = createEmptyProfile();
  const scalePcs = buildScalePcs(tonic, isMinor);

  const byAbsBeat = new Map<number, Map<number, number>>();
  for (const n of (notes || [])) {
    if (!n || n.isRest) continue;
    const mi = Number(n.measureIndex ?? 0);
    const bt = Number(n.beat ?? 1);
    const abs = mi * beatsPerMeasure + bt;
    const q = Math.round(abs * 192) / 192;
    const voice = Number(n.voice ?? 0);
    if (voice < 1 || voice > 4) continue;
    const midi = Number(n.midi);
    if (!Number.isFinite(midi) || midi <= 0) continue;
    if (!byAbsBeat.has(q)) byAbsBeat.set(q, new Map());
    byAbsBeat.get(q)!.set(voice, midi);
  }

  const sortedBeats = [...byAbsBeat.keys()].sort((a, b) => a - b);
  const snapshots: BeatSnapshot[] = [];

  for (const ab of sortedBeats) {
    const voices = byAbsBeat.get(ab)!;
    if (voices.size < 4) continue;
    const soprano = voices.get(1)!;
    const alto = voices.get(2)!;
    const tenor = voices.get(3)!;
    const bass = voices.get(4)!;
    const pcs = new Set([soprano, alto, tenor, bass].map(m => ((m % 12) + 12) % 12));
    const bassPc = ((bass % 12) + 12) % 12;

    let rootPc = bassPc, inversion = 0, degree = pcToScaleDegree(bassPc, scalePcs);
    for (let d = 0; d < 7; d++) {
      const root = scalePcs[d];
      const third = scalePcs[(d + 2) % 7];
      const fifth = scalePcs[(d + 4) % 7];
      let matchCount = 0;
      for (const pc of pcs) { if (pc === root || pc === third || pc === fifth) matchCount++; }
      if (matchCount < 3) continue;
      rootPc = root; degree = d;
      if (bassPc === root) inversion = 0;
      else if (bassPc === third) inversion = 1;
      else if (bassPc === fifth) inversion = 2;
      else inversion = 0;
      break;
    }
    snapshots.push({ bass, tenor, alto, soprano, pcs, rootPc, inversion, degree });
  }

  for (let i = 0; i < snapshots.length; i++) {
    const snap = snapshots[i];
    const degreeKey = degreeName(snap.degree, isMinor);

    if (!profile.inversionByDegree[degreeKey]) profile.inversionByDegree[degreeKey] = { counts: {}, total: 0 };
    const invStats = profile.inversionByDegree[degreeKey];
    invStats.counts[snap.inversion] = (invStats.counts[snap.inversion] || 0) + 1;
    invStats.total++;

    const midiArr = [snap.bass, snap.tenor, snap.alto, snap.soprano];
    const pcArr = midiArr.map(m => ((m % 12) + 12) % 12);
    const thirdPc = scalePcs[(snap.degree + 2) % 7];
    const fifthPc = scalePcs[(snap.degree + 4) % 7];
    for (const pc of pcArr) {
      if (pc === snap.rootPc) profile.doubling.root++;
      else if (pc === thirdPc) profile.doubling.third++;
      else if (pc === fifthPc) profile.doubling.fifth++;
    }
    profile.doubling.total += 4;

    if (i === 0) continue;
    const prev = snapshots[i - 1];
    const voiceNames = ['soprano', 'alto', 'tenor', 'bass'] as const;
    const currMidi = [snap.soprano, snap.alto, snap.tenor, snap.bass];
    const prevMidi = [prev.soprano, prev.alto, prev.tenor, prev.bass];

    for (let v = 0; v < 4; v++) {
      const dist = Math.abs(currMidi[v] - prevMidi[v]);
      const motionType = classifyMotion(dist);
      profile.motionByVoice[voiceNames[v]][motionType]++;
      profile.motionByVoice[voiceNames[v]].total++;
    }
    profile.bassMotion.sumSemitones += Math.abs(snap.bass - prev.bass);
    profile.bassMotion.count++;
    const sopDir = Math.sign(snap.soprano - prev.soprano);
    const bassDir = Math.sign(snap.bass - prev.bass);
    if (sopDir !== 0 && bassDir !== 0) {
      if (sopDir !== bassDir) profile.contraryMotion.contrary++;
      else profile.contraryMotion.parallel++;
    } else if (sopDir !== 0 || bassDir !== 0) {
      profile.contraryMotion.oblique++;
    }
    profile.contraryMotion.total++;
  }

  profile.filesAnalyzed = 1;
  profile.lastUpdated = new Date().toISOString();
  return profile;
}

// ── Main ──
const testsDir = path.resolve(__dirname, '..', 'tests');
const outPath = path.resolve(__dirname, '..', 'src', 'engine', 'defaultStyleProfile.json');

const files = fs.readdirSync(testsDir).filter(f => f.endsWith('.json') || f.endsWith('.htp'));
console.log(`Found ${files.length} test files in ${testsDir}`);

let merged: StyleProfile | null = null;
let ok = 0, skip = 0;

for (const file of files) {
  try {
    const raw = fs.readFileSync(path.join(testsDir, file), 'utf-8');
    const data = JSON.parse(raw);
    const notes = data.notes || data.rawNotes || [];
    const tonic = data.keySignatureRoot || 'C';
    const isMinor = !!data.isMinorMode;
    const ts = data.timeSignature || { numerator: 4, denominator: 4 };
    const beatsPerMeasure = ts.numerator * (4 / ts.denominator);

    // Only process files with enough 4-voice beats
    const nonRest = notes.filter((n: any) => n && !n.isRest && Number.isFinite(n.midi) && n.midi > 0);
    const voices = new Set(nonRest.map((n: any) => n.voice));
    if (voices.size < 4 || nonRest.length < 16) {
      skip++;
      continue;
    }

    const profile = extractFromNotes(notes, tonic, isMinor, beatsPerMeasure);
    // Only merge if we got meaningful data (at least some snapshots)
    if (profile.contraryMotion.total > 0 || Object.keys(profile.inversionByDegree).length > 0) {
      merged = mergeProfiles(merged, profile);
      ok++;
      console.log(`  ✅ ${file} — ${profile.contraryMotion.total + 1} snapshots`);
    } else {
      skip++;
    }
  } catch (err: any) {
    console.log(`  ⚠️  ${file} — skipped (${err.message?.slice(0, 60)})`);
    skip++;
  }
}

if (merged) {
  merged.lastUpdated = new Date().toISOString();
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2), 'utf-8');
  console.log(`\n✅ Profile written to ${outPath}`);
  console.log(`   ${ok} files analyzed, ${skip} skipped`);
  console.log(`   ${merged.filesAnalyzed} total files in profile`);
  console.log(`   Contrary motion observations: ${merged.contraryMotion.total}`);
  console.log(`   Avg bass motion: ${(merged.bassMotion.sumSemitones / Math.max(1, merged.bassMotion.count)).toFixed(1)} semitones`);

  // Print a summary
  console.log('\n── Motion Distribution ──');
  for (const v of ['soprano', 'alto', 'tenor', 'bass']) {
    const m = merged.motionByVoice[v];
    if (!m || m.total === 0) continue;
    console.log(`  ${v}: commonTone ${(m.commonTone / m.total * 100).toFixed(0)}%, step ${(m.step / m.total * 100).toFixed(0)}%, skip ${(m.skip / m.total * 100).toFixed(0)}%, leap ${(m.leap / m.total * 100).toFixed(0)}%`);
  }
  console.log('\n── Inversion Distribution ──');
  for (const [deg, stats] of Object.entries(merged.inversionByDegree)) {
    if (stats.total < 5) continue;
    const parts = Object.entries(stats.counts).map(([inv, cnt]) => `${inv === '0' ? 'root' : inv === '1' ? '1st' : '2nd'}:${(cnt / stats.total * 100).toFixed(0)}%`);
    console.log(`  ${deg}: ${parts.join(', ')} (n=${stats.total})`);
  }
} else {
  console.log('\n❌ No valid files found — no profile generated.');
}
