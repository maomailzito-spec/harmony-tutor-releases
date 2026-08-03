/**
 * Verifica delle regole d'analisi su esempi minimi scritti a mano.
 *
 * Ogni caso è un frammento di due o tre accordi a quattro voci in Do maggiore,
 * costruito apposta perché una certa regola (o una certa eccezione) debba
 * scattare. Il programma li analizza e confronta quello che esce con quello
 * che ci si aspetta.
 *
 * Si lancia con:   npx tsx scripts/verifica-regole.ts
 */
import { applyHarmonyRules, getKeySignature } from '../src/utils/musicTheory';

const L: any = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const LI: any = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
let uid = 0;

/** "Bb3" + voce (1=Soprano … 4=Basso) + posizione nella sequenza di accordi. */
function nota(nome: string, voce: number, slot: number) {
  const m = nome.match(/^([A-G])(b|#)?(-?\d)$/)!;
  const [, lettera, acc, oct] = m;
  const o = parseInt(oct, 10);
  const alter = acc === 'b' ? -1 : acc === '#' ? 1 : 0;
  const midi = (o + 1) * 12 + L[lettera] + alter;
  return {
    id: `n${++uid}`, pitch: lettera, octave: o, position: (o - 4) * 7 + LI[lettera], midi,
    noteIndex: ((midi % 12) + 12) % 12, clef: voce <= 2 ? 'treble' : 'bass',
    explicitAccidental: null, accidental: acc === 'b' ? 'flat' : acc === '#' ? 'sharp' : 'natural',
    duration: 'half', isRest: false, isTriplet: false, isDuplet: false, isDotted: false,
    measureIndex: slot >= 2 ? 1 : 0, beat: slot % 2 === 0 ? 1 : 3,
    startTick: slot * 1920, durationTicks: 1920, voice: voce,
  };
}

/** Nome in italiano di ogni regola, per stampare verdetti leggibili. */
const NOMI: Record<string, string> = {
  // settima
  'R-12': 'settima non risolta',
  'EXC-7-TRANSFERRED-RES': 'settima: risoluzione presa da un\'altra voce',
  'EXC-7m01': 'settima: risoluzione presa da un\'altra voce',
  'EXC-7-STATIC': 'settima: permanenza',
  'EXC-7-DELAYED': 'settima: risoluzione ritardata',
  'EXC-7-TRANSFER': 'settima: passata ad altra voce',
  'EXC-7-P4-TO7': 'settima: sale di 4ª verso un\'altra settima',
  // quinte e ottave
  'R-01': 'ottave parallele',
  'R-02': 'quinte parallele',
  'R-02c': 'quinte per moto contrario',
  'R-05': 'quinte/ottave nascoste',
  'R-14': 'quinte/ottave nascoste',
  'R-03': 'arrivo all\'unisono',
  'EXC-Hidden-Stepwise': 'nascoste ammesse (grado congiunto)',
  'EXC-Hidden-BassStep': 'nascoste attenuate',
  'EXC-OBL-PERF': 'nascoste per moto obliquo',
  'EXC-STYLE-5': 'quinte di stile',
  'EXC-Unison-Step': 'unisono ammesso',
  'EXC-Unison-Lower': 'unisono ammesso',
  'EXC-Unison-Cadence': 'unisono ammesso',
  // sensibile
  'R-07': 'sensibile non risolta',
  'R-10': 'raddoppio della sensibile',
  'R-10-6': 'raddoppio della sensibile',
  'EXC-LT-Transfer': 'sensibile: la tonica la prende il soprano',
  'EXC-LT-FREE': 'sensibile libera (l\'accordo d\'arrivo non è la tonica)',
  'EXC-LT-Chromatic-Line': 'sensibile in linea cromatica',
  // falsa relazione
  'R-09': 'falsa relazione cromatica',
  'R-09-TRITONE': 'falsa relazione di tritono',
};

/** Quali regole guarda ogni famiglia (le altre segnalazioni vengono ignorate). */
const FAMIGLIE: Record<string, (id: string) => boolean> = {
  'settima': (id) => id === 'R-12' || id.startsWith('EXC-7'),
  'quinte e ottave': (id) => ['R-01', 'R-02', 'R-02c', 'R-05', 'R-14', 'R-03'].includes(id)
    || id.startsWith('EXC-Hidden') || id === 'EXC-OBL-PERF' || id === 'EXC-STYLE-5' || id.startsWith('EXC-Unison'),
  'sensibile': (id) => id === 'R-07' || id === 'R-10' || id === 'R-10-6' || id.startsWith('EXC-LT'),
  'falsa relazione': (id) => id === 'R-09',
  'falsa relazione di tritono': (id) => id === 'R-09-TRITONE',
};

const COLORE: Record<string, string> = { error: 'ROSSA', warning: 'ARANCIONE', exception: 'VERDE' };

type Caso = { famiglia: string; nome: string; atteso: string; accordi: string[][] };

// Ogni accordo si scrive [Soprano, Contralto, Tenore, Basso].
const CASI: Caso[] = [
  // ───────────────────────── settima ─────────────────────────
  { famiglia: 'settima', nome: 'la settima scende di grado (risoluzione regolare)', atteso: 'niente',
    accordi: [['D5', 'F4', 'B3', 'G3'], ['C5', 'E4', 'C4', 'C3']] },
  { famiglia: 'settima', nome: 'la settima sale e nessuno raccoglie la risoluzione', atteso: 'ROSSA settima non risolta',
    accordi: [['D5', 'F4', 'B3', 'G3'], ['C5', 'G4', 'G3', 'C3']] },
  { famiglia: 'settima', nome: 'la settima sale, ma il soprano canta la risoluzione', atteso: 'VERDE settima: risoluzione presa da un\'altra voce',
    accordi: [['D5', 'F4', 'B3', 'G3'], ['E5', 'G4', 'C4', 'C3']] },
  { famiglia: 'settima', nome: 'la settima salta, la risoluzione la prende il basso', atteso: 'VERDE settima: risoluzione presa da un\'altra voce',
    accordi: [['F5', 'D5', 'B3', 'G3'], ['C5', 'G4', 'C4', 'E3']] },
  { famiglia: 'settima', nome: 'la settima resta ferma e diventa consonante', atteso: 'VERDE settima: permanenza',
    accordi: [['D5', 'F4', 'B3', 'G3'], ['C5', 'F4', 'A3', 'F3']] },
  { famiglia: 'settima', nome: 'la settima risolve un accordo dopo', atteso: 'VERDE settima: risoluzione ritardata',
    accordi: [['D5', 'F4', 'B3', 'G3'], ['C5', 'G4', 'C4', 'C3'], ['C5', 'E4', 'G3', 'C3']] },
  { famiglia: 'settima', nome: 'la settima passa a un\'altra voce e lì risolve', atteso: 'VERDE settima: passata ad altra voce',
    accordi: [['D5', 'F4', 'B3', 'G3'], ['F5', 'A4', 'C4', 'D3'], ['E5', 'G4', 'C4', 'C3']] },
  { famiglia: 'settima', nome: 'la settima sale di 4ª verso un\'altra settima', atteso: 'VERDE settima: sale di 4ª verso un\'altra settima',
    accordi: [['C5', 'F4', 'B3', 'G3'], ['C5', 'Bb4', 'E4', 'C3']] },
  { famiglia: 'settima', nome: 'l\'accordo d\'arrivo non ha nessuna nota che possa risolverla', atteso: 'ROSSA settima non risolta',
    accordi: [['F5', 'B4', 'D4', 'G3'], ['C5', 'G4', 'C4', 'C3']] },

  // ──────────────────── quinte e ottave ────────────────────
  { famiglia: 'quinte e ottave', nome: 'ottave parallele fra soprano e basso', atteso: 'ROSSA ottave parallele',
    accordi: [['C5', 'G4', 'E4', 'C3'], ['D5', 'A4', 'F4', 'D3']] },
  { famiglia: 'quinte e ottave', nome: 'quinte parallele fra tenore e basso', atteso: 'ROSSA quinte parallele',
    accordi: [['C5', 'E4', 'G3', 'C3'], ['C5', 'F4', 'A3', 'D3']] },
  { famiglia: 'quinte e ottave', nome: 'due quinte di seguito per moto contrario', atteso: 'ROSSA quinte per moto contrario',
    accordi: [['C5', 'E4', 'G3', 'C3'], ['B4', 'G4', 'D4', 'G2']] },
  { famiglia: 'quinte e ottave', nome: 'ottava nascosta: voci estreme nella stessa direzione (V→I)', atteso: 'ARANCIONE quinte/ottave nascoste',
    accordi: [['D5', 'D4', 'B3', 'G3'], ['C5', 'E4', 'C4', 'C3']] },
  { famiglia: 'quinte e ottave', nome: 'quinta nascosta: voci estreme per salto nella stessa direzione', atteso: 'ARANCIONE quinte/ottave nascoste',
    accordi: [['F5', 'D4', 'A3', 'D3'], ['D5', 'G4', 'B3', 'G2']] },
  { famiglia: 'quinte e ottave', nome: 'quinta nascosta col soprano per grado, verso il I grado (ammessa)', atteso: 'VERDE',
    accordi: [['F4', 'D4', 'B3', 'G2'], ['G4', 'E4', 'C4', 'C3']] },
  { famiglia: 'quinte e ottave', nome: 'condotta pulita (niente parallele né nascoste)', atteso: 'niente',
    accordi: [['G4', 'E4', 'G3', 'C3'], ['F4', 'C4', 'A3', 'F3']] },

  // ────────────────────── sensibile ──────────────────────
  { famiglia: 'sensibile', nome: 'la sensibile sale alla tonica (risoluzione regolare)', atteso: 'niente',
    accordi: [['B4', 'G4', 'D4', 'G3'], ['C5', 'G4', 'E4', 'C3']] },
  { famiglia: 'sensibile', nome: 'la sensibile al soprano non risolve e scende per salto', atteso: 'ROSSA sensibile non risolta',
    accordi: [['B4', 'G4', 'D4', 'G3'], ['G4', 'E4', 'C4', 'C3']] },
  { famiglia: 'sensibile', nome: 'la sensibile in voce interna non risolve, ma la tonica la prende il soprano', atteso: 'VERDE sensibile: la tonica la prende il soprano',
    accordi: [['D5', 'B4', 'G4', 'G3'], ['C5', 'G4', 'E4', 'C3']] },
  { famiglia: 'sensibile', nome: 'la sensibile non risolve perché l\'accordo dopo non è la tonica (V→vi)', atteso: 'VERDE sensibile libera',
    accordi: [['D5', 'B4', 'G4', 'G3'], ['A4', 'E4', 'C4', 'A3']] },
  { famiglia: 'sensibile', nome: 'la sensibile scende di semitono dentro una linea cromatica (voce interna)', atteso: 'VERDE sensibile in linea cromatica',
    accordi: [['D5', 'B4', 'G4', 'G3'], ['E5', 'Bb4', 'E4', 'C3']] },
  { famiglia: 'sensibile', nome: 'sensibile raddoppiata (due voci sulla stessa sensibile)', atteso: 'ROSSA raddoppio della sensibile',
    accordi: [['B4', 'G4', 'B3', 'G3'], ['C5', 'G4', 'C4', 'C3']] },

  // ─────────────────── falsa relazione ───────────────────
  { famiglia: 'falsa relazione', nome: 'Sol♯ al basso, poi Sol naturale al tenore (il basso salta via)', atteso: 'ROSSA falsa relazione cromatica',
    accordi: [['B4', 'E4', 'B3', 'G#3'], ['C5', 'E4', 'G3', 'C3']] },
  { famiglia: 'falsa relazione', nome: 'lo stesso cromatismo dentro una voce sola (Mi→Mi♭ al contralto)', atteso: 'niente',
    accordi: [['C5', 'E4', 'G3', 'C3'], ['C5', 'Eb4', 'G3', 'C3']] },
  { famiglia: 'falsa relazione', nome: 'il basso stesso scioglie il cromatismo (Sol♯→Sol)', atteso: 'niente',
    accordi: [['E5', 'B4', 'E4', 'G#3'], ['G4', 'E4', 'C4', 'G3']] },
  { famiglia: 'falsa relazione', nome: 'nessuna alterazione in gioco', atteso: 'niente',
    accordi: [['C5', 'E4', 'G3', 'C3'], ['D5', 'F4', 'A3', 'D3']] },

  // ─────────── falsa relazione di tritono (soprano/basso) ───────────
  { famiglia: 'falsa relazione di tritono', nome: 'Si al soprano, poi Fa al basso (parti estreme)', atteso: 'ROSSA falsa relazione di tritono',
    accordi: [['B4', 'G4', 'D4', 'G3'], ['C5', 'A4', 'C4', 'F3']] },
  { famiglia: 'falsa relazione di tritono', nome: 'lo stesso passaggio, ma col Fa in una parte interna (tollerata)', atteso: 'niente',
    accordi: [['B4', 'G4', 'D4', 'G3'], ['A4', 'F4', 'C4', 'A3']] },
  { famiglia: 'falsa relazione di tritono', nome: 'soprano e basso procedono entrambi per semitono (ammessa)', atteso: 'VERDE falsa relazione di tritono',
    accordi: [['B4', 'G4', 'G3', 'E3'], ['C5', 'C4', 'A3', 'F3']] },
  { famiglia: 'falsa relazione di tritono', nome: 'Fa al soprano e Si al basso dentro una cadenza (ammessa)', atteso: 'VERDE falsa relazione di tritono',
    accordi: [['F4', 'C4', 'A3', 'F3'], ['D5', 'G4', 'D4', 'B3'], ['C5', 'G4', 'E4', 'C3']] },
  { famiglia: 'falsa relazione di tritono', nome: 'il tritono sta dentro lo stesso accordo (V7): non è relazione falsa', atteso: 'niente',
    accordi: [['B4', 'F4', 'D4', 'G3'], ['C5', 'E4', 'C4', 'C3']] },
  { famiglia: 'falsa relazione di tritono', nome: 'controllo: il tritono sta dentro una voce sola (salto melodico)', atteso: 'niente',
    accordi: [['F4', 'D4', 'A3', 'D3'], ['B4', 'G4', 'D4', 'G3']] },
];

const ks = getKeySignature('C', 'Major');
let famigliaCorrente = '';
let ok = 0, ko = 0;

for (const c of CASI) {
  if (c.famiglia !== famigliaCorrente) {
    famigliaCorrente = c.famiglia;
    console.log(`\n═══ ${c.famiglia.toUpperCase()} ═══`);
  }
  uid = 0;
  const notes: any[] = [];
  c.accordi.forEach((ch, slot) => ch.forEach((nm, i) => notes.push(nota(nm, i + 1, slot))));

  const res: any = applyHarmonyRules(notes as any, ks as any, 'C', false, [],
    { numerator: 4, denominator: 4 }, [], [], [], { partCount: 4 });

  const dentro = FAMIGLIE[c.famiglia];
  const esiti = [...new Set(((res.violations || []) as any[])
    .filter((v) => dentro(String(v.ruleId)))
    .map((v) => `${COLORE[v.severity] || v.severity} ${NOMI[v.ruleId] || v.ruleId}`))];

  const esce = esiti.length ? esiti.join('  +  ') : 'niente';
  const passa = c.atteso === 'niente'
    ? esiti.length === 0
    : esiti.some((e) => e.startsWith(c.atteso));
  if (passa) ok++; else ko++;

  console.log(`${passa ? ' ok ' : '>>>>'}  ${c.nome}`);
  console.log(`        deve uscire: ${c.atteso}`);
  console.log(`        esce:        ${esce}`);
}

console.log(`\n${ok} casi corretti, ${ko} da guardare.\n`);
