import fs from 'node:fs';
import path from 'node:path';

import {
  applyHarmonyRules,
  formatFiguredBass,
  getActiveNotesTimeline,
  getChordSymbol,
  getKeySignature,
  getRomanAnalysis,
  normalizeNotePitchFieldsWithKey,
} from '../src/utils/musicTheory';

type Args = {
  filePath: string;
  measures?: number[]; // 0-based measure indices
  beats?: number[]; // 1-based beats within measure
  ruleIdIncludes?: string;
  includeExceptions?: boolean;
  outJsonPath?: string;
  jsonOnly?: boolean;
  showContext?: boolean;
  compareFiltered?: boolean;
};

const EPS = 1e-6;

const approxEq = (a: number, b: number, eps = EPS) => Math.abs(a - b) <= eps;

function ensureLogsDir() {
  try {
    const dir = path.resolve(process.cwd(), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  } catch {
    return null;
  }
}

function parseNumberList(raw: string): number[] {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n));
}

function parseMeasureSelector(raw: string): number[] {
  // Accept:
  // - "3" => [2]
  // - "3,4,8" => [2,3,7]
  // - "3-8" => [2..7]
  const v = String(raw || '').trim();
  if (!v) return [];

  if (v.includes('-') && !v.includes(',')) {
    const [aRaw, bRaw] = v.split('-').map((s) => s.trim());
    const a = Number(aRaw);
    const b = Number(bRaw);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return [];
    const start = Math.max(1, Math.round(Math.min(a, b)));
    const end = Math.max(1, Math.round(Math.max(a, b)));
    const out: number[] = [];
    for (let m = start; m <= end; m++) out.push(m - 1);
    return out;
  }

  return parseNumberList(v).map((m) => Math.max(0, Math.round(m) - 1));
}

function usage() {
  const msg = `\
Usage:
  npx tsx scripts/debug-new-case.ts --file <path> [--measure <n|a-b|a,b,c>] [--beats 1,2,2.5] [--rule R-...] [--exceptions] [--context] [--no-compare-filtered] [--out logs/report.json] [--json]

Examples:
  npx tsx scripts/debug-new-case.ts --file tests/Bach\ corale\ 19.json --measure 2 --beats 1,2,2.5
  npx tsx scripts/debug-new-case.ts --file tests/Dubois\ 1\ p11.json --measure 8-10 --rule ORN-

Notes:
  - Measures are 1-based in CLI ("--measure 2" means measureIndex=1).
  - Beats are 1-based within the measure.
  - By default, "exception" items are hidden (use --exceptions to include).
  - By default, the script also compares roman/symbol using ALL notes vs a FILTERED set (excluding notes flagged as passing/neighbor/appoggiatura/etc.).
`;
  console.log(msg);
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    filePath: '',
    showContext: false,
    compareFiltered: true,
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
    if (a === '--measure' || a === '--measures' || a === '-m') {
      args.measures = parseMeasureSelector(next());
      i++;
      continue;
    }
    if (a === '--beats' || a === '-b') {
      args.beats = parseNumberList(next());
      i++;
      continue;
    }
    if (a === '--rule') {
      args.ruleIdIncludes = String(next() || '').trim();
      i++;
      continue;
    }
    if (a === '--exceptions') {
      args.includeExceptions = true;
      continue;
    }
    if (a === '--context') {
      args.showContext = true;
      continue;
    }
    if (a === '--no-compare-filtered') {
      args.compareFiltered = false;
      continue;
    }
    if (a === '--out') {
      args.outJsonPath = String(next() || '').trim();
      i++;
      continue;
    }
    if (a === '--json') {
      args.jsonOnly = true;
      continue;
    }
  }

  if (!args.filePath) {
    usage();
    process.exit(2);
  }

  return args;
}

type AnalysisContextLike = {
  absBeat?: number;
  measureIndex?: number;
  newTonic: string;
  newIsMinor: boolean;
  label?: string;
  score?: number;
  source?: 'manual' | 'inferred';
};

function beatsPerMeasure(ts: any): number {
  try {
    const n = Number(ts?.numerator ?? 4);
    const d = Number(ts?.denominator ?? 4);
    const bpm = n * (4 / d);
    return Number.isFinite(bpm) ? bpm : 4;
  } catch {
    return 4;
  }
}

function ctxAbsBeat(c: AnalysisContextLike, ts: any): number {
  const bpm = beatsPerMeasure(ts);
  const legacy = (Number(c?.measureIndex ?? 0) || 0) * bpm;
  const a = Number(c?.absBeat);
  return Number.isFinite(a) ? a : legacy;
}

function mergeContexts(manual: any[], inferred: any[], ts: any): AnalysisContextLike[] {
  const norm = (c: any): AnalysisContextLike | null => {
    try {
      if (!c || typeof c !== 'object') return null;
      const newTonic = String(c.newTonic || c.tonic || '').trim();
      const newIsMinor = Boolean(c.newIsMinor ?? c.isMinor);
      if (!newTonic) return null;
      const out: AnalysisContextLike = {
        absBeat: Number.isFinite(Number(c.absBeat)) ? Number(c.absBeat) : undefined,
        measureIndex: Number.isFinite(Number(c.measureIndex)) ? Number(c.measureIndex) : undefined,
        newTonic,
        newIsMinor,
        label: typeof c.label === 'string' ? c.label : undefined,
        score: Number.isFinite(Number(c.score)) ? Number(c.score) : undefined,
        source: (c.source === 'inferred' || c.source === 'manual') ? c.source : undefined,
      };
      return out;
    } catch {
      return null;
    }
  };

  const m = (Array.isArray(manual) ? manual : []).map(norm).filter(Boolean) as AnalysisContextLike[];
  const inf = (Array.isArray(inferred) ? inferred : []).map(norm).filter(Boolean) as AnalysisContextLike[];

  // Default source tags
  for (const c of m) if (!c.source) c.source = 'manual';
  for (const c of inf) if (!c.source) c.source = 'inferred';

  // Merge and sort by absBeat, with manual winning ties.
  const all = [...m, ...inf].sort((a, b) => {
    const da = ctxAbsBeat(a, ts);
    const db = ctxAbsBeat(b, ts);
    if (Math.abs(da - db) > EPS) return da - db;
    if (a.source === b.source) return 0;
    return a.source === 'manual' ? -1 : 1;
  });

  // De-dupe: keep last context per (absBeat rounded + tonic+minor+source)
  const seen = new Set<string>();
  const out: AnalysisContextLike[] = [];
  for (const c of all) {
    const k = `${ctxAbsBeat(c, ts).toFixed(6)}::${c.newTonic}::${c.newIsMinor ? 'm' : 'M'}::${c.source}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

function contextAtAbsBeat(
  absBeat: number,
  baseTonic: string,
  baseMinor: boolean,
  contexts: AnalysisContextLike[],
  ts: any,
) {
  let best: AnalysisContextLike | null = null;
  let bestAbs = -Infinity;
  for (const c of contexts) {
    const a = ctxAbsBeat(c, ts);
    if (a <= absBeat + EPS && a >= bestAbs - EPS) {
      best = c;
      bestAbs = a;
    }
  }
  return {
    tonic: best ? best.newTonic : baseTonic,
    isMinor: best ? best.newIsMinor : baseMinor,
    source: best?.source ?? null,
    label: best?.label ?? null,
    score: best?.score ?? null,
    absBeat: best ? bestAbs : null,
  };
}

function isNonHarmonicFlagged(n: any): boolean {
  return !!(
    n?.isPassing ||
    n?.isNeighbor ||
    n?.isAnticipation ||
    n?.isAppoggiatura ||
    n?.isEscape
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const fullPath = path.resolve(process.cwd(), args.filePath);

  if (!fs.existsSync(fullPath)) {
    console.error(`File not found: ${args.filePath}`);
    process.exit(2);
  }

  const raw = fs.readFileSync(fullPath, 'utf8');
  const proj = JSON.parse(raw);

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

  const inferredContexts = (res as any).inferredAnalysisContexts || [];
  const mergedContexts = mergeContexts(analysisContexts, inferredContexts, timeSignature);

  const includeExceptions = !!args.includeExceptions;
  const ruleNeedle = String(args.ruleIdIncludes || '').trim();

  const events = timeline
    .filter((ev) => {
      if (!ev) return false;
      if (args.measures && args.measures.length > 0 && !args.measures.includes(ev.measureIndex)) return false;
      if (args.beats && args.beats.length > 0) {
        const ok = args.beats.some((b) => approxEq(Number(ev.beat), Number(b)));
        if (!ok) return false;
      }
      return true;
    })
    .map((ev) => {
      const ctx = contextAtAbsBeat(ev.absBeat, tonic, isMinorMode, mergedContexts, timeSignature);

      const ra = getRomanAnalysis(ev.notes as any, ctx.tonic, ctx.isMinor);
      const roman = ra?.roman ?? '';
      const figures: string[] = (ra as any)?.figures ?? [];
      const symbol = getChordSymbol(ev.notes as any, keySignature as any, ctx.tonic) ?? '';

      const filteredNotes = (args.compareFiltered)
        ? (ev.notes || []).filter((n: any) => n && !isNonHarmonicFlagged(n))
        : (ev.notes || []);
      const raFiltered = args.compareFiltered ? getRomanAnalysis(filteredNotes as any, ctx.tonic, ctx.isMinor) : null;
      const romanFiltered = args.compareFiltered ? (raFiltered?.roman ?? '') : '';
      const figuresFiltered: string[] = args.compareFiltered ? ((raFiltered as any)?.figures ?? []) : [];
      const symbolFiltered = args.compareFiltered ? (getChordSymbol(filteredNotes as any, keySignature as any, ctx.tonic) ?? '') : '';

      const activeIds = new Set(
        (ev.notes || [])
          .map((n: any) => (n && typeof n.id !== 'undefined') ? String(n.id) : '')
          .filter(Boolean),
      );

      const relViolations = violations
        .filter((v: any) => {
          if (!v) return false;
          if (!includeExceptions && v.severity === 'exception') return false;
          if (ruleNeedle && !String(v.ruleId || '').includes(ruleNeedle)) return false;
          const ids = Array.isArray(v.noteIds) ? v.noteIds : [];
          return ids.some((id: any) => activeIds.has(String(id)));
        })
        .map((v: any) => ({
          ruleId: String(v.ruleId || ''),
          severity: v.severity,
          description: String(v.description || ''),
          suggestion: v.suggestion ? String(v.suggestion) : undefined,
          noteIds: Array.isArray(v.noteIds) ? v.noteIds.map((x: any) => String(x)) : [],
        }));

      const notesSummary = (ev.notes || [])
        .slice()
        .sort((a: any, b: any) => (Number(a?.voice ?? 1) - Number(b?.voice ?? 1)) || (Number(a?.midi ?? 0) - Number(b?.midi ?? 0)))
        .map((n: any) => {
          const voice = Number.isFinite(n?.voice) ? Number(n.voice) : 1;
          const pitch = `${String(n?.pitch || '?')}${String(n?.octave ?? '')}`;
          const flags = [
            n?.isPassing ? 'pass' : null,
            n?.isNeighbor ? 'neigh' : null,
            n?.isAnticipation ? 'ant' : null,
            n?.isAppoggiatura ? 'app' : null,
            n?.isEscape ? 'esc' : null,
            n?.isSuspension ? 'susp' : null,
          ].filter(Boolean);
          return { id: String(n?.id ?? ''), voice, pitch, midi: n?.midi, flags };
        });

      return {
        absBeat: ev.absBeat,
        measureIndex: ev.measureIndex,
        beat: ev.beat,
        context: ctx,
        roman,
        figures,
        figuresText: formatFiguredBass(figures as any, 'horizontal'),
        symbol,
        romanFiltered: args.compareFiltered ? romanFiltered : undefined,
        figuresFiltered: args.compareFiltered ? figuresFiltered : undefined,
        figuresFilteredText: args.compareFiltered ? formatFiguredBass(figuresFiltered as any, 'horizontal') : undefined,
        symbolFiltered: args.compareFiltered ? symbolFiltered : undefined,
        notes: notesSummary,
        violations: relViolations,
      };
    });

  const header = {
    file: args.filePath,
    meta: {
      tonic,
      isMinorMode,
      timeSignature,
      timeSignatureChangesCount: Array.isArray(timeSignatureChanges) ? timeSignatureChanges.length : 0,
      analysisContextsCount: Array.isArray(analysisContexts) ? analysisContexts.length : 0,
      totalNotes: Array.isArray(notes) ? notes.length : 0,
      totalTimelineEvents: timeline.length,
      totalViolations: violations.length,
    },
    filters: {
      measures: args.measures?.map((m) => m + 1) ?? null,
      beats: args.beats ?? null,
      ruleIdIncludes: ruleNeedle || null,
      includeExceptions,
    },
  };

  const report = { ...header, events };

  const outPath = (() => {
    if (args.outJsonPath) return path.resolve(process.cwd(), args.outJsonPath);
    const logsDir = ensureLogsDir();
    if (!logsDir) return null;
    return path.join(logsDir, '_debug_new_case_report.json');
  })();

  if (outPath) {
    try {
      fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
    } catch {
      // ignore
    }
  }

  if (args.jsonOnly) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`File: ${args.filePath}`);
  console.log(`Key: ${tonic}${isMinorMode ? ' minor' : ' major'}  TS: ${timeSignature.numerator}/${timeSignature.denominator}`);
  if (args.compareFiltered) {
    console.log('Compare: roman/symbol using ALL notes vs FILTERED (exclude non-harmonic flags)');
  }
  if (args.measures && args.measures.length) {
    console.log(`Measures: ${args.measures.map((m) => m + 1).join(', ')}`);
  }
  if (args.beats && args.beats.length) {
    console.log(`Beats: ${args.beats.join(', ')}`);
  }
  if (ruleNeedle) {
    console.log(`Rule filter: ${ruleNeedle}`);
  }
  console.log('---');

  if (events.length === 0) {
    console.log('No events matched the filters.');
    if (outPath) console.log(`(Wrote JSON report to ${path.relative(process.cwd(), outPath)})`);
    return;
  }

  for (const ev of events) {
    const m1 = ev.measureIndex + 1;
    const beatTxt = Number(ev.beat).toFixed(3).replace(/\.000$/, '');
    const absTxt = Number(ev.absBeat).toFixed(3).replace(/\.000$/, '');

    const romanTxt = ev.roman ? ev.roman : '-';
    const figTxt = ev.figuresText ? ev.figuresText : '-';
    const symTxt = ev.symbol ? ev.symbol : '-';

    const ctx = (ev as any).context;
    const ctxTxt = ctx ? `${String(ctx.tonic || '')}${ctx.isMinor ? 'm' : ''}` : '';
    const ctxMeta = (args.showContext && ctx)
      ? `  ctx=${ctxTxt}${ctx.source ? ` (${ctx.source}${ctx.label ? `: ${ctx.label}` : ''})` : ''}`
      : '';
    console.log(`m${m1} b${beatTxt} (abs=${absTxt})  roman=${romanTxt}  fig=${figTxt}  sym=${symTxt}${ctxMeta}`);

    if (args.compareFiltered) {
      const rF = String((ev as any).romanFiltered || '');
      const fF = String((ev as any).figuresFilteredText || '');
      const sF = String((ev as any).symbolFiltered || '');
      const differs = (rF && rF !== romanTxt) || (sF && sF !== symTxt) || (fF && fF !== figTxt);
      if (differs) {
        console.log(`  Filtered→ roman=${rF || '-'}  fig=${fF || '-'}  sym=${sF || '-'}`);
      }
    }

    const noteLine = ev.notes
      .map((n) => {
        const f = n.flags.length ? ` [${n.flags.join(',')}]` : '';
        return `v${n.voice} ${n.pitch}${f}`;
      })
      .join(' | ');
    console.log(`  Notes: ${noteLine || '-'}`);

    if (ev.violations.length) {
      console.log(`  Flags: ${ev.violations.length} issue(s)`);
      for (const v of ev.violations.slice(0, 8)) {
        const sug = v.suggestion ? ` (consiglio: ${v.suggestion})` : '';
        console.log(`    - [${v.severity}] ${v.ruleId}: ${v.description}${sug}`);
      }
      if (ev.violations.length > 8) {
        console.log(`    - (+${ev.violations.length - 8} more...)`);
      }
    }

    console.log('');
  }

  if (outPath) console.log(`Wrote JSON report to ${path.relative(process.cwd(), outPath)}`);
}

main();
