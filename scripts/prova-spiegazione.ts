/**
 * Stampa il RECORD della spiegazione per ogni accordo di un brano.
 * Serve a guardare cosa il motore sa dire, prima di scrivere le frasi.
 *
 *   npx tsx scripts/prova-spiegazione.ts "tests/brano.htp"
 */
import { readFileSync } from 'fs';
import { applyHarmonyRules, getKeySignature } from '../src/utils/musicTheory';
import { tonicaReale } from '../src/utils/relativeMinors';
import { spiegaAccordo, relazioneFra, fraseDiRelazione } from '../src/engine/spiegazione';
import FRASI from '../src/locales/it/analysis.json';
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

// Si raggruppa per cio' che SUONA, non per gli attacchi: un tempo in cui si muove una voce
// sola non e' un accordo di una nota.
const vive = an.filter((n: any) => !n.isRest && Number.isFinite(n.startTick));
const attacchi = [...new Set(vive.map((n: any) => Number(n.startTick)))].sort((a, b) => a - b);
const eventi: { k: string; note: any[] }[] = [];
const visti = new Set<string>();
for (const t of attacchi) {
  const suonanti = vive.filter((n: any) => { const i = Number(n.startTick), d = Number(n.durationTicks ?? 0); return i <= t && t < i + d; });
  if (suonanti.length < 2) continue;
  const testa = suonanti.find((n: any) => Number(n.startTick) === t) ?? suonanti[0];
  const k = `${testa.measureIndex}:${testa.beat}`;
  if (visti.has(k)) continue;
  visti.add(k); eventi.push({ k, note: suonanti });
}

const F = FRASI as Record<string, string>;
let prec: any = null, righe = 0, mute = 0;
for (const ev of eventi.slice(0, Number(process.env.QUANTI ?? 16))) {
  const s = spiegaAccordo(ev.note as any, tonica, minore);
  if (!s) continue;
  const [m, b] = ev.k.split(':');
  const bassoPc = s.basso ? ((Number((s.basso as any).midi) % 12) + 12) % 12 : null;
  const rel = relazioneFra(prec, { roman: s.roman, bassoPc });
  const chiave = fraseDiRelazione(rel);

  const frasi: string[] = [];
  frasi.push(`${s.scelta?.sigla ?? '?'}${s.roman ? `  ·  ${s.roman}` : ''}`);
  if (s.evidenza) frasi.push(`Non ${s.seconda?.sigla}: ${s.evidenza.motivo}.`);
  if (chiave && F[chiave]) frasi.push(F[chiave]);

  console.log(`mis ${String(Number(m) + 1).padStart(2)} b${b}   ${frasi[0]}`);
  for (const f of frasi.slice(1)) { console.log(`           ${f}`); righe++; }
  if (frasi.length === 1) mute++;
  prec = { roman: s.roman, bassoPc };
}
console.log(`\n${righe} frasi oltre l'identificazione · ${mute} accordi senza niente da aggiungere`);
