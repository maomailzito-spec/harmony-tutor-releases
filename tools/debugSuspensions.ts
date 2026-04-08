import { applyHarmonyRules, getKeySignature } from '../src/utils/musicTheory';
import type { StaffNote, TimeSignature } from '../src/types';

const notes: StaffNote[] = [
  {"id":"0e58872f-27ef-469f-9d0c-ceb9403c7215","pitch":"E","octave":5,"position":9,"midi":75,"noteIndex":3,"clef":"treble","explicitAccidental":null,"duration":"whole","isRest":false,"isTriplet":false,"isDuplet":false,"isDotted":false,"measureIndex":1,"beat":1,"voice":1} as any,
  {"id":"e85fb2d0-1d70-4fc0-9af2-9b4bce90696a","pitch":"G","octave":4,"position":4,"midi":67,"noteIndex":7,"clef":"treble","explicitAccidental":null,"duration":"whole","isRest":false,"isTriplet":false,"isDuplet":false,"isDotted":false,"measureIndex":1,"beat":1,"voice":2} as any,
  {"id":"bb16f290-e2a8-43ea-89c0-9a372f374fc2","pitch":"E","octave":4,"position":2,"midi":63,"noteIndex":3,"clef":"bass","explicitAccidental":null,"duration":"half","isRest":false,"isTriplet":false,"isDuplet":false,"isDotted":false,"measureIndex":1,"beat":1,"voice":3} as any,
  {"id":"61d69fa7-622d-488c-ad71-7561706b53d5","pitch":"D","octave":3,"position":-6,"midi":50,"noteIndex":2,"clef":"bass","explicitAccidental":null,"duration":"half","isRest":false,"isTriplet":false,"isDuplet":false,"isDotted":false,"measureIndex":1,"beat":1,"voice":4} as any,
  {"id":"3c1d89a8-d6f3-4600-80a8-8906e80696e4","pitch":"C","octave":3,"position":-7,"midi":48,"noteIndex":0,"clef":"bass","explicitAccidental":null,"duration":"half","isRest":false,"isTriplet":false,"isDuplet":false,"isDotted":false,"measureIndex":1,"beat":3,"voice":4} as any,
];

const timeSignature: TimeSignature = { numerator: 4, denominator: 4 };
const tonic = 'C';
const isMinor = false;

const keySig = getKeySignature(tonic, 'Major') as any;

const res = applyHarmonyRules(notes as any, keySig, tonic, isMinor, [], timeSignature);

const suspConnections = (res.connections || []).filter((c: any) => typeof c.ruleId === 'string' && c.ruleId.startsWith('S-'));
const suspNotes = (res.analyzedNotes || []).filter((n: any) => n?.isSuspension);

console.log('S-connections:', suspConnections.map((c: any) => ({ ruleId: c.ruleId, from: c.fromNoteId, to: c.toNoteId })));
console.log('Susp notes:', suspNotes.map((n: any) => ({ id: n.id, voice: n.voice, pitch: n.pitch, octave: n.octave, isSuspension: n.isSuspension })));
