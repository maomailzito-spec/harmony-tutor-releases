import { computeLookaheadTonicizationOverrides } from './src/utils/harmonyLabelPipeline';
import { getRomanAnalysis, identifyChordCandidates } from './src/utils/musicTheory';

const noteNameToChromaticIndex = (name: string) => {
  const m: Record<string,number> = {C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11};
  return m[name] ?? -1;
};
const pcSet = (notes: any[]) => { const s = new Set<number>(); for (const n of notes||[]) if(n&&!n.isRest&&n.midi!=null) s.add(((n.midi%12)+12)%12); return s; };

const timeline = [
  { absBeat: 32, notes: [{pitch:'B',accidental:'sharp',octave:4,midi:72,isRest:false},{pitch:'G',accidental:'sharp',octave:4,midi:68,isRest:false},{pitch:'D',accidental:'sharp',octave:4,midi:63,isRest:false},{pitch:'G',accidental:'sharp',octave:2,midi:44,isRest:false}] },
  { absBeat: 33, notes: [{pitch:'C',accidental:'sharp',octave:5,midi:73,isRest:false},{pitch:'G',accidental:'sharp',octave:4,midi:68,isRest:false},{pitch:'E',accidental:'sharp',octave:4,midi:65,isRest:false},{pitch:'C',accidental:'sharp',octave:3,midi:49,isRest:false}] },
];

// Direct analysis first
const r32 = getRomanAnalysis(timeline[0].notes as any, 'A', false);
const r33 = getRomanAnalysis(timeline[1].notes as any, 'A', false);
console.log('Direct: ab=32 →', r32?.roman, '  ab=33 →', r33?.roman);

const r = computeLookaheadTonicizationOverrides({
  timelineForLabels: timeline as any,
  beatsPerMeasure: 3,
  currentTonic: 'A',
  isMinorMode: false,
  ctxAtAbsBeat: () => null,
  noteNameToChromaticIndex,
  getRomanAnalysis: (n: any[], t: string, m: boolean) => getRomanAnalysis(n, t, m),
  identifyChordCandidates: (n: any[]) => identifyChordCandidates(n as any) || [],
  pcSetFromNotes: pcSet,
  overrideByAbsBeat: new Map(),
});
console.log('autoOverrides:');
for (const [k,v] of r.autoOverrideByAbsBeat) console.log('  ab='+k, JSON.stringify(v));
console.log('autoDisplay:');
for (const [k,v] of r.autoRomanDisplayByAbsBeat) console.log('  ab='+k, v);
console.log('protected:', [...r.protectedAbsBeats]);
