/**
 * ESTRAE la tavola «che armonia sopra che basso» in `src/data/armoniaSottoIlBasso.json`.
 *
 * Gemella dell'estrattore per la melodia, e serve al caso che nella didattica
 * viene PRIMA: il basso dato. Il basso e' meno ambiguo del canto — misurato,
 * la prima scelta vale il 57,3% contro il 43,1% — perche' e' legato piu'
 * direttamente alla funzione dell'accordo, mentre una nota di melodia puo'
 * avere molti significati.
 *
 * DIFFERENZA IMPORTANTE: qui la tavola tiene il solo GRADO, senza cifre. Col
 * basso dato il rivolto non e' da scegliere — la nota al basso E' il basso, e
 * il filtro delle pose lo fissa da se'. Quello che resta da decidere e' quale
 * armonia, e la tavola deve rispondere a quella domanda e a nessun'altra.
 *
 * Gemello di `che-armonia-sotto-che-nota.ts`, che la stessa misura la STAMPA.
 * Da rifare quando il corpus cambia, come gli altri estrattori.
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
      // la nota piu' GRAVE che suona in questo momento
      const suonano = (ev.notes as any[]).filter((n: any) => n && !n.isRest && Number.isFinite(n.midi));
      if (!suonano.length) continue;
      const basso = suonano.reduce((lo: any, n: any) => (n.midi < lo.midi ? n : lo), suonano[0]);
      const grado = NOME_GRADO[(((basso.midi % 12) + 12) % 12 - tonicaPc + 12) % 12];
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

  // ── Scrittura del file di dati ──
  const fuori: any = { meta: { estrattoIl: new Date().toISOString(), osservazioni: totale }, MAG: {}, min: {} };
  for (const [chiave, m] of conta) {
    const [modo, grado, pos] = chiave.split(/\s+/);
    const dove = fuori[modo];
    if (!dove[grado]) dove[grado] = {};
    dove[grado][pos] = Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]));
  }
  const out = path.resolve(__dirname, '..', 'src', 'data', 'armoniaSottoIlBasso.json');
  fs.writeFileSync(out, JSON.stringify(fuori, null, 1) + '\n', 'utf8');
  console.log(`scritto ${out}`);
  console.log(`  ${totale} osservazioni, ${conta.size} combinazioni grado×posizione`);
}

main();
