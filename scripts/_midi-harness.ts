// Headless replica of importMidiAsAccompaniment's pipeline, for before/after
// validation of MIDI-import changes.
//
//   tsx scripts/_midi-harness.ts dump  <file.mid> <measure1based...>   human dump
//   tsx scripts/_midi-harness.ts snapshot                              write baselines
//   tsx scripts/_midi-harness.ts check                                 diff vs baselines
//
// Snapshots live in tests/_regression/midi/. The pipeline mirrors
// importMidiAsAccompaniment (src/hooks/useGrandStaffMidi.ts) step for step; keep
// the two in sync. Invariants protect against the classic failure mode (the
// merge heuristic that DROPPED notes 1686→1593 on bach_846): we capture the
// struck-note multiset BEFORE normalizeRhythm splits anything, so any voicing
// change that loses or invents a note shows up as an invariant violation.
import * as fs from 'fs';
import * as path from 'path';
import {
  convertParsedNoteToStaffNote, separateVoices, quantizeTripletBeats,
  extendNotesToNextOnset, quantizeMidiTimings, trimOverlappingNotes, normalizeRhythm,
} from '../src/hooks/useGrandStaffMidi';
import { parseMidi } from '../src/utils/midiParser';
import { getKeySignature } from '../src/utils/musicTheory';
import { TICKS_PER_QUARTER } from '../src/constants';

type N = any;

const CORPUS = [
  'tests/Import.mid',          // target: 3-layer broken-chord piano texture
  'tests/bach_846 (1).mid',    // hard pedaled case — must NOT drop notes
  'tests/cantata 41 Bach.mid', // chordal/SATB-ish — texture regression guard
];

const SNAP_DIR = 'tests/_regression/midi';
const SIX = TICKS_PER_QUARTER / 4; // 240 = a 16th

/** Run the ACC import pipeline. Returns the final notes plus the struck-note
 *  stream right after trim (before the normalizer splits into tied fragments),
 *  used as the "no notes dropped/invented" invariant. */
function importPipeline(file: string): { final: N[]; struck: N[]; ts: any } {
  const b = fs.readFileSync(file);
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  const parsed: any = parseMidi(ab);
  const tpq = Math.max(1, parsed.tpq);
  const beatsPerMeasure = parsed.timeSignature.numerator * (4 / parsed.timeSignature.denominator);
  const keySig = getKeySignature('C', 'Major');

  const trackPitch = new Map<number, { sum: number; n: number }>();
  for (const n of parsed.notes) { const e = trackPitch.get(n.track) ?? { sum: 0, n: 0 }; e.sum += n.midi; e.n++; trackPitch.set(n.track, e); }
  const multi = trackPitch.size >= 2;
  const clefForTrack = (t: number): any => { if (!multi) return undefined; const e = trackPitch.get(t); return (e && e.n > 0 && e.sum / e.n < 60) ? 'bass' : 'treble'; };

  const conv = parsed.notes.map((n: any, i: number) => {
    const sounding = n.durationTicks;
    const notated = n.notatedTicks ?? sounding;
    const dePedaled = notated < sounding ? { ...n, durationTicks: notated } : n;
    const sn: any = convertParsedNoteToStaffNote(dePedaled, i, tpq, beatsPerMeasure, keySig, 0, clefForTrack(n.track));
    if (notated < sounding) sn.playbackDurationTicks = Math.max(1, Math.round((sounding / Math.max(1, tpq)) * TICKS_PER_QUARTER));
    return sn;
  });
  const voiced = [
    ...separateVoices(conv.filter((n: N) => (n.clef ?? 'treble') === 'treble'), 2),
    ...separateVoices(conv.filter((n: N) => n.clef === 'bass'), 2),
  ];
  const trip = quantizeTripletBeats(voiced);
  const tpm = TICKS_PER_QUARTER * parsed.timeSignature.numerator * (4 / parsed.timeSignature.denominator);
  const ext = extendNotesToNextOnset(trip, tpm);
  const q = quantizeMidiTimings(ext);
  const struck = trimOverlappingNotes(q);
  const final = normalizeRhythm(struck.map((n: N) => ({ ...n })), parsed.timeSignature, [], true);
  return { final, struck, ts: parsed.timeSignature };
}

function durCode(n: N): string {
  const map: Record<string, string> = { whole: 'w', half: 'h', quarter: 'q', eighth: '8', sixteenth: '16', 'thirty-second': '32', 'sixty-fourth': '64' };
  let s = map[n.duration] ?? `?${n.durationTicks}`;
  if (n.isDotted) s += '.';
  if (n.isTriplet) s += '3';
  if (n.isTiedToNext) s += '~';
  return s;
}

function streamKey(n: N): string {
  const c = n.clef === 'bass' ? 'bass' : 'tre ';
  return `${c} v${n.voice ?? 0}`;
}

/** Human-readable per-measure rendering, grouped by (clef, voice). */
function renderMeasures(notes: N[], measures: number[]): string {
  const out: string[] = [];
  for (const M of measures) {
    const inM = notes.filter(n => n.measureIndex === M);
    const byStream = new Map<string, N[]>();
    for (const n of inM) { const k = streamKey(n); (byStream.get(k) ?? byStream.set(k, []).get(k)!).push(n); }
    out.push(`--- m${M + 1} (idx ${M}) ---`);
    for (const k of [...byStream.keys()].sort()) {
      const seq = byStream.get(k)!.sort((a, b) => (a.startTick ?? 0) - (b.startTick ?? 0));
      const toks = seq.map(n => `${n.isRest ? 'R' : (n.pitch + (n.octave ?? ''))}/${durCode(n)}`);
      out.push(`  ${k}: ${toks.join(' ')}`);
    }
  }
  return out.join('\n');
}

/** Multiset of struck (clef,midi,startTick) — stable under voicing changes,
 *  so a drop/duplicate of a real note is caught regardless of how voices move. */
function struckSignature(struck: N[]): { count: number; sig: string } {
  const keys = struck.filter(n => !n.isRest)
    .map(n => `${n.clef === 'bass' ? 'b' : 't'}:${n.midi}:${n.startTick}`)
    .sort();
  return { count: keys.length, sig: keys.join('|') };
}

function invariants(r: { final: N[]; struck: N[] }): Record<string, number> {
  const { count } = struckSignature(r.struck);
  const nonRest = r.final.filter(n => !n.isRest);
  const rests = r.final.filter(n => n.isRest);
  const sub16note = nonRest.filter(n => !n.isTriplet && !n.isDuplet && (n.durationTicks ?? 0) < SIX).length;
  const sub16rest = rests.filter(n => (n.durationTicks ?? 0) < SIX).length;
  return {
    struckNotes: count,
    finalNonRest: nonRest.length,
    finalRests: rests.length,
    sub16Notes: sub16note,
    sub16Rests: sub16rest,
  };
}

function snapPath(file: string): string {
  const base = path.basename(file).replace(/\.[^.]+$/, '');
  return path.join(SNAP_DIR, `${base}.snap.txt`);
}

function buildSnapshot(file: string): string {
  const r = importPipeline(file);
  const maxM = r.final.reduce((m, n) => Math.max(m, n.measureIndex ?? 0), 0);
  const allMeasures = Array.from({ length: maxM + 1 }, (_, i) => i);
  const inv = invariants(r);
  const sig = struckSignature(r.struck).sig;
  const header = [
    `# ${file}`,
    `# invariants: ${JSON.stringify(inv)}`,
    `# struckSig: ${sig.length > 0 ? sig.length : 0} chars`,
    '',
  ].join('\n');
  return header + renderMeasures(r.final, allMeasures) + `\n# STRUCK-SIGNATURE\n${sig}\n`;
}

const mode = process.argv[2];

if (mode === 'dump') {
  const file = process.argv[3];
  const measures = process.argv.slice(4).map(x => Number(x) - 1);
  const r = importPipeline(file);
  console.log(`${file} — invariants: ${JSON.stringify(invariants(r))}`);
  console.log(renderMeasures(r.final, measures.length ? measures : [0]));
} else if (mode === 'snapshot') {
  fs.mkdirSync(SNAP_DIR, { recursive: true });
  for (const file of CORPUS) {
    if (!fs.existsSync(file)) { console.log(`SKIP (missing): ${file}`); continue; }
    const snap = buildSnapshot(file);
    fs.writeFileSync(snapPath(file), snap);
    const r = importPipeline(file);
    console.log(`wrote ${snapPath(file)}  ${JSON.stringify(invariants(r))}`);
  }
} else if (mode === 'check') {
  let fail = 0;
  for (const file of CORPUS) {
    if (!fs.existsSync(file)) { console.log(`SKIP (missing): ${file}`); continue; }
    const p = snapPath(file);
    if (!fs.existsSync(p)) { console.log(`NO BASELINE: ${p} (run snapshot first)`); fail++; continue; }
    const want = fs.readFileSync(p, 'utf8');
    const got = buildSnapshot(file);
    if (want === got) { console.log(`OK   ${file}`); continue; }
    // Summarise: invariant deltas + measures that changed.
    const wInv = JSON.parse(want.split('\n').find(l => l.startsWith('# invariants:'))!.replace('# invariants:', '').trim());
    const gInv = JSON.parse(got.split('\n').find(l => l.startsWith('# invariants:'))!.replace('# invariants:', '').trim());
    const wSig = want.split('# STRUCK-SIGNATURE\n')[1]?.trim() ?? '';
    const gSig = got.split('# STRUCK-SIGNATURE\n')[1]?.trim() ?? '';
    const dropped = wSig !== gSig;
    console.log(`DIFF ${file}${dropped ? '  *** STRUCK NOTES CHANGED (possible drop/invent) ***' : ''}`);
    for (const k of Object.keys(wInv)) if (wInv[k] !== gInv[k]) console.log(`   ${k}: ${wInv[k]} -> ${gInv[k]}`);
    // Per-measure body diff.
    const wBody = want.split('# STRUCK-SIGNATURE')[0].split('\n').filter(l => l.startsWith('---') || l.startsWith('  '));
    const gBody = got.split('# STRUCK-SIGNATURE')[0].split('\n').filter(l => l.startsWith('---') || l.startsWith('  '));
    let curM = '';
    const changed = new Set<string>();
    const wMap = new Map<string, string>(); let m = '';
    for (const l of wBody) { if (l.startsWith('---')) m = l; else wMap.set(`${m}@@${l.split(':')[0]}`, l); }
    m = '';
    for (const l of gBody) {
      if (l.startsWith('---')) { m = l; continue; }
      const key = `${m}@@${l.split(':')[0]}`;
      if (wMap.get(key) !== l) changed.add(m);
    }
    for (const cm of changed) console.log(`   changed: ${cm.replace('--- ', '').replace(' ---', '')}`);
    fail++;
  }
  process.exit(fail ? 1 : 0);
} else {
  console.log('usage: dump <file> <measures...> | snapshot | check');
}
