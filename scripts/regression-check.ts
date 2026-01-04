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

    const status = fixtureFailed ? 'FAIL' : 'OK';
    console.log(`${status}  ${fx.name}`);
  }

  if (anyFailed) process.exitCode = 1;
};

main();
