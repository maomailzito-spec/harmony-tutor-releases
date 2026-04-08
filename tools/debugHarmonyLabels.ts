import { getActiveNotesTimeline, getRomanAnalysis, getChordSymbol, getKeySignature } from '../src/utils/musicTheory';
import type { StaffNote, TimeSignature } from '../src/types';

const notes: StaffNote[] = [
  {"id":"c1d63bb6-b523-45fc-9b17-ff6fad4e79f7","pitch":"C","octave":5,"position":7,"midi":72,"noteIndex":0,"clef":"treble","explicitAccidental":null,"duration":"half","isRest":false,"isTriplet":false,"isDuplet":false,"isDotted":false,"measureIndex":0,"beat":1,"voice":1} as any,
  {"id":"b052e6a4-e560-4728-ae19-26d2614613e7","pitch":"E","octave":4,"position":2,"midi":64,"noteIndex":4,"clef":"treble","explicitAccidental":null,"duration":"half","isRest":false,"isTriplet":false,"isDuplet":false,"isDotted":false,"measureIndex":0,"beat":1,"voice":2} as any,
  {"id":"bed34504-66d9-4bda-a18a-bd9d94b6a13a","pitch":"G","octave":3,"position":-3,"midi":55,"noteIndex":7,"clef":"bass","explicitAccidental":null,"duration":"half","isRest":false,"isTriplet":false,"isDuplet":false,"isDotted":false,"measureIndex":0,"beat":1,"voice":3} as any,
  {"id":"6930b566-64dd-451c-b190-aff6cc89c375","pitch":"C","octave":3,"position":-7,"midi":48,"noteIndex":0,"clef":"bass","explicitAccidental":null,"duration":"half","isRest":false,"isTriplet":false,"isDuplet":false,"isDotted":false,"measureIndex":0,"beat":1,"voice":4} as any,

  {"id":"a315ac26-978d-4cf5-b142-48e0142a1e58","pitch":"C","octave":5,"position":7,"midi":72,"noteIndex":0,"clef":"treble","explicitAccidental":null,"duration":"half","isRest":false,"isTriplet":false,"isDuplet":false,"isDotted":false,"measureIndex":0,"beat":3,"voice":1} as any,
  {"id":"108e88d7-b3d7-43eb-b228-8ca0a816a23a","pitch":"D","octave":4,"position":1,"midi":62,"noteIndex":2,"clef":"treble","explicitAccidental":null,"duration":"half","isRest":false,"isTriplet":false,"isDuplet":false,"isDotted":false,"measureIndex":0,"beat":3,"voice":2} as any,
  {"id":"df893e3f-edae-4446-b6da-df8d629c37d9","pitch":"F","octave":3,"position":-4,"midi":54,"noteIndex":6,"clef":"bass","explicitAccidental":"sharp","accidental":"sharp","userAccidental":"sharp","duration":"half","isRest":false,"isTriplet":false,"isDuplet":false,"isDotted":false,"measureIndex":0,"beat":3,"voice":3} as any,
  {"id":"14f68e59-e8c0-44fe-88e0-979e593162be","pitch":"D","octave":3,"position":-6,"midi":50,"noteIndex":2,"clef":"bass","explicitAccidental":null,"duration":"half","isRest":false,"isTriplet":false,"isDuplet":false,"isDotted":false,"measureIndex":0,"beat":3,"voice":4} as any,

  {"id":"09826219-2a1a-40d4-af0e-64a1a8b5e1b2","pitch":"B","octave":4,"position":6,"midi":71,"noteIndex":11,"clef":"treble","explicitAccidental":null,"duration":"half","isRest":false,"isTriplet":false,"isDuplet":false,"isDotted":false,"measureIndex":1,"beat":1,"voice":1} as any,
  {"id":"2c587b52-46b5-45ae-9bdf-3a45dd41c1d3","pitch":"D","octave":4,"position":1,"midi":62,"noteIndex":2,"clef":"treble","explicitAccidental":null,"duration":"half","isRest":false,"isTriplet":false,"isDuplet":false,"isDotted":false,"measureIndex":1,"beat":1,"voice":2} as any,
  {"id":"0e30dc80-f118-4d61-80e1-ed5fa174bfe1","pitch":"G","octave":3,"position":-3,"midi":55,"noteIndex":7,"clef":"bass","explicitAccidental":null,"duration":"half","isRest":false,"isTriplet":false,"isDuplet":false,"isDotted":false,"measureIndex":1,"beat":1,"voice":3} as any,
  {"id":"a57e7989-c3a1-4285-80d1-c895ce84af22","pitch":"G","octave":2,"position":-10,"midi":43,"noteIndex":7,"clef":"bass","explicitAccidental":null,"duration":"half","isRest":false,"isTriplet":false,"isDuplet":false,"isDotted":false,"measureIndex":1,"beat":1,"voice":4} as any,
];

const timeSignature: TimeSignature = { numerator: 4, denominator: 4 };
const tonic = 'C';
const isMinor = false;

const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
const startAbsBeat = (n: any) => ((n.measureIndex ?? 0) * beatsPerMeasure) + ((n.beat ?? 1) - 1);

const signatureFromNotes = (ns: any[]) => {
  const pcs = [...new Set((ns || []).filter(Boolean).filter((n: any) => !n.isRest).map((n: any) => n.noteIndex))].sort((a, b) => a - b);
  return pcs.join('-');
};

const pickByVoiceMostRecent = (active: any[]) => {
  const byVoice = new Map<number, any>();
  for (const n of active) {
    if (!n || n.isRest) continue;
    const v = (n.voice ?? 1) as number;
    const prev = byVoice.get(v);
    if (!prev) {
      byVoice.set(v, n);
      continue;
    }
    if (startAbsBeat(n) > startAbsBeat(prev)) byVoice.set(v, n);
  }
  return Array.from(byVoice.values());
};

const attackedAt = (active: any[], absBeat: number) => {
  return (active || []).filter((n: any) => !n?.isRest && Math.abs(startAbsBeat(n) - absBeat) < 1e-6);
};

const labelFor = (harmonicNotes: StaffNote[]) => {
  const r = getRomanAnalysis(harmonicNotes as any, tonic, isMinor);
  const keySig = getKeySignature(tonic, 'Major');
  const s = getChordSymbol(harmonicNotes as any, keySig as any, tonic);
  return { roman: r?.roman ?? '', figures: r?.figures ?? [], symbol: s ?? '' };
};

const timeline = getActiveNotesTimeline(notes as any, timeSignature);

console.log('Events:', timeline.map(e => ({ absBeat: e.absBeat, m: e.measureIndex, beat: e.beat, pcs: signatureFromNotes(e.notes) })));

const lastStructuralByVoice = new Map<number, any>();

for (const ev of timeline) {
  const active = ev.notes || [];
  const collapsed = pickByVoiceMostRecent(active);

  // baseline (like editor structural, but no ornament filtering needed here)
  for (const n of collapsed) {
    const v = (n.voice ?? 1) as number;
    lastStructuralByVoice.set(v, n);
  }
  const structural = Array.from(lastStructuralByVoice.values());

  const attacked = attackedAt(collapsed, ev.absBeat);
  const attackedPcCount = new Set(attacked.map(n => n.noteIndex)).size;

  const labelStructural = labelFor(structural as any);
  const labelAttacked = attackedPcCount >= 3 ? labelFor(attacked as any) : labelStructural;

  console.log(`\nabsBeat=${ev.absBeat} (m${ev.measureIndex} b${ev.beat})`);
  console.log(' collapsed pcs=', signatureFromNotes(collapsed));
  console.log(' structural pcs=', signatureFromNotes(structural));
  console.log(' attacked pcs  =', signatureFromNotes(attacked), 'count', attackedPcCount);
  console.log(' label(struct) =', labelStructural);
  console.log(' label(attk)   =', labelAttacked);
}
