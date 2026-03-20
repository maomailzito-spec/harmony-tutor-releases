import json
from collections import defaultdict

with open('tests/Delachi n2 p36:71.htp') as f:
    data = json.load(f)

notes = data.get('notes', [])
ts = data.get('timeSignature', {})
num = ts.get('numerator', 3)
den = ts.get('denominator', 2)
bpm_measure = num * (4 // den) if den <= 4 else num * 4 / den
key_root = data.get('keySignatureRoot', '?')
is_minor = data.get('isMinorMode', False)

print(f'Key: {key_root}, minor: {is_minor}, TS: {num}/{den}')
print(f'beatsPerMeasure (quarter notes): {bpm_measure}')
print(f'Total notes: {len(notes)}')
print()

by_ab = defaultdict(list)
for n in notes:
    mi = n.get('measureIndex', 0)
    beat = n.get('beat', 0)  # 1-based, quarter-note units
    ab = mi * bpm_measure + (beat - 1)
    by_ab[ab].append(n)

all_abs = sorted(by_ab.keys())
print(f'absBeat range: {all_abs[0]} .. {all_abs[-1]}')
print(f'All absBeat values ({len(all_abs)}): {all_abs}')
print()

targets = [12, 42, 72, 78]
overrides_info = {
    12: {'roman': 'I', 'figures': ['5', '2']},
    42: {'roman': 'I', 'figures': ['4', '7']},
    72: {'roman': 'I', 'figures': ['4', '7']},
    78: {'roman': 'I', 'figures': ['5', '2']},
}

for t in targets:
    ov = overrides_info[t]
    mi_t = t // int(bpm_measure)
    b_t = t % int(bpm_measure)

    if t not in by_ab:
        print(f'=== Override ab={t} (m{mi_t} b{b_t+1}) -> {ov["roman"]} {ov["figures"]} : NO NOTES ===')
        # check nearby
        close = [ab for ab in all_abs if abs(ab - t) <= 2]
        if close:
            print(f'  Nearby beats: {close}')
        print()
        continue

    idx = all_abs.index(t)
    ctx = []
    if idx >= 1:
        ctx.append(all_abs[idx - 1])
    ctx.append(t)
    if idx < len(all_abs) - 1:
        ctx.append(all_abs[idx + 1])

    print(f'=== Override ab={t} (m{mi_t} b{b_t+1}) -> {ov["roman"]} {ov["figures"]} ===')
    for ab in ctx:
        mi2 = ab // int(bpm_measure)
        b2 = ab % int(bpm_measure)
        mark = ' <<< OVERRIDE' if ab == t else ''
        ps = []
        for n in sorted(by_ab[ab], key=lambda x: x.get('voice', 0)):
            p = n['pitch']
            acc = n.get('accidental', '')
            if acc == 'flat':
                p += 'b'
            elif acc == 'sharp':
                p += '#'
            elif acc == 'natural':
                p += 'n'
            midi = n.get('midi', '?')
            dur = n.get('duration', '?')
            ps.append(f"v{n.get('voice', 0)}:{p}{n.get('octave', '')}(m{midi})")
        print(f'  ab={ab} (m{mi2} b{b2+1}): {", ".join(ps)}{mark}')
    print()
