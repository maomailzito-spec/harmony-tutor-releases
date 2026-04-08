import json
with open('tests/Delamont C67 2a.htp') as f:
    d = json.load(f)
print('ks:', d.get('keySignature'))
print('ts:', d.get('timeSignature'))
notes = sorted(d['notes'], key=lambda n: (n.get('measureIndex',-1), n.get('beat',-1), n.get('voice',1)))
print('\n--- m0 ---')
for n in notes:
    if n.get('measureIndex',-1) == 0:
        print(f"  b={n['beat']} v={n.get('voice','?')} {n.get('pitch','?')}{n.get('octave','?')} midi={n.get('midi','?')} dur={n.get('duration','?')} rest={n.get('isRest',False)}")
print('\n--- m1 b<=2 ---')
for n in notes:
    if n.get('measureIndex',-1) == 1 and n.get('beat',-1) <= 2:
        print(f"  b={n['beat']} v={n.get('voice','?')} {n.get('pitch','?')}{n.get('octave','?')} midi={n.get('midi','?')} dur={n.get('duration','?')} rest={n.get('isRest',False)}")
