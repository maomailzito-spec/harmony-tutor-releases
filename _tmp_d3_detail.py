import json

with open('tests/Delachi n2 p36:71.htp') as f:
    data = json.load(f)

notes = data.get('notes', [])
for n in notes:
    if n.get('voice') == 4 and n.get('midi') in [48, 49]:
        fields = {}
        for k in ['pitch','octave','accidental','explicitAccidental','midi','measureIndex','beat','duration','isTiedToNext','isTiedFromPrev','voice','id']:
            fields[k] = n.get(k, '<MISSING>')
        print(json.dumps(fields, indent=2))
        print('---')
