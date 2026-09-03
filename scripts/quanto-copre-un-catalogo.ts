/**
 * UN CATALOGO PICCOLO COPRE IL REPERTORIO?
 *
 * L'esperimento che decide se vale la pena costruire l'armonizzazione per
 * MODELLI — passare in rassegna delle formule e scegliere quella che si adatta
 * al tratto scritto — prima di scrivere il motore.
 *
 * La domanda: quanta parte delle progressioni D'AUTORE ricade in una manciata
 * di motivi ricorrenti? Se una decina di formule copre meta' del repertorio, la
 * via e' reale. Se ne copre una frazione minima, vuol dire che le frasi vere
 * sono quasi tutte diverse fra loro, e un catalogo produrrebbe musica
 * meccanica — e lo sapremmo prima di aver costruito niente.
 *
 * Si contano le successioni di GRADI consecutivi (senza cifre, senza rivolti,
 * accorpando le ripetizioni) di lunghezza 4, 5 e 6.
 *
 *   npx tsx scripts/quanto-copre-un-catalogo.ts
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

function main() {
  const dir = path.resolve(__dirname, '..', 'tests');
  const files = fs.readdirSync(dir).filter(f => /\.(json|htp)$/.test(f) && DAUTORE.test(f)).sort();

  const progressioni: string[][] = [];
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
      // Senza cifre e senza rivolti: il modello parla di GRADI.
      const g = String(ra.roman).replace(/\s+/g, '').replace(/[0-9/]+$/, '');
      if (g && g !== prec) { gradi.push(g); prec = g; }
    }
    if (gradi.length >= 6) progressioni.push(gradi);
  }

  console.log(`\n${progressioni.length} progressioni d'autore, ${progressioni.reduce((s, p) => s + p.length, 0)} accordi in tutto\n`);

  // ── LE FUNZIONI, non i gradi ──────────────────────────────────────────
  // Un modello non e' una fila di gradi letterali: e' un percorso di FUNZIONI,
  // con dentro dei giochi. `I–ii–V–I` e `I–IV–V–I` sono lo stesso modello —
  // tonica, sottodominante, dominante, tonica — e contarli separati e' il
  // motivo per cui i motivi letterali non coprono niente.
  const FUNZIONE: Record<string, string> = {
    I: 'T', i: 'T', vi: 'T', VI: 'T', iii: 'T', III: 'T',
    IV: 'S', iv: 'S', ii: 'S', 'ii°': 'S', II: 'S',
    V: 'D', v: 'D', 'vii°': 'D', vii: 'D', VII: 'D',
  };
  const funz = (g: string): string => {
    if (g.includes('/')) return 'D/';          // una tonicizzazione: dominante d'altro
    return FUNZIONE[g] ?? '?';
  };

  for (const modo of ['gradi', 'funzioni'] as const) {
    console.log(modo === 'gradi' ? '════ MOTIVI LETTERALI ════\n' : '\n════ PERCORSI DI FUNZIONE ════\n');
    const fonte = modo === 'gradi' ? progressioni
      : progressioni.map(p => {
          // accorpando le ripetizioni: `I–vi` sono due toniche di fila, e per il
          // modello sono un momento solo.
          const f = p.map(funz);
          const out: string[] = [];
          for (const x of f) if (x !== out[out.length - 1]) out.push(x);
          return out;
        });
    misura(fonte);
  }
}

function misura(progressioni: string[][]) {
  for (const L of [4, 5, 6]) {
    const conta = new Map<string, number>();
    let totale = 0;
    for (const p of progressioni) {
      for (let i = 0; i + L <= p.length; i++) {
        const k = p.slice(i, i + L).join('–');
        conta.set(k, (conta.get(k) || 0) + 1);
        totale++;
      }
    }
    const ordinati = [...conta.entries()].sort((a, b) => b[1] - a[1]);
    const copre = (n: number) => ordinati.slice(0, n).reduce((s, [, v]) => s + v, 0);
    const pc = (a: number) => (100 * a / totale).toFixed(1) + '%';
    console.log(`── successioni di ${L} gradi ──  ${totale} occorrenze, ${ordinati.length} motivi diversi`);
    console.log(`   i primi 10 coprono ${pc(copre(10))}   i primi 20 ${pc(copre(20))}   i primi 50 ${pc(copre(50))}`);
    console.log(`   visti UNA volta sola: ${(100 * ordinati.filter(([, v]) => v === 1).length / ordinati.length).toFixed(0)}% dei motivi`);
    console.log(`   i piu' frequenti: ${ordinati.slice(0, 6).map(([k, v]) => `${k} ×${v}`).join('   ')}\n`);
  }
}

main();
