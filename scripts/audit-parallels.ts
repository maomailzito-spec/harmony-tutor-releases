import fs from 'node:fs';
import path from 'node:path';

import {
  applyHarmonyRules,
  getActiveNotesTimeline,
  getKeySignature,
  normalizeNotePitchFieldsWithKey,
} from '../src/utils/musicTheory';

const EPS = 1e-6;
const approxEq = (a: number, b: number, eps = EPS) => Math.abs(a - b) <= eps;
const mod12 = (n: number) => ((n % 12) + 12) % 12;

function usage() {
  console.log(`\
Usage:
  npx tsx scripts/audit-parallels.ts --file <project.json> [--only-misses] [--voices 1,2,3,4] [--max 50]

What it does:
  - Runs the normal harmony engine (same as the app)
  - Independently scans adjacent chord-events for perfect 5ths/8ves in similar motion
  - Reports cases the engine DID NOT flag ("misses")

Examples:
  npx tsx scripts/audit-parallels.ts --file "tests/Bach corale 19.json"
  npx tsx scripts/audit-parallels.ts --file "tests/Bach corale 19.json" --voices 1,4 --max 200
`);
}

function parseNumberList(raw: string): number[] {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n))
    .map((n) => Math.round(n));
}

function parseArgs(argv: string[]) {
  const args = {
    filePath: '',
    onlyMisses: true,
    voices: [1, 2, 3, 4] as number[],
    max: 80,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => (i + 1 < argv.length ? argv[i + 1] : '');

    if (a === '--help' || a === '-h') {
      usage();
      process.exit(0);
    }
    if (a === '--file' || a === '-f') {
      args.filePath = String(next());
      i++;
      continue;
    }
    if (a === '--only-misses') {
      args.onlyMisses = true;
      continue;
    }
    if (a === '--all') {
      args.onlyMisses = false;
      continue;
    }
    if (a === '--voices') {
      const v = parseNumberList(next());
      if (v.length) args.voices = v;
      i++;
      continue;
    }
    if (a === '--max') {
      const n = Number(next());
      if (Number.isFinite(n)) args.max = Math.max(1, Math.round(n));
      i++;
      continue;
    }
  }

  if (!args.filePath) {
    usage();
    process.exit(2);
  }

  return args;
}

type VoiceNote = {
  id: string;
  voice: number;
  midi: number;
  label: string;
};

function dir(a: number, b: number) {
  const d = b - a;
  return d === 0 ? 0 : d > 0 ? 1 : -1;
}

function isPerfectFifth(int: number) {
  return mod12(int) === 7;
}

function isPerfectOctOrUnison(int: number) {
  return mod12(int) === 0;
}

function buildVoiceMap(evNotes: any[], voices: number[]) {
  const map = new Map<number, VoiceNote>();
  const perVoice = new Map<number, any[]>();

  for (const v of voices) perVoice.set(v, []);

  for (const n of (evNotes || [])) {
    const v = Number(n?.voice ?? 1);
    if (!perVoice.has(v)) continue;
    if (!n || n.isRest) continue;
    if (!Number.isFinite(Number(n.midi))) continue;
    perVoice.get(v)!.push(n);
  }

  for (const [v, list] of perVoice.entries()) {
    // Conservative: only consider events where each voice has exactly one active note.
    if (list.length !== 1) continue;
    const n = list[0];
    const pitch = `${String(n.pitch || '?')}${String(n.octave ?? '')}`;
    const label = `v${v} ${pitch}`;
    map.set(v, {
      id: String(n.id ?? ''),
      voice: v,
      midi: Number(n.midi),
      label,
    });
  }

  return map;
}

function setEq(a: Set<string>, b: Set<string>) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const fullPath = path.resolve(process.cwd(), args.filePath);

  if (!fs.existsSync(fullPath)) {
    console.error(`File not found: ${args.filePath}`);
    process.exit(2);
  }

  const proj = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  const notes = (proj as any).notes || [];
  const timeSignature = (proj as any).timeSignature || { numerator: 4, denominator: 4 };
  const timeSignatureChanges = (proj as any).timeSignatureChanges || [];
  const tonic = String((proj as any).keySignatureRoot || 'C');
  const isMinorMode = Boolean((proj as any).isMinorMode);
  const analysisContexts = (proj as any).analysisContexts || [];

  const keySignature = getKeySignature(tonic, isMinorMode ? 'Minor' : 'Major');
  const normalizedNotes = (notes as any[]).map((n) => normalizeNotePitchFieldsWithKey(n as any, keySignature as any));

  const res = applyHarmonyRules(
    normalizedNotes as any,
    keySignature as any,
    tonic,
    isMinorMode,
    analysisContexts as any,
    timeSignature as any,
  );

  const timeline = getActiveNotesTimeline(res.analyzedNotes as any, timeSignature as any, timeSignatureChanges as any);
  const violations = Array.isArray(res.violations) ? res.violations : [];

  const relevantRuleIds = new Set(['R-01', 'R-02', 'R-05', 'EXC-M03', 'EXC-M04', 'EXC-OBL-PERF', 'EXC-Hidden-Stepwise', 'EXC-Hidden-BassStep']);

  const hasEngineFlag = (noteIds: string[], ruleHint: 'R-01' | 'R-02') => {
    const target = new Set(noteIds.map(String));
    for (const v of violations) {
      const rid = String((v as any)?.ruleId || '');
      if (!relevantRuleIds.has(rid)) continue;
      // For octave/fifth parallels we accept either the exact ruleId or an exception that replaces it.
      if (ruleHint === 'R-01') {
        if (rid !== 'R-01') continue;
      } else {
        if (rid !== 'R-02' && rid !== 'EXC-M03' && rid !== 'EXC-M04') continue;
      }
      const ids = Array.isArray((v as any).noteIds) ? (v as any).noteIds.map((x: any) => String(x)) : [];
      if (ids.length < 4) continue;
      const s = new Set(ids);
      if (setEq(s, target)) return true;
    }
    return false;
  };

  const results: Array<{
    status: 'MISS' | 'OK';
    type: 'P8' | 'P5';
    from: { measure: number; beat: number; absBeat: number };
    to: { measure: number; beat: number; absBeat: number };
    voices: [number, number];
    a: [string, string];
    b: [string, string];
    noteIds: string[];
  }> = [];

  for (let i = 0; i < timeline.length - 1; i++) {
    const a = timeline[i];
    const b = timeline[i + 1];
    if (!a || !b) continue;

    const aMap = buildVoiceMap(a.notes as any, args.voices);
    const bMap = buildVoiceMap(b.notes as any, args.voices);

    for (let vi = 0; vi < args.voices.length; vi++) {
      for (let vj = vi + 1; vj < args.voices.length; vj++) {
        const vA = args.voices[vi];
        const vB = args.voices[vj];
        const a1 = aMap.get(vA);
        const a2 = aMap.get(vB);
        const b1 = bMap.get(vA);
        const b2 = bMap.get(vB);
        if (!a1 || !a2 || !b1 || !b2) continue;

        // Only true parallels: both voices actually move (new note ids) and move in similar motion.
        if (a1.id === b1.id) continue;
        if (a2.id === b2.id) continue;

        const d1 = dir(a1.midi, b1.midi);
        const d2 = dir(a2.midi, b2.midi);
        if (d1 === 0 || d2 === 0 || d1 !== d2) continue;

        const intA = mod12(Math.abs(a1.midi - a2.midi));
        const intB = mod12(Math.abs(b1.midi - b2.midi));

        const noteIds = [a1.id, a2.id, b1.id, b2.id].map(String);

        if (isPerfectOctOrUnison(intA) && isPerfectOctOrUnison(intB)) {
          const ok = hasEngineFlag(noteIds, 'R-01');
          results.push({
            status: ok ? 'OK' : 'MISS',
            type: 'P8',
            from: { measure: a.measureIndex + 1, beat: a.beat, absBeat: a.absBeat },
            to: { measure: b.measureIndex + 1, beat: b.beat, absBeat: b.absBeat },
            voices: [vA, vB],
            a: [a1.label, a2.label],
            b: [b1.label, b2.label],
            noteIds,
          });
        } else if (isPerfectFifth(intA) && isPerfectFifth(intB)) {
          const ok = hasEngineFlag(noteIds, 'R-02');
          results.push({
            status: ok ? 'OK' : 'MISS',
            type: 'P5',
            from: { measure: a.measureIndex + 1, beat: a.beat, absBeat: a.absBeat },
            to: { measure: b.measureIndex + 1, beat: b.beat, absBeat: b.absBeat },
            voices: [vA, vB],
            a: [a1.label, a2.label],
            b: [b1.label, b2.label],
            noteIds,
          });
        }
      }
    }
  }

  const filtered = args.onlyMisses ? results.filter((r) => r.status === 'MISS') : results;

  console.log(`File: ${args.filePath}`);
  console.log(`Key: ${tonic}${isMinorMode ? ' minor' : ' major'}  TS: ${timeSignature.numerator}/${timeSignature.denominator}`);
  console.log(`Scan: perfect parallels (true parallels only; voices must move)`);
  console.log(`Voices: ${args.voices.join(', ')}`);
  console.log(`Engine violations: ${violations.length}`);
  console.log('---');

  if (!filtered.length) {
    console.log(args.onlyMisses ? 'No misses found.' : 'No parallels found.');
    return;
  }

  let printed = 0;
  for (const r of filtered) {
    if (printed >= args.max) break;
    const beatA = Number(r.from.beat).toFixed(3).replace(/\.000$/, '');
    const beatB = Number(r.to.beat).toFixed(3).replace(/\.000$/, '');
    console.log(
      `${r.status} ${r.type} v${r.voices[0]}–v${r.voices[1]}: m${r.from.measure} b${beatA} → m${r.to.measure} b${beatB}`,
    );
    console.log(`  ${r.a[0]} + ${r.a[1]}  →  ${r.b[0]} + ${r.b[1]}`);
    printed++;
  }

  if (filtered.length > printed) {
    console.log(`(+${filtered.length - printed} more)`);
  }
}

main();
