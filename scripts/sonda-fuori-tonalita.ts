/**
 * Quante note del SOPRANO stanno fuori dalla tonalita' dichiarata nel file?
 *
 * Il banco armonizza in UNA tonalita' sola. Se la melodia modula, il generatore si trova a
 * dover armonizzare note che in quella tonalita' non esistono, e gli scontri cromatici che
 * ne escono sono un artefatto del banco, non un difetto del generatore.
 */
import { readFileSync } from 'fs';
import { tonicaReale } from '../src/utils/relativeMinors';

const MAG = [0, 2, 4, 5, 7, 9, 11];
const MIN = [0, 2, 3, 5, 7, 8, 10, 11]; // naturale + sensibile
const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

for (const f of process.argv.slice(2)) {
  const d = JSON.parse(readFileSync(f, 'utf8'));
  const note = (d.notes || []).filter((n: any) => !n.isRest);
  const radice = d.keySignatureRoot || 'C';
  const minore = !!d.isMinorMode;
  // LA TONICA VERA: `keySignatureRoot` è la fondamentale MAGGIORE relativa. Questa sonda
  // era nata col difetto che serviva a trovare — su un brano in Fa minore leggeva 'Ab' e
  // contava fuori tonalità mezzo soprano.
  const tonica = tonicaReale(radice, minore);
  const tonicaPc = PC[tonica[0]] + (tonica.includes('#') ? 1 : tonica.includes('b') ? -1 : 0);
  const scala = new Set((minore ? MIN : MAG).map(g => (tonicaPc + g + 120) % 12));

  const sop = note.filter((n: any) => (n.voice ?? 1) === 1);
  const fuori = sop.filter((n: any) => !scala.has(((n.midi % 12) + 12) % 12));
  const tutte = note.filter((n: any) => !scala.has(((n.midi % 12) + 12) % 12));
  const quali = new Map<number, number>();
  for (const n of fuori) { const p = ((n.midi % 12) + 12) % 12; quali.set(p, (quali.get(p) || 0) + 1); }

  console.log(`${f.split('/').pop()}  [${tonica}${minore ? ' min' : ' Mag'}]`);
  console.log(`   soprano: ${fuori.length}/${sop.length} note fuori tonalita'` +
    (quali.size ? `  (pc ${[...quali.entries()].map(([p, c]) => `${p}×${c}`).join(' ')})` : ''));
  console.log(`   tutte le voci: ${tutte.length}/${note.length}`);
}
