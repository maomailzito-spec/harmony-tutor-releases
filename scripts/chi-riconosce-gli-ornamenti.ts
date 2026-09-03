/**
 * IL GENERATORE SA DAVVERO QUALI NOTE SONO ORNAMENTALI?
 *
 * Il ritmo elastico gli PERMETTE di non armonizzare una nota. Ma decidere
 * QUALI sono davvero estranee e' un'altra cosa, e se sbaglia produce un accordo
 * fuorviante: un'appoggiatura presa per nota d'accordo cambia l'armonia.
 *
 * Qui si confrontano due giudizi sulla stessa melodia:
 *
 *   · quello dell'APPLICAZIONE — `applyHarmonyRules` sul brano intero, che
 *     conosce tutte e quattro le voci, quindi sa cos'e' consonante e cosa no,
 *     ed e' corretto a mano dall'utente dove serviva;
 *   · quello del GENERATORE — venti righe melodiche in `quantoSiSpiega`: grado
 *     congiunto in entrata e in uscita, stessa direzione o ritorno.
 *
 * L'asimmetria e' il punto: il primo giudica SAPENDO l'armonia, il secondo deve
 * giudicare PRIMA di sceglierla.
 *
 *   npx tsx scripts/chi-riconosce-gli-ornamenti.ts [--tutti]
 */
import fs from 'node:fs';
import path from 'node:path';
import { applyHarmonyRules, getKeySignature } from '../src/utils/musicTheory';

const DAUTORE = /dubois|pedron|delachi|delamont|schinelli|bach|cantata|corale/i;

/** Il giudizio del GENERATORE.
 *  `pcsAccordo` = le classi dell'armonia sotto la nota. Passandolo si misura la
 *  regola nuova — l'ornamento COLLEGA due note dell'accordo; omettendolo si
 *  misura quella vecchia, che guardava la sola linea. */
function ornamentalePerIlGeneratore(prima: any, qui: any, dopo: any, pcsAccordo?: number[]): boolean {
  if (!prima || !qui || !dopo) return false;
  const entra = qui.midi - prima.midi;
  const esce = dopo.midi - qui.midi;
  const risolvePerGrado = Math.abs(esce) >= 1 && Math.abs(esce) <= 2;
  // SULL'ACCENTO conta la sola risoluzione: e' un'appoggiatura, cioe' un
  // ritardo non preparato, e come ci si arrivi non fa parte della definizione.
  const b = Number(qui.beat) || 1;
  const sullAccento = Math.abs(b - Math.round(b)) < 0.01 && (b === 1 || b === 3);
  if (sullAccento) {
    if (!risolvePerGrado) return false;
    if (pcsAccordo && !pcsAccordo.includes(((dopo.midi % 12) + 12) % 12)) return false;
    return true;
  }
  const perGrado = Math.abs(entra) >= 1 && Math.abs(entra) <= 2 && risolvePerGrado;
  if (!perGrado) return false;
  const dentro = (m: number) => !pcsAccordo || pcsAccordo.includes(((m % 12) + 12) % 12);
  if (pcsAccordo && !dentro(prima.midi)) return false;
  if (pcsAccordo && !dentro(dopo.midi)) return false;
  const diPassaggio = (entra > 0) === (esce > 0);
  const diVolta = dopo.midi === prima.midi;
  return diPassaggio || diVolta;
}

const ORNAMENTALE = (n: any) => !!(n?.isPassing || n?.isNeighbor || n?.isAppoggiatura
  || n?.isEscape || n?.isCambiata || n?.isAnticipation);

function main() {
  const tutti = process.argv.includes('--tutti');
  /** `--linea` misura la regola VECCHIA, che guardava solo la melodia. */
  const conAccordo = !process.argv.includes('--linea');
  const dir = path.resolve(__dirname, '..', 'tests');
  const files = fs.readdirSync(dir).filter(f => /\.(json|htp)$/.test(f)).sort();

  let brani = 0, note = 0;
  let dueSi = 0, dueNo = 0, soloApp = 0, soloGen = 0;
  const persePerSpecie: Record<string, number> = {};

  for (const nome of files) {
    if (!tutti && !DAUTORE.test(nome)) continue;
    let d: any;
    try { d = JSON.parse(fs.readFileSync(path.join(dir, nome), 'utf8')); } catch { continue; }
    if (!Array.isArray(d.notes) || d.notes.length < 4) continue;
    let res: any;
    try {
      res = applyHarmonyRules(
        d.notes, getKeySignature(d.keySignatureRoot || 'C', 'Major') as any,
        d.keyTonic || d.keySignatureRoot || 'C', !!d.isMinorMode,
        d.analysisContexts || [], d.timeSignature || { numerator: 4, denominator: 4 },
        undefined,
        (d.ornamentOverrides || []).length ? d.ornamentOverrides : undefined,
        (d.harmonyOverrides || []).length ? d.harmonyOverrides : undefined,
      );
    } catch { continue; }
    brani++;

    const sop = (res.analyzedNotes || d.notes)
      .filter((n: any) => n && !n.isRest && (Number(n.voice) || 1) === 1)
      .sort((a: any, b: any) => ((a.measureIndex ?? 0) - (b.measureIndex ?? 0)) || ((a.beat ?? 1) - (b.beat ?? 1)));

    for (let i = 1; i < sop.length - 1; i++) {
      const n = sop[i];
      note++;
      const app = ORNAMENTALE(n);
      // L'armonia sotto la nota, come la vede l'applicazione: le altre voci
      // strutturali che suonano in quel momento.
      const pcs = (res.analyzedNotes || d.notes)
        .filter((x: any) => x && !x.isRest && (Number(x.voice) || 1) !== 1
          && (x.measureIndex ?? 0) === (n.measureIndex ?? 0)
          && Math.abs((x.beat ?? 1) - (n.beat ?? 1)) < 1e-6
          && !ORNAMENTALE(x))
        .map((x: any) => (((x.midi % 12) + 12) % 12));
      const gen = ornamentalePerIlGeneratore(sop[i - 1], n, sop[i + 1],
        conAccordo && pcs.length >= 2 ? pcs : undefined);
      if (app && gen) dueSi++;
      else if (!app && !gen) dueNo++;
      else if (app && !gen) {
        soloApp++;
        const s = n.isAppoggiatura ? 'appoggiatura' : n.isPassing ? 'passaggio'
          : n.isNeighbor ? 'volta' : n.isEscape ? 'sfuggita'
          : n.isCambiata ? 'cambiata' : n.isAnticipation ? 'anticipazione' : 'altro';
        persePerSpecie[s] = (persePerSpecie[s] || 0) + 1;
      } else soloGen++;
    }
  }

  const pc = (a: number, b: number) => b ? (100 * a / b).toFixed(1) + '%' : '—';
  const orn = dueSi + soloApp;
  console.log(`\n${brani} brani, ${note} note di melodia giudicate` +
              `   [regola ${conAccordo ? 'NUOVA: l\'ornamento collega due note dell\'accordo' : 'VECCHIA: solo la linea'}]\n`);
  console.log(`l'applicazione ne dice ornamentali : ${orn}  (${pc(orn, note)})`);
  console.log(`il generatore ne dice ornamentali  : ${dueSi + soloGen}  (${pc(dueSi + soloGen, note)})\n`);
  console.log(`  d'accordo che SI  : ${dueSi}`);
  console.log(`  d'accordo che NO  : ${dueNo}`);
  console.log(`  le PERDE (l'app dice ornamento, il generatore no)   : ${soloApp}  ${pc(soloApp, orn)} di quelle vere`);
  console.log(`  le INVENTA (il generatore dice ornamento, l'app no) : ${soloGen}  ${pc(soloGen, dueSi + soloGen)} di quelle che dichiara\n`);
  console.log('  quelle che PERDE, di che specie sono:');
  for (const [k, v] of Object.entries(persePerSpecie).sort((a, b) => b[1] - a[1])) {
    console.log(`     ${k.padEnd(16)} ${String(v).padStart(5)}  ${pc(v, soloApp)}`);
  }
  console.log('');
}

main();
