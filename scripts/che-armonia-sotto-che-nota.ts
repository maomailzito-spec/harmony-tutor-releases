/**
 * CHE ARMONIA STA SOTTO CHE NOTA.
 *
 * Osservazione dell'utente, e mette a fuoco tutto il resto: «le armonizzazioni
 * del generatore sono armonie corrette nel posto sbagliato». I percorsi di
 * funzione sono quasi tutti legittimi — la domanda non e' quale sia piu'
 * logico, e' quale si userebbe SOTTO QUELLE NOTE.
 *
 * E infatti: nel generatore la melodia entra nella scelta dell'armonia SOLO
 * come test di appartenenza — «questo accordo contiene la nota?». Tutte le
 * statistiche del corpus sono da accordo ad accordo (unigrammi, bigrammi,
 * trigrammi, rivolti, raddoppi): nessuna e' condizionata alla melodia.
 *
 * Qui si misura se il corpus saprebbe rispondere: dato il grado di scala che
 * canta il soprano, e se sta su tempo forte o debole, quanto e' concentrata la
 * scelta dell'armonia? Se e' concentrata, c'e' un'informazione forte che il
 * generatore non usa.
 *
 *   npx tsx scripts/che-armonia-sotto-che-nota.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  applyHarmonyRules, getActiveNotesTimeline, getKeySignature, getRomanAnalysis,
} from '../src/utils/musicTheory';

const REL: Record<string, string> = {
  C: 'A', G: 'E', D: 'B', A: 'F#', E: 'C#', B: 'G#', 'F#': 'D#',
  F: 'D', Bb: 'G', Eb: 'C', Ab: 'F', Db: 'Bb', Gb: 'Eb',
};
const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const DAUTORE = /dubois|pedron|delachi|delamont|schinelli|bach|cantata|corale/i;
const strut = (n: any) => n && !n.isRest
  && !n.isPassing && !n.isNeighbor && !n.isAnticipation && !n.isAppoggiatura && !n.isEscape;

const pcDi = (nome: string) => {
  const b = PC[nome.charAt(0).toUpperCase()];
  if (b == null) return null;
  let a = 0;
  for (const c of nome.slice(1)) { if (c === '#') a++; else if (c === 'b') a--; }
  return ((b + a) % 12 + 12) % 12;
};
/** I gradi di scala in semitoni dalla tonica, come si NOMINANO. */
const NOME_GRADO = ['1', 'b2', '2', 'b3', '3', '4', '#4', '5', 'b6', '6', 'b7', '7'];

function main() {
  const dir = path.resolve(__dirname, '..', 'tests');
  const files = fs.readdirSync(dir).filter(f => /\.(json|htp)$/.test(f) && DAUTORE.test(f)).sort();

  /** conteggi[modo][gradoSoprano][forte?][armonia] */
  const conta = new Map<string, Map<string, number>>();
  const marginale = new Map<string, number>();
  let totale = 0;

  for (const nome of files) {
    let d: any;
    try { d = JSON.parse(fs.readFileSync(path.join(dir, nome), 'utf8')); } catch { continue; }
    if (!Array.isArray(d.notes) || d.notes.length < 8) continue;
    const minore = !!d.isMinorMode;
    const radice = d.keySignatureRoot || 'C';
    const tonica = minore ? (REL[radice] || radice) : radice;
    const tonicaPc = pcDi(tonica);
    if (tonicaPc == null) continue;
    const ts = d.timeSignature || { numerator: 4, denominator: 4 };
    const bpm = ts.numerator * (4 / ts.denominator);
    let res: any;
    try {
      res = applyHarmonyRules(d.notes, getKeySignature(radice, 'Major') as any, tonica, minore,
        d.analysisContexts || [], ts, undefined,
        (d.ornamentOverrides || []).length ? d.ornamentOverrides : undefined,
        (d.harmonyOverrides || []).length ? d.harmonyOverrides : undefined);
    } catch { continue; }
    const linea = getActiveNotesTimeline(res.analyzedNotes || d.notes, ts, d.timeSignatureChanges || []);

    for (const ev of (linea || [])) {
      const st = (ev.notes as any[]).filter(strut);
      if (st.length < 2) continue;
      const ra = getRomanAnalysis(st as any, tonica, minore);
      if (!ra?.roman) continue;
      const armonia = String(ra.roman).replace(/\s+/g, '').replace(/[0-9/]+$/, '');
      if (!armonia) continue;
      // la nota che canta il soprano in questo momento
      const sop = (ev.notes as any[])
        .filter((n: any) => n && !n.isRest && (Number(n.voice) || 1) === 1)
        .sort((a: any, b: any) => b.midi - a.midi)[0];
      if (!sop || !Number.isFinite(sop.midi)) continue;
      const grado = NOME_GRADO[(((sop.midi % 12) + 12) % 12 - tonicaPc + 12) % 12];
      const dentro = (ev.absBeat ?? 0) % bpm;
      const forte = Math.abs(dentro - Math.round(dentro)) < 0.01
        && (Math.round(dentro) === 0 || (bpm >= 4 && Math.round(dentro) === 2));
      const chiave = `${minore ? 'min' : 'MAG'} ${grado.padStart(2)} ${forte ? 'forte' : 'debole'}`;
      if (!conta.has(chiave)) conta.set(chiave, new Map());
      const m = conta.get(chiave)!;
      m.set(armonia, (m.get(armonia) || 0) + 1);
      marginale.set(armonia, (marginale.get(armonia) || 0) + 1);
      totale++;
    }
  }

  // Quanto e' concentrata la scelta, dato il grado? Si guarda la quota della
  // prima e delle prime due, contro la stessa quota SENZA sapere la melodia.
  const marg = [...marginale.entries()].sort((a, b) => b[1] - a[1]);
  const margPrima = marg.length ? marg[0][1] / totale : 0;
  const margDue = marg.slice(0, 2).reduce((s, [, v]) => s + v, 0) / totale;

  console.log(`\n${totale} armonie d'autore, col grado che canta il soprano\n`);
  console.log(`SENZA sapere la melodia — l'armonia piu' comune vale ${(100 * margPrima).toFixed(1)}%, le prime due ${(100 * margDue).toFixed(1)}%`);
  console.log(`   (${marg.slice(0, 4).map(([k, v]) => `${k} ${(100 * v / totale).toFixed(0)}%`).join('  ')})\n`);
  console.log(`SAPENDO il grado del soprano:\n`);

  const righe = [...conta.entries()]
    .map(([k, m]) => {
      const tot = [...m.values()].reduce((a, b) => a + b, 0);
      const ord = [...m.entries()].sort((a, b) => b[1] - a[1]);
      return { k, tot, ord, prima: ord[0][1] / tot, due: ord.slice(0, 2).reduce((s, [, v]) => s + v, 0) / tot };
    })
    .filter(r => r.tot >= 25)
    .sort((a, b) => a.k.localeCompare(b.k));

  for (const r of righe) {
    console.log(`  ${r.k}  ${String(r.tot).padStart(4)} volte  →  ${r.ord.slice(0, 3).map(([a, v]) => `${a} ${(100 * v / r.tot).toFixed(0)}%`).join('   ')}`);
  }
  const mediaPrima = righe.reduce((s, r) => s + r.prima * r.tot, 0) / righe.reduce((s, r) => s + r.tot, 0);
  const mediaDue = righe.reduce((s, r) => s + r.due * r.tot, 0) / righe.reduce((s, r) => s + r.tot, 0);
  console.log(`\n  in media, sapendo il grado: la prima vale ${(100 * mediaPrima).toFixed(1)}%, le prime due ${(100 * mediaDue).toFixed(1)}%`);
  console.log(`  senza saperlo:               ${(100 * margPrima).toFixed(1)}%  e  ${(100 * margDue).toFixed(1)}%\n`);
}

main();
