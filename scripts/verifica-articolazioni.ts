/**
 * Banco di prova delle ARTICOLAZIONI: come suonano, come escono nel MusicXML e come
 * rientrano.  Si esegue con:  npx tsx scripts/verifica-articolazioni.ts
 */
import { articulationPlayback, ARTICULATIONS, ARTICULATION_VF_CODE, ARTICULATION_UI } from '../src/utils/articulations';
import { exportMusicXML } from '../src/exporters/exportMusicXML';
import { readNoteArticulations } from '../src/importers/musicxml/importMusicXML';
import { TICKS_PER_QUARTER as TPQ } from '../src/constants';
import type { ArticulationMark } from '../src/types';

let falliti = 0;
const ok = (cond: boolean, msg: string) => {
    console.log(`${cond ? '  ok  ' : '  NO  '} ${msg}`);
    if (!cond) falliti++;
};

// ── 1. Il suono ───────────────────────────────────────────────────────────
console.log('\nCome suonano');
const niente = articulationPlayback(undefined);
ok(niente.durationFactor === 1 && niente.gainFactor === 1, 'senza articolazioni non cambia nulla');

const stac = articulationPlayback(['staccato']);
ok(stac.durationFactor === 0.5 && stac.gainFactor === 1, `lo staccato dimezza la durata (${stac.durationFactor}) e non alza il volume`);

const acc = articulationPlayback(['accent']);
ok(acc.gainFactor > 1 && acc.durationFactor === 1, `l'accento rinforza (×${acc.gainFactor}) senza accorciare`);
ok(acc.velocityDelta > 0, "l'accento alza anche la velocity, per lo strato di campione più brillante");

const ten = articulationPlayback(['tenuto']);
ok(ten.durationFactor === 1 && ten.gainFactor === 1, 'il tenuto non tocca il suono (la durata piena è già la norma)');

// La combinazione è la prova vera: accento + staccato è scrittura corrente.
const combo = articulationPlayback(['accent', 'staccato']);
ok(combo.durationFactor === 0.5 && combo.gainFactor === acc.gainFactor,
   `accento + staccato: corta come lo staccato (${combo.durationFactor}), forte come l'accento (×${combo.gainFactor})`);
const doppioForte = articulationPlayback(['accent', 'marcato']);
ok(doppioForte.gainFactor === articulationPlayback(['marcato']).gainFactor,
   `due segni forti insieme non si sommano: resta il più forte (×${doppioForte.gainFactor})`);
ok(articulationPlayback(['staccatissimo', 'marcato']).durationFactor < 0.35,
   'le durate invece si moltiplicano (staccatissimo + marcato accorcia due volte)');

ok(ARTICULATIONS.every(a => !!ARTICULATION_VF_CODE[a] && !!ARTICULATION_UI[a]),
   `tutte e ${ARTICULATIONS.length} hanno glifo e nome: nessuna resta invisibile`);

// ── 2. Export MusicXML ────────────────────────────────────────────────────
console.log('\nEsportazione');
const nota = (extra: any = {}) => ({
    id: 'n1', pitch: 'C', octave: 5, midi: 72, voice: 1, clef: 'treble',
    duration: 'quarter', measureIndex: 0, beat: 1, startTick: 0, durationTicks: TPQ, ...extra,
});
const base = { title: 'x', keySignature: { type: 'sharp', count: 0 } as any, timeSignature: { numerator: 4, denominator: 4 } as any };

const xml = exportMusicXML({ ...base, notes: [nota({ articulations: ['staccato', 'accent'] })] as any });
ok(xml.includes('<staccato/>') && xml.includes('<accent/>'), 'staccato e accento escono nel file');
ok(xml.includes('<articulations>'), 'stanno dentro <articulations>, dove le cerca chi legge');
ok(/<marcato\/>/.test(xml) === false, 'niente elementi inventati');

const xmlMarc = exportMusicXML({ ...base, notes: [nota({ articulations: ['marcato'] })] as any });
ok(xmlMarc.includes('<strong-accent/>'), 'il marcato esce col suo nome vero (strong-accent)');

// Legatura + articolazione sulla stessa nota: un solo <notations>, non due.
const xmlTie = exportMusicXML({ ...base, notes: [nota({ articulations: ['tenuto'], isTiedToNext: true })] as any });
ok((xmlTie.match(/<notations>/g) || []).length === 1, 'legatura e articolazione stanno nello STESSO <notations>');
ok(xmlTie.includes('<tied type="start"/>') && xmlTie.includes('<tenuto/>'), 'e ci sono tutte e due');

const xmlNudo = exportMusicXML({ ...base, notes: [nota()] as any });
ok(!xmlNudo.includes('<articulations>'), 'una nota senza articolazioni non porta tag vuoti');

// ── 3. Rilettura ──────────────────────────────────────────────────────────
// L'import vero vuole un DOM, che in node non c'è: si prova il lettore da solo.
console.log('\nRilettura');
const fintaNota = (nomi: string[]): any => ({
    querySelectorAll: (sel: string) => sel.includes('articulations')
        ? [{ children: nomi.map(t => ({ tagName: t })) }]
        : [],
});
const lette = readNoteArticulations(fintaNota(['staccato', 'accent']));
ok(lette.length === 2 && lette.includes('staccato') && lette.includes('accent'), `rilette: ${lette.join(' + ')}`);
ok(readNoteArticulations(fintaNota(['strong-accent']))[0] === 'marcato', 'strong-accent torna a essere marcato');
ok(readNoteArticulations(fintaNota(['spiccato', 'detached-legato'])).length === 0,
   'le articolazioni che non abbiamo si ignorano invece di entrare per un\'altra cosa');
ok(readNoteArticulations(fintaNota([])).length === 0, 'nota senza articolazioni: nessun campo');

// Giro completo sui nomi: tutto ciò che esce deve poter rientrare uguale.
const giro = ARTICULATIONS.every((a: ArticulationMark) => {
    const x = exportMusicXML({ ...base, notes: [nota({ articulations: [a] })] as any });
    const tag = (x.match(/<articulations>\s*<([a-z-]+)\/>/) || [])[1];
    return !!tag && readNoteArticulations(fintaNota([tag]))[0] === a;
});
ok(giro, `tutte e ${ARTICULATIONS.length} escono e rientrano identiche`);

console.log(falliti === 0 ? '\nTUTTO A POSTO\n' : `\n${falliti} CONTROLLI FALLITI\n`);
process.exit(falliti === 0 ? 0 : 1);
