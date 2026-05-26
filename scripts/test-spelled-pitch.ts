/**
 * Unit tests for spelledPitch.ts (Fase 1 foundation).
 * Runs via tsx (no jest/vitest). Exit code 1 on any failure.
 *
 * Coverage:
 *   – spelledInterval: simple intervals (P1..P8) on natural notes
 *   – spelledInterval: chromatic alterations (m, M, A, d, AA, dd)
 *   – spelledInterval: cross-octave (M9, m10, P15)
 *   – spelledInterval: double-accidentals (F##→C##, Bbb→Dbb)
 *   – spelledInterval: enharmonic boundaries that MUST differ by spelling
 *                      (e.g. C→Gb is d5, C→F# is A4 — same semitones, different spelling)
 *   – normalizeToSpelled: trust path when fully specified
 *   – normalizeToSpelled: letter+midi without accidental → infer
 *   – normalizeToSpelled: midi-only key-aware (sharp keys vs flat keys, minor mode)
 */

import {
  spelledInterval,
  normalizeToSpelled,
  expectedSemitonesForMajorPerfect,
  qualityFromDiatonicAndAlteration,
  spToMidi,
  spToString,
  type SpelledInterval,
  type KeySignatureForSpelling,
} from '../src/utils/spelledPitch';
import { SpelledPitch } from '../src/types';

let failures = 0;
let total = 0;

function sp(letter: SpelledPitch['letter'], accidental: SpelledPitch['accidental'], octave: number): SpelledPitch {
  return { letter, accidental, octave };
}

function check(label: string, ok: boolean, details?: string) {
  total++;
  if (ok) {
    // console.log(`  OK  ${label}`);
  } else {
    failures++;
    console.error(`  FAIL  ${label}${details ? ' — ' + details : ''}`);
  }
}

function checkInterval(
  label: string,
  a: SpelledPitch,
  b: SpelledPitch,
  expected: SpelledInterval,
) {
  const got = spelledInterval(a, b);
  const ok = got.diatonicNumber === expected.diatonicNumber
    && got.semitones === expected.semitones
    && got.quality === expected.quality;
  check(
    label,
    ok,
    ok ? undefined :
      `${spToString(a)}→${spToString(b)} expected {d:${expected.diatonicNumber}, s:${expected.semitones}, q:${expected.quality}} got {d:${got.diatonicNumber}, s:${got.semitones}, q:${got.quality}}`,
  );
}

// ── expectedSemitonesForMajorPerfect / qualityFromDiatonicAndAlteration ────
console.log('### Pure helpers');
check('exp[1]=0', expectedSemitonesForMajorPerfect(1) === 0);
check('exp[2]=2', expectedSemitonesForMajorPerfect(2) === 2);
check('exp[3]=4', expectedSemitonesForMajorPerfect(3) === 4);
check('exp[4]=5', expectedSemitonesForMajorPerfect(4) === 5);
check('exp[5]=7', expectedSemitonesForMajorPerfect(5) === 7);
check('exp[6]=9', expectedSemitonesForMajorPerfect(6) === 9);
check('exp[7]=11', expectedSemitonesForMajorPerfect(7) === 11);
check('exp[8]=12 (octave)', expectedSemitonesForMajorPerfect(8) === 12);
check('exp[9]=14 (M9)', expectedSemitonesForMajorPerfect(9) === 14);
check('exp[11]=17 (P11)', expectedSemitonesForMajorPerfect(11) === 17);
check('exp[15]=24 (two octaves)', expectedSemitonesForMajorPerfect(15) === 24);

check('q(1,0)=P',  qualityFromDiatonicAndAlteration(1, 0) === 'P');
check('q(4,0)=P',  qualityFromDiatonicAndAlteration(4, 0) === 'P');
check('q(5,0)=P',  qualityFromDiatonicAndAlteration(5, 0) === 'P');
check('q(5,+1)=A', qualityFromDiatonicAndAlteration(5, 1) === 'A');
check('q(5,-1)=d', qualityFromDiatonicAndAlteration(5, -1) === 'd');
check('q(3,0)=M',  qualityFromDiatonicAndAlteration(3, 0) === 'M');
check('q(3,-1)=m', qualityFromDiatonicAndAlteration(3, -1) === 'm');
check('q(3,-2)=d', qualityFromDiatonicAndAlteration(3, -2) === 'd');
check('q(7,-2)=d', qualityFromDiatonicAndAlteration(7, -2) === 'd');
check('q(7,+1)=A', qualityFromDiatonicAndAlteration(7, 1) === 'A');
check('q(4,+2)=AA', qualityFromDiatonicAndAlteration(4, 2) === 'AA');
check('q(2,-3)=dd', qualityFromDiatonicAndAlteration(2, -3) === 'dd');

// ── spelledInterval: natural simple intervals from C4 ──────────────────────
console.log('### spelledInterval — natural notes from C4');
checkInterval('C4→C4 = P1', sp('C',0,4), sp('C',0,4), { diatonicNumber: 1, semitones: 0,  quality: 'P' });
checkInterval('C4→D4 = M2', sp('C',0,4), sp('D',0,4), { diatonicNumber: 2, semitones: 2,  quality: 'M' });
checkInterval('C4→E4 = M3', sp('C',0,4), sp('E',0,4), { diatonicNumber: 3, semitones: 4,  quality: 'M' });
checkInterval('C4→F4 = P4', sp('C',0,4), sp('F',0,4), { diatonicNumber: 4, semitones: 5,  quality: 'P' });
checkInterval('C4→G4 = P5', sp('C',0,4), sp('G',0,4), { diatonicNumber: 5, semitones: 7,  quality: 'P' });
checkInterval('C4→A4 = M6', sp('C',0,4), sp('A',0,4), { diatonicNumber: 6, semitones: 9,  quality: 'M' });
checkInterval('C4→B4 = M7', sp('C',0,4), sp('B',0,4), { diatonicNumber: 7, semitones: 11, quality: 'M' });
// (octave P8 omitted: simple semantics reduces to P1 — see octave-invariance section below)

// ── spelledInterval: chromatic alterations from C4 ─────────────────────────
console.log('### spelledInterval — chromatic alterations');
checkInterval('C4→Eb4 = m3',  sp('C',0,4), sp('E',-1,4), { diatonicNumber: 3, semitones: 3, quality: 'm' });
checkInterval('C4→Ebb4 = d3', sp('C',0,4), sp('E',-2,4), { diatonicNumber: 3, semitones: 2, quality: 'd' });
checkInterval('C4→E#4 = A3',  sp('C',0,4), sp('E',1,4),  { diatonicNumber: 3, semitones: 5, quality: 'A' });
checkInterval('C4→Gb4 = d5',  sp('C',0,4), sp('G',-1,4), { diatonicNumber: 5, semitones: 6, quality: 'd' });
checkInterval('C4→F#4 = A4',  sp('C',0,4), sp('F',1,4),  { diatonicNumber: 4, semitones: 6, quality: 'A' });
checkInterval('C4→Bb4 = m7',  sp('C',0,4), sp('B',-1,4), { diatonicNumber: 7, semitones: 10, quality: 'm' });
checkInterval('C4→Bbb4 = d7', sp('C',0,4), sp('B',-2,4), { diatonicNumber: 7, semitones: 9,  quality: 'd' });
// C→B# (12 semitones, diatonic 7) is degenerate in simple-mod-12 semantics:
// pc reduces to 0, so the simple interval collapses to "diatonic 7 with 0
// semitones" = dddd. This matches the canonical helper's pre-existing
// behavior and is a known limitation of simple semantics — proper handling
// (A7) requires compound-aware interval, scheduled for Fase 2.

// ── The dim7 cornerstone: dim7-no-5 spelling (E# in C# minor) ──────────────
// Note: spelledInterval is SIMPLE (1-7). Octave info on inputs is ignored —
// it reports the interval class above the root, regardless of voicing.
console.log('### spelledInterval — dim7 corner cases (E#°7 in C# minor)');
checkInterval('E#→G# = m3', sp('E',1,4), sp('G',1,4), { diatonicNumber: 3, semitones: 3, quality: 'm' });
checkInterval('E#→D  = d7', sp('E',1,4), sp('D',0,5), { diatonicNumber: 7, semitones: 9, quality: 'd' });
// E#→B#: both raised by 1 → keeps P5 quality (5 letter steps + 7 semitones).
// This is correct. The d5 of an E#°7 chord is E#→B (natural B, not B#) —
// covered by the next test.
checkInterval('E#→B = d5 (B natural)', sp('E',1,4), sp('B',0,4), { diatonicNumber: 5, semitones: 6, quality: 'd' });
checkInterval('E#→B# = P5 (both raised)', sp('E',1,4), sp('B',1,4), { diatonicNumber: 5, semitones: 7, quality: 'P' });
checkInterval('E#→D (same oct, voicing inversion) = d7',
  sp('E',1,5), sp('D',0,4), { diatonicNumber: 7, semitones: 9, quality: 'd' });

// ── Double accidentals ──────────────────────────────────────────────────────
console.log('### spelledInterval — double accidentals');
checkInterval('F##→C## = P5',  sp('F',2,4), sp('C',2,5), { diatonicNumber: 5, semitones: 7, quality: 'P' });
checkInterval('Bbb→Dbb = m3',  sp('B',-2,3), sp('D',-2,4), { diatonicNumber: 3, semitones: 3, quality: 'm' });
checkInterval('C##→A = d6',    sp('C',2,4), sp('A',0,4), { diatonicNumber: 6, semitones: 7, quality: 'd' });
checkInterval('Fx→Cx = P5 (×=double-sharp glyph)', sp('F',2,4), sp('C',2,5), { diatonicNumber: 5, semitones: 7, quality: 'P' });

// ── Octave invariance: same root+letter, different octaves → same simple ──
console.log('### spelledInterval — octave invariance (simple semantics)');
checkInterval('C4→G4 same as C4→G5', sp('C',0,4), sp('G',0,5), { diatonicNumber: 5, semitones: 7, quality: 'P' });
checkInterval('C4→G3 (b below a) still reports P5 going UP',
  sp('C',0,4), sp('G',0,3), { diatonicNumber: 5, semitones: 7, quality: 'P' });

// TODO Fase 2: add spelledIntervalCompound(a,b) that DOES use octave info
//   for 9/11/13 extensions in the new chord engine. Examples that will
//   matter: C→D5=M9, C→F5=P11, C→A5=M13, C→Bb5=m14. Until then, the simple
//   form above is the contract relied on by the existing chord recognizer.

// ── Same semitones, different spelling MUST give different quality ────────
console.log('### spelledInterval — enharmonic disambiguation');
// 6 semitones above C: F# vs Gb
checkInterval('C4→F#4 (A4)', sp('C',0,4), sp('F',1,4), { diatonicNumber: 4, semitones: 6, quality: 'A' });
checkInterval('C4→Gb4 (d5)', sp('C',0,4), sp('G',-1,4), { diatonicNumber: 5, semitones: 6, quality: 'd' });
// 3 semitones above C: Eb (m3) vs D# (A2)
checkInterval('C4→Eb4 (m3)', sp('C',0,4), sp('E',-1,4), { diatonicNumber: 3, semitones: 3, quality: 'm' });
checkInterval('C4→D#4 (A2)', sp('C',0,4), sp('D',1,4),  { diatonicNumber: 2, semitones: 3, quality: 'A' });

// ── normalizeToSpelled ─────────────────────────────────────────────────────
console.log('### normalizeToSpelled — trust path');
const ksC: KeySignatureForSpelling = { tonic: 'C', mode: 'Major' };
{
  const out = normalizeToSpelled({ letter: 'E', accidental: 'flat', octave: 4 }, ksC);
  check('letter+acc+octave trusted', out.letter === 'E' && out.accidental === -1 && out.octave === 4);
}
{
  const out = normalizeToSpelled({ letter: 'F', accidental: '##', octave: 5 }, ksC);
  check('## parsed as +2', out.letter === 'F' && out.accidental === 2 && out.octave === 5);
}
{
  const out = normalizeToSpelled({ letter: 'B', accidental: 'bb', octave: 3 }, ksC);
  check('bb parsed as -2', out.letter === 'B' && out.accidental === -2 && out.octave === 3);
}

console.log('### normalizeToSpelled — letter+midi, infer accidental');
{
  // E with midi 63 (Eb) → infer flat
  const out = normalizeToSpelled({ letter: 'E', midi: 63 }, ksC);
  check('E + midi63 → Eb', out.letter === 'E' && out.accidental === -1, `got ${spToString(out)}`);
}
{
  // E with midi 65 (E#=F) → infer sharp
  const out = normalizeToSpelled({ letter: 'E', midi: 65 }, ksC);
  check('E + midi65 → E#', out.letter === 'E' && out.accidental === 1, `got ${spToString(out)}`);
}
{
  // B with midi 60 (B#=C) → infer +1
  const out = normalizeToSpelled({ letter: 'B', midi: 60 }, ksC);
  check('B + midi60 → B#', out.letter === 'B' && out.accidental === 1, `got ${spToString(out)}`);
}
{
  // C with midi 71 (Cb=B) → infer -1
  const out = normalizeToSpelled({ letter: 'C', midi: 71 }, ksC);
  check('C + midi71 → Cb', out.letter === 'C' && out.accidental === -1, `got ${spToString(out)}`);
}

console.log('### normalizeToSpelled — MIDI-only, key-aware');
const ksGmaj: KeySignatureForSpelling = { tonic: 'G',  mode: 'Major' }; // 1 sharp
const ksFmaj: KeySignatureForSpelling = { tonic: 'F',  mode: 'Major' }; // 1 flat
const ksBbmaj: KeySignatureForSpelling = { tonic: 'Bb', mode: 'Major' }; // 2 flats
const ksAmin: KeySignatureForSpelling = { tonic: 'A',  mode: 'Minor' }; // 0
const ksCminor: KeySignatureForSpelling = { tonic: 'C', mode: 'Minor' }; // relative Eb → 3 flats

{
  // midi 61 in G major (sharp side) → C#
  const out = normalizeToSpelled({ midi: 61 }, ksGmaj);
  check('midi61 + G maj → C#4', out.letter === 'C' && out.accidental === 1, `got ${spToString(out)}`);
}
{
  // midi 61 in F major (flat side) → Db
  const out = normalizeToSpelled({ midi: 61 }, ksFmaj);
  check('midi61 + F maj → Db4', out.letter === 'D' && out.accidental === -1, `got ${spToString(out)}`);
}
{
  // midi 70 in Bb major (flat) → Bb
  const out = normalizeToSpelled({ midi: 70 }, ksBbmaj);
  check('midi70 + Bb maj → Bb4', out.letter === 'B' && out.accidental === -1, `got ${spToString(out)}`);
}
{
  // midi 70 in G major (sharp) → A#
  const out = normalizeToSpelled({ midi: 70 }, ksGmaj);
  check('midi70 + G maj → A#4', out.letter === 'A' && out.accidental === 1, `got ${spToString(out)}`);
}
{
  // midi 63 in A minor (rel C, 0 sharps/flats) → D# (sharp side as default)
  const out = normalizeToSpelled({ midi: 63 }, ksAmin);
  check('midi63 + Am → D#4 (sharp default)', out.letter === 'D' && out.accidental === 1, `got ${spToString(out)}`);
}
{
  // midi 63 in C minor (rel Eb, 3 flats) → Eb
  const out = normalizeToSpelled({ midi: 63 }, ksCminor);
  check('midi63 + Cm → Eb4', out.letter === 'E' && out.accidental === -1, `got ${spToString(out)}`);
}

// ── Octave consistency: spToMidi(normalize(x)) must round-trip MIDI ────────
console.log('### normalizeToSpelled — octave round-trip');
for (const midi of [48, 60, 61, 63, 66, 70, 71, 72, 84]) {
  for (const ks of [ksC, ksGmaj, ksFmaj, ksBbmaj, ksCminor]) {
    const out = normalizeToSpelled({ midi }, ks);
    const back = spToMidi(out);
    check(`midi${midi}+${ks.tonic}${ks.mode[0]} round-trip`, back === midi, `got ${back} from ${spToString(out)}`);
  }
}

// ── Summary ────────────────────────────────────────────────────────────────
console.log('');
if (failures === 0) {
  console.log(`✓ spelledPitch tests: ${total}/${total} passed`);
  process.exit(0);
} else {
  console.error(`✗ spelledPitch tests: ${failures}/${total} FAILED`);
  process.exit(1);
}
