/**
 * LE CORREZIONI MANUALI SONO GENERALIZZABILI?
 *
 * È la domanda che decide se «ornamenti appresi» abbia senso: la stessa situazione riceve
 * la stessa risposta in brani diversi, o ogni correzione vale solo per il suo brano?
 *
 * Sul corpus dell'utente (128 brani, 1641 correzioni con contesto): 78 situazioni
 * ricorrenti, che coprono 1363 correzioni, e nell'85,9% dei casi la situazione ha sempre la
 * stessa risposta. La più frequente ricorre in 49 brani diversi. È conoscenza generale.
 *
 *   npx tsx scripts/prova-ornamenti-appresi.ts tests/*.htp
 */
import { readFileSync } from 'fs';
type Lez = { chiave: string; orn: boolean; tipo: string; file: string };
const lez: Lez[] = [];
const passo = (d: number) => d === 0 ? 'ferma' : Math.abs(d) <= 2 ? (d > 0 ? 'grado su' : 'grado giu')
  : Math.abs(d) <= 4 ? (d > 0 ? 'terza su' : 'terza giu') : (d > 0 ? 'salto su' : 'salto giu');
for (const f of process.argv.slice(2)) {
  let d: any; try { d = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
  const ov: any[] = d.ornamentOverrides || []; if (!ov.length) continue;
  const note = (d.notes || []).filter((n: any) => !n.isRest);
  const perVoce = new Map<number, any[]>();
  for (const n of note) { const v = Number(n.voice ?? 1); if (!perVoce.has(v)) perVoce.set(v, []); perVoce.get(v)!.push(n); }
  for (const l of perVoce.values()) l.sort((a, b) => (a.startTick ?? 0) - (b.startTick ?? 0));
  const per = new Map<string, any>(note.map((n: any) => [n.id, n]));
  for (const o of ov) {
    const n = per.get(o.noteId) ?? note.find((x: any) => x.midi === o.midi && x.measureIndex === o.measureIndex && x.beat === o.beat);
    if (!n) continue;
    const linea = perVoce.get(Number(n.voice ?? 1)) || [];
    const i = linea.indexOf(n); if (i < 0) continue;
    const prima = linea[i - 1], dopo = linea[i + 1];
    if (!prima || !dopo) continue;
    const b = Number(n.beat || 1);
    const metro = (b === Math.floor(b) && (b === 1 || b === 3)) ? 'F' : 'd';
    const dur = String(n.duration || '?').slice(0, 4);
    const chiave = `${metro}|${dur}|${passo(n.midi - prima.midi)}|${passo(dopo.midi - n.midi)}`;
    lez.push({ chiave, orn: o.type !== 'structural', tipo: o.type, file: f });
  }
}
const gruppi = new Map<string, Lez[]>();
for (const l of lez) { if (!gruppi.has(l.chiave)) gruppi.set(l.chiave, []); gruppi.get(l.chiave)!.push(l); }
let coperte = 0, concordi = 0, situazioni = 0;
const righe: [string, number, number, number][] = [];
for (const [k, g] of gruppi) {
  if (g.length < 5) continue;
  situazioni++;
  const orn = g.filter(x => x.orn).length;
  const magg = Math.max(orn, g.length - orn);
  const nFile = new Set(g.map(x => x.file)).size;
  coperte += g.length; concordi += magg;
  righe.push([k, g.length, magg / g.length, nFile]);
}
righe.sort((a, b) => b[1] - a[1]);
console.log(`${lez.length} correzioni con contesto ·  ${situazioni} situazioni ricorrenti (≥5 casi)`);
console.log(`coprono ${coperte} correzioni, e in ${(100 * concordi / coperte).toFixed(1)}% dei casi la situazione ha SEMPRE la stessa risposta\n`);
console.log('metro|durata|come arriva|come riparte        casi   coerenza   file');
for (const [k, n, c, nf] of righe.slice(0, 14))
  console.log(`  ${k.padEnd(42)} ${String(n).padStart(4)}   ${(100 * c).toFixed(0).padStart(4)}%  ${String(nf).padStart(4)}`);
