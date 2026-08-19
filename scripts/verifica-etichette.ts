/**
 * LA RETE DELLE ETICHETTE.
 *
 * Fa girare il calcolo delle etichette su tutto il repertorio di prova e confronta il
 * risultato con una fotografia salvata. È al condotto delle etichette quello che
 * `npm run regress` è al motore: prima non esisteva, e ogni modifica all'analisi che
 * toccasse i romani si poteva controllare solo aprendo file a mano.
 *
 *   npx tsx scripts/verifica-etichette.ts              confronta
 *   npx tsx scripts/verifica-etichette.ts --aggiorna   rifà la fotografia
 *
 * La fotografia NON è un giudizio su cosa sia giusto: dice com'era prima. Quando una
 * differenza compare, o è la modifica che si voleva — e allora si aggiorna — o è un
 * effetto che non si era previsto, ed è esattamente ciò che si voleva sapere.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { etichetteDiUnFile } from './etichette-di-un-file';

const DIR = 'tests';
const FOTO = 'tests/etichette-baseline.json';
const aggiorna = process.argv.includes('--aggiorna');

const files = readdirSync(DIR).filter(f => f.endsWith('.htp')).sort();
const ora: Record<string, string[]> = {};
const rotti: string[] = [];

for (const f of files) {
  try {
    // una riga per etichetta: «movimento|romano|cifre» — compatta e leggibile in diff
    ora[f] = etichetteDiUnFile(`${DIR}/${f}`).map(e => `${e.absBeat}|${e.roman}|${(e.figures || []).join('/')}`);
  } catch (e: any) {
    rotti.push(`${f}: ${String(e?.message).slice(0, 80)}`);
  }
}

if (aggiorna) {
  writeFileSync(FOTO, JSON.stringify(ora, null, 0));
  const n = Object.values(ora).reduce((s, x) => s + x.length, 0);
  console.log(`fotografia scritta: ${Object.keys(ora).length} file, ${n} etichette`);
  if (rotti.length) { console.log(`\n${rotti.length} file che non si aprono:`); for (const r of rotti.slice(0, 10)) console.log('   ' + r); }
  process.exit(0);
}

if (!existsSync(FOTO)) { console.log('Nessuna fotografia: lanciare prima con --aggiorna'); process.exit(1); }
const prima: Record<string, string[]> = JSON.parse(readFileSync(FOTO, 'utf8'));

let uguali = 0; const diversi: string[] = [];
for (const f of Object.keys(prima)) {
  const a = prima[f] || [], b = ora[f];
  if (!b) { diversi.push(`${f}: non si apre più`); continue; }
  if (a.length === b.length && a.every((x, i) => x === b[i])) { uguali++; continue; }
  const scarti: string[] = [];
  const mappaB = new Map(b.map(x => [x.split('|')[0], x]));
  for (const x of a) {
    const [beat] = x.split('|');
    const y = mappaB.get(beat);
    if (y === undefined) scarti.push(`b.${beat} sparita (${x.split('|')[1]})`);
    else if (y !== x) scarti.push(`b.${beat} ${x.split('|').slice(1).join(' ')} → ${y.split('|').slice(1).join(' ')}`);
  }
  const nuove = b.length - a.length;
  diversi.push(`${f}: ${scarti.length} cambiate${nuove ? `, ${nuove > 0 ? '+' : ''}${nuove} di numero` : ''}` +
               (scarti.length ? `\n      ${scarti.slice(0, 3).join(' · ')}` : ''));
}
const nuoviFile = Object.keys(ora).filter(f => !(f in prima));

console.log(`file identici: ${uguali} su ${Object.keys(prima).length}`);
if (nuoviFile.length) console.log(`file nuovi (non nella fotografia): ${nuoviFile.length}`);
if (diversi.length) { console.log(`\nDIVERSI: ${diversi.length}`); for (const d of diversi.slice(0, 15)) console.log('   ' + d); }
else console.log('\nnessuna differenza.');
process.exit(diversi.length ? 1 : 0);
