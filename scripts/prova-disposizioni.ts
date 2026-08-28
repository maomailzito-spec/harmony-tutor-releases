/**
 * PROVA DEL CICLO DELLE DISPOSIZIONI SU SELEZIONE PARZIALE.
 *
 * Enumera tutte le disposizioni di ogni accordo di un brano con vari insiemi di voci
 * libere, ricostruisce le note come fa `handleRevoice`, e controlla due invarianti:
 *
 *   1. le voci NON selezionate non si muovono di un semitono;
 *   2. la nota nuova è la fonte trasportata di OTTAVE ESATTE — altezza, ottava e posizione
 *      sul rigo restano coerenti fra loro (sbagliarla vorrebbe dire disegnarla su una riga
 *      sbagliata).
 *
 *   npx tsx scripts/prova-disposizioni.ts "tests/brano.htp"
 */
import { readFileSync } from 'fs';
import { disposizioniPossibili, grafiaPerClasse } from '../src/engine/disposizioniSelezione';
const LET: Record<string,number> = {C:0,D:2,E:4,F:5,G:7,A:9,B:11};
const IDXL: Record<string,number> = {C:0,D:1,E:2,F:3,G:4,A:5,B:6};
const ACC: Record<string,number> = {sharp:1,flat:-1,'double-sharp':2,'double-flat':-2,natural:0};
const file = process.argv[2];
const d = JSON.parse(readFileSync(file,'utf8'));
const note = (d.notes||[]).filter((n:any)=>!n.isRest && [1,2,3,4].includes(Number(n.voice)));
const ticks = Array.from(new Set(note.map((n:any)=>n.startTick??0))).sort((a:any,b:any)=>a-b) as number[];
let provati=0, guasti=0, totDisp=0;
for (const t of ticks) {
  const acc = note.filter((n:any)=>(n.startTick??0)===t);
  if (acc.length!==4) continue;
  for (const libere of [new Set([2,3]), new Set([3]), new Set([1,2])]) {
    const lista = disposizioniPossibili(acc, libere, null);
    totDisp += lista.length;
    const perClasse = grafiaPerClasse(acc);
    for (const scelta of lista) {
      // le voci bloccate NON si muovono
      for (const v of [1,2,3,4]) if (!libere.has(v)) {
        const o:any = acc.find((n:any)=>Number(n.voice)===v);
        if (Number(o.midi) !== scelta[v as 1]) { guasti++; console.log(`  BLOCCATA MOSSA v${v} mis ${o.measureIndex+1}`); }
      }
      for (const v of [1,2,3,4] as (1|2|3|4)[]) {
        const orig:any = acc.find((n:any)=>Number(n.voice)===v);
        if (Number(orig.midi)===scelta[v]) continue;
        const fonte:any = perClasse.get(((scelta[v]%12)+12)%12) ?? orig;
        const k = Math.round((scelta[v]-Number(fonte.midi))/12);
        const ott = Number(fonte.octave)+k, pos = Number(fonte.position)+7*k;
        provati++;
        // invariante 1: la nota nuova e' la FONTE trasportata di ottave esatte
        if (Number(fonte.midi) + 12*k !== scelta[v]) { guasti++; console.log(`  TRASPORTO ${fonte.pitch}: ${fonte.midi}+12*${k} != ${scelta[v]}`); }
        if (Number(fonte.octave) + k !== ott) { guasti++; console.log('  OTTAVA incoerente'); }
        // invariante 2: posizione sul rigo = indice lettera + (ottava-4)*7
        const posAtteso = IDXL[fonte.pitch] + (ott-4)*7;
        if (posAtteso !== pos) { guasti++; console.log(`  POSIZIONE ${fonte.pitch} ott${ott}: attesa ${posAtteso}, calcolata ${pos}`); }
      }
    }
  }
}
console.log(`${file.split('/').pop()}: ${ticks.length} accordi, ${totDisp} disposizioni, ${provati} note ricostruite → ${guasti} guasti`);
