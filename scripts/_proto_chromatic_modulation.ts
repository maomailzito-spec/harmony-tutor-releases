/**
 * Chromatic-window modulation detector — standalone prototype.
 * Runs on all .htp files in tests/ and reports inferred modulations.
 *
 * Usage:  npx tsx scripts/_proto_chromatic_modulation.ts [file.htp]
 *         (omit file to scan all)
 */
import * as fs from 'fs';
import * as path from 'path';
import { calculateNoteBeats } from '../src/utils/musicTheory';
import { noteNameToPc, getScalePcs } from '../src/utils/cadentialPatterns';

// ── helpers ──────────────────────────────────────────────────────────

const PC_NAMES = ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];

const relativeMinors: Record<string, string> = {
  'C': 'A', 'G': 'E', 'D': 'B', 'A': 'F#', 'E': 'C#', 'B': 'G#',
  'F': 'D', 'Bb': 'G', 'Eb': 'C', 'Ab': 'F', 'Db': 'Bb', 'Gb': 'Eb',
};

/** Build the extended scale set (nat + harm + mel) for minor, or just major. */
function getExtendedScalePcs(tonicPc: number, isMinor: boolean): Set<number> {
  const nat = getScalePcs(tonicPc, isMinor);
  if (!isMinor) return new Set(nat);
  // harmonic: raise 7th
  const harm7 = ((tonicPc + 11) % 12 + 12) % 12;
  // melodic asc: raise 6th+7th
  const mel6 = ((tonicPc + 9) % 12 + 12) % 12;
  return new Set([...nat, harm7, mel6]);
}

/** For each of 24 keys (12 maj + 12 min), return the diatonic pc set. */
function allKeyScales(): { name: string; pcs: Set<number> }[] {
  const results: { name: string; pcs: Set<number> }[] = [];
  for (let pc = 0; pc < 12; pc++) {
    results.push({ name: `${PC_NAMES[pc]} maj`, pcs: new Set(getScalePcs(pc, false)) });
    results.push({ name: `${PC_NAMES[pc]} min`, pcs: getExtendedScalePcs(pc, true) });
  }
  return results;
}

interface ModulationCandidate {
  startMeasure: number;   // 1-based
  endMeasure: number;     // 1-based inclusive
  newKey: string;
  fitPercent: number;
  homeFitPercent: number;
}

// ── core detector ────────────────────────────────────────────────────

function detectChromaticModulations(
  filePath: string,
  opts?: { verbose?: boolean }
): ModulationCandidate[] {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const ts = data.timeSignature || { numerator: 4, denominator: 4 };
  const tsc = data.timeSignatureChanges || [];
  const notes = (calculateNoteBeats(data.notes || [], ts, tsc) as any[]).filter((n: any) => !n.isRest);
  if (notes.length < 8) return [];

  const keyRoot = data.keySignatureRoot || 'C';
  const isMinor = !!data.isMinorMode;
  const tonic = isMinor ? (relativeMinors[keyRoot] || 'A') : keyRoot;
  const tonicPc = noteNameToPc(tonic);
  const homePcs = getExtendedScalePcs(tonicPc, isMinor);

  // Group pc sets by measure
  const byMeasure = new Map<number, Set<number>>();
  for (const n of notes) {
    const m = n.measureIndex as number;
    if (!byMeasure.has(m)) byMeasure.set(m, new Set());
    byMeasure.get(m)!.add(n.midi % 12);
  }

  const measures = [...byMeasure.keys()].sort((a, b) => a - b);
  const keys = allKeyScales();

  // ── sliding window: 2-measure groups → fit score per key ──────────

  const MIN_WINDOW = 3;       // minimum consecutive measures
  const FIT_THRESHOLD = 0.92; // candidate key must explain ≥ 92% of pcs
  const HOME_GAP = 0.20;      // candidate fit must exceed home fit by ≥ 20%

  // For each measure, compute the best-fit non-home key
  interface MeasureScore {
    measure: number;
    bestKey: string;
    bestFit: number;
    homeFit: number;
    pcCount: number;
    outOfHome: number[];
  }

  const measureScores: MeasureScore[] = [];
  for (const m of measures) {
    const pcs = byMeasure.get(m)!;
    const pcArr = [...pcs];
    const pcCount = pcArr.length;
    if (pcCount < 2) {
      measureScores.push({ measure: m, bestKey: '', bestFit: 0, homeFit: 1, pcCount, outOfHome: [] });
      continue;
    }

    const homeFit = pcArr.filter(pc => homePcs.has(pc)).length / pcCount;
    const outOfHome = pcArr.filter(pc => !homePcs.has(pc));

    let bestKey = '';
    let bestFit = 0;
    for (const k of keys) {
      // Skip the home key itself
      const isHomeKey = (k.name === `${PC_NAMES[tonicPc]} ${isMinor ? 'min' : 'maj'}`);
      if (isHomeKey) continue;
      const fit = pcArr.filter(pc => k.pcs.has(pc)).length / pcCount;
      if (fit > bestFit) {
        bestFit = fit;
        bestKey = k.name;
      }
    }
    measureScores.push({ measure: m, bestKey, bestFit, homeFit, pcCount, outOfHome });
  }

  // ── find runs of measures where a non-home key dominates ──────────

  const candidates: ModulationCandidate[] = [];
  let runStart = -1;
  let runKey = '';
  let runFitSum = 0;
  let runHomeFitSum = 0;
  let runLen = 0;

  const flushRun = () => {
    if (runLen >= MIN_WINDOW) {
      const avgFit = runFitSum / runLen;
      const avgHomeFit = runHomeFitSum / runLen;
      if (avgFit >= FIT_THRESHOLD && (avgFit - avgHomeFit) >= HOME_GAP) {
        candidates.push({
          startMeasure: runStart + 1,
          endMeasure: runStart + runLen,
          newKey: runKey,
          fitPercent: Math.round(avgFit * 100),
          homeFitPercent: Math.round(avgHomeFit * 100),
        });
      }
    }
    runStart = -1;
    runKey = '';
    runFitSum = 0;
    runHomeFitSum = 0;
    runLen = 0;
  };

  for (const ms of measureScores) {
    const dominated = ms.bestFit >= FIT_THRESHOLD && (ms.bestFit - ms.homeFit) >= HOME_GAP * 0.5;
    if (dominated) {
      if (runKey === '' || runKey === ms.bestKey) {
        if (runStart < 0) runStart = ms.measure;
        runKey = ms.bestKey;
        runFitSum += ms.bestFit;
        runHomeFitSum += ms.homeFit;
        runLen++;
      } else {
        // Different key — flush and start new
        flushRun();
        runStart = ms.measure;
        runKey = ms.bestKey;
        runFitSum = ms.bestFit;
        runHomeFitSum = ms.homeFit;
        runLen = 1;
      }
    } else {
      flushRun();
    }
  }
  flushRun();

  if (opts?.verbose) {
    console.log(`  Home key: ${tonic} ${isMinor ? 'min' : 'maj'} (pcs: [${[...homePcs].sort((a,b)=>a-b)}])`);
    for (const ms of measureScores) {
      const flag = ms.outOfHome.length > 0 ? ` *** outOfHome=[${ms.outOfHome.map(p => PC_NAMES[p])}]` : '';
      console.log(`  m${ms.measure + 1}: homeFit=${(ms.homeFit * 100).toFixed(0)}% bestAlt=${ms.bestKey}@${(ms.bestFit * 100).toFixed(0)}% (${ms.pcCount}pcs)${flag}`);
    }
  }

  return candidates;
}

// ── main ─────────────────────────────────────────────────────────────

const testsDir = path.resolve(__dirname, '../tests');
const targetFile = process.argv[2];

let files: string[];
if (targetFile) {
  files = [path.resolve(testsDir, targetFile)];
} else {
  files = fs.readdirSync(testsDir)
    .filter(f => f.endsWith('.htp') || f.endsWith('.json'))
    .sort()
    .map(f => path.join(testsDir, f));
}

let totalModulations = 0;
for (const fp of files) {
  const name = path.basename(fp);
  try {
    const verbose = !!targetFile; // verbose only for single file
    const mods = detectChromaticModulations(fp, { verbose });
    if (mods.length > 0) {
      console.log(`\n${name}:`);
      for (const m of mods) {
        console.log(`  → m${m.startMeasure}–m${m.endMeasure}: ${m.newKey} (fit=${m.fitPercent}%, homeFit=${m.homeFitPercent}%)`);
      }
      totalModulations += mods.length;
    }
  } catch (e: any) {
    // skip broken files
  }
}

if (!targetFile) {
  console.log(`\n=== Total: ${totalModulations} modulation(s) detected across ${files.length} files ===`);
}
