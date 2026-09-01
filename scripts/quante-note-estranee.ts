/**
 * quante-note-estranee.ts
 *
 * LA DOMANDA. Il generatore lavora con «un accordo per ogni nota»: ogni nota
 * di melodia DEVE essere nota d'accordo. Prima di togliere quel vincolo —
 * lavoro serio sul motore, perché il confine fra un'armonia e la successiva
 * diventerebbe parte della ricerca — serve sapere quanto costa averlo.
 *
 * Due numeri, misurati sul repertorio vero:
 *   1. quante note NON sono note d'accordo (e di che specie, e in che voce);
 *   2. quante note di melodia stanno sotto UNA sola armonia — cioè quanto la
 *      griglia «un accordo per nota» sovraproduce rispetto a com'è scritto.
 *
 * La fonte è la piu' attendibile che abbiamo: le marcature MANUALI
 * dell'utente (`ornamentOverrides`, 181 file), che il motore applica sopra la
 * propria deduzione. Non una stima: ciò che ha deciso lui, nota per nota.
 *
 * Uso:  npx tsx scripts/quante-note-estranee.ts [--tutti]
 *       senza --tutti considera solo il repertorio d'autore.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  applyHarmonyRules,
  getActiveNotesTimeline,
  getKeySignature,
  getRomanAnalysis,
} from '../src/utils/musicTheory';

// ── Chi ha scritto il brano ──────────────────────────────────────────────────
// I file sintetici di prova non devono inquinare una misura sul repertorio:
// e' la trappola gia' vista coi profili di stile, dove un terzo del corpus
// erano file inventati.
function fonte(nome: string): string {
  const n = nome.toLowerCase();
  if (/dubois/.test(n)) return 'Dubois';
  if (/pedron/.test(n)) return 'Pedron';
  if (/delachi/.test(n)) return 'Delachi';
  if (/delamont/.test(n)) return 'Delamont';
  if (/schinelli/.test(n)) return 'Schinelli';
  if (/bach|cantata|corale|choral/.test(n)) return 'Bach';
  return 'altro';
}
const DAUTORE = new Set(['Dubois', 'Pedron', 'Delachi', 'Delamont', 'Schinelli', 'Bach']);

const NOMI_VOCE = ['—', 'soprano', 'contralto', 'tenore', 'basso'];

interface Ctx { absBeat: number; newTonic: string; newIsMinor: boolean }

function chiaveLocale(
  absBeat: number, tonicaGlob: string, minoreGlob: boolean,
  utente: Ctx[], dedotti: Ctx[],
): { tonic: string; isMinor: boolean } {
  const tutti = [...(utente || []), ...(dedotti || [])]
    .filter(c => c && Number.isFinite(c.absBeat))
    .sort((a, b) => a.absBeat - b.absBeat);
  let tonic = tonicaGlob, isMinor = minoreGlob;
  for (const c of tutti) {
    if (c.absBeat <= absBeat + 1e-9) { tonic = c.newTonic || tonic; isMinor = !!c.newIsMinor; }
    else break;
  }
  return { tonic, isMinor };
}

/** La definizione di «nota d'accordo» del condotto (harmonyLabelPipeline).
 *  NB: il RITARDO resta dentro, perche' porta il contesto armonico. Ma al suo
 *  attacco un ritardo NON e' nota d'accordo, ed e' esattamente il caso che il
 *  vincolo attuale vieta — quindi lo conto a parte, non lo perdo. */
const ESTRANEE = ['isPassing', 'isNeighbor', 'isAnticipation', 'isAppoggiatura', 'isEscape'];
const specie = (n: any): string | null => {
  const ov = n?.ornamentOverride;
  if (ov && ov !== 'structural') return String(ov);
  for (const f of ESTRANEE) if (n?.[f]) return f.replace(/^is/, '').toLowerCase();
  if (n?.isSuspension) return 'suspension';
  return null;
};
const strutturale = (n: any) => {
  if (!n || n.isRest) return false;
  const s = specie(n);
  return s === null || s === 'suspension';
};

interface Conta {
  file: number; note: number; estranee: number; ritardi: number;
  perSpecie: Record<string, number>; perVoce: Record<string, number>;
  sopranoNote: number; armonie: number;
  sopranoConEtichetta: number; sopranoConPiuArmonie: number; sopranoStessaArmonia: number;
  sopranoConPiuGradi: number;
}
const vuota = (): Conta => ({
  file: 0, note: 0, estranee: 0, ritardi: 0,
  perSpecie: {}, perVoce: {}, sopranoNote: 0, armonie: 0,
  sopranoConEtichetta: 0, sopranoConPiuArmonie: 0, sopranoStessaArmonia: 0, sopranoConPiuGradi: 0,
});

function main() {
  const tutti = process.argv.includes('--tutti');
  // Un brano senza marcature manuali porta la sola deduzione del motore: e'
  // una stima, non verita'. Dubois e Pedron sono marcati al 20%, quindi la
  // loro percentuale bassa dice anche «non guardati», non solo «puliti».
  const soloMarcati = process.argv.includes('--solo-marcati');
  const dir = path.resolve(__dirname, '..', 'tests');
  const files = fs.readdirSync(dir).filter(f => /\.(json|htp)$/.test(f)).sort();

  const perFonte: Record<string, Conta> = {};
  let saltati = 0, falliti = 0;

  for (const nome of files) {
    const f = fonte(nome);
    if (!tutti && !DAUTORE.has(f)) { saltati++; continue; }

    let d: any;
    try { d = JSON.parse(fs.readFileSync(path.join(dir, nome), 'utf8')); } catch { falliti++; continue; }
    const note = d.notes;
    if (!Array.isArray(note) || note.filter((n: any) => n && !n.isRest).length < 2) { saltati++; continue; }
    if (soloMarcati && !(d.ornamentOverrides && d.ornamentOverrides.length)) { saltati++; continue; }

    try {
      const radice: string = d.keySignatureRoot || 'C';
      const minore = !!d.isMinorMode;
      const metro = d.timeSignature || { numerator: 4, denominator: 4 };
      const tonica: string = d.keyTonic || radice;

      const res: any = applyHarmonyRules(
        note, getKeySignature(radice, 'Major') as any, tonica, minore,
        d.analysisContexts || [], metro, undefined,
        // LE MARCATURE MANUALI. `_build_corpus.ts` qui passa `undefined`, cioe'
        // costruisce le statistiche IGNORANDO le correzioni dell'utente.
        (d.ornamentOverrides && d.ornamentOverrides.length) ? d.ornamentOverrides : undefined,
        (d.harmonyOverrides && d.harmonyOverrides.length) ? d.harmonyOverrides : undefined,
      );
      const analizzate: any[] = res.analyzedNotes || note;

      const c = (perFonte[f] ||= vuota());
      c.file++;

      for (const n of analizzate) {
        if (!n || n.isRest) continue;
        c.note++;
        if (Number(n.voice) === 1) c.sopranoNote++;
        const s = specie(n);
        if (s === 'suspension') { c.ritardi++; continue; }
        if (s !== null) {
          c.estranee++;
          c.perSpecie[s] = (c.perSpecie[s] || 0) + 1;
          const v = NOMI_VOCE[Number(n.voice) || 0] || '—';
          c.perVoce[v] = (c.perVoce[v] || 0) + 1;
        }
      }

      // ── IL RITMO ARMONICO DAL PUNTO DI VISTA DEL GENERATORE ──
      // Non «quante armonie in tutto»: quello conta anche il basso che si
      // muove sotto un soprano fermo, e risponde a un'altra domanda. Qui
      // serve, nota di melodia per nota di melodia, che armonia le sta sotto.
      const dedotti: Ctx[] = (res.inferredAnalysisContexts || []).map((x: any) => ({
        absBeat: Number(x?.absBeat ?? 0), newTonic: String(x?.newTonic || tonica), newIsMinor: !!x?.newIsMinor,
      }));
      const linea = getActiveNotesTimeline(analizzate as any, metro, d.timeSignatureChanges || []);

      /** id della nota di soprano → etichette che si susseguono mentre dura. */
      const sotto = new Map<string, string[]>();
      const sottoGrado = new Map<string, string[]>();
      const ordine: string[] = [];
      for (const ev of (linea || [])) {
        const strutt = (ev.notes as any[]).filter(strutturale);
        if (strutt.length < 2) continue;
        const sop = (ev.notes as any[]).find(n => n && !n.isRest && Number(n.voice) === 1);
        if (!sop || !sop.id) continue;
        const k = chiaveLocale(ev.absBeat, tonica, minore, d.analysisContexts || [], dedotti);
        const ra = getRomanAnalysis(strutt as any, k.tonic, k.isMinor);
        if (!ra || !ra.roman) continue;
        const et = (ra.roman + (ra.figures || []).join('')).replace(/\s+/g, '');
        if (!et) continue;
        // DUE letture della stessa etichetta: `I6` cambia rispetto a `I` solo
        // di RIVOLTO — e' una scelta del generatore, non un'armonia nuova.
        // Contarle insieme gonfierebbe il caso (b).
        const grado = et.replace(/[0-9♭♯]+$/g, '');
        if (!sotto.has(sop.id)) { sotto.set(sop.id, []); sottoGrado.set(sop.id, []); ordine.push(sop.id); }
        const arr = sotto.get(sop.id)!;
        if (arr[arr.length - 1] !== et) arr.push(et);
        const arrG = sottoGrado.get(sop.id)!;
        if (grado && arrG[arrG.length - 1] !== grado) arrG.push(grado);
      }

      let precedente = '';
      for (const id of ordine) {
        const arr = sotto.get(id)!;
        c.sopranoConEtichetta++;
        // (a) l'armonia CAMBIA mentre la melodia tiene: oggi impossibile,
        //     una nota = un accordo.
        if (arr.length > 1) c.sopranoConPiuArmonie++;
        if ((sottoGrado.get(id)!).length > 1) c.sopranoConPiuGradi++;
        // (b) la melodia si muove e l'armonia RESTA: oggi impossibile, perche'
        //     ogni nota pretende un accordo nuovo (o una ripetizione forzata).
        if (arr[0] === precedente) c.sopranoStessaArmonia++;
        else c.armonie++;
        precedente = arr[arr.length - 1];
      }
    } catch { falliti++; }
  }

  // ── Resoconto ──
  const tot = vuota();
  for (const c of Object.values(perFonte)) {
    tot.file += c.file; tot.note += c.note; tot.estranee += c.estranee;
    tot.ritardi += c.ritardi; tot.sopranoNote += c.sopranoNote; tot.armonie += c.armonie;
    tot.sopranoConEtichetta += c.sopranoConEtichetta;
    tot.sopranoConPiuArmonie += c.sopranoConPiuArmonie;
    tot.sopranoStessaArmonia += c.sopranoStessaArmonia;
    tot.sopranoConPiuGradi += c.sopranoConPiuGradi;
    for (const [k, v] of Object.entries(c.perSpecie)) tot.perSpecie[k] = (tot.perSpecie[k] || 0) + v;
    for (const [k, v] of Object.entries(c.perVoce)) tot.perVoce[k] = (tot.perVoce[k] || 0) + v;
  }

  const pc = (a: number, b: number) => b ? (100 * a / b).toFixed(1) + '%' : '—';
  console.log(`\n${tot.file} brani${tutti ? '' : " d'autore"}${soloMarcati ? ' CON MARCATURE MANUALI' : ''} letti (${saltati} saltati, ${falliti} non analizzabili)\n`);

  console.log('NOTE CHE NON SONO NOTE D\'ACCORDO');
  console.log(`  su ${tot.note} note che suonano: ${tot.estranee} estranee (${pc(tot.estranee, tot.note)})`);
  console.log(`  piu' ${tot.ritardi} ritardi (${pc(tot.ritardi, tot.note)}) — al loro ATTACCO nemmeno questi sono note d'accordo`);
  console.log(`  insieme: ${pc(tot.estranee + tot.ritardi, tot.note)} delle note non e' nota d'accordo nel momento in cui entra\n`);

  console.log('  di che specie:');
  for (const [k, v] of Object.entries(tot.perSpecie).sort((a, b) => b[1] - a[1]))
    console.log(`    ${k.padEnd(14)} ${String(v).padStart(5)}  ${pc(v, tot.estranee)}`);
  console.log('\n  in che voce:');
  for (const [k, v] of Object.entries(tot.perVoce).sort((a, b) => b[1] - a[1]))
    console.log(`    ${k.padEnd(14)} ${String(v).padStart(5)}  ${pc(v, tot.estranee)}`);

  console.log('\nIL RITMO ARMONICO, DAL PUNTO DI VISTA DEL GENERATORE');
  const S = tot.sopranoConEtichetta;
  console.log(`  ${S} note di melodia con un'armonia sotto, ${tot.armonie} armonie distinte`);
  console.log(`  ${(S / (tot.armonie || 1)).toFixed(2)} note di melodia per ogni armonia\n`);
  console.log('  le due liberta\' che oggi NON esistono:');
  console.log(`   (a) la melodia si muove e l'armonia RESTA:  ${tot.sopranoStessaArmonia} note  ${pc(tot.sopranoStessaArmonia, S)}`);
  console.log(`   (b) la melodia TIENE e sotto cambia qualcosa: ${tot.sopranoConPiuArmonie} note  ${pc(tot.sopranoConPiuArmonie, S)}`);
  console.log(`       di cui cambia il GRADO, non il solo rivolto:  ${tot.sopranoConPiuGradi} note  ${pc(tot.sopranoConPiuGradi, S)}`);
  const tocca = tot.sopranoStessaArmonia + tot.sopranoConPiuGradi;
  console.log(`   in tutto riguarda ${tocca} note su ${S} (${pc(tocca, S)})\n`);

  console.log('PER FONTE');
  console.log('  fonte        brani   note  estranee  ritardi   note/armonia   (a) tiene  (b) cambia');
  for (const [f, c] of Object.entries(perFonte).sort((a, b) => b[1].note - a[1].note)) {
    const r = c.armonie ? (c.sopranoConEtichetta / c.armonie).toFixed(2) : '—';
    console.log(`  ${f.padEnd(12)} ${String(c.file).padStart(4)} ${String(c.note).padStart(6)}   ${pc(c.estranee, c.note).padStart(6)}   ${pc(c.ritardi, c.note).padStart(6)}        ${String(r).padStart(5)}      ${pc(c.sopranoStessaArmonia, c.sopranoConEtichetta).padStart(6)}      ${pc(c.sopranoConPiuGradi, c.sopranoConEtichetta).padStart(6)}`);
  }
  console.log('');
}

main();
