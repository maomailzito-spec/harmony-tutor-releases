/**
 * QUALE MOTIVO DECIDE fra la lettura scelta e la seconda.
 *
 * Serve alla spiegazione discorsiva: la frase discriminante («ho letto ii7 e non IV6
 * perché…») si può scrivere solo se il criterio che decide ha un nome. Sul corpus:
 *
 *   5472 accordi · 595 con una seconda lettura (10,9%)
 *      302  50,8%  per leggerlo così si dovrebbe sottintendere un'alterazione non scritta
 *      219  36,8%  accordo più comune            ← l'unico motivo POVERO
 *       43   7,2%  corrispondenza esatta
 *       16   2,7%  la fondamentale è al basso
 *       10   1,7%  manca la quinta
 *        5   0,8%  la grafia scritta conferma la lettura diminuita
 *
 * Cioè: il 59% delle contese ha una ragione dicibile a uno studente, e il motivo debole
 * («più comune») riguarda 219 accordi su 5472 — il 4% del totale. Lì la frase
 * discriminante non si scrive: resta identificazione e funzione.
 */
import { readFileSync } from 'fs';
import { identifyChordCandidates } from '../src/utils/musicTheory';
const conta: Record<string, number> = {};
let tot = 0, contesi = 0, senzaMotivo = 0;
for (const f of process.argv.slice(2)) {
  let d: any; try { d = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
  const note = (d.notes || []).filter((n: any) => !n.isRest);
  const per = new Map<string, any[]>();
  for (const n of note) { const k = `${n.measureIndex}:${n.beat}`; if (!per.has(k)) per.set(k, []); per.get(k)!.push(n); }
  for (const g of per.values()) {
    if (g.length < 3) continue;
    let c: any[]; try { c = identifyChordCandidates(g as any) as any[]; } catch { continue; }
    if (!c || c.length === 0) continue;
    tot++;
    if (c.length < 2 || c[0].score === c[1].score) continue;
    contesi++;
    // Il motivo che decide: quello col divario maggiore fra le due letture.
    const m = (x: any) => new Map<string, number>((x.motivi ?? []).map((y: any) => [y.nome, y.delta]));
    const a = m(c[0]), b = m(c[1]);
    const nomi = new Set([...a.keys(), ...b.keys()]);
    let vince = '', scarto = 0;
    for (const n of nomi) {
      const dd = (a.get(n) ?? 0) - (b.get(n) ?? 0);
      if (Math.abs(dd) > Math.abs(scarto)) { scarto = dd; vince = n; }
    }
    if (!vince) { senzaMotivo++; continue; }
    conta[vince] = (conta[vince] ?? 0) + 1;
  }
}
console.log(`${tot} accordi · ${contesi} con una seconda lettura\n`);
console.log('il motivo che DECIDE:');
for (const [k, v] of Object.entries(conta).sort((a, b) => b[1] - a[1]))
  console.log(`   ${String(v).padStart(4)}  ${(100*v/contesi).toFixed(1).padStart(5)}%  ${k}`);
if (senzaMotivo) console.log(`   ${String(senzaMotivo).padStart(4)}         (nessun motivo registrato)`);
