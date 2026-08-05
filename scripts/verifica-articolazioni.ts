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

// ── 4. Legature di portamento ─────────────────────────────────────────────
// Il segno che collega DUE note: nel file esce in due pezzi (start e stop) legati
// dallo stesso numero, e va appaiato in lettura.
console.log('\nLegature di portamento');
import { readNoteSlurEnds } from '../src/importers/musicxml/importMusicXML';

const due = [nota({ id: 'a' }), nota({ id: 'b', beat: 2, startTick: TPQ })];
const xmlLeg = exportMusicXML({ ...base, notes: due as any, slurs: [{ id: 's1', fromNoteId: 'a', toNoteId: 'b' }] });
ok(xmlLeg.includes('<slur type="start" number="1"/>'), 'la legatura si apre sulla prima nota');
ok(xmlLeg.includes('<slur type="stop" number="1"/>'), 'e si chiude sulla seconda');
ok((xmlLeg.match(/<slur /g) || []).length === 2, 'due capi, non uno né tre');

const xmlDueLeg = exportMusicXML({
    ...base, notes: [...due, nota({ id: 'c', beat: 3, startTick: 2 * TPQ })] as any,
    slurs: [{ id: 's1', fromNoteId: 'a', toNoteId: 'b' }, { id: 's2', fromNoteId: 'b', toNoteId: 'c' }],
});
ok(/number="1"/.test(xmlDueLeg) && /number="2"/.test(xmlDueLeg),
   'due legature diverse prendono numeri diversi: i capi non si confondono');

const xmlNiente = exportMusicXML({ ...base, notes: due as any });
ok(!xmlNiente.includes('<slur'), 'senza legature non esce nessun tag');

// Rilettura dei capi (di nuovo con elementi finti: in node non c'è un DOM).
const fintaConLegature = (capi: Array<{ type: string; number?: string }>): any => ({
    querySelectorAll: (sel: string) => sel.includes('slur')
        ? capi.map(c => ({ getAttribute: (k: string) => (k === 'type' ? c.type : (c.number ?? '1')) }))
        : [],
});
const capiLetti = readNoteSlurEnds(fintaConLegature([{ type: 'start', number: '2' }]));
ok(capiLetti.length === 1 && capiLetti[0].tipo === 'start' && capiLetti[0].numero === '2',
   'un capo di apertura si rilegge col suo numero');
ok(readNoteSlurEnds(fintaConLegature([{ type: 'continue' }])).length === 0,
   "il tipo 'continue' non apre e non chiude: si ignora");
ok(readNoteSlurEnds(fintaConLegature([])).length === 0, 'nota senza legature: nessun capo');

// ── 5. Segni d'ottava ─────────────────────────────────────────────────────
// Quello che è SCRITTO resta dov'è; il segno cambia quello che SUONA.
console.log('\nSegni d\'ottava');
import { octaveOffsetSemitones, type OctaveSpan } from '../src/utils/octaveShifts';

const sopra: OctaveSpan[] = [{ fromTick: 0, toTick: 4 * TPQ, voice: 1, direction: 'up' }];
ok(octaveOffsetSemitones(sopra, 0, 1) === 12, 'sulla prima nota del tratto: +12');
ok(octaveOffsetSemitones(sopra, 4 * TPQ, 1) === 12, "anche sull'ULTIMA: gli estremi sono compresi");
ok(octaveOffsetSemitones(sopra, 4 * TPQ + 1, 1) === 0, 'appena dopo la fine: niente');
ok(octaveOffsetSemitones(sopra, 2 * TPQ, 4) === 0, "un 8va sul soprano non alza il basso che suona insieme");
ok(octaveOffsetSemitones([{ ...sopra[0], direction: 'down' }], 0, 1) === -12, "l'8vb scende di un'ottava");
ok(octaveOffsetSemitones(undefined, 0, 1) === 0 && octaveOffsetSemitones([], 0, 1) === 0, 'senza segni non cambia niente');
ok(octaveOffsetSemitones([sopra[0], sopra[0]], 0, 1) === 24, 'due segni sovrapposti si sommano (15ma scritta come due 8va)');

// ── 6. L'8va nel file ─────────────────────────────────────────────────────
// La convenzione del formato è l'opposto delle parole: `type` dice di quanto è
// spostato lo SCRITTO, quindi 8va (suona sopra, scritto sotto) = type="down".
console.log('\nL\'8va nel MusicXML');
const treNote = [nota({ id: 'x1' }), nota({ id: 'x2', beat: 2, startTick: TPQ }), nota({ id: 'x3', beat: 3, startTick: 2 * TPQ })];
const xml8va = exportMusicXML({ ...base, notes: treNote as any, octaveShifts: [{ id: 'o1', fromNoteId: 'x1', toNoteId: 'x3', direction: 'up' }] });
ok(xml8va.includes('<octave-shift type="down" size="8"/>'), '8va → type="down" (lo scritto è un\'ottava sotto)');
ok(xml8va.includes('<octave-shift type="stop" size="8"/>'), 'e la sua chiusura');

const xml8vb = exportMusicXML({ ...base, notes: treNote as any, octaveShifts: [{ id: 'o2', fromNoteId: 'x1', toNoteId: 'x3', direction: 'down' }] });
ok(xml8vb.includes('<octave-shift type="up" size="8"/>'), '8vb → type="up", cioè l\'opposto');

// La chiusura deve cadere DOPO l'ultima nota coperta, altrimenti chi legge la esclude.
// Le direzioni stanno in una corsia loro all'inizio della battuta e si posizionano nel
// TEMPO con <forward>: quindi non si guarda l'ordine nel testo ma i tick percorsi.
const fraApreEChiude = xml8va.slice(xml8va.indexOf('type="down"'), xml8va.indexOf('type="stop"'));
const percorsi = [...fraApreEChiude.matchAll(/<forward>\s*<duration>(\d+)<\/duration>/g)]
    .reduce((tot, m) => tot + Number(m[1]), 0);
ok(percorsi === 3 * TPQ,
   `la chiusura cade alla FINE dell'ultima nota coperta (${percorsi} tick invece di ${2 * TPQ}, che sarebbe il suo attacco)`);

const xmlNoOtt = exportMusicXML({ ...base, notes: treNote as any });
ok(!xmlNoOtt.includes('octave-shift'), 'senza segni non esce nessun tag');

// Un 8va agganciato a note di un'ALTRA parte non deve finire in questa.
const xmlAltraParte = exportMusicXML({
    ...base, notes: treNote as any,
    accompanimentTracks: [{ name: 'Organo', notes: [nota({ id: 'y1' })] as any }],
    octaveShifts: [{ id: 'o3', fromNoteId: 'y1', toNoteId: 'y1', direction: 'up' }],
});
const parteCoro = xmlAltraParte.split('<part id="P1">')[1]?.split('</part>')[0] || '';
ok(!parteCoro.includes('octave-shift'), "un 8va dell'organo non compare nella parte del coro");

// ── 7. L'ALTEZZA sotto l'8va: scritta qui, suonata nel file ───────────────
// Verificato in MuseScore (04/08/2026): nel MusicXML <pitch> è l'altezza che SUONA, e
// <octave-shift> dice di quanto va DISEGNATA più in basso. Esportando l'altezza scritta,
// le note comparivano un'ottava sotto l'originale.
console.log('\nAltezza sotto l\'8va');
const laNota = (id: string, tick: number) => nota({ id, beat: tick / TPQ + 1, startTick: tick, octave: 5 });
const dentroFuori = [laNota('p1', 0), laNota('p2', TPQ), laNota('p3', 2 * TPQ)];

const conOttava = exportMusicXML({
    ...base, notes: dentroFuori as any,
    octaveShifts: [{ id: 'o', fromNoteId: 'p1', toNoteId: 'p2', direction: 'up' }],
});
const ottaveScritte = [...conOttava.matchAll(/<octave>(\d+)<\/octave>/g)].map(m => Number(m[1]));
ok(ottaveScritte[0] === 6 && ottaveScritte[1] === 6,
   `le note sotto l'8va escono all'altezza SUONATA (${ottaveScritte[0]}, ${ottaveScritte[1]} invece di 5)`);
ok(ottaveScritte[2] === 5, `la nota fuori dal tratto resta com'è scritta (${ottaveScritte[2]})`);

const giuOttava = exportMusicXML({
    ...base, notes: dentroFuori as any,
    octaveShifts: [{ id: 'o', fromNoteId: 'p1', toNoteId: 'p2', direction: 'down' }],
});
ok([...giuOttava.matchAll(/<octave>(\d+)<\/octave>/g)].map(m => Number(m[1]))[0] === 4,
   "l'8vb scende: la nota esce un'ottava sotto lo scritto");

// E nel MIDI, che è tutto altezza suonata.
import { buildMidiFile as buildMidi2 } from '../src/utils/midiWriter';
const leggiPrimo = (bytes: Uint8Array): number => {
    for (let i = 14; i < bytes.length - 2; i++) {
        if ((bytes[i] & 0xf0) === 0x90 && bytes[i + 2] > 0) return bytes[i + 1];
    }
    return -1;
};
const progettoOtt = { notes: dentroFuori as any, timeSignature: { numerator: 4, denominator: 4 } as any, bpm: 90, midiType: 1 as const };
ok(leggiPrimo(buildMidi2(progettoOtt)) === 72, 'senza segni il MIDI porta l\'altezza scritta');
ok(leggiPrimo(buildMidi2({ ...progettoOtt, octaveSpans: [{ fromTick: 0, toTick: TPQ, voice: 1, direction: 'up' }] })) === 84,
   "sotto l'8va il MIDI porta l'altezza suonata (+12)");

console.log(falliti === 0 ? '\nTUTTO A POSTO\n' : `\n${falliti} CONTROLLI FALLITI\n`);
process.exit(falliti === 0 ? 0 : 1);
