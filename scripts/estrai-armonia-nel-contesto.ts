/**
 * ESTRAE «che armonia, sapendo anche cosa c'e' INTORNO» in
 * `src/data/armoniaNelContesto.json`.
 *
 * La terza tavola, e la prima che guarda oltre la nota singola. Le altre due
 * rispondono a «che armonia sotto questa nota»; questa aggiunge la funzione
 * dell'accordo PRIMA e di quello DOPO.
 *
 * Serve a un difetto preciso, visto dall'utente su una generazione: sotto un
 * Si (secondo grado) fra due toniche il generatore metteva `ii`, dove l'autore
 * scrive `vii°`. Cioe' faceva `I–ii–I` invece di `I–V–I`: non coglieva la
 * funzione di dominante. E non e' che sbagliasse — e' che non aveva modo di
 * saperlo, perche' tutti i suoi pesi guardano la nota e non il contesto.
 *
 * Misurato: col secondo grado al soprano, la dominante vale il 38% sapendo la
 * sola nota, e il 70,4% sapendo di stare FRA DUE TONICHE.
 *
 *   npx tsx scripts/estrai-armonia-nel-contesto.ts
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
const FN: Record<string, string> = {
  I: 'T', i: 'T', vi: 'T', VI: 'T', iii: 'T', III: 'T',
  IV: 'S', iv: 'S', ii: 'S', 'ii°': 'S', II: 'S',
  V: 'D', v: 'D', 'vii°': 'D', vii: 'D', VII: 'D',
};
const fu = (g: string) => { const n = g.replace(/[0-9/]+$/, ''); return n.includes('/') ? 'D/' : (FN[n] ?? '?'); };
const NOME_GRADO = ['1', 'b2', '2', 'b3', '3', '4', '#4', '5', 'b6', '6', 'b7', '7'];
const DAUTORE = /dubois|pedron|delachi|delamont|schinelli|bach|cantata|corale/i;
const strut = (n: any) => n && !n.isRest
  && !n.isPassing && !n.isNeighbor && !n.isAnticipation && !n.isAppoggiatura && !n.isEscape;

const pcDi = (s: string) => {
  const b = PC[s.charAt(0).toUpperCase()];
  if (b == null) return null;
  let a = 0;
  for (const c of s.slice(1)) { if (c === '#') a++; else if (c === 'b') a--; }
  return ((b + a) % 12 + 12) % 12;
};

function main() {
  const dir = path.resolve(__dirname, '..', 'tests');
  const files = fs.readdirSync(dir).filter(f => /\.(json|htp)$/.test(f) && DAUTORE.test(f)).sort();
  const conta = new Map<string, Map<string, number>>();
  let totale = 0;

  for (const nome of files) {
    let d: any;
    try { d = JSON.parse(fs.readFileSync(path.join(dir, nome), 'utf8')); } catch { continue; }
    if (!Array.isArray(d.notes) || d.notes.length < 8) continue;
    const minore = !!d.isMinorMode;
    const radice = d.keySignatureRoot || 'C';
    const tonica = minore ? (REL[radice] || radice) : radice;
    const tp = pcDi(tonica);
    if (tp == null) continue;
    const ts = d.timeSignature || { numerator: 4, denominator: 4 };
    let res: any;
    try {
      res = applyHarmonyRules(d.notes, getKeySignature(radice, 'Major') as any, tonica, minore,
        d.analysisContexts || [], ts, undefined,
        (d.ornamentOverrides || []).length ? d.ornamentOverrides : undefined,
        (d.harmonyOverrides || []).length ? d.harmonyOverrides : undefined);
    } catch { continue; }
    const linea = getActiveNotesTimeline(res.analyzedNotes || d.notes, ts, d.timeSignatureChanges || []);

    const G: string[] = [], S: number[] = [];
    let prec = '';
    for (const ev of (linea || [])) {
      const st = (ev.notes as any[]).filter(strut);
      if (st.length < 2) continue;
      const ra = getRomanAnalysis(st as any, tonica, minore);
      if (!ra?.roman) continue;
      const g = String(ra.roman).replace(/\s+/g, '').replace(/[0-9/]+$/, '');
      if (!g || g === prec) continue;
      const sop = (ev.notes as any[])
        .filter((n: any) => n && !n.isRest && (Number(n.voice) || 1) === 1)
        .sort((a: any, b: any) => b.midi - a.midi)[0];
      G.push(g);
      S.push(sop ? ((((sop.midi % 12) + 12) % 12 - tp + 12) % 12) : -1);
      prec = g;
    }

    for (let i = 1; i < G.length - 1; i++) {
      if (S[i] < 0) continue;
      const k = `${minore ? 'min' : 'MAG'}|${NOME_GRADO[S[i]]}|${fu(G[i - 1])}|${fu(G[i + 1])}`;
      if (!conta.has(k)) conta.set(k, new Map());
      const m = conta.get(k)!;
      m.set(G[i], (m.get(G[i]) || 0) + 1);
      totale++;
    }
  }

  const fuori: any = { meta: { estrattoIl: new Date().toISOString(), osservazioni: totale }, tav: {} };
  let usabili = 0;
  for (const [k, m] of conta) {
    const t = [...m.values()].reduce((a, b) => a + b, 0);
    if (t < 12) continue;                    // troppo magro per dire qualcosa
    usabili++;
    fuori.tav[k] = Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]));
  }
  const out = path.resolve(__dirname, '..', 'src', 'data', 'armoniaNelContesto.json');
  fs.writeFileSync(out, JSON.stringify(fuori, null, 1) + '\n', 'utf8');
  console.log(`scritto ${out}`);
  console.log(`  ${totale} osservazioni · ${conta.size} contesti, di cui ${usabili} con almeno 12 casi`);
}

main();
