import json
from collections import defaultdict

with open('tests/Delachi n2 p36:71.htp') as f:
    data = json.load(f)

notes = data.get('notes', [])
ts = data.get('timeSignature', {})
num = ts.get('numerator', 3)
den = ts.get('denominator', 2)
bpm = num * (4 / den)  # quarter-note beats per measure

print(f'Key: {data.get("keySignatureRoot","?")}, minor: {data.get("isMinorMode",False)}, TS: {num}/{den}, bpm={bpm}')
print()

# Duration in quarter-note beats
dur_map = {
    'whole': 4, 'half': 2, 'quarter': 1, 'eighth': 0.5, '16th': 0.25,
    'dotted-whole': 6, 'dotted-half': 3, 'dotted-quarter': 1.5, 'dotted-eighth': 0.75,
}

def note_abs_beat(n):
    mi = n.get('measureIndex', 0)
    beat = n.get('beat', 1)
    return mi * bpm + (beat - 1)

def note_duration_beats(n):
    dur = n.get('duration', 'quarter')
    is_dotted = n.get('isDotted', False)
    base = dur_map.get(dur, 1)
    if is_dotted and not dur.startswith('dotted'):
        base *= 1.5
    return base

def pitch_label(n):
    p = n['pitch']
    acc = n.get('accidental', '')
    if acc == 'flat':
        p += 'b'
    elif acc == 'sharp':
        p += '#'
    elif acc == 'natural':
        p += 'n'
    return f"{p}{n.get('octave','')}"

targets = [12, 42, 72, 78]
overrides_info = {
    12: {'roman': 'I', 'figures': ['5', '2']},
    42: {'roman': 'I', 'figures': ['4', '7']},
    72: {'roman': 'I', 'figures': ['4', '7']},
    78: {'roman': 'I', 'figures': ['5', '2']},
}

for t in targets:
    ov = overrides_info[t]
    mi_t = int(t // bpm)
    b_t = int(t % bpm)

    print(f'=== Override ab={t} (m{mi_t} b{b_t+1}) -> {ov["roman"]} {ov["figures"]} ===')
    
    # Find ALL notes sounding at this beat (onset <= t < onset + duration)
    sounding = []
    onsets = []
    for n in notes:
        if n.get('isRest', False):
            continue
        ab = note_abs_beat(n)
        dur = note_duration_beats(n)
        if ab <= t < ab + dur:
            is_onset = (ab == t)
            sounding.append((n, ab, dur, is_onset))
            if is_onset:
                onsets.append(n)

    # Sort by voice
    sounding.sort(key=lambda x: x[0].get('voice', 0))
    
    print(f'  Sounding notes ({len(sounding)}):')
    for n, ab, dur, is_onset in sounding:
        v = n.get('voice', 0)
        lbl = pitch_label(n)
        midi = n.get('midi', '?')
        d = n.get('duration', '?')
        onset_mark = 'ONSET' if is_onset else f'sustained from ab={ab}'
        print(f'    v{v}: {lbl} midi={midi} dur={d} [{onset_mark}]')
    
    pcs = set()
    for n, _, _, _ in sounding:
        m = n.get('midi', 0)
        if m:
            pcs.add(m % 12)
    pc_names = {0:'C',1:'Db',2:'D',3:'Eb',4:'E',5:'F',6:'F#',7:'G',8:'Ab',9:'A',10:'Bb',11:'B'}
    pc_str = ', '.join(pc_names.get(p, '?') for p in sorted(pcs))
    print(f'  Pitch classes: {{{pc_str}}}')
    print()
