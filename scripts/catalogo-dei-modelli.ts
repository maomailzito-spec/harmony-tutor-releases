/**
 * I QUINDICI MODELLI PIU' USATI DAL REPERTORIO, in forma leggibile.
 *
 * Seguito di `quanto-copre-un-catalogo.ts`, che ha stabilito il fatto: i modelli
 * esistono ma sono percorsi di FUNZIONE (T/S/D), non file di gradi — dieci
 * coprono il 47,7% del repertorio, i motivi letterali il 5,9%.
 *
 * Qui si stampano per essere GIUDICATI da chi insegna, non per essere innestati
 * subito: il corpus dice cosa si fa, non cosa si insegna, e nella lista ci sono
 * cose che nessuno metterebbe in un catalogo. Per ognuno:
 *
 *   · il percorso di funzione nell'orientamento in cui si presenta davvero
 *     (non la forma canonica, che e' comoda per contare e illeggibile per un
 *     musicista);
 *   · quanto pesa;
 *   · e come suona DAVVERO — le realizzazioni in gradi piu' frequenti, che
 *     sono la cosa su cui si puo' dire «questo si', questo no».
 *
 *   npx tsx scripts/catalogo-dei-modelli.ts [--lunghezza 4|5]
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
const DAUTORE = /dubois|pedron|delachi|delamont|schinelli|bach|cantata|corale/i;
const strut = (n: any) => n && !n.isRest
  && !n.isPassing && !n.isNeighbor && !n.isAnticipation && !n.isAppoggiatura && !n.isEscape;

const FUNZIONE: Record<string, string> = {
  I: 'T', i: 'T', vi: 'T', VI: 'T', iii: 'T', III: 'T',
  IV: 'S', iv: 'S', ii: 'S', 'ii°': 'S', II: 'S',
  V: 'D', v: 'D', 'vii°': 'D', vii: 'D', VII: 'D',
};
const funz = (g: string) => g.includes('/') ? 'D/' : (FUNZIONE[g] ?? '?');

function main() {
  const iL = process.argv.indexOf('--lunghezza');
  const L = iL >= 0 ? Number(process.argv[iL + 1]) || 4 : 4;
  const dir = path.resolve(__dirname, '..', 'tests');
  const files = fs.readdirSync(dir).filter(f => /\.(json|htp)$/.test(f) && DAUTORE.test(f)).sort();

  /** Ogni elemento: la funzione, e i gradi VERI che l'hanno prodotta. */
  type Passo = { f: string; gradi: string[] };
  const brani: Passo[][] = [];

  for (const nome of files) {
    let d: any;
    try { d = JSON.parse(fs.readFileSync(path.join(dir, nome), 'utf8')); } catch { continue; }
    if (!Array.isArray(d.notes) || d.notes.length < 8) continue;
    const minore = !!d.isMinorMode;
    const radice = d.keySignatureRoot || 'C';
    const tonica = minore ? (REL[radice] || radice) : radice;
    const ts = d.timeSignature || { numerator: 4, denominator: 4 };
    let res: any;
    try {
      res = applyHarmonyRules(d.notes, getKeySignature(radice, 'Major') as any, tonica, minore,
        d.analysisContexts || [], ts, undefined,
        (d.ornamentOverrides || []).length ? d.ornamentOverrides : undefined,
        (d.harmonyOverrides || []).length ? d.harmonyOverrides : undefined);
    } catch { continue; }
    const linea = getActiveNotesTimeline(res.analyzedNotes || d.notes, ts, d.timeSignatureChanges || []);
    const gradi: string[] = [];
    let prec = '';
    for (const ev of (linea || [])) {
      const st = (ev.notes as any[]).filter(strut);
      if (st.length < 2) continue;
      const ra = getRomanAnalysis(st as any, tonica, minore);
      if (!ra?.roman) continue;
      const g = String(ra.roman).replace(/\s+/g, '').replace(/[0-9/]+$/, '');
      if (g && g !== prec) { gradi.push(g); prec = g; }
    }
    // Accorpare le ripetizioni di FUNZIONE, tenendo i gradi che le compongono.
    const passi: Passo[] = [];
    for (const g of gradi) {
      const f = funz(g);
      if (passi.length && passi[passi.length - 1].f === f) passi[passi.length - 1].gradi.push(g);
      else passi.push({ f, gradi: [g] });
    }
    if (passi.length >= L) brani.push(passi);
  }

  // ── Conteggio, per classe di rotazione ──
  const canonica = (p: string[]) => {
    let best = p.join('–');
    for (let r = 1; r < p.length; r++) {
      const g = p.slice(r).concat(p.slice(0, r)).join('–');
      if (g < best) best = g;
    }
    return best;
  };
  type Voce = { conto: number; orient: Map<string, number>; reali: Map<string, number> };
  const classi = new Map<string, Voce>();
  let totale = 0;

  for (const passi of brani) {
    for (let i = 0; i + L <= passi.length; i++) {
      const fin = passi.slice(i, i + L);
      const f = fin.map(x => x.f);
      const k = canonica(f);
      if (!classi.has(k)) classi.set(k, { conto: 0, orient: new Map(), reali: new Map() });
      const v = classi.get(k)!;
      v.conto++; totale++;
      const o = f.join('–');
      v.orient.set(o, (v.orient.get(o) || 0) + 1);
      const reale = fin.map(x => x.gradi.join('+')).join('–');
      v.reali.set(reale, (v.reali.get(reale) || 0) + 1);
    }
  }

  const ordinate = [...classi.entries()].sort((a, b) => b[1].conto - a[1].conto).slice(0, 15);
  console.log(`\nI 15 MODELLI PIU' USATI  —  finestre di ${L} funzioni, ${totale} occorrenze, ${classi.size} modelli distinti\n`);
  let cum = 0;
  ordinate.forEach(([, v], n) => {
    cum += v.conto;
    const orient = [...v.orient.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const reali = [...v.reali.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    console.log(`${String(n + 1).padStart(2)}. ${orient.padEnd(16)} ${String(v.conto).padStart(4)} volte`
      + `   ${(100 * v.conto / totale).toFixed(1).padStart(4)}%   (cumulato ${(100 * cum / totale).toFixed(1)}%)`);
    console.log(`    come suona: ${reali.map(([r, c]) => `${r} ×${c}`).join('    ')}`);
  });
  console.log('');
}

main();
