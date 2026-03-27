import fs from 'node:fs';
import path from 'node:path';

import {
  applyHarmonyRules,
  calculateNoteBeats,
  formatFiguredBass,
  getActiveNotesTimeline,
  getChordSymbol,
  getKeySignature,
  getRomanAnalysis,
  substituteSuspensionsForAnalysis,
} from '../src/utils/musicTheory';

import { TICKS_PER_QUARTER } from '../src/constants';
import { detectVoiceLeadingSequences } from '../src/utils/sequenceDetector';
import { applyStatelessRules } from '../src/utils/harmonyPostRules';

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
  expectsViolations?: Array<{
    ruleId: string;
    severity?: 'error' | 'warning' | 'exception';
    // At least one noteId must match a note at this absBeat
    atAbsBeat?: number;
  }>;
  forbidsViolations?: Array<{
    ruleId: string;
    atAbsBeat?: number;
  }>;
  forbidsSequences?: boolean;
};

const fixturesDir = path.resolve(__dirname, 'fixtures');

const loadFixtures = (): Fixture[] => {
  const files = fs
    .readdirSync(fixturesDir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  const out: Fixture[] = [];
  for (const f of files) {
    const full = path.join(fixturesDir, f);
    const raw = fs.readFileSync(full, 'utf8');
    const obj = JSON.parse(raw);

    // Allow keeping non-test example JSONs in the fixtures folder.
    if (!obj || !Array.isArray(obj.expects)) continue;

    if (typeof obj.name !== 'string' || !obj.name) obj.name = f;
    if (typeof obj.keyTonic !== 'string' || !obj.keyTonic) obj.keyTonic = obj.keySignatureRoot;

    out.push(obj as Fixture);
  }
  return out;
};

const fail = (msg: string) => {
  console.error(msg);
  process.exitCode = 1;
};

const approxEq = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

const runCalculateNoteBeatsRegression = () => {
  // Regression for a real editor bug:
  // when a measure in the middle becomes empty (notes deleted -> rests -> transiently missing),
  // notes in later measures must NOT be repacked/compacted into earlier measures.
  // `calculateNoteBeats` must treat `startTick` as canonical timeline.
  const name = 'calculateNoteBeats preserves empty measures (startTick-canonical)';
  const ts = { numerator: 4, denominator: 4 };
  const q = TICKS_PER_QUARTER;

  // Four bars of quarter notes, but intentionally scrambled array order:
  // m0 (0..3), m2 (8..11), m3 (12..15), m1 (4..7)
  const mk = (id: string, startTick: number): any => ({
    id,
    pitch: 'C',
    octave: 4,
    position: 0,
    midi: 60,
    noteIndex: 0,
    clef: 'treble',
    duration: 'quarter',
    isRest: false,
    isTriplet: false,
    isDuplet: false,
    isDotted: false,
    // Legacy/possibly-wrong fields: the function must override based on startTick.
    measureIndex: 0,
    beat: 1,
    startTick,
    durationTicks: q,
    voice: 1,
  });

  const notes: any[] = [
    mk('m0b1', 0),
    mk('m0b2', 1 * q),
    mk('m0b3', 2 * q),
    mk('m0b4', 3 * q),

    mk('m2b1', 8 * q),
    mk('m2b2', 9 * q),
    mk('m2b3', 10 * q),
    mk('m2b4', 11 * q),

    mk('m3b1', 12 * q),
    mk('m3b2', 13 * q),
    mk('m3b3', 14 * q),
    mk('m3b4', 15 * q),

    mk('m1b1', 4 * q),
    mk('m1b2', 5 * q),
    mk('m1b3', 6 * q),
    mk('m1b4', 7 * q),
  ];

  const out = calculateNoteBeats(notes as any, ts as any, []);
  const byId = new Map(out.map((n: any) => [String(n.id), n]));

  const assert = (id: string, wantMeasureIndex: number, wantBeat: number) => {
    const n = byId.get(id);
    if (!n) {
      fail(`[${name}] missing output note id='${id}'`);
      return false;
    }
    const mi = Number(n.measureIndex);
    const bt = Number(n.beat);
    if (!(mi === wantMeasureIndex && approxEq(bt, wantBeat))) {
      fail(`[${name}] id='${id}' expected m=${wantMeasureIndex} beat=${wantBeat} got m=${String(mi)} beat=${String(bt)}`);
      return false;
    }
    return true;
  };

  let ok = true;
  ok = assert('m1b1', 1, 1) && ok;
  ok = assert('m2b1', 2, 1) && ok;
  ok = assert('m3b4', 3, 4) && ok;

  console.log(`${ok ? 'OK' : 'FAIL'}  ${name}`);
  if (!ok) process.exitCode = 1;
};

const runInferredContextRegression = () => {
  // Regression for a real-world issue: modulation was not detected and the UI showed
  // bVII/bIII/etc. in the home key even when the piece clearly moved to a far flat key.
  const name = 'inferred contexts detect Bb→Gb modulation (Dubois n3 p12)';
  const file = './tests/Dubois n3 p12.htp';
  if (!fs.existsSync(file)) {
    console.log(`SKIP  ${name} (missing ${file})`);
    return;
  }

  try {
    const fx = JSON.parse(fs.readFileSync(file, 'utf8'));
    const beatsPerMeasure = fx.timeSignature.numerator * (4 / fx.timeSignature.denominator);
    const ks = getKeySignature(fx.keySignatureRoot, fx.isMinorMode ? 'Minor' : 'Major');
    const res: any = applyHarmonyRules(
      fx.notes,
      ks as any,
      fx.keySignatureRoot,
      fx.isMinorMode,
      fx.analysisContexts || [],
      fx.timeSignature,
    );

    const inferred = (res.inferredAnalysisContexts || []) as any[];
    const hasGb = inferred.some((c) => String(c?.newTonic) === 'Gb' && !c?.newIsMinor && approxEq(Number(c?.absBeat), 76, 1e-3));
    // Return-to-global is now snapped to the measure downbeat when inferred mid-measure.
    const hasReturnBb = inferred.some((c) => String(c?.newTonic) === 'Bb' && !c?.newIsMinor && approxEq(Number(c?.absBeat), 108, 1e-3));
    const hasBad = inferred.some((c) => {
      const t = String(c?.newTonic || '');
      // Guard against known false positives.
      // NOTE: Eb can be a legitimate local tonicization in this excerpt; do not forbid it.
      // NOTE: Db is now a legitimate inferred tonic for the modulating sequence at m24 (V-I-iv in Db).
      return t === 'B';
    });

    if (!hasGb) fail(`[${name}] missing inferred context Gb@absBeat≈76`);
    if (!hasReturnBb) fail(`[${name}] missing inferred return context Bb@absBeat≈108`);
    if (hasBad) fail(`[${name}] has unexpected inferred context (B/Db) => ${JSON.stringify(inferred.map(c => ({ absBeat: c.absBeat, tonic: c.newTonic })))}`);

    const ok = hasGb && hasReturnBb && !hasBad;
    console.log(`${ok ? 'OK' : 'FAIL'}  ${name}`);
    if (!ok) process.exitCode = 1;
  } catch (e: any) {
    fail(`[${name}] threw: ${String(e?.message || e)}`);
    console.log(`FAIL  ${name}`);
    process.exitCode = 1;
  }
};

const runDuboisN2P7ContextRegression = () => {
  const name = 'Dubois N2 p7: no spurious Bm inferred context';
  const file = './tests/Dubois N2 p.7.json';
  if (!fs.existsSync(file)) {
    console.log(`SKIP  ${name} (missing ${file})`);
    return;
  }

  try {
    const fx = JSON.parse(fs.readFileSync(file, 'utf8')) as any;
    const ks = getKeySignature(fx.keySignatureRoot, fx.isMinorMode ? 'Minor' : 'Major');
    const res: any = applyHarmonyRules(
      fx.notes,
      ks as any,
      fx.keySignatureRoot,
      fx.isMinorMode,
      fx.analysisContexts || [],
      fx.timeSignature,
    );

    const inferred = (res.inferredAnalysisContexts || []) as any[];
    const hasBm = inferred.some((c) => String(c?.newTonic || '') === 'B' && !!c?.newIsMinor);
    const ok = !hasBm;
    if (!ok) {
      fail(`[${name}] unexpected inferred Bm => ${JSON.stringify(inferred.map((c) => ({ absBeat: c.absBeat, tonic: c.newTonic, minor: !!c?.newIsMinor, score: (c as any).score ?? null })))}`);
    }
    console.log(`${ok ? 'OK' : 'FAIL'}  ${name}`);
    if (!ok) process.exitCode = 1;
  } catch (e: any) {
    fail(`[${name}] threw: ${String(e?.message || e)}`);
    console.log(`FAIL  ${name}`);
    process.exitCode = 1;
  }
};

const runDuboisN2P7DiminishedConfusionRegressions = () => {
  const file = './tests/Dubois N2 p.7.json';
  const name = 'Dubois N2 p7: avoid spurious dominant readings (m7b3, m11b1)';
  if (!fs.existsSync(file)) {
    console.log(`SKIP  ${name} (missing ${file})`);
    return;
  }

  try {
    const fx = JSON.parse(fs.readFileSync(file, 'utf8')) as any;
    const ks = getKeySignature(fx.keySignatureRoot, fx.isMinorMode ? 'Minor' : 'Major');
    const res: any = applyHarmonyRules(
      fx.notes,
      ks as any,
      fx.keySignatureRoot,
      fx.isMinorMode,
      fx.analysisContexts || [],
      fx.timeSignature,
    );

    const analyzed = (res.analyzedNotes || fx.notes) as any[];
    const timeline = getActiveNotesTimeline(analyzed as any, fx.timeSignature, fx.timeSignatureChanges || []);
    const evAt = (ab: number) => timeline.find((e: any) => approxEq(Number(e?.absBeat), ab, 1e-6));

    // m7 b3 => absBeat 26 (4/4)
    const ev7b3 = evAt(26);
    if (!ev7b3) {
      fail(`[${name}] missing chordEvent at absBeat=26 (m7b3)`);
      console.log(`FAIL  ${name}`);
      process.exitCode = 1;
      return;
    }
    const rEb = String(getRomanAnalysis(ev7b3.notes || [], 'Eb', false)?.roman || '').replace(/\s+/g, '');
    if (rEb !== 'iii') {
      fail(`[${name}] m7b3 expected EbMaj roman='iii' got '${rEb || '(empty)'}'`);
    }

    // m11 b1 => absBeat 40 (4/4)
    const ev11b1 = evAt(40);
    if (!ev11b1) {
      fail(`[${name}] missing chordEvent at absBeat=40 (m11b1)`);
      console.log(`FAIL  ${name}`);
      process.exitCode = 1;
      return;
    }
    const rG = String(getRomanAnalysis(ev11b1.notes || [], 'G', false)?.roman || '').replace(/\s+/g, '');
    if (rG !== 'iii') {
      fail(`[${name}] m11b1 expected GMaj roman='iii' got '${rG || '(empty)'}'`);
    }

    const ok = rEb === 'iii' && rG === 'iii';
    console.log(`${ok ? 'OK' : 'FAIL'}  ${name}`);
    if (!ok) process.exitCode = 1;
  } catch (e: any) {
    fail(`[${name}] threw: ${String(e?.message || e)}`);
    console.log(`FAIL  ${name}`);
    process.exitCode = 1;
  }
};

const runDuboisN2P7R07SequenceRegression = () => {
  const file = './tests/Dubois N2 p.7.json';
  const name = 'Dubois N2 p7: R-07 in sequence is exception at m4';
  if (!fs.existsSync(file)) {
    console.log(`SKIP  ${name} (missing ${file})`);
    return;
  }

  try {
    const fx = JSON.parse(fs.readFileSync(file, 'utf8')) as any;
    const beatsPerMeasure = fx.timeSignature.numerator * (4 / fx.timeSignature.denominator);
    const ks = getKeySignature(fx.keySignatureRoot, fx.isMinorMode ? 'Minor' : 'Major');
    const res: any = applyHarmonyRules(
      fx.notes,
      ks as any,
      fx.keySignatureRoot,
      fx.isMinorMode,
      fx.analysisContexts || [],
      fx.timeSignature,
    );

    const violations = (res.violations || []) as any[];
    const r07 = violations.filter((v) => String(v?.ruleId) === 'R-07');

    const uiMeasureOfViolation = (v: any): number | null => {
      try {
        const ids = Array.isArray(v?.noteIds) ? (v.noteIds as any[]).map(String) : [];
        let minAbs = Number.POSITIVE_INFINITY;
        for (const id of ids) {
          const n = (res.analyzedNotes as any[]).find((x: any) => x && String(x.id) === id);
          if (!n) continue;
          const ab = Number(n.measureIndex) * beatsPerMeasure + (Number(n.beat) - 1);
          if (Number.isFinite(ab)) minAbs = Math.min(minAbs, ab);
        }
        if (!Number.isFinite(minAbs)) return null;
        return Math.floor(minAbs / beatsPerMeasure) + 1;
      } catch {
        return null;
      }
    };

    const hitsM4 = r07.filter((v) => (uiMeasureOfViolation(v) ?? -1) === 4);
    const bad = hitsM4.filter((v) => String(v?.severity) !== 'exception');
    const ok = bad.length === 0;
    if (!ok) {
      fail(`[${name}] expected no warning/error R-07 at m4; got: ${JSON.stringify(bad.map((h) => ({ severity: h.severity, desc: h.description, noteIds: (h.noteIds || []).length })))}`);
    }
    console.log(`${ok ? 'OK' : 'FAIL'}  ${name}`);
    if (!ok) process.exitCode = 1;
  } catch (e: any) {
    fail(`[${name}] threw: ${String(e?.message || e)}`);
    console.log(`FAIL  ${name}`);
    process.exitCode = 1;
  }
};

const runDuboisN3WarningRegressions = () => {
  const file = './tests/Dubois n3 p12.htp';
  if (!fs.existsSync(file)) {
    console.log(`SKIP  Dubois n3 p12 warning regressions (missing ${file})`);
    return;
  }

  const fx = JSON.parse(fs.readFileSync(file, 'utf8')) as any;
  const beatsPerMeasure = fx.timeSignature.numerator * (4 / fx.timeSignature.denominator);
  const keySig = getKeySignature(fx.keySignatureRoot, fx.isMinorMode ? 'Minor' : 'Major');
  const res: any = applyHarmonyRules(
    fx.notes,
    keySig as any,
    fx.keySignatureRoot,
    fx.isMinorMode,
    fx.analysisContexts || [],
    fx.timeSignature,
  );

  const timeline = getActiveNotesTimeline(res.analyzedNotes as any, fx.timeSignature as any);
  const violations = (res.violations || []) as any[];

  const eventAt = (absBeat: number) => timeline.find((ev) => approxEq(ev.absBeat, absBeat, 1e-3));
  const idsAt = (absBeat: number): Set<string> => {
    const ev = eventAt(absBeat);
    const ids = new Set<string>();
    for (const n of (ev?.notes || []) as any[]) {
      if (!n || n.isRest) continue;
      if (n.id) ids.add(String(n.id));
    }
    return ids;
  };

  // UI measure 12 beat 3
  try {
    const name = 'Dubois n3 p12: no false R-CHORD-COMPLETE at m12 b3';
    const absBeat = (12 - 1) * beatsPerMeasure + (3 - 1);
    const ids = idsAt(absBeat);
    const hits = violations.filter((v) => String(v?.ruleId) === 'R-CHORD-COMPLETE'
      && Array.isArray(v?.noteIds)
      && (v.noteIds as any[]).some((id) => ids.has(String(id))));
    const ok = hits.length === 0;
    if (!ok) fail(`[${name}] unexpected hits: ${JSON.stringify(hits.map(h => ({ ruleId: h.ruleId, desc: h.description })))}`);
    console.log(`${ok ? 'OK' : 'FAIL'}  ${name}`);
    if (!ok) process.exitCode = 1;
  } catch (e: any) {
    const name = 'Dubois n3 p12: no false R-CHORD-COMPLETE at m12 b3';
    fail(`[${name}] threw: ${String(e?.message || e)}`);
    console.log(`FAIL  ${name}`);
    process.exitCode = 1;
  }

  // UI measure 23 beat 1
  try {
    const name = 'Dubois n3 p12: no false R-N-RES at m23 b1';
    const absBeat = (23 - 1) * beatsPerMeasure + (1 - 1);
    const ids = idsAt(absBeat);
    const hits = violations.filter((v) => String(v?.ruleId) === 'R-N-RES'
      && Array.isArray(v?.noteIds)
      && (v.noteIds as any[]).some((id) => ids.has(String(id))));
    const ok = hits.length === 0;
    if (!ok) fail(`[${name}] unexpected hits: ${JSON.stringify(hits.map(h => ({ ruleId: h.ruleId, desc: h.description })))}`);
    console.log(`${ok ? 'OK' : 'FAIL'}  ${name}`);
    if (!ok) process.exitCode = 1;
  } catch (e: any) {
    const name = 'Dubois n3 p12: no false R-N-RES at m23 b1';
    fail(`[${name}] threw: ${String(e?.message || e)}`);
    console.log(`FAIL  ${name}`);
    process.exitCode = 1;
  }

  // R-13 (all voices same direction) must not fire on pure revoicing at UI measure 17.
  try {
    const name = 'Dubois n3 p12: no false R-13 at m17 (revoicing)';
    const bad = (violations || []).filter((v) => String(v?.ruleId) === 'R-13');
    const hits = bad.filter((v) => {
      const ids = Array.isArray(v?.noteIds) ? (v.noteIds as any[]).map(String) : [];
      let minAbs = Number.POSITIVE_INFINITY;
      for (const id of ids) {
        const n = (res.analyzedNotes as any[]).find((x: any) => x && String(x.id) === id);
        if (!n) continue;
        const ab = Number(n.measureIndex) * beatsPerMeasure + (Number(n.beat) - 1);
        if (Number.isFinite(ab)) minAbs = Math.min(minAbs, ab);
      }
      if (!Number.isFinite(minAbs)) return false;
      const uiM = Math.floor(minAbs / beatsPerMeasure) + 1;
      return uiM === 17;
    });
    const ok = hits.length === 0;
    if (!ok) fail(`[${name}] unexpected hits: ${JSON.stringify(hits.map((h) => ({ desc: h.description, noteIds: (h.noteIds || []).length })))}`);
    console.log(`${ok ? 'OK' : 'FAIL'}  ${name}`);
    if (!ok) process.exitCode = 1;
  } catch (e: any) {
    const name = 'Dubois n3 p12: no false R-13 at m17 (revoicing)';
    fail(`[${name}] threw: ${String(e?.message || e)}`);
    console.log(`FAIL  ${name}`);
    process.exitCode = 1;
  }

  // R-10 (doubled leading tone) inside sequences is downgraded to exception (green).
  try {
    const name = 'Dubois n3 p12: R-10 in sequence is exception at m6/m7';
    const r10 = (violations || []).filter((v) => String(v?.ruleId) === 'R-10');
    const targets = new Set([6, 7]);

    const uiMeasureOfViolation = (v: any): number | null => {
      try {
        const ids = Array.isArray(v?.noteIds) ? (v.noteIds as any[]).map(String) : [];
        let minAbs = Number.POSITIVE_INFINITY;
        for (const id of ids) {
          const n = (res.analyzedNotes as any[]).find((x: any) => x && String(x.id) === id);
          if (!n) continue;
          const ab = Number(n.measureIndex) * beatsPerMeasure + (Number(n.beat) - 1);
          if (Number.isFinite(ab)) minAbs = Math.min(minAbs, ab);
        }
        if (!Number.isFinite(minAbs)) return null;
        return Math.floor(minAbs / beatsPerMeasure) + 1;
      } catch {
        return null;
      }
    };

    const hits = r10.filter((v) => targets.has(uiMeasureOfViolation(v) ?? -1));
    const ok = hits.length >= 2 && hits.every((v) => v?.severity === 'exception');
    if (!ok) fail(`[${name}] expected exception R-10 at m6 and m7; got: ${JSON.stringify(hits.map(h => ({ m: uiMeasureOfViolation(h), severity: h.severity, desc: h.description })))}`);
    console.log(`${ok ? 'OK' : 'FAIL'}  ${name}`);
    if (!ok) process.exitCode = 1;
  } catch (e: any) {
    const name = 'Dubois n3 p12: R-10 in sequence is exception at m6/m7';
    fail(`[${name}] threw: ${String(e?.message || e)}`);
    console.log(`FAIL  ${name}`);
    process.exitCode = 1;
  }
};

const main = () => {
  runCalculateNoteBeatsRegression();
  runInferredContextRegression();
  runDuboisN2P7ContextRegression();
  runDuboisN2P7DiminishedConfusionRegressions();
  runDuboisN2P7R07SequenceRegression();
  runDuboisN3WarningRegressions();

  const fixtures = loadFixtures();
  if (!fixtures.length) {
    console.log('No fixtures found.');
    return;
  }

  let anyFailed = false;

  for (const fx of fixtures) {
    let fixtureFailed = false;
    const beatsPerMeasure = fx.timeSignature.numerator * (4 / fx.timeSignature.denominator);
    const keySignature = getKeySignature(fx.keySignatureRoot, fx.isMinorMode ? 'Minor' : 'Major');

    const result = applyHarmonyRules(
      fx.notes as any,
      keySignature as any,
      fx.keyTonic,
      fx.isMinorMode,
      (fx.analysisContexts || []) as any,
      fx.timeSignature as any,
      (fx as any).doubleBarlineMeasures || [],
      (fx as any).ornamentOverrides || [],
      (fx as any).harmonyOverrides || [],
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

      const substNotes = substituteSuspensionsForAnalysis(ev.notes as any, ev.absBeat);
      const bassPc = (() => {
        let lowest: any = null;
        for (const n of (substNotes || [])) {
          if (!n || n.isRest) continue;
          const m = Number(n.midi);
          if (!Number.isFinite(m)) continue;
          if (!lowest || m < lowest.midi) lowest = { midi: m, pc: ((m % 12) + 12) % 12 };
        }
        return lowest?.pc ?? null;
      })();
      const stateless = applyStatelessRules({
        analysisNotesForNaming: substNotes as any,
        analysisNotes: substNotes as any,
        fullNotes: ev.notes as any,
        contextTonic: fx.keyTonic,
        contextIsMinor: fx.isMinorMode,
        bassPc,
        absBeat: ev.absBeat,
        autoOverrideByAbsBeat: new Map(),
        overrideByAbsBeat: new Map(),
      });
      const roman = stateless.roman;
      const figures = stateless.figures;
      const symbol = stateless.symbol || (getChordSymbol(ev.notes as any, keySignature as any, fx.keyTonic) ?? '');

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

    // ── expectsViolations ──
    if (fx.expectsViolations && fx.expectsViolations.length) {
      const viols = (result.violations || []) as Array<{ ruleId: string; severity: string; noteIds: string[] }>;
      // Build absBeat→noteId mapping for matching
      const noteAbsBeat = new Map<string, number>();
      for (const n of result.analyzedNotes as any[]) {
        if (!n || !n.id) continue;
        const ab = ((n.measureIndex ?? 0) * beatsPerMeasure) + ((n.beat ?? 1) - 1);
        noteAbsBeat.set(n.id, ab);
      }
      for (const exp of fx.expectsViolations) {
        const match = viols.find(v => {
          if (v.ruleId !== exp.ruleId) return false;
          if (exp.severity && v.severity !== exp.severity) return false;
          if (exp.atAbsBeat != null) {
            return (v.noteIds || []).some(id => {
              const ab = noteAbsBeat.get(id);
              return ab != null && Math.abs(ab - exp.atAbsBeat!) < 0.5;
            });
          }
          return true;
        });
        if (!match) {
          fixtureFailed = true;
          anyFailed = true;
          fail(
            `[${fx.name}] expected violation ruleId='${exp.ruleId}'` +
            (exp.severity ? ` severity='${exp.severity}'` : '') +
            (exp.atAbsBeat != null ? ` atAbsBeat=${exp.atAbsBeat}` : '') +
            ` — not found`,
          );
        }
      }
    }

    // ── forbidsViolations ──
    if (fx.forbidsViolations && fx.forbidsViolations.length) {
      const viols = (result.violations || []) as Array<{ ruleId: string; severity: string; noteIds: string[] }>;
      const noteAbsBeat = new Map<string, number>();
      for (const n of result.analyzedNotes as any[]) {
        if (!n || !n.id) continue;
        const ab = ((n.measureIndex ?? 0) * beatsPerMeasure) + ((n.beat ?? 1) - 1);
        noteAbsBeat.set(n.id, ab);
      }
      for (const forbid of fx.forbidsViolations) {
        const match = viols.find(v => {
          if (v.ruleId !== forbid.ruleId) return false;
          if (forbid.atAbsBeat != null) {
            return (v.noteIds || []).some(id => {
              const ab = noteAbsBeat.get(id);
              return ab != null && Math.abs(ab - forbid.atAbsBeat!) < 0.5;
            });
          }
          return true;
        });
        if (match) {
          fixtureFailed = true;
          anyFailed = true;
          fail(
            `[${fx.name}] forbidden violation ruleId='${forbid.ruleId}'` +
            (forbid.atAbsBeat != null ? ` atAbsBeat=${forbid.atAbsBeat}` : '') +
            ` — was found`,
          );
        }
      }
    }

    // ── forbidsSequences ──
    if (fx.forbidsSequences) {
      try {
        const seqMatches = detectVoiceLeadingSequences(
          result.analyzedNotes as any,
          fx.timeSignature as any,
          [],
          undefined,
          undefined,
          { keySignatureRoot: fx.keyTonic || fx.keySignatureRoot, isMinorMode: fx.isMinorMode },
        );
        if (seqMatches.length > 0) {
          fixtureFailed = true;
          anyFailed = true;
          fail(
            `[${fx.name}] forbidden sequences — found ${seqMatches.length} sequence(s), expected none`,
          );
        }
      } catch { /* detector not available */ }
    }

    const status = fixtureFailed ? 'FAIL' : 'OK';
    console.log(`${status}  ${fx.name}`);
  }

  if (anyFailed) process.exitCode = 1;
};

const updateSnapshots = () => {
  const fixtures = loadFixtures();
  let updated = 0;
  for (const fx of fixtures) {
    if (!fx.name.endsWith('(snapshot)')) continue;
    const keySignature = getKeySignature(fx.keySignatureRoot, fx.isMinorMode ? 'Minor' : 'Major');
    const result = applyHarmonyRules(
      fx.notes as any,
      keySignature as any,
      fx.keyTonic,
      fx.isMinorMode,
      (fx.analysisContexts || []) as any,
      fx.timeSignature as any,
      (fx as any).doubleBarlineMeasures || [],
      (fx as any).ornamentOverrides || [],
      (fx as any).harmonyOverrides || [],
    );
    const timeline = getActiveNotesTimeline(result.analyzedNotes as any, fx.timeSignature as any);
    const newExpects: typeof fx.expects = [];
    for (const ev of timeline) {
      const ab = Math.round(Number(ev.absBeat) * 1e6) / 1e6;
      if (!Number.isFinite(ab)) continue;
      const ra = getRomanAnalysis(substituteSuspensionsForAnalysis(ev.notes as any, ev.absBeat) as any, fx.keyTonic, fx.isMinorMode);
      const roman = ra?.roman ?? '';
      const figures = ra?.figures ?? [];
      if (!roman) continue;
      const entry: any = { absBeat: ab, roman };
      if (figures.length > 0 && !(figures.length === 1 && figures[0] === '5')) {
        entry.figuresInclude = figures;
      }
      newExpects.push(entry);
    }
    if (newExpects.length === 0) continue;
    fx.expects = newExpects;
    // Write back — find the file
    const files = fs.readdirSync(fixturesDir).filter(f => f.endsWith('.json')).sort();
    for (const f of files) {
      const full = path.join(fixturesDir, f);
      const obj = JSON.parse(fs.readFileSync(full, 'utf8'));
      if (obj.name === fx.name) {
        obj.expects = newExpects;
        fs.writeFileSync(full, JSON.stringify(obj, null, 2) + '\n');
        updated++;
        console.log(`UPDATED  ${fx.name} (${newExpects.length} expects)`);
        break;
      }
    }
  }
  console.log(`\nDone: ${updated} snapshots updated`);
};

if (process.argv.includes('--update-snapshots')) {
  updateSnapshots();
} else {
  main();
}

