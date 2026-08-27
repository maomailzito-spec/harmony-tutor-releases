/**
 * ANALISI FORMALE DEL CORPUS — come sono COSTRUITI i brani, non solo che accordi usano.
 *
 * Il generatore sa scegliere gli accordi, e da oggi sa che una chiusura di frase dipende da
 * dove sta la frase. Ma non sa niente della FORMA: quanto dura un brano, dove cadono le
 * cadenze e di che tipo, quali movimenti armonici ricorrono in un gruppo di quattro battute e
 * come si distribuiscono lungo la composizione.
 *
 * Si guardano i brani ACCADEMICI — Dubois, Pedron, Delachi, Schinelli — e il Delamont, che ha
 * armonie più cromatiche ma strutture uguali: cadenze e sospensioni le fa allo stesso modo.
 *
 *   npx tsx scripts/analisi-formale.ts            il rapporto
 *   npx tsx scripts/analisi-formale.ts json       i dati grezzi
 */
import { readFileSync, readdirSync } from 'fs';
import * as path from 'path';
import { applyHarmonyRules, getKeySignature, getRomanAnalysis } from '../src/utils/musicTheory';
import { tonicaReale } from '../src/utils/relativeMinors';

const ACCADEMICI = /dubois|dubuois|duboi|pedron|delachi|schinelli|delamont/i;
const senza = (l: string) => String(l || '').replace(/[0-9]+$/, '').replace(/\/([^/]*?)[0-9]+$/, '/$1').replace(/[♯♭♮]+$/, '').trim();

export type Accordo = {
  batt: number; mov: number; grado: string; forte: boolean;
  /** Quanto dura la nota di SOPRANO qui, in rapporto alla durata tipica del brano. Serve a
   *  distinguere un punto d'ARRIVO da un passaggio: senza, ogni `V→I` sembra una cadenza —
   *  misurato, ne uscivano 5,9 a brano, il 63% a una battuta di distanza l'una dall'altra. */
  respiro: number;
};
export type Brano = { nome: string; fonte: string; minore: boolean; battute: number; movPerBatt: number; accordi: Accordo[] };

const fonteDi = (n: string) => /delamont/i.test(n) ? 'Delamont' : /delachi/i.test(n) ? 'Delachi'
  : /pedron/i.test(n) ? 'Pedron' : /schinelli/i.test(n) ? 'Schinelli' : 'Dubois';

export function leggiBrani(): Brano[] {
  const fuori: Brano[] = [];
  for (const f of readdirSync('tests').filter(x => (x.endsWith('.htp') || x.endsWith('.json')) && ACCADEMICI.test(x))) {
    let d: any; try { d = JSON.parse(readFileSync(path.join('tests', f), 'utf8')); } catch { continue; }
    const note = (d.notes || []).filter((n: any) => n && !n.isRest);
    if (note.length < 40) continue;
    const voci = new Set(note.map((n: any) => n.voice ?? 1));
    if (![1, 2, 3, 4].every(v => voci.has(v))) continue;
    const minore = !!d.isMinorMode;
    const tonica = tonicaReale(String(d.keySignatureRoot || 'C'), minore);
    const ts = d.timeSignature || { numerator: 4, denominator: 4 };
    const movPerBatt = ts.numerator * (4 / ts.denominator);
    try {
      const res: any = applyHarmonyRules(note as any, getKeySignature(tonica, minore ? 'Minor' : 'Major') as any,
        tonica, minore, d.analysisContexts || [], ts as any, undefined, d.ornamentOverrides || []);
      const an: any[] = res.analyzedNotes || note;
      const per = new Map<string, any[]>();
      for (const n of an) { if (n.isRest) continue; const k = `${n.measureIndex}:${n.beat}`; (per.get(k) ?? per.set(k, []).get(k)!).push(n); }
      const chiavi = [...per.keys()].map(k => k.split(':').map(Number) as [number, number])
        .filter(([, b]) => Math.abs(b - Math.round(b)) < 0.01)
        .sort((a, b) => a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]);
      const accordi: Accordo[] = [];
      let ultimo = -Infinity;
      for (const [mi, bt] of chiavi) {
        const assoluto = mi * movPerBatt + bt;
        if (assoluto - ultimo < 0.99) continue;
        const g = per.get(`${mi}:${bt}`)!.filter((n: any) => !n.isPassing && !n.isNeighbor && !n.isAppoggiatura);
        if (g.length < 2) continue;
        try {
          const r = getRomanAnalysis(g as any, tonica, minore);
          if (!r?.roman || r.roman === '?') continue;
          ultimo = assoluto;
          const sop = g.find((n: any) => (n.voice ?? 1) === 1);
          accordi.push({ batt: mi, mov: bt, grado: senza(r.roman),
            forte: bt === 1 || (movPerBatt % 2 === 0 && bt === movPerBatt / 2 + 1),
            respiro: sop ? (Number(sop.durationTicks) || 480) : 480 });
        } catch { /* */ }
      }
      if (accordi.length < 8) continue;
      // Il respiro si normalizza sulla durata TIPICA del brano: in un corale a semiminime
      // una minima è un arrivo, in uno a minime no.
      const durate = accordi.map(a => a.respiro).sort((x, y) => x - y);
      const tipica = durate[Math.floor(durate.length / 2)] || 480;
      for (const a of accordi) a.respiro = a.respiro / tipica;
      fuori.push({ nome: f.replace(/\.(htp|json)$/, ''), fonte: fonteDi(f), minore,
        battute: Math.max(...note.map((n: any) => n.measureIndex ?? 0)) + 1, movPerBatt, accordi });
    } catch { /* */ }
  }
  return fuori;
}

/** Che cadenza è, guardando i due accordi. `null` = non è una cadenza. */
export function tipoCadenza(da: string, a: string, minore: boolean): string | null {
  const T = minore ? 'i' : 'I', D = 'V', S = minore ? 'iv' : 'IV', SM = minore ? 'VI' : 'vi';
  const dom = da === D || da === 'V7' || da.startsWith('vii');
  if (dom && a === T) return 'autentica';
  if (dom && a === SM) return 'inganno';
  if (da === S && a === T) return 'plagale';
  if (a === D) return 'sospesa';
  return null;
}

if (require.main === module) {
  const brani = leggiBrani();
  if (process.argv[2] === 'json') { console.log(JSON.stringify(brani)); }
  else {
    console.log(`${brani.length} brani accademici\n`);
    const perFonte: Record<string, number> = {};
    for (const b of brani) perFonte[b.fonte] = (perFonte[b.fonte] || 0) + 1;
    console.log('  ' + Object.entries(perFonte).map(([k, v]) => `${k}: ${v}`).join('   '));
    // ── quanto durano ──
    const lung: Record<number, number> = {};
    for (const b of brani) lung[b.battute] = (lung[b.battute] || 0) + 1;
    console.log('\n── quante battute ──');
    const ord = Object.entries(lung).map(([k, v]) => [+k, v] as [number, number]).sort((a, b) => b[1] - a[1]);
    console.log('  ' + ord.slice(0, 10).map(([k, v]) => `${k} batt: ${v}`).join('   '));
    const mult4 = brani.filter(b => b.battute % 4 === 0).length;
    const mult2 = brani.filter(b => b.battute % 2 === 0).length;
    console.log(`  multipli di 4: ${mult4}/${brani.length} (${Math.round(100 * mult4 / brani.length)}%)   ·   di 2: ${mult2} (${Math.round(100 * mult2 / brani.length)}%)`);

    // ── DOVE CADONO LE CADENZE, e quanto sono lunghe le frasi ──
    // Non si assume nessuna griglia: la cadenza si riconosce dal profilo armonico e
    // dall'atterraggio sul BATTERE, e si guarda dove finisce.
    const tipi: Record<string, number> = {};
    const lunghezze: Record<number, number> = {};
    const suBattere: Record<string, number> = { 'battere': 0, 'altro movimento': 0 };
    let conCadenze = 0, cadenzeTot = 0;
    for (const b of brani) {
      const cad: { batt: number; tipo: string }[] = [];
      for (let i = 1; i < b.accordi.length; i++) {
        const a = b.accordi[i - 1], c = b.accordi[i];
        const t = tipoCadenza(a.grado, c.grado, b.minore);
        if (!t) continue;
        // Una cadenza ATTERRA: su un movimento forte E su una nota che dura più del solito.
        // Senza il secondo requisito ogni `V→I` di passaggio conta come cadenza.
        if (!c.forte || c.respiro < 1.5) continue;
        // e non due di fila nello stesso punto
        if (cad.length && cad[cad.length - 1].batt === c.batt) continue;
        cad.push({ batt: c.batt, tipo: t });
        suBattere[c.mov === 1 ? 'battere' : 'altro movimento']++;
      }
      if (!cad.length) continue;
      conCadenze++; cadenzeTot += cad.length;
      for (const c of cad) tipi[c.tipo] = (tipi[c.tipo] || 0) + 1;
      // distanza fra cadenze = lunghezza della frase
      let prec = -1;
      for (const c of cad) { if (prec >= 0) { const L = c.batt - prec; if (L > 0 && L <= 16) lunghezze[L] = (lunghezze[L] || 0) + 1; } prec = c.batt; }
    }
    console.log(`\n── le cadenze ──`);
    console.log(`  ${cadenzeTot} cadenze in ${conCadenze} brani su ${brani.length}  (${(cadenzeTot / conCadenze).toFixed(1)} a brano)`);
    const tt = Object.values(tipi).reduce((a, b2) => a + b2, 0);
    console.log('  ' + Object.entries(tipi).sort((a, b2) => b2[1] - a[1]).map(([k, v]) => `${k}: ${Math.round(100 * v / tt)}%`).join('   '));
    console.log(`  atterrano sul battere: ${Math.round(100 * suBattere['battere'] / (suBattere['battere'] + suBattere['altro movimento']))}%`);
    // ── DOVE cadono, nei brani di lunghezza regolare ──
    console.log(`\n── dove cade la cadenza, nei brani di 8 e di 16 battute ──`);
    for (const L of [8, 16]) {
      const gruppo = brani.filter(b => b.battute === L);
      if (gruppo.length < 4) continue;
      const conta = new Array(L + 1).fill(0);
      let n = 0;
      for (const b of gruppo) {
        for (let i2 = 1; i2 < b.accordi.length; i2++) {
          const a = b.accordi[i2 - 1], c = b.accordi[i2];
          const t = tipoCadenza(a.grado, c.grado, b.minore);
          if (!t || !c.forte || c.respiro < 1.5) continue;
          conta[c.batt + 1]++; n++;
        }
      }
      console.log(`  ${L} battute (${gruppo.length} brani, ${n} cadenze):`);
      for (let m = 1; m <= L; m++) {
        if (!conta[m]) continue;
        console.log(`    b${String(m).padStart(2)}: ${String(conta[m]).padStart(3)}  ${'█'.repeat(Math.round(40 * conta[m] / Math.max(...conta)))}`);
      }
    }

    // ── LE DUE METÀ: che cadenza chiude la prima e che cadenza chiude la seconda ──
    console.log(`\n── il periodo: che cadenza chiude ciascuna metà ──`);
    const meta: Record<string, Record<string, number>> = { 'prima metà': {}, 'seconda metà': {} };
    let periodi = 0;
    for (const b of brani) {
      if (b.battute < 6) continue;
      const mezzo = b.battute / 2;
      const cad: { batt: number; tipo: string }[] = [];
      for (let i2 = 1; i2 < b.accordi.length; i2++) {
        const a = b.accordi[i2 - 1], c = b.accordi[i2];
        const t = tipoCadenza(a.grado, c.grado, b.minore);
        if (t && c.forte && c.respiro >= 1.5) cad.push({ batt: c.batt, tipo: t });
      }
      if (cad.length < 2) continue;
      periodi++;
      // la cadenza più vicina alla metà, e quella finale
      const dentroPrima = cad.filter(c => c.batt + 1 <= mezzo + 0.5);
      const ultima = cad[cad.length - 1];
      if (dentroPrima.length) {
        const u = dentroPrima[dentroPrima.length - 1];
        meta['prima metà'][u.tipo] = (meta['prima metà'][u.tipo] || 0) + 1;
      }
      meta['seconda metà'][ultima.tipo] = (meta['seconda metà'][ultima.tipo] || 0) + 1;
    }
    console.log(`  ${periodi} brani con almeno due cadenze e almeno 6 battute`);
    for (const [dove, m] of Object.entries(meta)) {
      const t = Object.values(m).reduce((a, b2) => a + b2, 0);
      if (!t) continue;
      console.log(`  ${dove.padEnd(13)}: ` + Object.entries(m).sort((a, b2) => b2[1] - a[1])
        .map(([k, v]) => `${k} ${Math.round(100 * v / t)}%`).join('   '));
    }

    // ── COSA C'È IN QUATTRO BATTUTE, secondo dove stanno ──
    console.log(`\n── i movimenti armonici di un gruppo di 4 battute, per posizione ──`);
    const perPos: Record<string, Record<string, number>> = { 'primo': {}, 'interno': {}, 'ultimo': {} };
    for (const b of brani) {
      const gruppi = Math.floor(b.battute / 4);
      if (gruppi < 2) continue;
      for (let gr = 0; gr < gruppi; gr++) {
        const dentro = b.accordi.filter(a => a.batt >= gr * 4 && a.batt < (gr + 1) * 4);
        if (dentro.length < 3) continue;
        // la successione dei gradi, senza ripetizioni consecutive
        const seq = dentro.map(a => a.grado).filter((g, k, arr) => k === 0 || g !== arr[k - 1]);
        if (seq.length < 3) continue;
        const dove = gr === 0 ? 'primo' : gr === gruppi - 1 ? 'ultimo' : 'interno';
        // si guardano i movimenti a due, che è l'unità che si ripete
        for (let k = 1; k < seq.length; k++) {
          const mv = `${seq[k - 1]} → ${seq[k]}`;
          perPos[dove][mv] = (perPos[dove][mv] || 0) + 1;
        }
      }
    }
    for (const [dove, mappa] of Object.entries(perPos)) {
      const t = Object.values(mappa).reduce((a, b2) => a + b2, 0);
      if (!t) continue;
      const top = Object.entries(mappa).sort((a, b2) => b2[1] - a[1]).slice(0, 8);
      console.log(`  gruppo ${dove.toUpperCase()} (${t} movimenti):`);
      console.log('    ' + top.map(([m, v]) => `${m} ${Math.round(100 * v / t)}%`).join('   '));
    }
  }
}
