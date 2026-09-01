/**
 * QUANTE COPPIE COPRE CIASCUNA FAMIGLIA DI RELAZIONE.
 *
 * Sul repertorio di SCUOLA soltanto (Dubois, Delachi, Pedron, Schinelli): il Delamont
 * sposterebbe le frequenze verso relazioni jazz che nel testo scolastico non servono, e i
 * file sintetici gonfierebbero le famiglie costruite apposta per collaudarle.
 *
 * 2939 coppie. Le regole qui sono GREZZE — mancano sequenze, ritardi, scambio modale,
 * napoletana, sesta eccedente — quindi il 38% di «giustapposizione» è un tetto, non un
 * risultato: quelle famiglie mangeranno da lì.
 *
 * Il dato che conta: «accordo ribattuto» (13,3%) più «stesso accordo, altro rivolto»
 * (6,1%) fanno quasi una coppia su cinque. È la famiglia più frequente del repertorio, e
 * la frase giusta lì è NESSUNA frase.
 *
 * TRAPPOLA: raggruppare per ATTACCO invece che per ciò che SUONA falsava tutto — 432
 * «accordi» di una nota sola, e il 31,4% di sigle non riconosciute contro lo 0,9% attuale.
 */
import { readFileSync } from 'fs';
import { applyHarmonyRules, getKeySignature, getRomanAnalysis } from '../src/utils/musicTheory';
import { tonicaReale } from '../src/utils/relativeMinors';
const grado = (r: string) => String(r || '').replace(/[0-9/]+$/, '').replace(/6\/4|6\/5|4\/3|4\/2|6|7|9/g, '').trim();
const IDX: Record<string, number> = { I:0,i:0,II:1,ii:1,'ii°':1,'iio':1,III:2,iii:2,IV:3,iv:3,V:4,v:4,VI:5,vi:5,VII:6,vii:6,'vii°':6,'viio':6 };
const conta: Record<string, number> = {};
const segna = (k: string) => { conta[k] = (conta[k] ?? 0) + 1; };
let coppie = 0, aMeta = 0;
const durate: Record<number, number> = {};
const SCUOLA = /dubois|delachi|pedron|schinelli/i;
for (const f of process.argv.slice(2)) {
  if (!SCUOLA.test(f)) continue;
  let d: any; try { d = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
  const note = (d.notes || []).filter((n: any) => !n.isRest); if (note.length < 8) continue;
  const minore = !!d.isMinorMode, tonica = tonicaReale(d.keySignatureRoot || 'C', minore);
  const ts = d.timeSignature || { numerator: 4, denominator: 4 };
  let an: any[]; try { const ks = getKeySignature(tonica, minore ? 'Minor' : 'Major');
    const r: any = applyHarmonyRules(note as any, ks as any, tonica, minore, (d.analysisContexts || []) as any, ts, [], [], [], { partCount: 4 }); an = r.analyzedNotes || note; } catch { continue; }
  // SI RAGGRUPPA PER CIÒ CHE SUONA, non per gli attacchi. Raggruppando per attacco, un
  // tempo in cui si muove una voce sola dà un «accordo» di una nota: sul repertorio di
  // scuola erano 432 casi su 536 senza sigla — un difetto della misura, non del repertorio.
  const vive = an.filter((n: any) => !n.isRest && Number.isFinite(n.startTick));
  const attacchi = [...new Set(vive.map((n: any) => Number(n.startTick)))].sort((a, b) => a - b);
  const per = new Map<string, any[]>();
  const chiavi: string[] = [];
  for (const t of attacchi) {
    const suonanti = vive.filter((n: any) => {
      const i = Number(n.startTick), d = Number(n.durationTicks ?? 0);
      return i <= t && t < i + d;
    });
    if (suonanti.length < 2) continue;
    const testa = suonanti.find((n: any) => Number(n.startTick) === t) ?? suonanti[0];
    const k = `${testa.measureIndex}:${testa.beat}`;
    if (per.has(k)) continue;
    per.set(k, suonanti); chiavi.push(k);
  }
  const seq = chiavi.map(k => {
    const g = per.get(k)!.filter((x: any) => !x.isPassing && !x.isNeighbor);
    let roman = '?'; try { roman = getRomanAnalysis(g as any, tonica, minore)?.roman ?? '?'; } catch { }
    const basso = g.slice().sort((x: any, y: any) => x.midi - y.midi)[0];
    const dur = Math.max(...g.map((x: any) => Number(x.durationTicks ?? 0)));
    return { k, roman, bassoPc: basso ? ((basso.midi % 12) + 12) % 12 : -1, dur, misura: Number(k.split(':')[0]) };
  });
  const ultimaMis = Math.max(...seq.map(s => s.misura));
  for (let i = 1; i < seq.length; i++) {
    const a = seq[i - 1], b = seq[i];
    if (a.roman === '?' || b.roman === '?') { segna('sigla non riconosciuta'); coppie++; continue; }
    coppie++;
    const ga = grado(a.roman), gb = grado(b.roman);
    const ia = IDX[ga], ib = IDX[gb];
    durate[b.dur] = (durate[b.dur] ?? 0) + 1;
    if (b.misura === Math.floor((ultimaMis + 1) / 2) - 1 || b.misura === ultimaMis) aMeta++;
    // le famiglie, in ordine di specificità
    if (ga === gb && a.bassoPc !== b.bassoPc) { segna('stesso accordo, altro rivolto'); continue; }
    if (ga === gb) { segna('accordo ribattuto'); continue; }
    if (a.roman.includes('/')) {
      const bers = a.roman.split('/')[1];
      if (grado(bers) === gb) { segna('tonicizzazione risolta'); continue; }
      segna('tonicizzazione non risolta'); continue;
    }
    if (ia === 4 && ib === 0) { segna('risoluzione regolare della dominante'); continue; }
    if (ia === 4 && ib === 5) { segna("risoluzione d'inganno"); continue; }
    if (ia === 4 && ib === 3) { segna('dominante → sottodominante (retrocessione)'); continue; }
    if (ia === 6 && ib === 0) { segna('diminuita → tonica'); continue; }
    if ((ia === 1 || ia === 3) && ib === 4) { segna('preparazione della dominante'); continue; }
    if (ia != null && ib != null && ((ia - ib + 7) % 7) === 3) { segna('progressione per quinte discendenti'); continue; }
    if (ia != null && ib != null && ((ib - ia + 7) % 7) === 1) { segna('per grado ascendente'); continue; }
    segna('giustapposizione (nessuna famiglia)');
  }
}
console.log(`${coppie} coppie nel repertorio di scuola\n`);
for (const [k, v] of Object.entries(conta).sort((a, b) => b[1] - a[1]))
  console.log(`   ${String(v).padStart(5)}  ${(100*v/coppie).toFixed(1).padStart(5)}%  ${k}`);
console.log(`\ndurate degli arrivi (tick):`);
for (const [k, v] of Object.entries(durate).sort((a, b) => b[1] - a[1]).slice(0, 5)) console.log(`   ${String(v).padStart(5)}  ${k}`);
console.log(`arrivi a metà o a fine brano: ${aMeta}`);
