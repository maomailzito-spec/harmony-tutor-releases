/**
 * Che ritmo esce quando il ritmo armonico e' SCELTO.
 *
 * L'utente: «se scelgo un valore produce diversi errori ritmici». Qui si guarda
 * dove finiscono gli accordi e che durata prendono, su una melodia con valori
 * misti — semiminime, crome, minime — che e' il caso che ha provato.
 *
 *   npx tsx scripts/sonda-ritmo-armonico.ts [movimenti]
 */
import { autoHarmonize, realizeChorale, type SopranoConstraint, type ChoralConfig } from '../src/engine/choralRealization';

const ritmo = Number(process.argv[2] ?? 2);
const ts = { numerator: 4, denominator: 4 };

// Do maggiore, valori misti: minima, due crome, semiminima | semiminima ×2, minima …
const melodia: { midi: number; measure: number; beat: number; dur: string }[] = [
  { midi: 72, measure: 0, beat: 1,   dur: 'half'    },
  { midi: 74, measure: 0, beat: 3,   dur: 'eighth'  },
  { midi: 76, measure: 0, beat: 3.5, dur: 'eighth'  },
  { midi: 77, measure: 0, beat: 4,   dur: 'quarter' },
  { midi: 76, measure: 1, beat: 1,   dur: 'quarter' },
  { midi: 74, measure: 1, beat: 2,   dur: 'quarter' },
  { midi: 72, measure: 1, beat: 3,   dur: 'half'    },
];

const vincoli: SopranoConstraint[] = melodia.map(m => ({ midi: m.midi, measure: m.measure, beat: m.beat }));

console.log(`\nLA MELODIA (dove attacca ogni nota)`);
for (const m of melodia) console.log(`   mis ${m.measure + 1} b${m.beat}  midi ${m.midi}  ${m.dur}`);

const prog = autoHarmonize(vincoli, 'C', false, ritmo, 4);
console.log(`\nGLI ACCORDI SCELTI  (ritmo armonico = ${ritmo || 'per nota'})`);
for (const c of prog) console.log(`   mis ${(c.measure ?? 0) + 1} b${c.beat}  ${c.roman}`);

console.log(`\nSI POSANO SU UN ATTACCO VERO DELLA MELODIA?`);
const attacchi = new Set(melodia.map(m => `${m.measure}:${m.beat}`));
let fuori = 0;
for (const c of prog) {
  const k = `${c.measure}:${c.beat}`;
  const ok = attacchi.has(k);
  if (!ok) fuori++;
  console.log(`   mis ${(c.measure ?? 0) + 1} b${c.beat}  ${ok ? 'sì' : 'NO — qui la melodia non attacca niente'}`);
}
console.log(`   → ${fuori} accordi su ${prog.length} cadono nel vuoto`);

const config: ChoralConfig = {
  tonic: 'C', isMinor: false, timeSignature: ts as any,
  rules: { allowParallel5ths: false, allowParallel8ves: false, allowCrossing: false, allowOverlap: false, doubleRoot: true },
  sopranoMelody: vincoli,
};
const res = realizeChorale(prog, config);

console.log(`\nLE NOTE GENERATE, misura per misura`);
const perMisura = new Map<number, any[]>();
for (const n of res.notes as any[]) {
  if (!perMisura.has(n.measureIndex)) perMisura.set(n.measureIndex, []);
  perMisura.get(n.measureIndex)!.push(n);
}
const VAL: Record<string, number> = { whole: 4, half: 2, quarter: 1, eighth: 0.5, sixteenth: 0.25 };
for (const [m, ns] of [...perMisura.entries()].sort((a, b) => a[0] - b[0])) {
  for (const voce of [1, 2, 3, 4]) {
    const dellaVoce = ns.filter(n => n.voice === voce).sort((a, b) => a.beat - b.beat);
    if (!dellaVoce.length) continue;
    const somma = dellaVoce.reduce((s, n) => s + (VAL[n.duration] || 0) * (n.isDotted ? 1.5 : 1), 0);
    const segno = Math.abs(somma - 4) < 1e-9 ? '' : `   ← LA MISURA FA ${somma}, non 4`;
    console.log(`   mis ${m + 1} voce ${voce}: ` +
      dellaVoce.map(n => `b${n.beat} ${n.duration}${n.isDotted ? '.' : ''}`).join('  ') + segno);
  }
}
console.log('');
