/** Le note fuori tonalità della melodia stanno RAGGRUPPATE (= modulazione) o sparse
 *  (= cromatismo di passaggio)? Si misura con la lunghezza media dei tratti consecutivi. */
import { readFileSync, readdirSync } from 'fs';
import * as path from 'path';
import { tonicaReale } from '../src/utils/relativeMinors';
const PC: any = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const righe: any[] = [];
for (const f of readdirSync('tests').filter(x => x.endsWith('.htp'))) {
  let d: any; try { d = JSON.parse(readFileSync(path.join('tests', f), 'utf8')); } catch { continue; }
  const note = (d.notes || []).filter((n: any) => !n.isRest);
  const sop = note.filter((n: any) => (n.voice ?? 1) === 1)
    .sort((a: any, b: any) => (a.measureIndex - b.measureIndex) || (a.beat - b.beat));
  if (sop.length < 20) continue;
  const minore = !!d.isMinorMode;
  const ton = tonicaReale(String(d.keySignatureRoot || 'C'), minore);
  const tp = (PC[ton[0]] ?? 0) + (ton.includes('#') ? 1 : ton.includes('b') ? -1 : 0);
  const scala = new Set((minore ? [0,2,3,5,7,8,10,11] : [0,2,4,5,7,9,11]).map(g => ((tp + g) % 12 + 12) % 12));
  const fuori = sop.map((n: any) => !scala.has(((n.midi % 12) + 12) % 12));
  const quante = fuori.filter(Boolean).length;
  if (quante < 3) continue;
  // tratti consecutivi di note fuori tonalità
  let tratti = 0, dentro = false, maxTratto = 0, cur = 0;
  for (const x of fuori) {
    if (x) { if (!dentro) { tratti++; dentro = true; cur = 0; } cur++; if (cur > maxTratto) maxTratto = cur; }
    else dentro = false;
  }
  righe.push({ f: f.replace('.htp',''), fuori: quante, tot: sop.length,
    pct: Math.round(100 * quante / sop.length), medio: +(quante / tratti).toFixed(1), max: maxTratto });
}
righe.sort((a, b) => b.medio - a.medio || b.pct - a.pct);
console.log(`${'brano'.padEnd(32)}${'fuori'.padStart(8)}${'%'.padStart(5)}${'tratto medio'.padStart(14)}${'più lungo'.padStart(11)}`);
for (const r of righe.slice(0, 16))
  console.log(`${r.f.slice(0,32).padEnd(32)}${String(r.fuori+'/'+r.tot).padStart(8)}${String(r.pct).padStart(5)}${String(r.medio).padStart(14)}${String(r.max).padStart(11)}`);
const raggr = righe.filter(r => r.max >= 3).length;
console.log(`\n${righe.length} brani con almeno 3 note fuori tonalità; ${raggr} hanno un tratto di 3+ note consecutive fuori — cioè MODULANO, non ornamentano.`);
