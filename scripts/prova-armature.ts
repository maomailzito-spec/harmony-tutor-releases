/**
 * Le quindici armature maggiori e i minori, ciascuna con la SUA scrittura.
 * Si maggiore sono cinque diesis, non sette bemolli: enarmonico non vuol dire uguale.
 */
import { getKeySignature } from '../src/utils/musicTheory';
const attese: Record<string,string> = {
  'C':'0','G':'1 sharp','D':'2 sharp','A':'3 sharp','E':'4 sharp','B':'5 sharp','F#':'6 sharp','C#':'7 sharp',
  'F':'1 flat','Bb':'2 flat','Eb':'3 flat','Ab':'4 flat','Db':'5 flat','Gb':'6 flat','Cb':'7 flat',
};
let male=0;
for (const [r,att] of Object.entries(attese)) {
  const k:any = getKeySignature(r,'Major');
  const got = k.count===0 ? '0' : `${k.count} ${k.type}`;
  if (got!==att) { console.log(`  ✗ ${r}: atteso ${att}, ottenuto ${got}`); male++; }
}
console.log(male? `${male} sbagliate` : '  ✓ tutte e 15 le armature maggiori corrette');
// i minori, che passano da un'altra strada
const min: Record<string,string> = {'A':'0','E':'1 sharp','B':'2 sharp','F#':'3 sharp','C#':'4 sharp','G#':'5 sharp',
  'D':'1 flat','G':'2 flat','C':'3 flat','F':'4 flat','Bb':'5 flat','Eb':'6 flat'};
let m2=0;
for (const [r,att] of Object.entries(min)) {
  const k:any = getKeySignature(r,'Minor');
  const got = k.count===0 ? '0' : `${k.count} ${k.type}`;
  if (got!==att) { console.log(`  ✗ ${r} minore: atteso ${att}, ottenuto ${got}`); m2++; }
}
console.log(m2? `${m2} minori sbagliate` : '  ✓ i minori provati sono corretti');
