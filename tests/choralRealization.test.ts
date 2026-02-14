/**
 * Unit tests for choralRealization engine.
 * Run: npx tsx tests/choralRealization.test.ts
 *
 * Exit code 0 = all pass, 1 = failures.
 */

import {
  parseRoman,
  buildScale,
  buildNaturalMinorScale,
  getChordTones,
  realizeFirstChord,
  realizeNextChord,
  detectViolations,
  realizeChorale,
  resetNoteIdCounter,
  autoHarmonize,
  type ParsedRoman,
  type ScaleDegreeNote,
  type SATBVoicing,
  type ChoralRules,
  type ChoralConfig,
  type RomanChord,
  type SopranoConstraint,
} from '../src/engine/choralRealization';

// ─── Mini test harness ─────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, msg: string): void {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(msg);
    console.error(`  ✗ ${msg}`);
  }
}

function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    const detail = `${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
    failures.push(detail);
    console.error(`  ✗ ${detail}`);
  }
}

function assertIncludes<T>(arr: T[], value: T, msg: string): void {
  if (arr.includes(value)) {
    passed++;
  } else {
    failed++;
    const detail = `${msg} — ${JSON.stringify(value)} not found in [${arr.map(v => JSON.stringify(v)).join(', ')}]`;
    failures.push(detail);
    console.error(`  ✗ ${detail}`);
  }
}

function section(name: string): void {
  console.log(`\n── ${name} ──`);
}

// ─── Tests: parseRoman ─────────────────────────────────────────────────────

section('parseRoman');

(() => {
  const r = parseRoman('I');
  assertEqual(r.degree, 0, 'I → degree 0');
  assertEqual(r.quality, 'major', 'I → major');
  assertEqual(r.inversion, 0, 'I → root position');
  assertEqual(r.hasSeventh, false, 'I → no seventh');
})();

(() => {
  const r = parseRoman('ii');
  assertEqual(r.degree, 1, 'ii → degree 1');
  assertEqual(r.quality, 'minor', 'ii → minor');
})();

(() => {
  const r = parseRoman('V7');
  assertEqual(r.degree, 4, 'V7 → degree 4');
  assertEqual(r.quality, 'dominant7', 'V7 → dominant7');
  assertEqual(r.hasSeventh, true, 'V7 → has seventh');
  assertEqual(r.inversion, 0, 'V7 → root position');
})();

(() => {
  const r = parseRoman('viio');
  assertEqual(r.degree, 6, 'viio → degree 6');
  assertEqual(r.quality, 'diminished', 'viio → diminished');
})();

(() => {
  const r = parseRoman('IV6');
  assertEqual(r.degree, 3, 'IV6 → degree 3');
  assertEqual(r.inversion, 1, 'IV6 → first inversion');
  assertEqual(r.quality, 'major', 'IV6 → major');
})();

(() => {
  const r = parseRoman('V65');
  assertEqual(r.degree, 4, 'V65 → degree 4');
  assertEqual(r.inversion, 1, 'V65 → first inversion');
  assertEqual(r.hasSeventh, true, 'V65 → has seventh');
  assertEqual(r.quality, 'dominant7', 'V65 → dominant7');
})();

(() => {
  const r = parseRoman('V43');
  assertEqual(r.degree, 4, 'V43 → degree 4');
  assertEqual(r.inversion, 2, 'V43 → second inversion');
  assertEqual(r.hasSeventh, true, 'V43 → has seventh');
})();

(() => {
  const r = parseRoman('V42');
  assertEqual(r.degree, 4, 'V42 → degree 4');
  assertEqual(r.inversion, 3, 'V42 → third inversion');
  assertEqual(r.hasSeventh, true, 'V42 → has seventh');
})();

(() => {
  const r = parseRoman('I64');
  assertEqual(r.degree, 0, 'I64 → degree 0');
  assertEqual(r.inversion, 2, 'I64 → second inversion');
})();

(() => {
  const r = parseRoman('III+');
  assertEqual(r.quality, 'augmented', 'III+ → augmented');
  assertEqual(r.degree, 2, 'III+ → degree 2');
})();

(() => {
  const r = parseRoman('iiø7');
  assertEqual(r.quality, 'halfDim7', 'iiø7 → halfDim7');
  assertEqual(r.hasSeventh, true, 'iiø7 → has seventh');
})();

(() => {
  const r = parseRoman('viio7');
  assertEqual(r.quality, 'dim7', 'viio7 → dim7');
  assertEqual(r.hasSeventh, true, 'viio7 → has seventh');
})();

// ─── Tests: slash notation ─────────────────────────────────────────────────

section('parseRoman — slash notation');

(() => {
  const r = parseRoman('I6/4');
  assertEqual(r.degree, 0, 'I6/4 → degree 0');
  assertEqual(r.inversion, 2, 'I6/4 → second inversion');
  assertEqual(r.quality, 'major', 'I6/4 → major');
})();

(() => {
  const r = parseRoman('V6/5');
  assertEqual(r.degree, 4, 'V6/5 → degree 4');
  assertEqual(r.inversion, 1, 'V6/5 → first inversion');
  assertEqual(r.hasSeventh, true, 'V6/5 → has seventh');
  assertEqual(r.quality, 'dominant7', 'V6/5 → dominant7');
})();

(() => {
  const r = parseRoman('V4/3');
  assertEqual(r.degree, 4, 'V4/3 → degree 4');
  assertEqual(r.inversion, 2, 'V4/3 → second inversion');
  assertEqual(r.hasSeventh, true, 'V4/3 → has seventh');
})();

(() => {
  const r = parseRoman('V4/2');
  assertEqual(r.degree, 4, 'V4/2 → degree 4');
  assertEqual(r.inversion, 3, 'V4/2 → third inversion');
  assertEqual(r.hasSeventh, true, 'V4/2 → has seventh');
})();

(() => {
  const r = parseRoman('I5/3');
  assertEqual(r.degree, 0, 'I5/3 → degree 0');
  assertEqual(r.inversion, 0, 'I5/3 → root position');
})();

// ─── Tests: buildScale ─────────────────────────────────────────────────────

section('buildScale');

(() => {
  const scale = buildScale('C', false);
  assertEqual(scale.length, 7, 'C major scale has 7 notes');
  assertEqual(scale[0].letter, 'C', 'C major: degree 0 = C');
  assertEqual(scale[0].accidental, '', 'C major: C has no accidental');
  assertEqual(scale[1].letter, 'D', 'C major: degree 1 = D');
  assertEqual(scale[2].letter, 'E', 'C major: degree 2 = E');
  assertEqual(scale[3].letter, 'F', 'C major: degree 3 = F');
  assertEqual(scale[4].letter, 'G', 'C major: degree 4 = G');
  assertEqual(scale[5].letter, 'A', 'C major: degree 5 = A');
  assertEqual(scale[6].letter, 'B', 'C major: degree 6 = B');
  // All naturals
  for (let i = 0; i < 7; i++) {
    assertEqual(scale[i].accidental, '', `C major: degree ${i} has no accidental`);
  }
})();

(() => {
  const scale = buildScale('G', false);
  assertEqual(scale[6].letter, 'F', 'G major: degree 6 = F');
  assertEqual(scale[6].accidental, '#', 'G major: F# (leading tone)');
})();

(() => {
  const scale = buildScale('F', false);
  assertEqual(scale[3].letter, 'B', 'F major: degree 3 = B');
  assertEqual(scale[3].accidental, 'b', 'F major: Bb');
})();

(() => {
  const scale = buildScale('Bb', false);
  assertEqual(scale[0].letter, 'B', 'Bb major: root = B');
  assertEqual(scale[0].accidental, 'b', 'Bb major: root has flat');
  assertEqual(scale[3].letter, 'E', 'Bb major: degree 3 = E');
  assertEqual(scale[3].accidental, 'b', 'Bb major: Eb');
})();

(() => {
  // A minor (harmonic) — raised 7th = G#
  const scale = buildScale('A', true);
  assertEqual(scale[0].letter, 'A', 'A minor: root = A');
  assertEqual(scale[6].letter, 'G', 'A minor: degree 6 (leading tone) = G');
  assertEqual(scale[6].accidental, '#', 'A minor (harmonic): G#');
})();

(() => {
  // D minor (harmonic) — raised 7th = C#
  const scale = buildScale('D', true);
  assertEqual(scale[6].letter, 'C', 'D minor: degree 6 = C');
  assertEqual(scale[6].accidental, '#', 'D minor (harmonic): C#');
})();

// ─── Tests: buildNaturalMinorScale ─────────────────────────────────────────

section('buildNaturalMinorScale');

(() => {
  const scale = buildNaturalMinorScale('A');
  assertEqual(scale[6].letter, 'G', 'A natural minor: degree 6 = G');
  assertEqual(scale[6].accidental, '', 'A natural minor: G (no sharp)');
})();

// ─── Tests: getChordTones ──────────────────────────────────────────────────

section('getChordTones');

(() => {
  // I in C major = C-E-G
  const scale = buildScale('C', false);
  const parsed = parseRoman('I');
  const tones = getChordTones(parsed, scale, 'C', false);
  assertEqual(tones.length, 3, 'I → 3 tones (triad)');
  assertEqual(tones[0].letter, 'C', 'I root = C');
  assertEqual(tones[1].letter, 'E', 'I third = E');
  assertEqual(tones[2].letter, 'G', 'I fifth = G');
})();

(() => {
  // V7 in C major = G-B-D-F
  const scale = buildScale('C', false);
  const parsed = parseRoman('V7');
  const tones = getChordTones(parsed, scale, 'C', false);
  assertEqual(tones.length, 4, 'V7 → 4 tones');
  assertEqual(tones[0].letter, 'G', 'V7 root = G');
  assertEqual(tones[1].letter, 'B', 'V7 third = B');
  assertEqual(tones[2].letter, 'D', 'V7 fifth = D');
  if (tones.length >= 4) assertEqual(tones[3].letter, 'F', 'V7 seventh = F');
})();

(() => {
  // ii in C major = D-F-A
  const scale = buildScale('C', false);
  const parsed = parseRoman('ii');
  const tones = getChordTones(parsed, scale, 'C', false);
  assertEqual(tones[0].letter, 'D', 'ii root = D');
  assertEqual(tones[1].letter, 'F', 'ii third = F');
  assertEqual(tones[2].letter, 'A', 'ii fifth = A');
})();

(() => {
  // viio in C major = B-D-F (diminished)
  const scale = buildScale('C', false);
  const parsed = parseRoman('viio');
  const tones = getChordTones(parsed, scale, 'C', false);
  assertEqual(tones[0].letter, 'B', 'viio root = B');
  assertEqual(tones[1].letter, 'D', 'viio third = D');
  assertEqual(tones[2].letter, 'F', 'viio fifth = F');
})();

(() => {
  // V in A minor (harmonic) = E-G#-B
  const scale = buildScale('A', true);
  const parsed = parseRoman('V');
  const tones = getChordTones(parsed, scale, 'A', true);
  assertEqual(tones[0].letter, 'E', 'V in Am root = E');
  assertEqual(tones[1].letter, 'G', 'V in Am third = G');
  assertEqual(tones[1].accidental, '#', 'V in Am third = G# (harmonic minor)');
  assertEqual(tones[2].letter, 'B', 'V in Am fifth = B');
})();

(() => {
  // iv in A minor = D-F-A (natural minor, no raised 7th)
  const scale = buildScale('A', true);
  const parsed = parseRoman('iv');
  const tones = getChordTones(parsed, scale, 'A', true);
  assertEqual(tones[0].letter, 'D', 'iv in Am root = D');
  assertEqual(tones[1].letter, 'F', 'iv in Am third = F');
  assertEqual(tones[2].letter, 'A', 'iv in Am fifth = A');
})();

// ─── Tests: realizeFirstChord ──────────────────────────────────────────────

section('realizeFirstChord');

(() => {
  const scale = buildScale('C', false);
  const parsed = parseRoman('I');
  const tones = getChordTones(parsed, scale, 'C', false);
  const rules: ChoralRules = { doubleRoot: true };
  const voicing = realizeFirstChord(tones, 0, rules);

  assert(voicing !== null, 'I in C → voicing not null');
  if (voicing) {
    assert(voicing.bass >= 40 && voicing.bass <= 60, `Bass in range (MIDI ${voicing.bass})`);
    assert(voicing.tenor >= 48 && voicing.tenor <= 67, `Tenor in range (MIDI ${voicing.tenor})`);
    assert(voicing.alto >= 55 && voicing.alto <= 74, `Alto in range (MIDI ${voicing.alto})`);
    assert(voicing.soprano >= 60 && voicing.soprano <= 79, `Soprano in range (MIDI ${voicing.soprano})`);
    assert(voicing.bass <= voicing.tenor, 'Bass ≤ Tenor');
    assert(voicing.tenor <= voicing.alto, 'Tenor ≤ Alto');
    assert(voicing.alto <= voicing.soprano, 'Alto ≤ Soprano');

    // All notes should be chord tones (C, E, G → pc 0, 4, 7)
    const chordPCs = [0, 4, 7];
    for (const midi of [voicing.soprano, voicing.alto, voicing.tenor, voicing.bass]) {
      assertIncludes(chordPCs, midi % 12, `MIDI ${midi} is a chord tone of C major`);
    }

    // Root (C, pc=0) should be in bass for root position
    assertEqual(voicing.bass % 12, 0, 'Bass is root (C) in root position');
  }
})();

(() => {
  // First inversion: bass = E (pc=4)
  const scale = buildScale('C', false);
  const parsed = parseRoman('I6');
  const tones = getChordTones(parsed, scale, 'C', false);
  const rules: ChoralRules = { doubleRoot: true };
  const voicing = realizeFirstChord(tones, 1, rules);

  assert(voicing !== null, 'I6 in C → voicing not null');
  if (voicing) {
    assertEqual(voicing.bass % 12, 4, 'I6 bass = E (pc=4)');
  }
})();

// ─── Tests: realizeNextChord ───────────────────────────────────────────────

section('realizeNextChord');

(() => {
  const scale = buildScale('C', false);
  const rules: ChoralRules = { doubleRoot: true, allowParallel5ths: false, allowParallel8ves: false };

  // I → IV
  const tones_I = getChordTones(parseRoman('I'), scale, 'C', false);
  const prev = realizeFirstChord(tones_I, 0, rules);
  assert(prev !== null, 'First chord realized');

  if (prev) {
    const tones_IV = getChordTones(parseRoman('IV'), scale, 'C', false);
    const next = realizeNextChord(tones_IV, 0, prev, rules);
    assert(next !== null, 'IV realized after I');

    if (next) {
      // Bass should be F (pc=5)
      assertEqual(next.bass % 12, 5, 'IV bass = F');
      // Voice leading: total motion should be small
      const totalMotion = Math.abs(next.soprano - prev.soprano)
                        + Math.abs(next.alto - prev.alto)
                        + Math.abs(next.tenor - prev.tenor)
                        + Math.abs(next.bass - prev.bass);
      assert(totalMotion <= 20, `Total voice motion ≤ 20 semitones (was ${totalMotion})`);
    }
  }
})();

// ─── Tests: detectViolations ───────────────────────────────────────────────

section('detectViolations');

(() => {
  // Parallel 5ths detection
  const rules: ChoralRules = { allowParallel5ths: false, allowParallel8ves: false };
  const prev: SATBVoicing = { bass: 48, tenor: 55, alto: 60, soprano: 67 }; // C3-G3-C4-G4
  const curr: SATBVoicing = { bass: 50, tenor: 57, alto: 62, soprano: 69 }; // D3-A3-D4-A4 (all move up by 2)

  const violations = detectViolations(prev, curr, 0, 1, rules);
  const has5ths = violations.some(v => v.type === 'parallel-5th');
  assert(has5ths, 'Detects parallel 5ths');
})();

(() => {
  // Voice crossing detection
  const rules: ChoralRules = { allowCrossing: false };
  const prev: SATBVoicing = { bass: 48, tenor: 55, alto: 60, soprano: 67 };
  const curr: SATBVoicing = { bass: 48, tenor: 62, alto: 58, soprano: 67 }; // tenor > alto

  const violations = detectViolations(prev, curr, 0, 2, rules);
  const hasCrossing = violations.some(v => v.type === 'voice-crossing');
  assert(hasCrossing, 'Detects voice crossing (tenor > alto)');
})();

(() => {
  // Spacing violation: S-A > octave
  const rules: ChoralRules = {};
  const prev: SATBVoicing = { bass: 48, tenor: 55, alto: 60, soprano: 67 };
  const curr: SATBVoicing = { bass: 48, tenor: 55, alto: 58, soprano: 72 }; // S-A = 14 semitones

  const violations = detectViolations(prev, curr, 0, 3, rules);
  const hasSpacing = violations.some(v => v.type === 'spacing');
  assert(hasSpacing, 'Detects spacing violation (S-A > octave)');
})();

// ─── Tests: realizeChorale (integration) ───────────────────────────────────

section('realizeChorale — I-IV-V-I in C major');

(() => {
  resetNoteIdCounter();

  const progression: RomanChord[] = [
    { roman: 'I',  beat: 1, measure: 0 },
    { roman: 'IV', beat: 3, measure: 0 },
    { roman: 'V',  beat: 1, measure: 1 },
    { roman: 'I',  beat: 3, measure: 1 },
  ];

  const config: ChoralConfig = {
    tonic: 'C',
    isMinor: false,
    timeSignature: { numerator: 4, denominator: 4 },
  };

  const result = realizeChorale(progression, config);

  // 4 chords × 4 voices = 16 notes
  assertEqual(result.notes.length, 16, '4 chords × 4 voices = 16 notes');

  // All notes should have valid fields
  for (const n of result.notes) {
    assert(typeof n.id === 'string' && n.id.length > 0, `Note has id: ${n.id}`);
    assert(typeof n.pitch === 'string' && n.pitch.length === 1, `Note has pitch letter: ${n.pitch}`);
    assert(typeof n.octave === 'number', `Note has octave: ${n.octave}`);
    assert(typeof n.midi === 'number' && n.midi >= 21 && n.midi <= 108, `Note has valid MIDI: ${n.midi}`);
    assert(typeof n.position === 'number', `Note has position: ${n.position}`);
    assert(typeof n.noteIndex === 'number', `Note has noteIndex: ${n.noteIndex}`);
    assert(n.voice === 1 || n.voice === 2 || n.voice === 3 || n.voice === 4, `Note has valid voice: ${n.voice}`);
    assert(n.clef === 'treble' || n.clef === 'bass', `Note has valid clef: ${n.clef}`);
    assert(typeof n.measureIndex === 'number', `Note has measureIndex: ${n.measureIndex}`);
    assert(typeof n.beat === 'number', `Note has beat: ${n.beat}`);
  }

  // Check voices: each chord should have exactly voices 1,2,3,4
  const chordGroups = new Map<string, typeof result.notes>();
  for (const n of result.notes) {
    const key = `${n.measureIndex}-${n.beat}`;
    if (!chordGroups.has(key)) chordGroups.set(key, []);
    chordGroups.get(key)!.push(n);
  }
  for (const [key, notes] of chordGroups) {
    const voices = notes.map(n => n.voice).sort();
    assertEqual(JSON.stringify(voices), JSON.stringify([1, 2, 3, 4]), `Chord at ${key} has all 4 voices`);
  }

  // Check clefs: voice 1,2 = treble; voice 3,4 = bass
  for (const n of result.notes) {
    if (n.voice === 1 || n.voice === 2) {
      assertEqual(n.clef, 'treble', `Voice ${n.voice} on treble clef`);
    } else {
      assertEqual(n.clef, 'bass', `Voice ${n.voice} on bass clef`);
    }
  }

  console.log(`  Violations: ${result.violations.length}`);
  for (const v of result.violations) {
    console.log(`    ${v.type}: ${v.description} (m${v.measure + 1} b${v.beat})`);
  }
})();

// ─── Tests: realizeChorale — minor key ─────────────────────────────────────

section('realizeChorale — i-iv-V-i in A minor');

(() => {
  resetNoteIdCounter();

  const progression: RomanChord[] = [
    { roman: 'i',  beat: 1, measure: 0 },
    { roman: 'iv', beat: 3, measure: 0 },
    { roman: 'V',  beat: 1, measure: 1 },
    { roman: 'i',  beat: 3, measure: 1 },
  ];

  const config: ChoralConfig = {
    tonic: 'A',
    isMinor: true,
    timeSignature: { numerator: 4, denominator: 4 },
  };

  const result = realizeChorale(progression, config);
  assertEqual(result.notes.length, 16, 'Am: 4 chords × 4 voices = 16 notes');

  // Check V chord has G# (leading tone in harmonic minor)
  const vChordNotes = result.notes.filter(n => n.measureIndex === 1 && n.beat === 1);
  const hasGSharp = vChordNotes.some(n => n.pitch === 'G' && n.midi % 12 === 8);
  assert(hasGSharp, 'V in Am contains G# (raised leading tone)');

  console.log(`  Violations: ${result.violations.length}`);
  for (const v of result.violations) {
    console.log(`    ${v.type}: ${v.description} (m${v.measure + 1} b${v.beat})`);
  }
})();

// ─── Tests: realizeChorale — with inversions ───────────────────────────────

section('realizeChorale — inversions');

(() => {
  resetNoteIdCounter();

  const progression: RomanChord[] = [
    { roman: 'I',   beat: 1, measure: 0 },
    { roman: 'I6',  beat: 2, measure: 0 },
    { roman: 'IV',  beat: 3, measure: 0 },
    { roman: 'V65', beat: 4, measure: 0 },
    { roman: 'I',   beat: 1, measure: 1 },
  ];

  const config: ChoralConfig = {
    tonic: 'C',
    isMinor: false,
    timeSignature: { numerator: 4, denominator: 4 },
  };

  const result = realizeChorale(progression, config);
  assertEqual(result.notes.length, 20, '5 chords × 4 voices = 20 notes');

  // I6: bass should be E (pc=4)
  const i6Bass = result.notes.find(n => n.measureIndex === 0 && n.beat === 2 && n.voice === 4);
  if (i6Bass) {
    assertEqual(i6Bass.midi % 12, 4, 'I6 bass = E');
  }

  // V65: bass should be B (pc=11) — first inversion of V7
  const v65Bass = result.notes.find(n => n.measureIndex === 0 && n.beat === 4 && n.voice === 4);
  if (v65Bass) {
    assertEqual(v65Bass.midi % 12, 11, 'V65 bass = B');
  }

  console.log(`  Violations: ${result.violations.length}`);
})();

// ─── Tests: realizeChorale — flat key ──────────────────────────────────────

section('realizeChorale — Bb major');

(() => {
  resetNoteIdCounter();

  const progression: RomanChord[] = [
    { roman: 'I',  beat: 1, measure: 0 },
    { roman: 'IV', beat: 3, measure: 0 },
    { roman: 'V7', beat: 1, measure: 1 },
    { roman: 'I',  beat: 3, measure: 1 },
  ];

  const config: ChoralConfig = {
    tonic: 'Bb',
    isMinor: false,
    timeSignature: { numerator: 4, denominator: 4 },
  };

  const result = realizeChorale(progression, config);
  assertEqual(result.notes.length, 16, 'Bb major: 16 notes');

  // I in Bb: bass should be Bb (pc=10)
  const iRoot = result.notes.find(n => n.measureIndex === 0 && n.beat === 1 && n.voice === 4);
  if (iRoot) {
    assertEqual(iRoot.midi % 12, 10, 'I in Bb: bass = Bb (pc=10)');
  }

  console.log(`  Violations: ${result.violations.length}`);
})();

// ─── Tests: StaffNote compatibility ────────────────────────────────────────

section('StaffNote field compatibility');

(() => {
  resetNoteIdCounter();

  const progression: RomanChord[] = [
    { roman: 'I', beat: 1, measure: 0 },
  ];

  const config: ChoralConfig = {
    tonic: 'C',
    isMinor: false,
    timeSignature: { numerator: 4, denominator: 4 },
  };

  const result = realizeChorale(progression, config);
  const note = result.notes[0];

  // Verify all critical StaffNote fields exist
  assert('id' in note, 'has id');
  assert('pitch' in note, 'has pitch');
  assert('octave' in note, 'has octave');
  assert('position' in note, 'has position');
  assert('midi' in note, 'has midi');
  assert('noteIndex' in note, 'has noteIndex');
  assert('clef' in note, 'has clef');
  assert('duration' in note, 'has duration');
  assert('isRest' in note, 'has isRest');
  assert('isTriplet' in note, 'has isTriplet');
  assert('isDotted' in note, 'has isDotted');
  assert('measureIndex' in note, 'has measureIndex');
  assert('beat' in note, 'has beat');
  assert('voice' in note, 'has voice');
  assert('startTick' in note, 'has startTick');
  assert('durationTicks' in note, 'has durationTicks');

  assertEqual(note.isRest, false, 'isRest = false');
  assertEqual(note.isTriplet, false, 'isTriplet = false');
  assertEqual(note.isDotted, false, 'isDotted = false');
})();

// ─── Tests: edge cases ────────────────────────────────────────────────────

section('Edge cases');

(() => {
  // Empty progression
  const result = realizeChorale([], {
    tonic: 'C', isMinor: false, timeSignature: { numerator: 4, denominator: 4 },
  });
  assertEqual(result.notes.length, 0, 'Empty progression → 0 notes');
  assertEqual(result.violations.length, 0, 'Empty progression → 0 violations');
})();

(() => {
  // Single chord
  resetNoteIdCounter();
  const result = realizeChorale(
    [{ roman: 'I', beat: 1, measure: 0 }],
    { tonic: 'C', isMinor: false, timeSignature: { numerator: 4, denominator: 4 } }
  );
  assertEqual(result.notes.length, 4, 'Single chord → 4 notes');
})();

(() => {
  // V7 should produce 4 unique pitch classes (no doubling in 7th chords)
  resetNoteIdCounter();
  const scale = buildScale('C', false);
  const parsed = parseRoman('V7');
  const tones = getChordTones(parsed, scale, 'C', false);
  assertEqual(tones.length, 4, 'V7 has 4 tones');

  const pcs = tones.map(t => {
    const semi = ({'C':0,'D':2,'E':4,'F':5,'G':7,'A':9,'B':11} as any)[t.letter] ?? 0;
    let adj = semi;
    for (const ch of t.accidental) {
      if (ch === '#') adj++;
      if (ch === 'b') adj--;
    }
    return ((adj % 12) + 12) % 12;
  });
  const uniquePcs = new Set(pcs);
  assertEqual(uniquePcs.size, 4, 'V7 has 4 unique pitch classes (G, B, D, F)');
})();

// ─── Tests: realizeChorale — soprano constraint ───────────────────────────

section('realizeChorale — soprano constraint (I-IV-V-I in C, fixed melody)');

(() => {
  // Soprano melody: C5, C5, B4, C5 (MIDI 72, 72, 71, 72)
  const sopranoMelody: SopranoConstraint[] = [
    { midi: 72, measure: 0, beat: 1 },
    { midi: 72, measure: 0, beat: 3 },
    { midi: 71, measure: 1, beat: 1 },
    { midi: 72, measure: 1, beat: 3 },
  ];

  const progression: RomanChord[] = [
    { roman: 'I',  measure: 0, beat: 1 },
    { roman: 'IV', measure: 0, beat: 3 },
    { roman: 'V',  measure: 1, beat: 1 },
    { roman: 'I',  measure: 1, beat: 3 },
  ];

  const config: ChoralConfig = {
    tonic: 'C',
    isMinor: false,
    timeSignature: { numerator: 4, denominator: 4 },
    sopranoMelody,
  };

  const result = realizeChorale(progression, config);
  assertEqual(result.notes.length, 16, 'constrained: produces 16 notes (4 chords × 4 voices)');

  // Verify soprano MIDI values match constraints exactly
  const sopranoNotes = result.notes
    .filter(n => n.voice === 1)
    .sort((a, b) => (a.measureIndex ?? 0) !== (b.measureIndex ?? 0) ? (a.measureIndex ?? 0) - (b.measureIndex ?? 0) : (a.beat ?? 1) - (b.beat ?? 1));

  assertEqual(sopranoNotes.length, 4, 'constrained: 4 soprano notes');
  assertEqual(sopranoNotes[0].midi, 72, 'constrained: soprano[0] = C5 (72)');
  assertEqual(sopranoNotes[1].midi, 72, 'constrained: soprano[1] = C5 (72)');
  assertEqual(sopranoNotes[2].midi, 71, 'constrained: soprano[2] = B4 (71)');
  assertEqual(sopranoNotes[3].midi, 72, 'constrained: soprano[3] = C5 (72)');

  // Verify inner voices are within proper ranges
  const altoNotes = result.notes.filter(n => n.voice === 2);
  const tenorNotes = result.notes.filter(n => n.voice === 3);
  const bassNotes = result.notes.filter(n => n.voice === 4);

  for (const n of altoNotes) {
    assert(n.midi >= 55 && n.midi <= 74, `constrained: alto ${n.midi} in range [55,74]`);
  }
  for (const n of tenorNotes) {
    assert(n.midi >= 48 && n.midi <= 67, `constrained: tenor ${n.midi} in range [48,67]`);
  }
  for (const n of bassNotes) {
    assert(n.midi >= 40 && n.midi <= 60, `constrained: bass ${n.midi} in range [40,60]`);
  }
})();

section('realizeChorale — soprano constraint in minor key (i-iv-V-i in Am)');

(() => {
  // Soprano: E5, E5, D#5, E5 (MIDI 76, 76, 75, 76 — not standard for Am but tests constraint)
  // Actually use more realistic: A4, A4, G#4, A4
  const sopranoMelody: SopranoConstraint[] = [
    { midi: 69, measure: 0, beat: 1 },  // A4
    { midi: 69, measure: 0, beat: 3 },  // A4
    { midi: 68, measure: 1, beat: 1 },  // G#4
    { midi: 69, measure: 1, beat: 3 },  // A4
  ];

  const progression: RomanChord[] = [
    { roman: 'i',  measure: 0, beat: 1 },
    { roman: 'iv', measure: 0, beat: 3 },
    { roman: 'V',  measure: 1, beat: 1 },
    { roman: 'i',  measure: 1, beat: 3 },
  ];

  const config: ChoralConfig = {
    tonic: 'A',
    isMinor: true,
    timeSignature: { numerator: 4, denominator: 4 },
    sopranoMelody,
  };

  const result = realizeChorale(progression, config);
  assertEqual(result.notes.length, 16, 'constrained minor: produces 16 notes');

  const sopranoNotes = result.notes
    .filter(n => n.voice === 1)
    .sort((a, b) => (a.measureIndex ?? 0) !== (b.measureIndex ?? 0) ? (a.measureIndex ?? 0) - (b.measureIndex ?? 0) : (a.beat ?? 1) - (b.beat ?? 1));

  assertEqual(sopranoNotes[0].midi, 69, 'constrained minor: soprano[0] = A4 (69)');
  assertEqual(sopranoNotes[1].midi, 69, 'constrained minor: soprano[1] = A4 (69)');
  assertEqual(sopranoNotes[2].midi, 68, 'constrained minor: soprano[2] = G#4 (68)');
  assertEqual(sopranoNotes[3].midi, 69, 'constrained minor: soprano[3] = A4 (69)');
})();

section('realizeChorale — without sopranoMelody still works normally');

(() => {
  const progression: RomanChord[] = [
    { roman: 'I',  measure: 0, beat: 1 },
    { roman: 'V',  measure: 0, beat: 3 },
    { roman: 'I',  measure: 1, beat: 1 },
  ];

  const config: ChoralConfig = {
    tonic: 'C',
    isMinor: false,
    timeSignature: { numerator: 4, denominator: 4 },
    // NO sopranoMelody — should behave as before
  };

  const result = realizeChorale(progression, config);
  assertEqual(result.notes.length, 12, 'unconstrained: produces 12 notes (3 chords × 4 voices)');

  // Soprano should be determined freely by the engine (not constrained)
  const sopranoNotes = result.notes.filter(n => n.voice === 1);
  assertEqual(sopranoNotes.length, 3, 'unconstrained: 3 soprano notes');
  // Just verify they're in soprano range
  for (const n of sopranoNotes) {
    assert(n.midi >= 60 && n.midi <= 79, `unconstrained: soprano ${n.midi} in range [60,79]`);
  }
})();

// ─── Tests: autoHarmonize ──────────────────────────────────────────────────

section('autoHarmonize — C major melody C5-E5-G5-C5');

(() => {
  // Simple C major scale fragment: C5, E5, G5, C5
  const melody: SopranoConstraint[] = [
    { midi: 72, measure: 0, beat: 1 },  // C5
    { midi: 76, measure: 0, beat: 3 },  // E5
    { midi: 79, measure: 1, beat: 1 },  // G5
    { midi: 72, measure: 1, beat: 3 },  // C5
  ];

  const result = autoHarmonize(melody, 'C', false);
  assertEqual(result.length, 4, 'auto: produces 4 chords');

  // First chord should contain C → likely I
  // Last chord should be I (cadence rule)
  assertEqual(result[3].roman, 'I', 'auto: last chord is I');
  assertEqual(result[0].roman, 'I', 'auto: first chord on C5 is I');

  // All chords should have valid roman numerals
  const validRomans = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'viio'];
  const invSuffixes = ['', '6', '6/4', '7', '6/5', '4/3', '4/2'];
  for (const c of result) {
    const base = c.roman.replace(/6\/5$|6\/4$|4\/3$|4\/2$|7$|6$/, '');
    assert(validRomans.includes(base), `auto: ${c.roman} (base=${base}) is a valid diatonic roman`);
  }

  // Positions should match melody
  for (let i = 0; i < 4; i++) {
    assertEqual(result[i].measure, melody[i].measure, `auto: chord ${i} measure matches`);
    assertEqual(result[i].beat, melody[i].beat, `auto: chord ${i} beat matches`);
  }
})();

section('autoHarmonize — A minor melody A4-C5-E5-A4');

(() => {
  const melody: SopranoConstraint[] = [
    { midi: 69, measure: 0, beat: 1 },  // A4
    { midi: 72, measure: 0, beat: 3 },  // C5
    { midi: 76, measure: 1, beat: 1 },  // E5
    { midi: 69, measure: 1, beat: 3 },  // A4
  ];

  const result = autoHarmonize(melody, 'A', true);
  assertEqual(result.length, 4, 'auto minor: produces 4 chords');

  // Last chord should be i
  assertEqual(result[3].roman, 'i', 'auto minor: last chord is i');
  assertEqual(result[0].roman, 'i', 'auto minor: first chord on A4 is i');

  const validRomans = ['i', 'iio', 'III', 'iv', 'V', 'VI', 'viio'];
  for (const c of result) {
    const base = c.roman.replace(/6\/5$|6\/4$|4\/3$|4\/2$|7$|6$/, '');
    assert(validRomans.includes(base), `auto minor: ${c.roman} (base=${base}) is valid`);
  }
})();

section('autoHarmonize — empty melody');

(() => {
  const result = autoHarmonize([], 'C', false);
  assertEqual(result.length, 0, 'auto empty: returns empty array');
})();

section('autoHarmonize — harmonic rhythm grouping (half notes)');

(() => {
  // 8 quarter-note melody in C major: C5 D5 E5 F5 G5 A5 B5 C6
  // With harmonicRhythmBeats=2 → should produce 4 chords (one per half note)
  const melody: SopranoConstraint[] = [
    { midi: 72, measure: 0, beat: 1 },  // C5
    { midi: 74, measure: 0, beat: 2 },  // D5
    { midi: 76, measure: 0, beat: 3 },  // E5
    { midi: 77, measure: 0, beat: 4 },  // F5
    { midi: 79, measure: 1, beat: 1 },  // G5
    { midi: 81, measure: 1, beat: 2 },  // A5
    { midi: 83, measure: 1, beat: 3 },  // B5
    { midi: 84, measure: 1, beat: 4 },  // C6
  ];

  const resultPerNote = autoHarmonize(melody, 'C', false, 0, 4);
  assertEqual(resultPerNote.length, 8, 'harmRhythm=0: 8 chords (per note)');

  const resultHalf = autoHarmonize(melody, 'C', false, 2, 4);
  assertEqual(resultHalf.length, 4, 'harmRhythm=2: 4 chords (per half note)');

  const resultWhole = autoHarmonize(melody, 'C', false, 4, 4);
  assertEqual(resultWhole.length, 2, 'harmRhythm=4: 2 chords (per whole note)');

  // Verify positions: half-note groups start at beats 1 and 3
  assertEqual(resultHalf[0].measure, 0, 'half[0] measure=0');
  assertEqual(resultHalf[0].beat, 1, 'half[0] beat=1');
  assertEqual(resultHalf[1].measure, 0, 'half[1] measure=0');
  assertEqual(resultHalf[1].beat, 3, 'half[1] beat=3');
  assertEqual(resultHalf[2].measure, 1, 'half[2] measure=1');
  assertEqual(resultHalf[2].beat, 1, 'half[2] beat=1');
  assertEqual(resultHalf[3].measure, 1, 'half[3] measure=1');
  assertEqual(resultHalf[3].beat, 3, 'half[3] beat=3');

  // Last chord should still be I (cadence rule applies)
  assertEqual(resultHalf[3].roman, 'I', 'half: last chord is I');
  assertEqual(resultWhole[1].roman, 'I', 'whole: last chord is I');
})();

section('autoHarmonize — auto inversions for smooth bass');

(() => {
  // Longer melody to trigger inversions in middle chords
  // C5, E5, D5, F5, E5, G5, F5, C5
  const melody: SopranoConstraint[] = [
    { midi: 72, measure: 0, beat: 1 },
    { midi: 76, measure: 0, beat: 2 },
    { midi: 74, measure: 0, beat: 3 },
    { midi: 77, measure: 0, beat: 4 },
    { midi: 76, measure: 1, beat: 1 },
    { midi: 79, measure: 1, beat: 2 },
    { midi: 77, measure: 1, beat: 3 },
    { midi: 72, measure: 1, beat: 4 },
  ];

  const result = autoHarmonize(melody, 'C', false);
  assertEqual(result.length, 8, 'autoInv: 8 chords');

  // First and last should be root position (no suffix or just base roman)
  assert(!result[0].roman.includes('6'), 'autoInv: first chord is root position');
  assert(!result[7].roman.includes('6'), 'autoInv: last chord is root position');

  // All should have inversion field
  for (const c of result) {
    assert(c.inversion !== undefined && c.inversion >= 0 && c.inversion <= 2,
      `autoInv: chord ${c.roman} has valid inversion=${c.inversion}`);
  }

  // First & last inversion should be 0 (root)
  assertEqual(result[0].inversion, 0, 'autoInv: first chord inv=0');
  assertEqual(result[7].inversion, 0, 'autoInv: last chord inv=0');

  // At least one middle chord should use an inversion (probability very high with this melody)
  const middleInverted = result.slice(1, -1).some(c => (c.inversion ?? 0) > 0);
  assert(middleInverted, 'autoInv: at least one middle chord uses inversion');
})();

section('autoHarmonize — automatic sevenths');

(() => {
  // Melody designed to trigger V7: C5, B4, C5 (I → V → I cadence)
  // V should get a seventh since it precedes I
  const melody: SopranoConstraint[] = [
    { midi: 72, measure: 0, beat: 1 },  // C5
    { midi: 71, measure: 0, beat: 3 },  // B4
    { midi: 72, measure: 1, beat: 1 },  // C5
  ];

  const result = autoHarmonize(melody, 'C', false);
  assertEqual(result.length, 3, 'auto7th: 3 chords');

  // V (on B4) should have a seventh suffix
  const vChord = result[1];
  const vBase = vChord.roman.replace(/6\/5$|6\/4$|4\/3$|4\/2$|7$|6$/, '');
  assertEqual(vBase, 'V', 'auto7th: middle chord is V-based');
  // Should contain seventh indicator (7, 6/5, 4/3, or 4/2)
  const has7th = /7$|6\/5$|4\/3$|4\/2$/.test(vChord.roman);
  assert(has7th, `auto7th: V chord has seventh suffix: ${vChord.roman}`);

  // Last chord should be I without seventh (stability)
  assertEqual(result[2].roman, 'I', 'auto7th: last chord is plain I');
})();

section('autoHarmonize + realizeChorale integration');

(() => {
  // Full pipeline: auto-harmonize a melody, then realize with soprano constraint
  const melody: SopranoConstraint[] = [
    { midi: 72, measure: 0, beat: 1 },
    { midi: 76, measure: 0, beat: 3 },
    { midi: 79, measure: 1, beat: 1 },
    { midi: 72, measure: 1, beat: 3 },
  ];

  const progression = autoHarmonize(melody, 'C', false);
  const config: ChoralConfig = {
    tonic: 'C',
    isMinor: false,
    timeSignature: { numerator: 4, denominator: 4 },
    sopranoMelody: melody,
  };

  const result = realizeChorale(progression, config);
  assertEqual(result.notes.length, 16, 'auto+realize: 16 notes (4×4)');

  // Soprano should match the melody exactly
  const sopranos = result.notes
    .filter(n => n.voice === 1)
    .sort((a, b) => (a.measureIndex ?? 0) !== (b.measureIndex ?? 0) ? (a.measureIndex ?? 0) - (b.measureIndex ?? 0) : (a.beat ?? 1) - (b.beat ?? 1));

  assertEqual(sopranos[0].midi, 72, 'auto+realize: soprano[0] = 72');
  assertEqual(sopranos[1].midi, 76, 'auto+realize: soprano[1] = 76');
  assertEqual(sopranos[2].midi, 79, 'auto+realize: soprano[2] = 79');
  assertEqual(sopranos[3].midi, 72, 'auto+realize: soprano[3] = 72');
})();

// ─── Summary ───────────────────────────────────────────────────────────────

console.log('\n═══════════════════════════════════════');
console.log(`  PASSED: ${passed}`);
console.log(`  FAILED: ${failed}`);
if (failed > 0) {
  console.log('\n  Failures:');
  for (const f of failures) {
    console.log(`    • ${f}`);
  }
}
console.log('═══════════════════════════════════════\n');

process.exit(failed > 0 ? 1 : 0);
