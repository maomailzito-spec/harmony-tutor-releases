import { applyHarmonyRules, getKeySignature, getRomanAnalysis } from '../src/utils/musicTheory';
import type { StaffNote, TimeSignature } from '../src/types';

// C – D7 – G (C major), with C held into D7 then resolving to B on G.
const notes: StaffNote[] = [
  {"id":"c1","pitch":"C","octave":5,"position":7,"midi":72,"noteIndex":0,"clef":"treble","duration":"whole","isRest":false,"isTriplet":false,"isDuplet":false,"isDotted":false,"measureIndex":0,"beat":1,"voice":1} as any,
  {"id":"e1","pitch":"E","octave":4,"position":2,"midi":64,"noteIndex":4,"clef":"treble","duration":"half","isRest":false,"isTriplet":false,"isDuplet":false,"isDotted":false,"measureIndex":0,"beat":1,"voice":2} as any,
  {"id":"g1","pitch":"G","octave":3,"position":-3,"midi":55,"noteIndex":7,"clef":"bass","duration":"half","isRest":false,"isTriplet":false,"isDuplet":false,"isDotted":false,"measureIndex":0,"beat":1,"voice":3} as any,
  {"id":"cB1","pitch":"C","octave":3,"position":-7,"midi":48,"noteIndex":0,"clef":"bass","duration":"half","isRest":false,"isTriplet":false,"isDuplet":false,"isDotted":false,"measureIndex":0,"beat":1,"voice":4} as any,

  // D7 at beat 3, soprano holds C from previous chord (no new attack here)
  {"id":"d2","pitch":"D","octave":4,"position":1,"midi":62,"noteIndex":2,"clef":"treble","duration":"half","isRest":false,"isTriplet":false,"isDuplet":false,"isDotted":false,"measureIndex":0,"beat":3,"voice":2} as any,
  {"id":"fs2","pitch":"F","octave":3,"position":-4,"midi":54,"noteIndex":6,"clef":"bass","explicitAccidental":"sharp","accidental":"sharp","userAccidental":"sharp","duration":"half","isRest":false,"isTriplet":false,"isDuplet":false,"isDotted":false,"measureIndex":0,"beat":3,"voice":3} as any,
  {"id":"dB2","pitch":"D","octave":3,"position":-6,"midi":50,"noteIndex":2,"clef":"bass","duration":"half","isRest":false,"isTriplet":false,"isDuplet":false,"isDotted":false,"measureIndex":0,"beat":3,"voice":4} as any,

  // G at next measure, soprano resolves to B
  {"id":"b3","pitch":"B","octave":4,"position":6,"midi":71,"noteIndex":11,"clef":"treble","duration":"half","isRest":false,"isTriplet":false,"isDuplet":false,"isDotted":false,"measureIndex":1,"beat":1,"voice":1} as any,
  {"id":"d3","pitch":"D","octave":4,"position":1,"midi":62,"noteIndex":2,"clef":"treble","duration":"half","isRest":false,"isTriplet":false,"isDuplet":false,"isDotted":false,"measureIndex":1,"beat":1,"voice":2} as any,
  {"id":"g3","pitch":"G","octave":3,"position":-3,"midi":55,"noteIndex":7,"clef":"bass","duration":"half","isRest":false,"isTriplet":false,"isDuplet":false,"isDotted":false,"measureIndex":1,"beat":1,"voice":3} as any,
  {"id":"gB3","pitch":"G","octave":2,"position":-10,"midi":43,"noteIndex":7,"clef":"bass","duration":"half","isRest":false,"isTriplet":false,"isDuplet":false,"isDotted":false,"measureIndex":1,"beat":1,"voice":4} as any,
];

const timeSignature: TimeSignature = { numerator: 4, denominator: 4 };
const tonic = 'C';
const isMinor = false;

const keySig = getKeySignature(tonic, 'Major') as any;
const res = applyHarmonyRules(notes as any, keySig, tonic, isMinor, [], timeSignature);

const suspNotes = (res.analyzedNotes || []).filter((n: any) => n?.isSuspension);
const sConnections = (res.connections || []).filter((c: any) => String(c?.ruleId || '').startsWith('S-'));

console.log('Susp notes:', suspNotes.map((n: any) => ({ id: n.id, voice: n.voice, pitch: n.pitch, oct: n.octave, susp: n.isSuspension })));
console.log('S-connections:', sConnections.map((c: any) => ({ ruleId: c.ruleId, a: c.noteId1, b: c.noteId2 })));

// Roman checks on the three vertical snapshots
const chordC = notes.filter(n => n.measureIndex === 0 && n.beat === 1);
const chordD7 = notes.filter(n => (n.measureIndex === 0 && (n.beat === 3 || (n.voice === 1 && n.beat === 1))));
const chordG = notes.filter(n => n.measureIndex === 1 && n.beat === 1);

console.log('Roman C:', getRomanAnalysis(chordC as any, tonic, isMinor));
console.log('Roman D7:', getRomanAnalysis(chordD7 as any, tonic, isMinor));
console.log('Roman G:', getRomanAnalysis(chordG as any, tonic, isMinor));
