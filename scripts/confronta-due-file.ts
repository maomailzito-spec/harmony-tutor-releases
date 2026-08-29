/**
 * AFFIANCA DUE FILE, accordo per accordo: le quattro voci e la sigla che l'analisi legge in
 * ciascuno, marcando dove divergono la SIGLA o la sola disposizione. È lo strumento con cui
 * si guarda un'armonizzazione d'autore accanto a quella del generatore.
 *
 *   npx tsx scripts/confronta-due-file.ts "autore.htp" "generatore.htp"
 */
import { readFileSync } from 'fs';
import { applyHarmonyRules, getKeySignature, getRomanAnalysis } from '../src/utils/musicTheory';
import { tonicaReale } from '../src/utils/relativeMinors';
const NOMI=['Do','Do#','Re','Mib','Mi','Fa','Fa#','Sol','Sol#','La','Sib','Si'];
const V:Record<number,string>={1:'S',2:'A',3:'T',4:'B'};
const leggi=(f:string)=>{
  const d=JSON.parse(readFileSync(f,'utf8'));
  const note=(d.notes||[]).filter((n:any)=>!n.isRest);
  const minore=!!d.isMinorMode, tonica=tonicaReale(d.keySignatureRoot||'C',minore);
  const ts=d.timeSignature||{numerator:4,denominator:4};
  const ks=getKeySignature(tonica,minore?'Minor':'Major');
  const sigle=new Map<string,string>();
  try{
    const r:any=applyHarmonyRules(note as any,ks as any,tonica,minore,[],ts,[],[],[],{partCount:4});
    const an:any[]=r.analyzedNotes||note; const per=new Map<string,any[]>();
    for(const n of an){ if(n.isRest)continue; const k=`${n.measureIndex}:${n.beat}`; if(!per.has(k))per.set(k,[]); per.get(k)!.push(n); }
    for(const [k,g] of per){ const a=getRomanAnalysis(g.filter((x:any)=>!x.isPassing&&!x.isNeighbor) as any,tonica,minore); if(a?.roman)sigle.set(k,a.roman); }
  }catch(e){ console.log('  (analisi fallita)',e); }
  const per=new Map<string,any[]>();
  for(const n of note){ const k=`${n.measureIndex}:${n.beat}`; if(!per.has(k))per.set(k,[]); per.get(k)!.push(n); }
  return {per,sigle,tonica,minore,ts,note,ks};
};
const A=leggi(process.argv[2]), B=leggi(process.argv[3]);
const acc=(m:Map<string,any[]>,k:string)=>{ const g=m.get(k); if(!g)return '—'.padEnd(26);
  const o:Record<number,string>={}; for(const n of g) o[Number(n.voice)]=`${NOMI[n.midi%12]}${Math.floor(n.midi/12)-1}`;
  return [1,2,3,4].map(v=>`${V[v]}=${(o[v]??'·')}`).join(' ').padEnd(26); };
const chiavi=Array.from(new Set([...A.per.keys(),...B.per.keys()]))
  .sort((x,y)=>{const[a,b]=x.split(':').map(Number),[c,d]=y.split(':').map(Number);return (a-c)||(b-d);});
console.log(`${process.argv[2].split('/').pop()}  ·  tonalita ${A.tonica}${A.minore?' min':' Mag'}\n`);
console.log('mis.b   AUTORE                      sigla      GENERATORE                  sigla');
for(const k of chiavi){
  const [m,b]=k.split(':');
  const sA=A.sigle.get(k)??'?', sB=B.sigle.get(k)??'?';
  const diff = acc(A.per,k)!==acc(B.per,k);
  console.log(`${String(Number(m)+1).padStart(3)}.${b}  ${acc(A.per,k)} ${sA.padEnd(9)}  ${acc(B.per,k)} ${sB.padEnd(9)}${sA!==sB?' ←sigla':diff?' ←disp':''}`);
}
const err=(x:any)=>{ try{ const r:any=applyHarmonyRules(x.note as any,x.ks as any,x.tonica,x.minore,[],x.ts,[],[],[],{partCount:4});
  const v=(r.violations||[]); return `${v.filter((z:any)=>z.severity==='error').length} errori, ${v.filter((z:any)=>z.severity!=='error').length} avvisi`;}catch{return '?';} };
console.log(`\nAUTORE: ${err(A)}\nGENERATORE: ${err(B)}`);
