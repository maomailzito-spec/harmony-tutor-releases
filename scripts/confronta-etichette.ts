/**
 * LA RETE.
 *
 * Confronta le etichette calcolate ORA con quelle che l'applicazione aveva salvato dentro
 * i file di prova (`computedLabels`). È il controllo che prima non esisteva: il corpus di
 * regressione attraversa il motore, non il condotto delle etichette.
 */
import { readFileSync, readdirSync } from 'fs';
import { etichetteDiUnFile } from './etichette-di-un-file';

const DIR = 'tests';
const files = readdirSync(DIR).filter(f => f.endsWith('.htp'));
let conBase = 0, uguali = 0, diversi = 0, esplosi = 0;
const dettagli: string[] = [];

for (const f of files) {
  let salvate: any[] = [];
  try { salvate = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8')).computedLabels || []; } catch { continue; }
  if (!salvate.length) continue;
  conBase++;
  try {
    const ora = etichetteDiUnFile(`${DIR}/${f}`);
    const mappa = new Map(ora.map(e => [Math.round(e.absBeat * 1000), e.roman]));
    const scarti: string[] = [];
    for (const s of salvate) {
      const k = Math.round(Number(s.absBeat) * 1000);
      const adesso = mappa.get(k);
      if (adesso === undefined) { scarti.push(`b.${s.absBeat} sparita (era ${s.roman})`); continue; }
      if (adesso !== s.roman) scarti.push(`b.${s.absBeat} ${s.roman} → ${adesso}`);
    }
    if (scarti.length === 0) { uguali++; console.log(`  ✓ ${f}  (${salvate.length} etichette)`); }
    else {
      diversi++;
      console.log(`  ✗ ${f}  ${scarti.length}/${salvate.length} diverse`);
      dettagli.push(`${f}: ${scarti.slice(0, 4).join(' · ')}`);
    }
  } catch (e: any) { esplosi++; console.log(`  ! ${f}  errore: ${String(e?.message).slice(0, 60)}`); }
}
console.log(`\nfile con etichette salvate: ${conBase} · identici: ${uguali} · diversi: ${diversi} · errori: ${esplosi}`);
if (dettagli.length) { console.log('\nprimi scarti:'); for (const d of dettagli.slice(0, 8)) console.log('   ' + d); }
