import json
from collections import defaultdict

with open('tests/Delachi n2 p36:71.htp') as f:
    data = json.load(f)

notes = data.get('notes', [])
ts = data.get('timeSignature', {})
num = ts.get('numerator', 4)
key_root = data.get('keySignatureRoot', '?')
is_minor = data.get('isMinorMode', False)

print(f'Key: {key_root}, minor: {is_minor}, TS: {num}/{ts.get("denominator",4)}')
print()

by_ab = defaultdict(list)
for n in notes:
    ab = n.get('measureIndex', 0) * num + n.get('beat', 0)
    by_ab[ab].append(n)

all_abs = sorted(by_ab.keys())
targets = [12, 42, 72, 78]

for t in targets:
    idx = all_abs.index(t) if t in all_abs else -1
    ctx = []
    if idx >= 1:
        ctx.append(all_abs[idx - 1])
    ctx.append(t)
    if 0 <= idx < len(all_abs) - 1:
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
            ps.append(f"v{n.get('voice', 0)}:{p}{n.get('octave', '')}(m{midi})")
        print(f'  ab={ab} (m{mi2} b{b2+1}): {", ".join(ps)}{mark}')
    print()
