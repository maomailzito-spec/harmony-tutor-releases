/**
 * Test suite for modalInterchange.ts
 *
 * Usage: npx tsx scripts/_test_modal_interchange.ts
 */
import { isBorrowedChord, shouldBlockTonicization } from '../src/utils/modalInterchange';
import { noteNameToPc } from '../src/utils/cadentialPatterns';

let pass = 0, fail = 0;

function test(desc: string, actual: boolean, expected: boolean) {
  if (actual === expected) {
    console.log(`  OK  ${desc}`);
    pass++;
  } else {
    console.log(`  FAIL ${desc}  (got ${actual}, expected ${expected})`);
    fail++;
  }
}

// ═══════════════════════════════════════════════════════════════════
// 1. Borrowed chords in C major (from C minor)
// ═══════════════════════════════════════════════════════════════════
console.log('\n── Borrowed chords in C major ──');

const C = noteNameToPc('C');

// iv = Fm (root F=5, minor)
test('Fm (iv) in C maj → borrowed', isBorrowedChord(5, 'Minor', C, false).isBorrowed, true);
test('Fm label = iv', isBorrowedChord(5, 'Minor', C, false).label === 'iv', true);

// ♭VI = Ab (root Ab=8, major)
test('Ab (♭VI) in C maj → borrowed', isBorrowedChord(8, 'Major', C, false).isBorrowed, true);
test('Ab label = ♭VI', isBorrowedChord(8, 'Major', C, false).label === '♭VI', true);

// ♭VII = Bb (root Bb=10, major)
test('Bb (♭VII) in C maj → borrowed', isBorrowedChord(10, 'Major', C, false).isBorrowed, true);
test('Bb label = ♭VII', isBorrowedChord(10, 'Major', C, false).label === '♭VII', true);

// ♭III = Eb (root Eb=3, major)
test('Eb (♭III) in C maj → borrowed', isBorrowedChord(3, 'Major', C, false).isBorrowed, true);
test('Eb label = ♭III', isBorrowedChord(3, 'Major', C, false).label === '♭III', true);

// ♭II / N = Db (root Db=1, major)
test('Db (♭II) in C maj → borrowed', isBorrowedChord(1, 'Major', C, false).isBorrowed, true);
test('Db label = ♭II', isBorrowedChord(1, 'Major', C, false).label === '♭II', true);

// ii° = D dim (root D=2, dim)
test('Ddim (ii°) in C maj → borrowed', isBorrowedChord(2, 'Diminished', C, false).isBorrowed, true);
test('Ddim label = ii°', isBorrowedChord(2, 'Diminished', C, false).label === 'ii°', true);

// ═══════════════════════════════════════════════════════════════════
// 2. Diatonic chords should NOT be borrowed
// ═══════════════════════════════════════════════════════════════════
console.log('\n── Diatonic chords in C major (NOT borrowed) ──');

test('C maj (I) → not borrowed', isBorrowedChord(0, 'Major', C, false).isBorrowed, false);
test('Dm (ii) → not borrowed',   isBorrowedChord(2, 'Minor', C, false).isBorrowed, false);
test('Em (iii) → not borrowed',  isBorrowedChord(4, 'Minor', C, false).isBorrowed, false);
test('F maj (IV) → not borrowed', isBorrowedChord(5, 'Major', C, false).isBorrowed, false);
test('G maj (V) → not borrowed',  isBorrowedChord(7, 'Major', C, false).isBorrowed, false);
test('Am (vi) → not borrowed',   isBorrowedChord(9, 'Minor', C, false).isBorrowed, false);

// ═══════════════════════════════════════════════════════════════════
// 3. In minor mode, same chords are diatonic (NOT borrowed)
// ═══════════════════════════════════════════════════════════════════
console.log('\n── Same chords in C minor (NOT borrowed — already diatonic) ──');

test('Fm in C minor → not borrowed', isBorrowedChord(5, 'Minor', C, true).isBorrowed, false);
test('Ab in C minor → not borrowed', isBorrowedChord(8, 'Major', C, true).isBorrowed, false);
test('Bb in C minor → not borrowed', isBorrowedChord(10, 'Major', C, true).isBorrowed, false);

// ═══════════════════════════════════════════════════════════════════
// 4. Borrowed chords in G major (from G minor) — Delamont 44 case
// ═══════════════════════════════════════════════════════════════════
console.log('\n── Borrowed chords in G major (Delamont 44) ──');

const G = noteNameToPc('G');

// iv = Cm (root C=0, minor)
test('Cm (iv) in G maj → borrowed', isBorrowedChord(0, 'Minor', G, false).isBorrowed, true);
test('Cm label = iv', isBorrowedChord(0, 'Minor', G, false).label === 'iv', true);

// ♭VI = Eb (root Eb=3, major)
test('Eb (♭VI) in G maj → borrowed', isBorrowedChord(3, 'Major', G, false).isBorrowed, true);

// ♭II / N = Ab (root Ab=8, major)
test('Ab (♭II/N) in G maj → borrowed', isBorrowedChord(8, 'Major', G, false).isBorrowed, true);

// ♭VII = F (root F=5, major)
test('F (♭VII) in G maj → borrowed', isBorrowedChord(5, 'Major', G, false).isBorrowed, true);

// ═══════════════════════════════════════════════════════════════════
// 5. shouldBlockTonicization — integration test
// ═══════════════════════════════════════════════════════════════════
console.log('\n── shouldBlockTonicization ──');

// In G major, V→Cm should be blocked (Cm is borrowed iv)
test('V→Cm in G maj → block', shouldBlockTonicization(0, 'Minor', 'G', false), true);

// In G major, V→Em should NOT be blocked (Em is diatonic vi)
test('V→Em in G maj → allow', shouldBlockTonicization(4, 'Minor', 'G', false), false);

// In G major, V→D should NOT be blocked (D is diatonic V)
test('V→D in G maj → allow', shouldBlockTonicization(2, 'Major', 'G', false), false);

// In C major, V→Fm should be blocked (Fm is borrowed iv)
test('V→Fm in C maj → block', shouldBlockTonicization(5, 'Minor', 'C', false), true);

// In C minor, V→Fm should NOT be blocked (Fm is diatonic iv)
test('V→Fm in C min → allow', shouldBlockTonicization(5, 'Minor', 'C', true), false);

// In C major, V→Ab should be blocked (Ab is borrowed ♭VI)
test('V→Ab in C maj → block', shouldBlockTonicization(8, 'Major', 'C', false), true);

// ═══════════════════════════════════════════════════════════════════
// 6. Edge: wrong quality should NOT match
// ═══════════════════════════════════════════════════════════════════
console.log('\n── Wrong quality mismatches ──');

// Ab minor in C major — not a standard borrowed chord (♭VI should be major)
test('Abm in C maj → not borrowed', isBorrowedChord(8, 'Minor', C, false).isBorrowed, false);

// F major in C major — IV is diatonic, not borrowed
test('F maj in C maj → not borrowed', isBorrowedChord(5, 'Major', C, false).isBorrowed, false);

// Bb minor in C major — ♭VII should be major
test('Bbm in C maj → not borrowed', isBorrowedChord(10, 'Minor', C, false).isBorrowed, false);

// ═══════════════════════════════════════════════════════════════════
console.log(`\n══════════════════════════════`);
console.log(`  ${pass} passed, ${fail} failed`);
console.log(`══════════════════════════════\n`);
process.exit(fail > 0 ? 1 : 0);
