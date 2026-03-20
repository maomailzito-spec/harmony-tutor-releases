import json
from collections import defaultdict

with open('tests/Delachi n2 p36:71.htp') as f:
    data = json.load(f)

notes = data.get('notes', [])
ts = data.get('timeSignature', {})
num = ts.get('numerator', 3)
den = ts.get('denominator', 2)
bpm = num * (4 / den)  # 6 quarter beats per measure

dur_map = {
    'whole': 4, 'half': 2, 'quarter': 1, 'eighth': 0.5, '16th': 0.25,
}

def note_abs_beat(n):
    mi = n.get('measureIndex', 0)
    beat = n.get('beat', 1)
    return mi * bpm + (beat - 1)

def note_dur_beats(n):
    d = n.get('duration', 'quarter')
    base = dur_map.get(d, 1)
    if n.get('isDotted', False):
        base *= 1.5
    return base

def pitch_label(n):
    p = n['pitch']
    acc = n.get('accidental', '')
    if acc == 'flat': p += 'b'
    elif acc == 'sharp': p += '#'
    elif acc == 'natural': p += 'n'
    return f"{p}{n.get('octave','')}"

# Target: m3 b1 = absBeat 12 (measure 2 in 0-based, but user says m3 = 1-based)
# m2 (0-based) * 6 + 0 = 12, or m3 (1-based, so index=2) * 6 = 12
target_ab = 12

# Show all notes in m1, m2, m3 (0-based) = user's m2, m3, m4
print(f'Key: {data.get("keySignatureRoot")}, TS: {num}/{den}, bpm={bpm}')
print()

for mi in range(0, 5):  # measures 0-4
    print(f'--- Measure {mi} (user m{mi+1}) ---')
    m_notes = [n for n in notes if n.get('measureIndex') == mi]
    m_notes.sort(key=lambda x: (x.get('beat',1), x.get('voice',0)))
    for n in m_notes:
        ab = note_abs_beat(n)
        dur = note_dur_beats(n)
        end = ab + dur
        tied = n.get('isTiedToNext', False)
        tied_from = n.get('isTiedFromPrev', False)
        v = n.get('voice', 0)
        print(f'  v{v}: {pitch_label(n):6s} midi={n.get("midi","?"):3} beat={n.get("beat")} ab={ab:5.1f} dur={n.get("duration"):8s}({dur:.1f}q) end={end:.1f} tiedTo={tied} tiedFrom={tied_from}')
    print()

# Specifically check v4 around absBeat 12
print('=== V4 (bass) timeline around ab=12 ===')
v4_notes = sorted([n for n in notes if n.get('voice') == 4], key=lambda x: note_abs_beat(x))
for n in v4_notes:
    ab = note_abs_beat(n)
    dur = note_dur_beats(n)
    end = ab + dur
    if 0 <= ab <= 24:
        print(f'  {pitch_label(n):6s} midi={n.get("midi","?"):3} ab={ab:5.1f} dur={n.get("duration"):8s}({dur:.1f}q) end={end:.1f} tied={n.get("isTiedToNext",False)}/{n.get("isTiedFromPrev",False)}')

print()
print('=== All voices sounding at ab=12 ===')
for n in notes:
    if n.get('isRest'): continue
    ab = note_abs_beat(n)
    dur = note_dur_beats(n)
    if ab <= target_ab < ab + dur:
        onset = 'ONSET' if ab == target_ab else f'held from ab={ab}'
        print(f'  v{n.get("voice")}: {pitch_label(n):6s} midi={n.get("midi","?")} [{onset}] dur={n.get("duration")}')

print()
print('=== All voices sounding at ab=14 (m3 b3, resolution?) ===')
for n in notes:
    if n.get('isRest'): continue
    ab = note_abs_beat(n)
    dur = note_dur_beats(n)
    if ab <= 14 < ab + dur:
        onset = 'ONSET' if ab == 14 else f'held from ab={ab}'
        print(f'  v{n.get("voice")}: {pitch_label(n):6s} midi={n.get("midi","?")} [{onset}] dur={n.get("duration")}')
