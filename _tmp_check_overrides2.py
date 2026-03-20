import json
from collections import defaultdict

with open('tests/Delachi n2 p36:71.htp') as f:
    data = json.load(f)

notes = data.get('notes', [])
ts = data.get('timeSignature', {})
tsc = data.get('timeSignatureChanges', [])
num = ts.get('numerator', 4)
key_root = data.get('keySignatureRoot', '?')
is_minor = data.get('isMinorMode', False)

print(f'Key: {key_root}, minor: {is_minor}, TS: {num}/{ts.get("denominator",4)}')
print(f'TS changes: {tsc}')
print(f'Total notes: {len(notes)}')

# Find max measureIndex
max_mi = max(n.get('measureIndex', 0) for n in notes)
print(f'Max measureIndex: {max_mi}')
print()

# group by absBeat
by_ab = defaultdict(list)
for n in notes:
    ab = n.get('measureIndex', 0) * num + n.get('beat', 0)
    by_ab[ab].append(n)

all_abs = sorted(by_ab.keys())
print(f'All absBeat values: {all_abs}')
print()

targets = [12, 42, 72, 78]
for t in targets:
    if t not in by_ab:
        print(f'=== ab={t}: NO NOTES ===')
        print()
        continue
    idx = all_abs.index(t)
    ctx = []
    if idx >= 1:
        ctx.append(all_abs[idx - 1])
    ctx.append(t)
    if idx < len(all_abs) - 1:
        ctx.append(all_abs[idx + 1])

    mi = t // num
    b = t % num
    print(f'=== Override ab={t} (m{mi} b{b+1}) -> forced I ===')
    for ab in ctx:
        mi2 = ab // num
        b2 = ab % num
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
            ps.append(f"v{n.get('voice', 0)}:{p}{n.get('octave', '')}(m{midi},d={dur})")
        print(f'  ab={ab} (m{mi2} b{b2+1}): {", ".join(ps)}{mark}')
    print()
