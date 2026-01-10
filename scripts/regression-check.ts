import fs from 'node:fs';
import path from 'node:path';

import {
  applyHarmonyRules,
  formatFiguredBass,
  getActiveNotesTimeline,
  getChordSymbol,
  getKeySignature,
  getRomanAnalysis,
} from '../src/utils/musicTheory';

type Fixture = {
  name: string;
  keySignatureRoot: string;
  keyTonic: string;
  isMinorMode: boolean;
  timeSignature: { numerator: number; denominator: number };
  analysisContexts?: any[];
  notes: any[];
  expects: Array<{
    // Absolute beat, where absBeat = measureIndex * beatsPerMeasure + (beat-1)
    absBeat: number;
    roman?: string;
    symbolIncludes?: string;
    symbolNotIncludes?: string;
    figuresInclude?: string[];
  }>;
  expectsSuspensions?: Array<{
    // Suspension onset (the chord event where the dissonance starts)
    fromAbsBeat: number;
    voice: number;
    type?: string;
  }>;
  forbidsSuspensions?: Array<{
    // Suspension onset that must NOT appear (guards against false positives)
    fromAbsBeat: number;
    voice: number;
    type?: string;
  }>;
  expectsNoteFlags?: Array<{
    id: string;
    voice?: number;
    isPassing?: boolean;
    isNeighbor?: boolean;
    isAnticipation?: boolean;
    isAppoggiatura?: boolean;
    isEscape?: boolean;
    isSuspension?: boolean;
    suspensionFromAbsBeat?: number;
  }>;
};

const fixturesDir = path.resolve(__dirname, 'fixtures');

const loadFixtures = (): Fixture[] => {
  const files = fs
    .readdirSync(fixturesDir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  return files.map((f) => {
    const full = path.join(fixturesDir, f);
    const raw = fs.readFileSync(full, 'utf8');
    const obj = JSON.parse(raw);
    return obj as Fixture;
  });
};

const fail = (msg: string) => {
  console.error(msg);
  process.exitCode = 1;
};

const approxEq = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

const main = () => {
  const fixtures = loadFixtures();
  if (!fixtures.length) {
    console.log('No fixtures found.');
    return;
  }

  let anyFailed = false;

  for (const fx of fixtures) {
    let fixtureFailed = false;
    const beatsPerMeasure = fx.timeSignature.numerator * (4 / fx.timeSignature.denominator);
    const keySignature = getKeySignature(fx.keySignatureRoot, 'Major');

    const result = applyHarmonyRules(
      fx.notes as any,
      keySignature as any,
      fx.keyTonic,
      fx.isMinorMode,
      (fx.analysisContexts || []) as any,
      fx.timeSignature as any,
    );

    const timeline = getActiveNotesTimeline(result.analyzedNotes as any, fx.timeSignature as any);

    const findEvent = (absBeat: number) => timeline.find((ev) => approxEq(ev.absBeat, absBeat));

    for (const exp of fx.expects) {
      const ev = findEvent(exp.absBeat);
      if (!ev) {
        fixtureFailed = true;
        anyFailed = true;
        fail(`[${fx.name}] Missing event at absBeat=${exp.absBeat}`);
        continue;
      }

      const ra = getRomanAnalysis(ev.notes as any, fx.keyTonic, fx.isMinorMode);
      const roman = ra?.roman ?? '';
      const figures = ra?.figures ?? [];
      const symbol = getChordSymbol(ev.notes as any, keySignature as any, fx.keyTonic) ?? '';

      if (exp.roman != null && roman !== exp.roman) {
        fixtureFailed = true;
        anyFailed = true;
        fail(`[${fx.name}] absBeat=${exp.absBeat} roman expected '${exp.roman}' got '${roman}'`);
      }
      if (exp.symbolIncludes && !symbol.includes(exp.symbolIncludes)) {
        fixtureFailed = true;
        anyFailed = true;
        fail(`[${fx.name}] absBeat=${exp.absBeat} symbol expected include '${exp.symbolIncludes}' got '${symbol}'`);
      }
      if (exp.symbolNotIncludes && symbol.includes(exp.symbolNotIncludes)) {
        fixtureFailed = true;
        anyFailed = true;
        fail(`[${fx.name}] absBeat=${exp.absBeat} symbol expected NOT include '${exp.symbolNotIncludes}' got '${symbol}'`);
      }
      if (exp.figuresInclude) {
        for (const f of exp.figuresInclude) {
          if (!figures.includes(f)) {
            fixtureFailed = true;
            anyFailed = true;
            fail(
              `[${fx.name}] absBeat=${exp.absBeat} figures expected include '${f}' got [${formatFiguredBass(figures, 'horizontal')}]`,
            );
          }
        }
      }
    }

    if (fx.expectsSuspensions && fx.expectsSuspensions.length) {
      const suspNotes = (result.analyzedNotes as any[])
        .filter((n) => n && n.isSuspension && typeof n.isSuspension.fromAbsBeat === 'number')
        .map((n) => ({
          voice: n.voice ?? 1,
          type: n.isSuspension?.type ?? 'susp',
          fromAbsBeat: n.isSuspension?.fromAbsBeat,
        }));

      for (const exp of fx.expectsSuspensions) {
        const found = suspNotes.find(
          (s) => s.voice === exp.voice && approxEq(s.fromAbsBeat, exp.fromAbsBeat) && (exp.type ? s.type === exp.type : true),
        );
        if (!found) {
          fixtureFailed = true;
          anyFailed = true;
          fail(
            `[${fx.name}] missing suspension voice=${exp.voice} fromAbsBeat=${exp.fromAbsBeat}` +
              (exp.type ? ` type='${exp.type}'` : ''),
          );
        }
      }
    }

    if (fx.forbidsSuspensions && fx.forbidsSuspensions.length) {
      const suspNotes = (result.analyzedNotes as any[])
        .filter((n) => n && n.isSuspension && typeof n.isSuspension.fromAbsBeat === 'number')
        .map((n) => ({
          voice: n.voice ?? 1,
          type: n.isSuspension?.type ?? 'susp',
          fromAbsBeat: n.isSuspension?.fromAbsBeat,
        }));

      for (const forbid of fx.forbidsSuspensions) {
        const found = suspNotes.find(
          (s) =>
            s.voice === forbid.voice &&
            approxEq(s.fromAbsBeat, forbid.fromAbsBeat) &&
            (forbid.type ? s.type === forbid.type : true),
        );
        if (found) {
          fixtureFailed = true;
          anyFailed = true;
          fail(
            `[${fx.name}] forbidden suspension present voice=${forbid.voice} fromAbsBeat=${forbid.fromAbsBeat}` +
              (forbid.type ? ` type='${forbid.type}'` : ''),
          );
        }
      }
    }

    if (fx.expectsNoteFlags && fx.expectsNoteFlags.length) {
      const byId = new Map<string, any>();
      for (const n of result.analyzedNotes as any[]) {
        if (n && typeof n.id === 'string') byId.set(n.id, n);
      }

      for (const exp of fx.expectsNoteFlags) {
        const n = byId.get(exp.id);
        if (!n) {
          fixtureFailed = true;
          anyFailed = true;
          fail(`[${fx.name}] missing note id='${exp.id}' for expectsNoteFlags`);
          continue;
        }
        if (exp.voice != null && (n.voice ?? 1) !== exp.voice) {
          fixtureFailed = true;
          anyFailed = true;
          fail(`[${fx.name}] note id='${exp.id}' voice expected ${exp.voice} got ${(n.voice ?? 1)}`);
        }
        const checks: Array<[keyof typeof exp, boolean | undefined, boolean]> = [
          ['isPassing', exp.isPassing, !!n.isPassing],
          ['isNeighbor', exp.isNeighbor, !!n.isNeighbor],
          ['isAnticipation', exp.isAnticipation, !!n.isAnticipation],
          ['isAppoggiatura', exp.isAppoggiatura, !!n.isAppoggiatura],
          ['isEscape', exp.isEscape, !!n.isEscape],
          ['isSuspension', exp.isSuspension, !!n.isSuspension],
        ];
        for (const [k, wanted, actual] of checks) {
          if (wanted == null) continue;
          if (actual !== wanted) {
            fixtureFailed = true;
            anyFailed = true;
            fail(`[${fx.name}] note id='${exp.id}' ${String(k)} expected ${wanted} got ${actual}`);
          }
        }

        if (exp.suspensionFromAbsBeat != null) {
          const from = n.isSuspension?.fromAbsBeat;
          if (!(typeof from === 'number' && approxEq(from, exp.suspensionFromAbsBeat))) {
            fixtureFailed = true;
            anyFailed = true;
            fail(
              `[${fx.name}] note id='${exp.id}' suspension.fromAbsBeat expected ${exp.suspensionFromAbsBeat} got ${String(from)}`,
            );
          }
        }
      }
    }

    const status = fixtureFailed ? 'FAIL' : 'OK';
    console.log(`${status}  ${fx.name}`);
  }

  if (anyFailed) process.exitCode = 1;
};

main();
