/**
 * LE CAMPATE, non i pilastri: come si apre una progressione, e cosa prepara la
 * dominante finale. Sono le due cose che l'utente aveva nominato accanto alle
 * cadenze, e servono a decidere DOVE vale la pena mettere un modello.
 *
 * Misurato su nove brani:
 *
 *   · SOTTODOMINANTE prima della dominante finale — autori 25%, generatore 14%.
 *     Poco margine: forzarla porterebbe il generatore SOPRA gli autori, e
 *     abbiamo gia' imparato che non e' un traguardo. NON si tocca.
 *   · APERTURA — il generatore apriva due volte su sette con `I6/4`, che e' una
 *     figura di cadenza, non un inizio. Difetto vero, e curato.
 *
 *   npx tsx scripts/apertura-e-preparazione.ts <file.htp> [altri…]
 */
import { readFileSync } from 'fs';
import { applyHarmonyRules, getActiveNotesTimeline, getKeySignature, getRomanAnalysis } from '../src/utils/musicTheory';
import { autoHarmonize, parseRoman, type SopranoConstraint } from '../src/engine/choralRealization';
const REL: Record<string,string> = {C:'A',G:'E',D:'B',A:'F#',E:'C#',B:'G#','F#':'D#',F:'D',Bb:'G',Eb:'C',Ab:'F',Db:'Bb',Gb:'Eb'};
const strut=(n:any)=>n&&!n.isRest&&!n.isPassing&&!n.isNeighbor&&!n.isAnticipation&&!n.isAppoggiatura&&!n.isEscape;
const gr=(s:string)=>{try{return parseRoman(s);}catch{return null;}};
const ePre=(x:any)=>x&&x.secondaryTarget==null&&(x.degree===3||x.degree===1||x.degree===5);
let preA=0,preG=0,domA=0,domG=0; const apreA:Record<string,number>={}, apreG:Record<string,number>={};
for (const f of process.argv.slice(2)) {
  let d:any; try{d=JSON.parse(readFileSync(f,'utf8'))}catch{continue}
  const minore=!!d.isMinorMode, radice=d.keySignatureRoot||'C';
  const tonica=minore?(REL[radice]||radice):radice;
  const ts=d.timeSignature||{numerator:4,denominator:4}; const bpm=ts.numerator*(4/ts.denominator);
  const res:any=applyHarmonyRules(d.notes,getKeySignature(radice,'Major') as any,tonica,minore,
    d.analysisContexts||[],ts,undefined,
    (d.ornamentOverrides||[]).length?d.ornamentOverrides:undefined,
    (d.harmonyOverrides||[]).length?d.harmonyOverrides:undefined);
  const an=res.analyzedNotes||d.notes;
  const linea=getActiveNotesTimeline(an,ts,d.timeSignatureChanges||[]);
  const A:string[]=[]; let p='';
  for(const ev of (linea||[])){const st=(ev.notes as any[]).filter(strut); if(st.length<2)continue;
    const ra=getRomanAnalysis(st as any,tonica,minore); if(!ra?.roman)continue;
    const g=String(ra.roman).replace(/\s+/g,''); if(g&&g!==p){A.push(g);p=g;}}
  const sop=an.filter((n:any)=>n&&!n.isRest&&(Number(n.voice)||1)===1)
    .sort((a:any,b:any)=>((a.measureIndex??0)-(b.measureIndex??0))||((a.beat??1)-(b.beat??1)));
  const v:SopranoConstraint[]=sop.map((n:any)=>({midi:n.midi,measure:n.measureIndex??0,beat:n.beat??1}));
  const G=autoHarmonize(v,tonica,minore,Number(process.env.RITMO||0)||0,bpm).map(c=>String(c.roman));
  // cosa prepara la dominante finale
  for (const [L,cont] of [[A,'A'],[G,'G']] as [string[],string][]) {
    if (L.length<3) continue;
    const pen=gr(L[L.length-2]), ter=gr(L[L.length-3]);
    if (pen && pen.secondaryTarget==null && pen.degree===4) {
      if (cont==='A') domA++; else domG++;
      if (ePre(ter)) { if (cont==='A') preA++; else preG++; }
    }
    const primi = L.slice(0,2).join('→');
    if (cont==='A') apreA[primi]=(apreA[primi]||0)+1; else apreG[primi]=(apreG[primi]||0)+1;
  }
}
const pc=(a:number,b:number)=>b?(100*a/b).toFixed(0)+'%':'—';
console.log(`\nCOSA PREPARA LA DOMINANTE FINALE`);
console.log(`  autori:     ${preA} su ${domA}  (${pc(preA,domA)}) hanno una sottodominante prima`);
console.log(`  generatore: ${preG} su ${domG}  (${pc(preG,domG)})`);
const cima=(o:Record<string,number>)=>Object.entries(o).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,v])=>`${k} ×${v}`).join('   ');
console.log(`\nCOME SI APRE`);
console.log(`  autori:     ${cima(apreA)}`);
console.log(`  generatore: ${cima(apreG)}\n`);
