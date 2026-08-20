import { PREFERENCE_DEFS } from '../src/preferences/preferencesRegistry';
const def: any = (PREFERENCE_DEFS as any[]).find(d => d.id === 'editor.toolbarPrefs');
const scritto = JSON.stringify({ order: ['playback','__acapo__','analysis'], hidden: ['midi','key'] });
const letto = def.parse(scritto);
const riscritto = def.serialize(letto);
console.log('  scritto dall\'editor: ', scritto);
console.log('  riletto dal registro:', JSON.stringify(letto));
console.log('  riscritto:           ', riscritto);
console.log(riscritto === scritto ? '  ✓ lo spegnimento sopravvive al giro' : '  ✗ PERSO');
