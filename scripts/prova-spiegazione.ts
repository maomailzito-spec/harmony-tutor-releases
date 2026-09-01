/**
 * Stampa il RECORD della spiegazione per ogni accordo di un brano.
 * Serve a guardare cosa il motore sa dire, prima di scrivere le frasi.
 *
 *   npx tsx scripts/prova-spiegazione.ts "tests/brano.htp"
 */
import { readFileSync } from 'fs';
import { applyHarmonyRules, getKeySignature } from '../src/utils/musicTheory';
import { tonicaReale } from '../src/utils/relativeMinors';
import { spiegaAccordo } from '../src/engine/spiegazione';
const NOMI = ['Do','Do#','Re','Mib','Mi','Fa','Fa#','Sol','Sol#','La','Sib','Si'];
const nota = (n: any) => `${NOMI[n.midi % 12]}${Math.floor(n.midi / 12) - 1}`;
const d = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const note = (d.notes || []).filter((n: any) => !n.isRest);
const minore = !!d.isMinorMode, tonica = tonicaReale(d.keySignatureRoot || 'C', minore);
const ts = d.timeSignature || { numerator: 4, denominator: 4 };
const ks = getKeySignature(tonica, minore ? 'Minor' : 'Major');
const r: any = applyHarmonyRules(note as any, ks as any, tonica, minore, [], ts, [], [], [], { partCount: 4 });
const an: any[] = r.analyzedNotes || note;
const per = new Map<string, any[]>();
for (const n of an) { if (n.isRest) continue; const k = `${n.measureIndex}:${n.beat}`; if (!per.has(k)) per.set(k, []); per.get(k)!.push(n); }
const chiavi = [...per.keys()].sort((a, b) => { const [m1,b1]=a.split(':').map(Number),[m2,b2]=b.split(':').map(Number); return (m1-m2)||(b1-b2); });
console.log(`${process.argv[2].split('/').pop()}  ·  ${tonica}${minore ? ' minore' : ' maggiore'}\n`);
let conEvidenza = 0;
for (const k of chiavi.slice(0, Number(process.env.QUANTI ?? 14))) {
  const s = spiegaAccordo(per.get(k)! as any, tonica, minore);
  if (!s) continue;
  const [m, b] = k.split(':');
  const testa = `mis ${String(Number(m) + 1).padStart(2)} b${b}`;
  console.log(`${testa}  ${(s.roman ?? '?').padEnd(8)} ${(s.scelta?.sigla ?? '?').padEnd(12)} basso ${s.basso ? nota(s.basso) : '—'}`);
  if (s.noteEstranee.length) console.log(`          estranee: ${s.noteEstranee.map(e => `${nota(e.nota)} (${e.categoria})`).join(', ')}`);
  if (s.seconda) console.log(`          seconda lettura: ${s.seconda.sigla}  (${s.scelta?.punteggio} contro ${s.seconda.punteggio})`);
  if (s.evidenza) { conEvidenza++; console.log(`          ► DECIDE: ${s.evidenza.motivo}`); }
}
console.log(`\n${conEvidenza} accordi con un'evidenza da raccontare, sui primi ${Math.min(chiavi.length, Number(process.env.QUANTI ?? 14))}`);
