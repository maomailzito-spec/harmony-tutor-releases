/**
 * QUANTI RITARDI VENGONO CHIAMATI APPOGGIATURE.
 *
 * Segnalazione d'utente: un ritardo con la sua preparazione regolare esce
 * etichettato «A». Il motivo sta in `detectOrnaments` (musicTheory.ts ~6906):
 * la condizione che marca l'appoggiatura include `prepared`, cioe' il caso in
 * cui la nota precedente della stessa voce e' LA STESSA ALTEZZA — che e' la
 * definizione di preparazione. L'appoggiatura e' insomma il valore
 * predefinito, e `detectSuspensions`, che gira dopo, deve riconquistare la
 * nota. Ogni suo paletto lascia quindi un ritardo vero chiamato appoggiatura.
 *
 * Qui si conta quante volte succede, e con che durata — perche' fra i paletti
 * c'e' `MIN_SUSP_DURATION = 1.0` movimento.
 *
 *   npx tsx scripts/ritardo-o-appoggiatura.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { applyHarmonyRules, getKeySignature } from '../src/utils/musicTheory';

const DUR: Record<string, number> = { whole: 4, half: 2, quarter: 1, eighth: 0.5, sixteenth: 0.25 };
const durataDi = (n: any) => (DUR[n?.duration] ?? 1) * (n?.isDotted ? 1.5 : 1);

function main() {
  const dir = path.resolve(__dirname, '..', 'tests');
  const files = fs.readdirSync(dir).filter(f => /\.(json|htp)$/.test(f)).sort();

  let brani = 0, appogg = 0, preparate = 0, ritardi = 0, conLegatura = 0, senzaLegatura = 0, bandiera = 0;
  const perDurata: Record<string, number> = {};
  const esempi: string[] = [];

  for (const nome of files) {
    let d: any;
    try { d = JSON.parse(fs.readFileSync(path.join(dir, nome), 'utf8')); } catch { continue; }
    const note = d.notes;
    if (!Array.isArray(note) || note.filter((n: any) => n && !n.isRest).length < 2) continue;

    let res: any;
    try {
      res = applyHarmonyRules(
        note, getKeySignature(d.keySignatureRoot || 'C', 'Major') as any,
        d.keyTonic || d.keySignatureRoot || 'C', !!d.isMinorMode,
        d.analysisContexts || [], d.timeSignature || { numerator: 4, denominator: 4 },
        undefined,
        (d.ornamentOverrides && d.ornamentOverrides.length) ? d.ornamentOverrides : undefined,
        (d.harmonyOverrides && d.harmonyOverrides.length) ? d.harmonyOverrides : undefined,
      );
    } catch { continue; }
    brani++;

    const an: any[] = res.analyzedNotes || note;
    // le note in fila, voce per voce: la preparazione e' la precedente della STESSA voce
    const perVoce = new Map<number, any[]>();
    for (const n of an) {
      if (!n || n.isRest) continue;
      const v = Number(n.voice) || 1;
      if (!perVoce.has(v)) perVoce.set(v, []);
      perVoce.get(v)!.push(n);
    }
    for (const [, linea] of perVoce) {
      linea.sort((a, b) => ((a.measureIndex ?? 0) - (b.measureIndex ?? 0)) || ((a.beat ?? 1) - (b.beat ?? 1)));
      for (let i = 0; i < linea.length; i++) {
        const n = linea[i];
        if (n.isSuspension) ritardi++;
        if ((n as any).preparata && n.isAppoggiatura) bandiera++;
        if (!n.isAppoggiatura) continue;
        appogg++;
        const prima = linea[i - 1];
        // PREPARATA: la precedente della stessa voce e' la stessa altezza.
        if (!prima || prima.midi !== n.midi) continue;
        preparate++;
        const legata = !!prima.isTiedToNext || !!n.isTiedFromPrev;
        if (legata) conLegatura++; else senzaLegatura++;
        const dv = durataDi(n);
        const chiave = dv < 1 ? `sotto il movimento (${dv})` : `${dv} movimenti`;
        perDurata[chiave] = (perDurata[chiave] || 0) + 1;
        if (process.env.ELENCO_ID) console.log('PREPARATA_ID', n.id, dv);
        if (esempi.length < 10) {
          esempi.push(`${nome}  mis ${(n.measureIndex ?? 0) + 1} b${n.beat}  voce ${n.voice}  ${n.pitch}${n.octave}  dura ${dv}`);
        }
      }
    }
  }

  const pc = (a: number, b: number) => b ? (100 * a / b).toFixed(1) + '%' : '—';
  console.log(`\n${brani} brani letti\n`);
  console.log(`note marcate APPOGGIATURA : ${appogg}`);
  console.log(`  di cui PREPARATE (la precedente della stessa voce e' la stessa altezza): ${preparate}  ${pc(preparate, appogg)}`);
  console.log(`     di cui LEGATE (ritardo vero, va detto R): ${conLegatura}`);
  console.log(`     di cui RIBATTUTE (appoggiatura, resta A):  ${senzaLegatura}`);
  console.log(`     la lettera che CAMBIA da A a R:            ${bandiera}`);
  console.log(`note marcate ritardo      : ${ritardi}\n`);
  console.log('le preparate, per durata:');
  for (const [k, v] of Object.entries(perDurata).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${k.padEnd(28)} ${String(v).padStart(5)}   ${pc(v, preparate)}`);
  }
  console.log('\nqualche caso:');
  for (const e of esempi) console.log('   ' + e);
  console.log('');
}

main();
