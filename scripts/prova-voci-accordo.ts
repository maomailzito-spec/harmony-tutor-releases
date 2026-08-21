import { vociDallAccordo } from '../src/utils/voiceFromChord';
const NOME: Record<number,string> = {1:'S',2:'A',3:'T',4:'B'};
const n = (id: string, midi: number) => ({ id, midi });
const p = (id: string, voice: number) => ({ id, isRest: true, voice });

const casi: Array<[string, any[], number]> = [
  ['accordo pieno (Do maggiore, lato largo)', [n('s',72), n('a',67), n('t',64), n('b',48)], 4],
  ['stesse note scritte a rovescio',           [n('b',48), n('t',64), n('a',67), n('s',72)], 4],
  ['PARTI STRETTE: tenore alto, sul rigo di violino', [n('s',72), n('a',69), n('t',65), n('b',41)], 4],
  ['due note sole (ambiguo)',                  [n('x',72), n('y',60)], 4],
  ['due note + pausa di tenore',               [n('x',72), n('y',60), p('r',3)], 4],
  ['tre note + pausa di contralto',            [n('x',72), n('y',64), n('z',48), p('r',2)], 4],
  ['tre parti (1-2-4)',                        [n('x',72), n('y',64), n('z',48)], 3],
  ['unisono contralto/tenore',                 [n('s',72), n('a',60), n('t',60), n('b',48)], 4],
  ['cinque note (una avanza)',                 [n('a1',72), n('a2',69), n('a3',65), n('a4',60), n('a5',48)], 4],
];
for (const [titolo, els, pc] of casi) {
  const r = vociDallAccordo(els, pc);
  const riga = els.filter(e=>!e.isRest).sort((a,b)=>b.midi-a.midi)
    .map(e => `${e.id}(${e.midi})→${NOME[r.voci.get(e.id) as number] ?? '—'}`).join('  ');
  const pause = els.filter(e=>e.isRest).map(e=>`${e.id}→${NOME[r.voci.get(e.id) as number]}`).join(' ');
  console.log(`${titolo}\n   ${riga}${pause?'   [pause: '+pause+']':''}   certo=${r.certo}${r.avanzate.length?'  avanzate='+r.avanzate.join(','):''}\n`);
}
