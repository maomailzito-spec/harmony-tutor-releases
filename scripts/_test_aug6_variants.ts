import { getRomanAnalysis } from '../src/utils/musicTheory';

function mk(pitch: string, octave: number, acc: string | null, voice: number, clef: string): any {
  const basePc: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const altMap: Record<string, number> = { sharp: 1, 'double-sharp': 2, flat: -1, 'double-flat': -2 };
  const alt = acc ? (altMap[acc] || 0) : 0;
  const pc = (basePc[pitch] + alt + 12) % 12;
  const midi = (octave + 1) * 12 + pc;
  return {
    id: `${pitch}${acc||''}${octave}v${voice}`, pitch, octave, midi,
    noteIndex: pc, accidental: acc || 'natural',
    explicitAccidental: acc, userAccidental: acc,
    isRest: false, voice, duration: 'whole', measureIndex: 0, beat: 1, clef,
  };
}

const tests: { name: string; notes: any[]; key: string; minor: boolean; expectRoman: string; expectVariants?: string[]; expectFigs?: string[] }[] = [
  {
    name: '1. Ger+ standard (Db-F-Ab-B)',
    notes: [mk('B',4,null,1,'treble'), mk('F',4,null,2,'treble'), mk('A',3,'flat',3,'bass'), mk('D',3,'flat',4,'bass')],
    key: 'C', minor: false, expectRoman: 'Ger+', expectVariants: undefined,
  },
  {
    name: '2. Ger+ + 8x (Db-Ab-B-D#)',
    notes: [mk('D',5,'sharp',1,'treble'), mk('B',4,null,2,'treble'), mk('A',3,'flat',3,'bass'), mk('D',3,'flat',4,'bass')],
    key: 'C', minor: false, expectRoman: 'Ger+', expectVariants: ['8x'], expectFigs: ['8x'],
  },
  {
    name: '3. Ger+ + 5x (Db-F-A#-B)',
    notes: [mk('B',4,null,1,'treble'), mk('A',4,'sharp',2,'treble'), mk('F',4,null,3,'treble'), mk('D',3,'flat',4,'bass')],
    key: 'C', minor: false, expectRoman: 'Ger+', expectVariants: ['5x'], expectFigs: ['5x'],
  },
  {
    name: '4. Ger+ + 3+ (Db-F#-Ab-B)',
    notes: [mk('B',4,null,1,'treble'), mk('A',3,'flat',3,'bass'), mk('F',4,'sharp',2,'treble'), mk('D',3,'flat',4,'bass')],
    key: 'C', minor: false, expectRoman: 'Ger+', expectVariants: ['3+'], expectFigs: ['3+'],
  },
  {
    name: '5. Ger+ 5x+8x (Db-A#-B-D#)',
    notes: [mk('D',5,'sharp',1,'treble'), mk('B',4,null,2,'treble'), mk('A',3,'sharp',3,'bass'), mk('D',3,'flat',4,'bass')],
    key: 'C', minor: false, expectRoman: 'Ger+', expectVariants: ['8x','5x'],
  },
  {
    name: '7. Ger+ 3++8x (Db-F#-B-D#)',
    notes: [mk('D',5,'sharp',1,'treble'), mk('B',4,null,2,'treble'), mk('F',4,'sharp',3,'treble'), mk('D',3,'flat',4,'bass')],
    key: 'C', minor: false, expectRoman: 'Ger+', expectVariants: ['8x','3+'],
  },
  {
    name: '8. Ger+ 3++5x (Db-F#-A#-B)',
    notes: [mk('B',4,null,1,'treble'), mk('A',4,'sharp',2,'treble'), mk('F',4,'sharp',3,'treble'), mk('D',3,'flat',4,'bass')],
    key: 'C', minor: false, expectRoman: 'Ger+', expectVariants: ['5x','3+'],
  },
  {
    name: 'Fr+ + 3+ (Db-F#-G-B)',
    notes: [mk('B',4,null,1,'treble'), mk('G',4,null,2,'treble'), mk('F',4,'sharp',3,'treble'), mk('D',3,'flat',4,'bass')],
    key: 'C', minor: false, expectRoman: 'Fr+', expectVariants: ['3+'],
  },
  {
    name: 'It+ + 3+ (Db-F#-B)',
    notes: [mk('B',4,null,1,'treble'), mk('F',4,'sharp',2,'treble'), mk('D',3,'flat',4,'bass')],
    key: 'C', minor: false, expectRoman: 'It+', expectVariants: ['3+'],
  },

  // ── INVERSIONS (spec examples) ──

  // Ger+ standard — 1st inversion (bass = F)
  {
    name: 'INV: Ger+ std 1st inv (F-Ab-B-Db)',
    notes: [mk('D',5,'flat',1,'treble'), mk('B',4,null,2,'treble'), mk('A',4,'flat',3,'treble'), mk('F',3,null,4,'bass')],
    key: 'C', minor: false, expectRoman: 'Ger+', expectVariants: undefined,
  },
  // Ger+ standard — 2nd inversion (bass = Ab)
  {
    name: 'INV: Ger+ std 2nd inv (Ab-B-Db-F)',
    notes: [mk('F',4,null,1,'treble'), mk('D',4,'flat',2,'treble'), mk('B',3,null,3,'bass'), mk('A',3,'flat',4,'bass')],
    key: 'C', minor: false, expectRoman: 'Ger+', expectVariants: undefined,
  },
  // Ger+ standard — 3rd inversion (bass = B)
  {
    name: 'INV: Ger+ std 3rd inv (B-Db-F-Ab)',
    notes: [mk('A',4,'flat',1,'treble'), mk('F',4,null,2,'treble'), mk('D',4,'flat',3,'treble'), mk('B',3,null,4,'bass')],
    key: 'C', minor: false, expectRoman: 'Ger+', expectVariants: undefined,
  },

  // Ger+ + 8x — 1st inversion (bass = Ab, root = Db, Db-Ab-B-D#)
  {
    name: 'INV: Ger+8x 1st inv bass=Ab (Ab-B-Db-D#)',
    notes: [mk('D',5,'sharp',1,'treble'), mk('D',5,'flat',2,'treble'), mk('B',4,null,3,'treble'), mk('A',3,'flat',4,'bass')],
    key: 'C', minor: false, expectRoman: 'Ger+', expectVariants: ['8x'], expectFigs: ['8x'],
  },
  // Ger+ + 8x — 2nd inversion (bass = B)
  {
    name: 'INV: Ger+8x 2nd inv bass=B (B-Db-D#-Ab)',
    notes: [mk('A',4,'flat',1,'treble'), mk('D',5,'sharp',2,'treble'), mk('D',4,'flat',3,'treble'), mk('B',3,null,4,'bass')],
    key: 'C', minor: false, expectRoman: 'Ger+', expectVariants: ['8x'], expectFigs: ['8x'],
  },
  // Ger+ + 8x — 3rd inversion (bass = D#)
  {
    name: 'INV: Ger+8x 3rd inv bass=D# (D#-Ab-B-Db)',
    notes: [mk('D',5,'flat',1,'treble'), mk('B',4,null,2,'treble'), mk('A',4,'flat',3,'treble'), mk('D',3,'sharp',4,'bass')],
    key: 'C', minor: false, expectRoman: 'Ger+', expectVariants: ['8x'], expectFigs: ['8x'],
  },

  // Fr+ + 8x — all inversions (Db-G-B-D#)
  {
    name: 'INV: Fr+8x root pos (Db-G-B-D#)',
    notes: [mk('D',5,'sharp',1,'treble'), mk('B',4,null,2,'treble'), mk('G',4,null,3,'treble'), mk('D',3,'flat',4,'bass')],
    key: 'C', minor: false, expectRoman: 'Fr+', expectVariants: ['8x'], expectFigs: ['8x'],
  },
  {
    name: 'INV: Fr+8x 1st inv bass=G (G-B-Db-D#)',
    notes: [mk('D',5,'sharp',1,'treble'), mk('D',5,'flat',2,'treble'), mk('B',4,null,3,'treble'), mk('G',3,null,4,'bass')],
    key: 'C', minor: false, expectRoman: 'Fr+', expectVariants: ['8x'], expectFigs: ['8x'],
  },
  {
    name: 'INV: Fr+8x 2nd inv bass=B (B-Db-D#-G)',
    notes: [mk('G',4,null,1,'treble'), mk('D',5,'sharp',2,'treble'), mk('D',4,'flat',3,'treble'), mk('B',3,null,4,'bass')],
    key: 'C', minor: false, expectRoman: 'Fr+', expectVariants: ['8x'], expectFigs: ['8x'],
  },
  {
    name: 'INV: Fr+8x 3rd inv bass=D# (D#-G-B-Db)',
    notes: [mk('D',5,'flat',1,'treble'), mk('B',4,null,2,'treble'), mk('G',4,null,3,'treble'), mk('D',3,'sharp',4,'bass')],
    key: 'C', minor: false, expectRoman: 'Fr+', expectVariants: ['8x'], expectFigs: ['8x'],
  },

  // Ger+ + 3+ inversion (bass = F#)
  {
    name: 'INV: Ger+3+ bass=F# (F#-Ab-B-Db)',
    notes: [mk('D',5,'flat',1,'treble'), mk('B',4,null,2,'treble'), mk('A',4,'flat',3,'treble'), mk('F',3,'sharp',4,'bass')],
    key: 'C', minor: false, expectRoman: 'Ger+', expectVariants: ['3+'], expectFigs: ['3+'],
  },
];

let pass = 0, fail = 0;
for (const t of tests) {
  const r = getRomanAnalysis(t.notes, t.key, t.minor);
  const roman = r?.roman || '';
  const variants = (r as any)?.aug6Variants || [];
  const figs = r?.figures || [];

  const romanOk = roman === t.expectRoman;
  const varOk = t.expectVariants
    ? t.expectVariants.every(v => variants.includes(v)) && variants.length === t.expectVariants.length
    : variants.length === 0;
  const figOk = t.expectFigs ? t.expectFigs.every(f => figs.some(ff => ff.includes(f))) : true;

  const ok = romanOk && varOk && figOk;
  if (ok) {
    console.log(`✅ ${t.name}: ${roman} variants=${JSON.stringify(variants)} figs=${JSON.stringify(figs)}`);
    pass++;
  } else {
    console.log(`❌ ${t.name}: got ${roman} variants=${JSON.stringify(variants)} figs=${JSON.stringify(figs)}`);
    if (!romanOk) console.log(`   expected roman=${t.expectRoman}`);
    if (!varOk) console.log(`   expected variants=${JSON.stringify(t.expectVariants)}`);
    if (!figOk) console.log(`   expected figs to include ${JSON.stringify(t.expectFigs)}`);
    fail++;
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
