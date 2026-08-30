/**
 * ESTRAE LA TAVOLA DEGLI ORNAMENTI APPRESI dalle correzioni manuali dell'utente.
 *
 * Stesso schema con cui il programma impara le progressioni: si estrae una volta dal
 * corpus, si scrive una tavola nel sorgente, e il motore la consulta. Le correzioni sono
 * già nei file — `ornamentOverrides` — e finora l'applicazione le buttava via a ogni
 * apertura.
 *
 * La situazione di una nota è descritta da quattro cose: se cade su tempo forte o debole,
 * che durata ha, come ci si arriva e come si riparte. Sul corpus dell'utente la stessa
 * situazione dà la stessa risposta nell'86% dei casi, e le più frequenti ricorrono in
 * decine di file diversi: è conoscenza generale, non memoria di un brano.
 *
 *   npx tsx scripts/estrai-ornamenti.ts tests/*.htp > src/engine/ornamentiAppresi.ts
 */
import { readFileSync } from 'fs';

const passo = (d: number) => d === 0 ? 'ferma' : Math.abs(d) <= 2 ? (d > 0 ? 'gradoSu' : 'gradoGiu')
  : Math.abs(d) <= 4 ? (d > 0 ? 'terzaSu' : 'terzaGiu') : (d > 0 ? 'saltoSu' : 'saltoGiu');

type Conto = { orn: number; str: number; file: Set<string>; tipi: Record<string, number> };
const tavola = new Map<string, Conto>();

for (const f of process.argv.slice(2)) {
  let d: any; try { d = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
  const ov: any[] = d.ornamentOverrides || []; if (!ov.length) continue;
  const note = (d.notes || []).filter((n: any) => !n.isRest);
  const perVoce = new Map<number, any[]>();
  for (const n of note) { const v = Number(n.voice ?? 1); if (!perVoce.has(v)) perVoce.set(v, []); perVoce.get(v)!.push(n); }
  for (const l of perVoce.values()) l.sort((a, b) => (a.startTick ?? 0) - (b.startTick ?? 0));
  const per = new Map<string, any>(note.map((n: any) => [n.id, n]));
  for (const o of ov) {
    const n = per.get(o.noteId) ?? note.find((x: any) => x.midi === o.midi && x.measureIndex === o.measureIndex && x.beat === o.beat);
    if (!n) continue;
    const linea = perVoce.get(Number(n.voice ?? 1)) || [];
    const i = linea.indexOf(n); if (i < 0) continue;
    const prima = linea[i - 1], dopo = linea[i + 1];
    if (!prima || !dopo) continue;
    const b = Number(n.beat || 1);
    const metro = (b === Math.floor(b) && (b === 1 || b === 3)) ? 'F' : 'd';
    const chiave = `${metro}|${String(n.duration || '?')}|${passo(n.midi - prima.midi)}|${passo(dopo.midi - n.midi)}`;
    if (!tavola.has(chiave)) tavola.set(chiave, { orn: 0, str: 0, file: new Set(), tipi: {} });
    const c = tavola.get(chiave)!;
    if (o.type === 'structural') c.str++; else c.orn++;
    c.file.add(f);
    c.tipi[o.type] = (c.tipi[o.type] ?? 0) + 1;
  }
}

// SOGLIE. Una situazione entra nella tavola solo se ricorre abbastanza, in abbastanza brani
// diversi, e con una risposta abbastanza netta. Sotto queste soglie non è conoscenza: è
// il ricordo di un caso, o una situazione davvero ambigua — e lì il motore deve ASTENERSI.
const MIN_CASI = 5, MIN_FILE = 3, MIN_COERENZA = 0.75;
const righe: string[] = [];
let tenute = 0, scartate = 0;
for (const [k, c] of [...tavola.entries()].sort((a, b) => (b[1].orn + b[1].str) - (a[1].orn + a[1].str))) {
  const n = c.orn + c.str;
  const coerenza = Math.max(c.orn, c.str) / n;
  if (n < MIN_CASI || c.file.size < MIN_FILE || coerenza < MIN_COERENZA) { scartate++; continue; }
  tenute++;
  const tipo = Object.entries(c.tipi).sort((a, b) => b[1] - a[1])[0][0];
  righe.push(`  '${k}': { ornamento: ${c.orn > c.str}, tipo: '${tipo}', casi: ${n}, brani: ${c.file.size}, coerenza: ${coerenza.toFixed(2)} },`);
}

console.log(`/**
 * ORNAMENTI APPRESI — tavola estratta dalle correzioni manuali dell'utente.
 *
 * NON SCRIVERE A MANO: la produce \`scripts/estrai-ornamenti.ts\` dai file del corpus.
 *
 * Ogni riga dice: in questa situazione — tempo forte o debole, durata, come ci si arriva,
 * come si riparte — l'utente ha deciso così. Una situazione entra qui solo se ricorre
 * almeno ${MIN_CASI} volte in almeno ${MIN_FILE} brani diversi e con almeno il ${(MIN_COERENZA * 100).toFixed(0)}% di risposte
 * concordi: sotto quelle soglie non è conoscenza, è il ricordo di un caso — o una
 * situazione davvero ambigua, e lì il motore deve astenersi invece di indovinare.
 *
 * ${tenute} situazioni tenute, ${scartate} scartate.
 */
export type SituazioneAppresa = {
  /** true = l'utente l'ha chiamata ornamentale; false = nota reale dell'armonia. */
  ornamento: boolean;
  /** Il tipo scelto più spesso in questa situazione. */
  tipo: string;
  casi: number;
  brani: number;
  coerenza: number;
};

export const ORNAMENTI_APPRESI: Record<string, SituazioneAppresa> = {
${righe.join('\n')}
};

/** La situazione di una nota, nella stessa forma con cui è scritta la tavola. */
export function situazioneDi(args: {
  beat: number; duration: string; daPrima: number; aDopo: number;
}): string {
  const passo = (d: number) => d === 0 ? 'ferma' : Math.abs(d) <= 2 ? (d > 0 ? 'gradoSu' : 'gradoGiu')
    : Math.abs(d) <= 4 ? (d > 0 ? 'terzaSu' : 'terzaGiu') : (d > 0 ? 'saltoSu' : 'saltoGiu');
  const b = args.beat;
  const metro = (b === Math.floor(b) && (b === 1 || b === 3)) ? 'F' : 'd';
  return \`\${metro}|\${args.duration}|\${passo(args.daPrima)}|\${passo(args.aDopo)}\`;
}

/** Cosa ha deciso l'utente in questa situazione, se l'ha decisa abbastanza volte. */
export function cosaDisseLUtente(situazione: string): SituazioneAppresa | null {
  return ORNAMENTI_APPRESI[situazione] ?? null;
}`);
