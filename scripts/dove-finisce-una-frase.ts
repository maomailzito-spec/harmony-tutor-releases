/**
 * DOVE FINISCE UNA FRASE? (e la risposta e': non lo sappiamo)
 *
 * Per estendere i modelli di cadenza alla SEMICADENZA di meta' periodo serve
 * sapere dove la frase finisce davvero. Il generatore oggi taglia a meta' delle
 * battute — un'approssimazione aritmetica — e infatti il giudizio li' e' poco
 * affidabile: gli AUTORI stessi ne escono con 3 semicadenze ben formate su 8,
 * che e' il segno che si sta guardando il punto sbagliato.
 *
 * I segnali disponibili nel corpus, contati:
 *   · CORONE: il modello le prevede, ma NESSUNO dei 380 file ne ha.
 *   · DOPPIE STANGHETTE: solo 21 file su 380.
 *   · NOTE LUNGHE di soprano (almeno il doppio delle vicine): 214 file, 780
 *     occorrenze — l'unico segnale diffuso.
 *
 * Questo script mette alla prova il terzo, che era l'unico candidato: nei punti
 * che individua, gli autori ci fanno davvero una cadenza?
 *
 * RISULTATO: 42,4% su 642 punti, e in 358 non c'e' NESSUNA cadenza. Meta' delle
 * volte li' non si sta chiudendo niente. Il segnale non basta per IMPORRE una
 * cadenza: si finirebbe per metterne una in mezzo a una frase, che e' peggio
 * di non farne.
 *
 *   npx tsx scripts/dove-finisce-una-frase.ts
 */
import { readFileSync, readdirSync } from 'fs';
import { applyHarmonyRules, getActiveNotesTimeline, getKeySignature, getRomanAnalysis } from '../src/utils/musicTheory';
import { giudicaCadenza } from '../src/engine/cadenze';
const REL: Record<string,string> = {C:'A',G:'E',D:'B',A:'F#',E:'C#',B:'G#','F#':'D#',F:'D',Bb:'G',Eb:'C',Ab:'F',Db:'Bb',Gb:'Eb'};
const V: Record<string,number> = {whole:4,half:2,quarter:1,eighth:0.5,sixteenth:0.25};
const dur=(n:any)=>(V[n.duration]||1)*(n.isDotted?1.5:1);
const strut=(n:any)=>n&&!n.isRest&&!n.isPassing&&!n.isNeighbor&&!n.isAnticipation&&!n.isAppoggiatura&&!n.isEscape;
const DAUT=/dubois|pedron|delachi|delamont|schinelli|bach|cantata|corale/i;
let punti=0, buone=0; const specie: Record<string,number>={};
for (const f of readdirSync('tests').sort()) {
  if(!DAUT.test(f)||!/\.(htp|json)$/.test(f)) continue;
  let d:any; try{d=JSON.parse(readFileSync('tests/'+f,'utf8'))}catch{continue}
  if(!Array.isArray(d.notes)||d.notes.length<8) continue;
  const minore=!!d.isMinorMode, radice=d.keySignatureRoot||'C';
  const tonica=minore?(REL[radice]||radice):radice;
  const ts=d.timeSignature||{numerator:4,denominator:4}; const bpm=ts.numerator*(4/ts.denominator);
  let res:any; try{ res=applyHarmonyRules(d.notes,getKeySignature(radice,'Major') as any,tonica,minore,
    d.analysisContexts||[],ts,undefined,
    (d.ornamentOverrides||[]).length?d.ornamentOverrides:undefined,
    (d.harmonyOverrides||[]).length?d.harmonyOverrides:undefined);}catch{continue}
  const an=res.analyzedNotes||d.notes;
  const sop=an.filter((n:any)=>n&&!n.isRest&&(Number(n.voice)||1)===1)
    .sort((a:any,b:any)=>((a.measureIndex??0)-(b.measureIndex??0))||((a.beat??1)-(b.beat??1)));
  // le NOTE LUNGHE: almeno il doppio della precedente e della seguente
  const fini: number[] = [];
  for(let i=1;i<sop.length-1;i++){
    if(dur(sop[i])>=2*dur(sop[i-1]) && dur(sop[i])>=2*dur(sop[i+1]))
      fini.push((sop[i].measureIndex??0)*bpm+((sop[i].beat??1)-1));
  }
  if(!fini.length) continue;
  const linea=getActiveNotesTimeline(an,ts,d.timeSignatureChanges||[]);
  const gradi:string[]=[]; const ab:number[]=[]; let prec='';
  for(const ev of (linea||[])){ const st=(ev.notes as any[]).filter(strut); if(st.length<2)continue;
    const ra=getRomanAnalysis(st as any,tonica,minore); if(!ra?.roman)continue;
    const g=String(ra.roman).replace(/\s+/g,''); if(g&&g!==prec){gradi.push(g);ab.push(ev.absBeat??0);prec=g;} }
  for(const fine of fini){
    const fino=gradi.filter((_,k)=>ab[k]<=fine+1e-6);
    if(fino.length<2) continue;
    punti++;
    const c=giudicaCadenza(fino);
    specie[c.specie]=(specie[c.specie]||0)+1;
    if(c.benFormata) buone++;
  }
}
console.log(`punti di frase individuati (nota lunga di soprano): ${punti}`);
console.log(`di questi, gli AUTORI ci fanno una cadenza ben formata: ${buone}  (${(100*buone/punti).toFixed(1)}%)`);
console.log('che specie:', Object.entries(specie).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k} ${v}`).join('  '));
