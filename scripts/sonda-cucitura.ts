/**
 * LA SONDA DELLA CUCITURA.
 *
 * Rifà fuori dall'app il gesto «Inserisci dalla misura N» in modo melodia: tiene le misure
 * 1…N-1 del file così come sono, fa rigenerare il resto dalla sola melodia, incolla i due
 * pezzi come fa `handleApply`, e passa il tutto al checker VERO dell'applicazione.
 *
 * Serve perché la giuntura è il punto più esposto e il meno guardato: il generatore la
 * scrive senza vederla. `SENZA_SEME=1` toglie l'accordo precedente dalla configurazione e
 * riporta al comportamento di prima, per il confronto.
 *
 *   npx tsx scripts/sonda-cucitura.ts "tests/brano.htp" [misura-di-taglio-0based]
 */
import { readFileSync } from 'fs';
import { applyHarmonyRules, getKeySignature } from '../src/utils/musicTheory';
import { autoHarmonize, realizeChorale, type SopranoConstraint, type ChoralConfig } from '../src/engine/choralRealization';
const REL: Record<string,string> = {'C':'A','G':'E','D':'B','A':'F#','E':'C#','B':'G#','F':'D','Bb':'G','Eb':'C','Ab':'F','Db':'Bb'};
const NOMI = ['Do','Do#','Re','Mib','Mi','Fa','Fa#','Sol','Sol#','La','Sib','Si'];
const V: Record<number,string> = {1:'S',2:'A',3:'T',4:'B'};
const f = process.argv[2], DA = Number(process.argv[3] ?? 2);
const d = JSON.parse(readFileSync(f,'utf8'));
const note = (d.notes||[]).filter((n:any)=>!n.isRest);
const radice = d.keySignatureRoot||'C', minore = !!d.isMinorMode;
const tonica = minore ? (REL[radice]||radice) : radice;
const ts = d.timeSignature||{numerator:4,denominator:4};
const bpm = ts.numerator*(4/ts.denominator);
const TPQ = 480, tpm = bpm*TPQ;
const sop = note.filter((n:any)=>(n.voice??1)===1).sort((a:any,b:any)=>(a.measureIndex-b.measureIndex)||(a.beat-b.beat));

const coda: SopranoConstraint[] = sop.filter((n:any)=>(n.measureIndex??0)>=DA)
  .map((n:any)=>({midi:n.midi, measure:(n.measureIndex??0)-DA, beat:n.beat??1}));
const prog = autoHarmonize(coda, tonica, minore, 0, bpm, {corpus:true,condotta:true,frase:true} as any);
// L'ultimo accordo TENUTO: le quattro voci allo startTick più alto prima della ripartenza.
const primaDelTaglio = note.filter((n:any)=>(n.measureIndex??0) < DA);
const ultimoTick = primaDelTaglio.length ? Math.max(...primaDelTaglio.map((n:any)=>n.startTick??0)) : -1;
const notePrecedenti = primaDelTaglio.filter((n:any)=>(n.startTick??0)===ultimoTick);
const SEME = process.env.SENZA_SEME !== '1';
const gen = realizeChorale(prog, { tonic:tonica, isMinor:minore, timeSignature:ts,
  rules:{allowParallel5ths:false,allowParallel8ves:false,allowCrossing:false,allowOverlap:false,doubleRoot:true},
  autoSevenths:true, sopranoMelody:coda,
  ...(SEME && notePrecedenti.length>=4 ? { notePrecedenti } : {}) } as any);

// Come fa handleApply: sposta le note generate di DA misure e le incolla dopo le tenute.
const tenute = note.filter((n:any)=>(n.measureIndex??0) < DA);
const spostate = (gen.notes||[]).filter((n:any)=>!n.isRest).map((n:any)=>({
  ...n, measureIndex:(n.measureIndex??0)+DA, startTick:((n.startTick??0)+DA*tpm),
}));
const cucito = [...tenute, ...spostate];

const ks = getKeySignature(tonica, minore?'Minor':'Major');
const controlla = (nn:any[]) => {
  const r:any = applyHarmonyRules(nn as any, ks as any, tonica, minore, [], ts, [], [], [], {partCount:4});
  const per = new Map(nn.map((n:any)=>[n.id,n]));
  return (r.violations||[]).map((v:any)=>{
    const ms = (v.noteIds||[]).map((id:string)=>per.get(id)).filter(Boolean).map((n:any)=>(n.measureIndex??0)+1);
    return { reg:v.ruleId||v.type, grave:v.severity==='error', mis: ms.length?Math.min(...ms):-1, tutte:ms };
  });
};

const viol = controlla(cucito);
const alGiunto = viol.filter((v:any)=>v.tutte.some((m:number)=>m===DA) && v.tutte.some((m:number)=>m===DA+1));
console.log(`${f.split('/').pop()}  ripartenza da misura ${DA+1}\n`);
const acc = (mis:number, bt:number) => cucito.filter((n:any)=>(n.measureIndex??0)===mis-1 && (n.beat??1)===bt)
  .sort((a:any,b:any)=>(b.voice??1)-(a.voice??1)).map((n:any)=>`${V[n.voice??1]}=${NOMI[n.midi%12]}${Math.floor(n.midi/12)-1}`).join(' ');
const ultimoBeat = Math.max(...cucito.filter((n:any)=>(n.measureIndex??0)===DA-1).map((n:any)=>n.beat??1));
console.log(`  mis ${DA} b${ultimoBeat}  (tenuta)     ${acc(DA, ultimoBeat)}`);
console.log(`  mis ${DA+1} b1  (generata)   ${acc(DA+1, 1)}`);
console.log(`\nviolazioni totali: ${viol.filter((v:any)=>v.grave).length} errori, ${viol.filter((v:any)=>!v.grave).length} avvisi`);
console.log(`ALLA CUCITURA (mis ${DA} → ${DA+1}): ${alGiunto.length}`);
for (const v of alGiunto) console.log(`   ${v.grave?'ERRORE':'avviso'}  ${v.reg}  mis ${v.tutte.join(',')}`);
