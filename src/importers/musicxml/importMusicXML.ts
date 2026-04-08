import { TICKS_PER_QUARTER } from '../../constants';
import type { AccidentalType, ClefType, NoteDuration, StaffNote, TimeSignature, TimeSignatureChange } from '../../types';

export type MusicXMLImportResult = {
  notes: StaffNote[];
  timeSignature: TimeSignature;
  timeSignatureChanges: TimeSignatureChange[];
  keySignatureRoot: string;
  isMinorMode: boolean;
  staffSystemMode: 'grandstaff' | 'treble_only' | 'satb_ancient';
  projectTitle?: string;
};

const NOTE_PC_BY_LETTER: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

const NOTE_POSITION_BY_LETTER: Record<string, number> = {
  C: 0,
  D: 1,
  E: 2,
  F: 3,
  G: 4,
  A: 5,
  B: 6,
};

function textOf(el: Element | null | undefined): string {
  if (!el) return '';
  return String(el.textContent ?? '').trim();
}

function intOf(el: Element | null | undefined): number | null {
  const s = textOf(el);
  const v = Number.parseInt(s, 10);
  return Number.isFinite(v) ? v : null;
}

function getFirstNonEmpty(...vals: Array<string | undefined | null>): string {
  for (const v of vals) {
    const s = String(v ?? '').trim();
    if (s) return s;
  }
  return '';
}

function accidentalFromAlter(alter: number): AccidentalType | null {
  if (!Number.isFinite(alter) || alter === 0) return null;
  if (alter === 1) return 'sharp';
  if (alter === -1) return 'flat';
  if (alter === 2) return 'double-sharp';
  if (alter === -2) return 'double-flat';
  return null;
}

function noteDurationFromType(type: string): NoteDuration | null {
  switch (String(type || '').trim()) {
    case 'whole':
      return 'whole';
    case 'half':
      return 'half';
    case 'quarter':
      return 'quarter';
    case 'eighth':
      return 'eighth';
    case '16th':
      return 'sixteenth';
    case '32nd':
      return 'thirty-second';
    case '64th':
      return 'sixty-fourth';
    default:
      return null;
  }
}

function clefFromMusicXML(sign: string, line: number | null): ClefType {
  const s = String(sign || '').trim().toUpperCase();
  if (s === 'F') return 'bass';
  if (s === 'G') return 'treble';
  if (s === 'C') {
    // Common C clef placements.
    if (line === 1) return 'soprano';
    if (line === 3) return 'alto';
    if (line === 4) return 'tenor';
    return 'alto';
  }
  return 'treble';
}

function keyRootFromFifths(fifths: number, mode: 'major' | 'minor'): { root: string; isMinor: boolean } {
  // Represent roots in the app's sharp-name domain; getKeySignature() can still emit flat signatures.
  const majorByFifths: Record<number, string> = {
    [-7]: 'B',
    [-6]: 'F#',
    [-5]: 'C#',
    [-4]: 'G#',
    [-3]: 'D#',
    [-2]: 'A#',
    [-1]: 'F',
    0: 'C',
    1: 'G',
    2: 'D',
    3: 'A',
    4: 'E',
    5: 'B',
    6: 'F#',
    7: 'C#',
  };
  const minorByFifths: Record<number, string> = {
    [-7]: 'G#',
    [-6]: 'D#',
    [-5]: 'A#',
    [-4]: 'F',
    [-3]: 'C',
    [-2]: 'G',
    [-1]: 'D',
    0: 'A',
    1: 'E',
    2: 'B',
    3: 'F#',
    4: 'C#',
    5: 'G#',
    6: 'D#',
    7: 'A#',
  };

  const safeFifths = Number.isFinite(fifths) ? Math.max(-7, Math.min(7, Math.trunc(fifths))) : 0;
  if (mode === 'minor') {
    // The app stores keySignatureRoot as the RELATIVE MAJOR root.
    // For minor mode, fifths=0 → C major signature → A minor, so root='C'.
    return { root: majorByFifths[safeFifths] || 'C', isMinor: true };
  }
  return { root: majorByFifths[safeFifths] || 'C', isMinor: false };
}

function createIdFactory(prefix: string) {
  let i = 0;
  return () => {
    i++;
    const r = (globalThis as any)?.crypto?.randomUUID?.();
    if (typeof r === 'string' && r) return `${prefix}-${r}`;
    return `${prefix}-${Date.now()}-${i}`;
  };
}

function parseXmlOrThrow(xml: string): Document {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    const msg = getFirstNonEmpty(textOf(parseError), 'MusicXML non valido (parsererror).');
    throw new Error(msg);
  }
  return doc;
}

export function importMusicXML(xml: string): MusicXMLImportResult {
  const doc = parseXmlOrThrow(xml);

  const root = doc.querySelector('score-partwise') || doc.documentElement;
  if (!root) throw new Error('MusicXML non valido: root mancante.');

  const title = getFirstNonEmpty(
    textOf(doc.querySelector('work > work-title')),
    textOf(doc.querySelector('movement-title')),
    textOf(doc.querySelector('credit credit-words')),
  );

  const parts = Array.from(doc.querySelectorAll('part'));
  if (parts.length === 0) throw new Error('MusicXML non valido: nessun <part>.');

  const makeId = createIdFactory('mx');

  // Global score-level defaults
  let timeSignature: TimeSignature = { numerator: 4, denominator: 4 };
  const timeSignatureChanges: TimeSignatureChange[] = [];

  let keySignatureRoot = 'C';
  let isMinorMode = false;

  // Use the first encountered key signature as the project key.
  let didSetKey = false;
  let didSetTime = false;

  const notes: StaffNote[] = [];

  // Heuristic: if any note declares staff=2, assume grandstaff.
  let sawSecondStaff = false;

  // Parse up to 4 parts (handles SATB as separate parts).
  const partsToParse = parts.slice(0, 4);

  // Detect multi-part SATB: 3+ parts typically means S/A/T/B as individual parts
  const isSeparateSATB = partsToParse.length >= 3;

  for (let partIndex = 0; partIndex < partsToParse.length; partIndex++) {
    const part = partsToParse[partIndex];
    const measures = Array.from(part.querySelectorAll(':scope > measure'));

    // Score cursor at measure granularity (ticks). We derive it from timeSignature changes.
    // Inside each measure we position notes by their MusicXML position in divisions.
    // `divisions` persists across measures per MusicXML spec — only updated when <attributes> declares a new value.
    let divisions = 1;
    for (let measureIndex = 0; measureIndex < measures.length; measureIndex++) {
      const measure = measures[measureIndex];

      // attributes
      const attrs = measure.querySelector(':scope > attributes');
      // divisions persists from previous measure (MusicXML spec); only update when declared.
      if (attrs) {
        const div = intOf(attrs.querySelector('divisions'));
        if (div != null && div > 0) divisions = div;

        const timeEl = attrs.querySelector('time');
        if (timeEl) {
          const beats = intOf(timeEl.querySelector('beats'));
          const beatType = intOf(timeEl.querySelector('beat-type'));
          if (beats != null && beatType != null && beats > 0 && beatType > 0) {
            const nextTs = { numerator: beats, denominator: beatType };
            if (!didSetTime) {
              timeSignature = nextTs;
              didSetTime = true;
            } else {
              // Only record if changed vs last known
              const last = (timeSignatureChanges.length > 0)
                ? timeSignatureChanges[timeSignatureChanges.length - 1]
                : null;
              const lastEffective = last
                ? { numerator: last.numerator, denominator: last.denominator }
                : timeSignature;
              if (lastEffective.numerator !== nextTs.numerator || lastEffective.denominator !== nextTs.denominator) {
                timeSignatureChanges.push({ measureIndex, numerator: nextTs.numerator, denominator: nextTs.denominator });
              }
            }
          }
        }

        const keyEl = attrs.querySelector('key');
        if (keyEl) {
          const fifths = intOf(keyEl.querySelector('fifths')) ?? 0;
          const modeRaw = textOf(keyEl.querySelector('mode')).toLowerCase();
          const mode = (modeRaw === 'minor') ? 'minor' : 'major';
          if (!didSetKey) {
            const k = keyRootFromFifths(fifths, mode);
            keySignatureRoot = k.root;
            isMinorMode = k.isMinor;
            didSetKey = true;
          }
        }
      }

      // Determine the effective time signature for this measure (needed for beat numbering only).
      const effectiveTs = (() => {
        let cur: TimeSignature = timeSignature;
        for (const c of timeSignatureChanges) {
          if ((c.measureIndex ?? 0) <= measureIndex) cur = { numerator: c.numerator, denominator: c.denominator };
          else break;
        }
        return cur;
      })();
      const beatsPerMeasure = effectiveTs.numerator * (4 / effectiveTs.denominator);

      // Clef per staff (fallback per part)
      const clefByStaff = new Map<number, ClefType>();
      try {
        const clefs = Array.from(measure.querySelectorAll(':scope > attributes > clef'));
        for (const c of clefs) {
          const staffNum = Number.parseInt(c.getAttribute('number') || '1', 10);
          const sign = textOf(c.querySelector('sign'));
          const line = intOf(c.querySelector('line'));
          clefByStaff.set(Number.isFinite(staffNum) ? staffNum : 1, clefFromMusicXML(sign, line));
        }
      } catch {
        // ignore
      }

      const measureStartAbsBeat = (() => {
        // Compute via accumulated beats from 0 to measureIndex, honoring timeSignatureChanges.
        let acc = 0;
        for (let m = 0; m < measureIndex; m++) {
          let ts: TimeSignature = timeSignature;
          for (const c of timeSignatureChanges) {
            if ((c.measureIndex ?? 0) <= m) ts = { numerator: c.numerator, denominator: c.denominator };
            else break;
          }
          acc += ts.numerator * (4 / ts.denominator);
        }
        return acc;
      })();
      const measureStartTick = Math.round(measureStartAbsBeat * TICKS_PER_QUARTER);

      // Iterate measure children in order to support <backup>/<forward>.
      let curPosDiv = 0;
      let lastChordStartDiv: number | null = null;

      const children = Array.from(measure.children);
      for (const child of children) {
        const tag = child.tagName;
        if (tag === 'backup') {
          const dur = intOf(child.querySelector('duration'));
          if (dur != null) curPosDiv = Math.max(0, curPosDiv - dur);
          lastChordStartDiv = null;
          continue;
        }
        if (tag === 'forward') {
          const dur = intOf(child.querySelector('duration'));
          if (dur != null) curPosDiv += dur;
          lastChordStartDiv = null;
          continue;
        }
        if (tag !== 'note') continue;

        const noteEl = child;
        const isGrace = !!noteEl.querySelector('grace');
        if (isGrace) {
          // MVP: ignore grace notes (no stable spacing/playback contract).
          continue;
        }

        const isChord = !!noteEl.querySelector('chord');
        const startDiv = isChord && lastChordStartDiv != null ? lastChordStartDiv : curPosDiv;
        if (!isChord) lastChordStartDiv = startDiv;

        const durDiv = intOf(noteEl.querySelector('duration')) ?? 0;

        const voiceRaw = intOf(noteEl.querySelector('voice')) ?? 1;
        const staffRaw = intOf(noteEl.querySelector('staff')) ?? 1;
        const staff = (Number.isFinite(staffRaw) && staffRaw > 0) ? staffRaw : 1;
        if (staff >= 2) sawSecondStaff = true;

        const clef: ClefType = clefByStaff.get(staff) || (
          isSeparateSATB
            ? (partIndex >= 2 ? 'bass' : 'treble')
            : (staff === 2 ? 'bass' : (partIndex === 1 ? 'bass' : 'treble'))
        );

        const voice: 1 | 2 | 3 | 4 = (() => {
          if (isSeparateSATB) {
            // Each part → one voice: part 0=S(1), part 1=A(2), part 2=T(3), part 3=B(4)
            return Math.min(4, partIndex + 1) as 1 | 2 | 3 | 4;
          }
          // 1–2 parts: use staff+voice mapping (staff 1 → voices 1/2; staff 2 → voices 3/4)
          const v = Math.max(1, Math.min(4, Math.trunc(voiceRaw)));
          // If this is the second part and staff is still 1, offset to bass voices
          if (partIndex === 1 && staff === 1) return (v === 1 ? 3 : 4) as 1 | 2 | 3 | 4;
          if (staff === 2) return (v === 1 ? 3 : (v === 2 ? 4 : (v as any)));
          return (v as any);
        })();

        const isRest = !!noteEl.querySelector('rest');

        const pitchEl = noteEl.querySelector('pitch');
        const step = textOf(pitchEl?.querySelector('step'));
        const alter = intOf(pitchEl?.querySelector('alter')) ?? 0;
        const octave = intOf(pitchEl?.querySelector('octave')) ?? 4;

        const letter = String(step || '').trim().toUpperCase();
        const basePc = NOTE_PC_BY_LETTER[letter];
        const basePos = NOTE_POSITION_BY_LETTER[letter];

        const midi = (!isRest && basePc != null)
          ? ((octave + 1) * 12 + basePc + alter)
          : 60;
        const noteIndex = ((midi % 12) + 12) % 12;
        const position = (!isRest && basePos != null)
          ? (basePos + (octave - 4) * 7)
          : 0;

        const typeRaw = textOf(noteEl.querySelector('type'));
        const duration = noteDurationFromType(typeRaw) || 'quarter';
        const dots = noteEl.querySelectorAll('dot').length;

        const tm = noteEl.querySelector('time-modification');
        const actualNotes = intOf(tm?.querySelector('actual-notes'));
        const normalNotes = intOf(tm?.querySelector('normal-notes'));
        const isTriplet = actualNotes === 3 && normalNotes === 2;
        const isDuplet = actualNotes === 2 && normalNotes === 3;

        const tieEls = Array.from(noteEl.querySelectorAll('tie'));
        const tieStarts = tieEls.some(t => String(t.getAttribute('type') || '').toLowerCase() === 'start');
        const tieStops = tieEls.some(t => String(t.getAttribute('type') || '').toLowerCase() === 'stop');

        const startBeats = (divisions > 0) ? (startDiv / divisions) : 0;
        const durationBeats = (divisions > 0) ? (durDiv / divisions) : 0;
        const startTick = measureStartTick + Math.round(startBeats * TICKS_PER_QUARTER);
        const durationTicks = Math.max(1, Math.round(durationBeats * TICKS_PER_QUARTER));

        const accidental = accidentalFromAlter(alter);

        const chordId = `mx-chord-${partIndex}-${measureIndex}-${startDiv}-${staff}-${voice}`;

        // Beat is measured in quarter-note units from the measure start.
        const beatInMeasure = Math.max(1, startBeats + 1);

        const staffNote: StaffNote = {
          id: makeId(),
          pitch: isRest ? 'C' : (letter || 'C'),
          octave,
          accidental: accidental ?? undefined,
          explicitAccidental: accidental ?? undefined,
          userAccidental: accidental ?? undefined,
          position,
          midi,
          noteIndex,
          duration,
          isRest,
          isDotted: dots > 0,
          isTriplet,
          isDuplet,
          isTiedToNext: tieStarts || undefined,
          isTiedFromPrev: tieStops || undefined,
          chordId,
          measureIndex,
          beat: beatInMeasure,
          startTick,
          durationTicks,
          clef,
          voice,
        };

        notes.push(staffNote);

        if (!isChord) {
          curPosDiv += durDiv;
          // Stay within measure bounds if the file is slightly inconsistent.
          if (Number.isFinite(beatsPerMeasure) && beatsPerMeasure > 0) {
            const maxDiv = Math.round(beatsPerMeasure * divisions);
            if (maxDiv > 0) curPosDiv = Math.min(curPosDiv, maxDiv);
          }
        }
      }
    }
  }

  const staffSystemMode: MusicXMLImportResult['staffSystemMode'] = (isSeparateSATB || partsToParse.length >= 2 || sawSecondStaff)
    ? 'grandstaff'
    : 'treble_only';

  // Final normalization: stable sort by startTick/voice/midi.
  notes.sort((a, b) => {
    const stA = Number((a as any).startTick ?? 0);
    const stB = Number((b as any).startTick ?? 0);
    if (stA !== stB) return stA - stB;
    if ((a.voice ?? 1) !== (b.voice ?? 1)) return (a.voice ?? 1) - (b.voice ?? 1);
    return (a.midi ?? 0) - (b.midi ?? 0);
  });

  return {
    notes,
    timeSignature,
    timeSignatureChanges,
    keySignatureRoot,
    isMinorMode,
    staffSystemMode,
    projectTitle: title || undefined,
  };
}
