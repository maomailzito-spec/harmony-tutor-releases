/**
 * DOVE le etichette di oggi differiscono da quelle salvate dentro i file di prova.
 *
 * Le stampa come si leggono su una partitura — file, misura, movimento — invece che in
 * movimenti assoluti, perché servono a essere GUARDATE: si apre il file a quella misura e
 * si giudica quale delle due letture è giusta.
 *
 * Attenzione: le etichette salvate nei file NON sono un oracolo. Sono una fotografia
 * datata, presa quando quel file fu salvato l'ultima volta, e nel frattempo qualche
 * scelta è cambiata apposta — per esempio il quartisestaccordo di cadenza, che oggi si
 * legge V6/4 (lettura funzionale) dove prima si leggeva i6/4 (lettura per posizione).
 */
import { readFileSync, readdirSync } from 'fs';
import { etichetteDiUnFile } from './etichette-di-un-file';
for (const f of readdirSync('tests').filter(x => x.endsWith('.htp')).sort()) {
  const d = JSON.parse(readFileSync(`tests/${f}`, 'utf8'));
  const salvate = d.computedLabels || [];
  if (!salvate.length) continue;
  const ts = d.timeSignature || { numerator: 4, denominator: 4 };
  const bpm = ts.numerator * (4 / ts.denominator);
  const ora = new Map(etichetteDiUnFile(`tests/${f}`).map(e => [Math.round(e.absBeat * 1000), e.roman]));
  const scarti: string[] = [];
  for (const s of salvate) {
    const k = Math.round(Number(s.absBeat) * 1000);
    const a = ora.get(k);
    if (a === undefined || a === s.roman) continue;
    const mis = Math.floor(Number(s.absBeat) / bpm) + 1;
    const mov = Number(s.absBeat) - (mis - 1) * bpm + 1;
    scarti.push(`misura ${mis} mov ${mov % 1 ? mov.toFixed(2) : mov}: ${s.roman} → ${a}`);
  }
  if (!scarti.length) continue;
  console.log(`\n${f}   (${ts.numerator}/${ts.denominator}, ${scarti.length} differenze)`);
  for (const x of scarti.slice(0, 12)) console.log('   ' + x);
  if (scarti.length > 12) console.log(`   … e altre ${scarti.length - 12}`);
}
