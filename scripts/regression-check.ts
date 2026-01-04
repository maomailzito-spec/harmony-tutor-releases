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
  ornaments?: Array<{
    noteId: string;
    ornamentMark?: string;
    isNeighbor?: boolean;
    isAnticipation?: boolean;
    isAppoggiatura?: boolean;
  }>;
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

    if (fx.ornaments && fx.ornaments.length) {
      for (const exp of fx.ornaments) {
        const n: any = (result.analyzedNotes as any[]).find((x) => x && x.id === exp.noteId);
        if (!n) {
          fixtureFailed = true;
          anyFailed = true;
          fail(`[${fx.name}] Missing analyzed note id='${exp.noteId}'`);
          continue;
        }
        if (exp.ornamentMark != null && String(n.ornamentMark ?? '') !== exp.ornamentMark) {
          fixtureFailed = true;
          anyFailed = true;
          fail(`[${fx.name}] noteId='${exp.noteId}' ornamentMark expected '${exp.ornamentMark}' got '${String(n.ornamentMark ?? '')}'`);
        }
        if (exp.isNeighbor != null && Boolean(n.isNeighbor) !== exp.isNeighbor) {
          fixtureFailed = true;
          anyFailed = true;
          fail(`[${fx.name}] noteId='${exp.noteId}' isNeighbor expected '${exp.isNeighbor}' got '${Boolean(n.isNeighbor)}'`);
        }
        if (exp.isAnticipation != null && Boolean(n.isAnticipation) !== exp.isAnticipation) {
          fixtureFailed = true;
          anyFailed = true;
          fail(`[${fx.name}] noteId='${exp.noteId}' isAnticipation expected '${exp.isAnticipation}' got '${Boolean(n.isAnticipation)}'`);
        }
        if (exp.isAppoggiatura != null && Boolean(n.isAppoggiatura) !== exp.isAppoggiatura) {
          fixtureFailed = true;
          anyFailed = true;
          fail(`[${fx.name}] noteId='${exp.noteId}' isAppoggiatura expected '${exp.isAppoggiatura}' got '${Boolean(n.isAppoggiatura)}'`);
        }
      }
    }

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
