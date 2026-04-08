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

const EPS = 1e-6;
const approxEq = (a: number, b: number, eps = EPS) => Math.abs(a - b) <= eps;

function usage() {
  console.log(`\
Usage:
  npx tsx scripts/audit-analysis-suspects.ts --file <project.json> [--max 30] [--exceptions]

What it does (high-level):
  - Runs the normal harmony analysis on the whole piece
  - Builds a timeline of chord-events
  - Produces a ranked list of "suspect" beats where analysis is likely fragile:
      (A) roman/symbol changes if we exclude non-harmonic notes (passing, neighbor, appoggiatura, ...)
      (B) roman/symbol changes if we force the base key instead of the inferred/manual context

Tip:
  For any listed item, you can drill down with:
    npm run debug:case -- --file <same file> --measure <M> --beats <B> --context

Examples:
  npx tsx scripts/audit-analysis-suspects.ts --file "tests/Bach corale 19.json" --max 25
  npx tsx scripts/audit-analysis-suspects.ts --file "tests/Dubois 1 p11.json" --max 40 --exceptions
`);
}

type Args = {
  filePath: string;
  max: number;
  includeExceptions: boolean;
  outJsonPath?: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    filePath: '',
    max: 30,
    includeExceptions: false,
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
    if (a === '--max') {
      const n = Number(next());
      if (Number.isFinite(n)) args.max = Math.max(1, Math.round(n));
      i++;
      continue;
    }
    if (a === '--exceptions') {
      args.includeExceptions = true;
      continue;
    }
    if (a === '--out') {
      args.outJsonPath = String(next() || '').trim();
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
      return {
        absBeat: Number.isFinite(Number(c.absBeat)) ? Number(c.absBeat) : undefined,
        measureIndex: Number.isFinite(Number(c.measureIndex)) ? Number(c.measureIndex) : undefined,
        newTonic,
        newIsMinor,
        label: typeof c.label === 'string' ? c.label : undefined,
        score: Number.isFinite(Number(c.score)) ? Number(c.score) : undefined,
        source: (c.source === 'inferred' || c.source === 'manual') ? c.source : undefined,
      };
    } catch {
      return null;
    }
  };

  const m = (Array.isArray(manual) ? manual : []).map(norm).filter(Boolean) as AnalysisContextLike[];
  const inf = (Array.isArray(inferred) ? inferred : []).map(norm).filter(Boolean) as AnalysisContextLike[];

  for (const c of m) if (!c.source) c.source = 'manual';
  for (const c of inf) if (!c.source) c.source = 'inferred';

  return [...m, ...inf].sort((a, b) => {
    const da = ctxAbsBeat(a, ts);
    const db = ctxAbsBeat(b, ts);
    if (Math.abs(da - db) > EPS) return da - db;
    if (a.source === b.source) return 0;
    return a.source === 'manual' ? -1 : 1;
  });
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

function ensureLogsDir() {
  try {
    const dir = path.resolve(process.cwd(), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  } catch {
    return null;
  }
}

type Suspect = {
  score: number;
  measure: number;
  beat: number;
  absBeat: number;
  ctx: { tonic: string; isMinor: boolean; source: string | null; label: string | null };
  all: { roman: string; figures: string; symbol: string };
  filtered: { roman: string; figures: string; symbol: string };
  baseKey: { roman: string; figures: string; symbol: string };
  reasons: string[];
  issues: { errors: number; warnings: number; exceptions: number; topRuleIds: string[] };
};

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
  const violations = Array.isArray((res as any).violations) ? (res as any).violations : [];

  const inferredContexts = (res as any).inferredAnalysisContexts || [];
  const mergedContexts = mergeContexts(analysisContexts, inferredContexts, timeSignature);

  const suspects: Suspect[] = [];

  for (const ev of timeline) {
    if (!ev) continue;

    const ctx = contextAtAbsBeat(ev.absBeat, tonic, isMinorMode, mergedContexts, timeSignature);

    const raAll = getRomanAnalysis(ev.notes as any, ctx.tonic, ctx.isMinor);
    const romanAll = raAll?.roman ?? '';
    const figuresAll = formatFiguredBass(((raAll as any)?.figures ?? []) as any, 'horizontal');
    const symbolAll = getChordSymbol(ev.notes as any, keySignature as any, ctx.tonic) ?? '';

    const filteredNotes = (ev.notes || []).filter((n: any) => n && !isNonHarmonicFlagged(n));
    const raFilt = getRomanAnalysis(filteredNotes as any, ctx.tonic, ctx.isMinor);
    const romanFilt = raFilt?.roman ?? '';
    const figuresFilt = formatFiguredBass(((raFilt as any)?.figures ?? []) as any, 'horizontal');
    const symbolFilt = getChordSymbol(filteredNotes as any, keySignature as any, ctx.tonic) ?? '';

    const raBase = getRomanAnalysis(ev.notes as any, tonic, isMinorMode);
    const romanBase = raBase?.roman ?? '';
    const figuresBase = formatFiguredBass(((raBase as any)?.figures ?? []) as any, 'horizontal');
    const symbolBase = getChordSymbol(ev.notes as any, keySignature as any, tonic) ?? '';

    const activeIds = new Set(
      (ev.notes || [])
        .map((n: any) => (n && typeof n.id !== 'undefined') ? String(n.id) : '')
        .filter(Boolean),
    );

    const relevantViolations = violations.filter((v: any) => {
      if (!v) return false;
      if (!args.includeExceptions && v.severity === 'exception') return false;
      const ids = Array.isArray(v.noteIds) ? v.noteIds : [];
      return ids.some((id: any) => activeIds.has(String(id)));
    });

    const counts = { errors: 0, warnings: 0, exceptions: 0 };
    const ruleCount = new Map<string, number>();
    for (const v of relevantViolations) {
      const sev = String(v.severity || 'warning');
      if (sev === 'error') counts.errors++;
      else if (sev === 'exception') counts.exceptions++;
      else counts.warnings++;
      const rid = String(v.ruleId || '');
      if (rid) ruleCount.set(rid, (ruleCount.get(rid) || 0) + 1);
    }
    const topRuleIds = Array.from(ruleCount.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 4)
      .map(([rid]) => rid);

    const reasons: string[] = [];

    const contamination = (romanAll && romanFilt && romanAll !== romanFilt) || (symbolAll && symbolFilt && symbolAll !== symbolFilt) || (figuresAll && figuresFilt && figuresAll !== figuresFilt);
    if (contamination) reasons.push('Non-harmonic notes change the chord reading');

    const contextShift = (romanAll && romanBase && romanAll !== romanBase) || (symbolAll && symbolBase && symbolAll !== symbolBase) || (figuresAll && figuresBase && figuresAll !== figuresBase);
    if (contextShift) reasons.push('Context/base-key mismatch (possible tonicization/modulation)');

    const hasErrors = counts.errors > 0;
    if (hasErrors) reasons.push('Engine reports errors here');

    // Heuristic score: prefer actionable items.
    let score = 0;
    if (contamination) score += 3;
    if (contextShift) score += 2;
    if (hasErrors) score += 1;
    score += Math.min(2, counts.warnings * 0.25);

    // Only keep true suspects.
    if (score <= 0) continue;

    suspects.push({
      score,
      measure: ev.measureIndex + 1,
      beat: ev.beat,
      absBeat: ev.absBeat,
      ctx: { tonic: ctx.tonic, isMinor: ctx.isMinor, source: ctx.source, label: ctx.label },
      all: { roman: romanAll, figures: figuresAll, symbol: symbolAll },
      filtered: { roman: romanFilt, figures: figuresFilt, symbol: symbolFilt },
      baseKey: { roman: romanBase, figures: figuresBase, symbol: symbolBase },
      reasons,
      issues: { errors: counts.errors, warnings: counts.warnings, exceptions: counts.exceptions, topRuleIds },
    });
  }

  suspects.sort((a, b) => b.score - a.score || a.absBeat - b.absBeat);

  const outPath = (() => {
    if (args.outJsonPath) return path.resolve(process.cwd(), args.outJsonPath);
    const logsDir = ensureLogsDir();
    if (!logsDir) return null;
    return path.join(logsDir, '_analysis_suspects_report.json');
  })();

  if (outPath) {
    try {
      fs.writeFileSync(
        outPath,
        JSON.stringify(
          {
            file: args.filePath,
            meta: {
              tonic,
              isMinorMode,
              timeSignature,
              totalNotes: Array.isArray(notes) ? notes.length : 0,
              totalEvents: timeline.length,
              totalViolations: violations.length,
              inferredContexts: Array.isArray(inferredContexts) ? inferredContexts.length : 0,
              manualContexts: Array.isArray(analysisContexts) ? analysisContexts.length : 0,
            },
            suspects,
          },
          null,
          2,
        ),
        'utf8',
      );
    } catch {
      // ignore
    }
  }

  console.log(`File: ${args.filePath}`);
  console.log(`Key: ${tonic}${isMinorMode ? ' minor' : ' major'}  TS: ${timeSignature.numerator}/${timeSignature.denominator}`);
  console.log(`Suspects found: ${suspects.length}`);
  console.log('---');

  const shown = suspects.slice(0, args.max);
  if (!shown.length) {
    console.log('No suspects found with the current heuristics.');
    if (outPath) console.log(`Wrote JSON report to ${path.relative(process.cwd(), outPath)}`);
    return;
  }

  for (const s of shown) {
    const beatTxt = Number(s.beat).toFixed(3).replace(/\.000$/, '');
    const ctxTxt = `${s.ctx.tonic}${s.ctx.isMinor ? 'm' : ''}`;

    console.log(
      `m${s.measure} b${beatTxt}  score=${s.score.toFixed(2)}  ctx=${ctxTxt}${s.ctx.source ? ` (${s.ctx.source}${s.ctx.label ? `: ${s.ctx.label}` : ''})` : ''}`,
    );

    const allTxt = `ALL: roman=${s.all.roman || '-'} fig=${s.all.figures || '-'} sym=${s.all.symbol || '-'}`;
    const filtTxt = `FIL: roman=${s.filtered.roman || '-'} fig=${s.filtered.figures || '-'} sym=${s.filtered.symbol || '-'}`;
    const baseTxt = `BASE: roman=${s.baseKey.roman || '-'} fig=${s.baseKey.figures || '-'} sym=${s.baseKey.symbol || '-'}`;

    console.log(`  ${allTxt}`);
    if (s.reasons.includes('Non-harmonic notes change the chord reading')) console.log(`  ${filtTxt}`);
    if (s.reasons.includes('Context/base-key mismatch (possible tonicization/modulation)')) console.log(`  ${baseTxt}`);

    const issuesTxt = `issues: err=${s.issues.errors} warn=${s.issues.warnings}` + (args.includeExceptions ? ` exc=${s.issues.exceptions}` : '');
    const rulesTxt = s.issues.topRuleIds.length ? `rules: ${s.issues.topRuleIds.join(', ')}` : '';
    console.log(`  ${issuesTxt}${rulesTxt ? `  ${rulesTxt}` : ''}`);

    console.log(
      `  drill-down: npm run debug:case -- --file "${args.filePath}" --measure ${s.measure} --beats ${beatTxt} --context`,
    );
    console.log('');
  }

  if (outPath) console.log(`Wrote JSON report to ${path.relative(process.cwd(), outPath)}`);
}

main();
