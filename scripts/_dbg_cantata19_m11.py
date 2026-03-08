#!/usr/bin/env python3
"""Debug script: trace chords in Cantata 19 Bach to find Dm context source."""
import json, os

path = os.path.join(os.path.dirname(__file__), '..', 'tests', 'Cantata 19 bach.json')
with open(path) as f:
    d = json.load(f)

notes = d.get('notes', d.get('rawNotes', []))
print(f"File: Cantata 19 bach.json")
print(f"Tonic: {d.get('keySignatureRoot', d.get('keyTonic', '?'))}")
print(f"Minor: {d.get('isMinorMode', '?')}")
print(f"TS: {d.get('timeSignature', '?')}")
print(f"AnalysisContexts: {d.get('analysisContexts', [])}")
print(f"Total notes: {len(notes)}")
print()

NOTE_NAMES = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B']

def identify_chord(pcs_set):
    """Simple chord identification by pitch class set."""
    for root_pc in range(12):
        r = root_pc
        name = NOTE_NAMES[r]
        maj3 = (r + 4) % 12
        min3 = (r + 3) % 12
        p5 = (r + 7) % 12
        dim5 = (r + 6) % 12
        m7 = (r + 10) % 12
        
        if {r, maj3, p5}.issubset(pcs_set):
            if m7 in pcs_set:
                return f"{name}7"
            return f"{name}M"
        if {r, min3, p5}.issubset(pcs_set):
            if m7 in pcs_set:
                return f"{name}m7"
            return f"{name}m"
        if {r, min3, dim5}.issubset(pcs_set):
            return f"{name}dim"
    return f"?{sorted(pcs_set)}"

max_mi = max(n.get('measureIndex', 0) for n in notes)
print(f"Measures: {max_mi + 1}")
print()

# Show all measures
for mi in range(max_mi + 1):
    mn = [n for n in notes if n.get('measureIndex') == mi]
    if not mn:
        continue
    beats = sorted(set(n.get('beat') for n in mn))
    parts = []
    for b in beats:
        bnotes = [n for n in mn if n.get('beat') == b]
        pcs = set(nn.get('midi', 0) % 12 for nn in bnotes)
        chord = identify_chord(pcs)
        bass = min(nn.get('midi', 999) for nn in bnotes)
        bass_name = NOTE_NAMES[bass % 12]
        # Mark beats with A natural or C#
        flags = []
        if 9 in pcs:
            flags.append('A')
        if 1 in pcs:
            flags.append('C#')
        flag_str = f" [{','.join(flags)}]" if flags else ""
        parts.append(f"b{b}:{chord}/{bass_name}{flag_str}")
    
    marker = " <<<" if mi == 10 else ""  # m11 = measureIndex 10
    print(f"  m{mi+1}: {' | '.join(parts)}{marker}")

print()
print("=== Potential V/iii (A major = pcs 9,1,4) or V-vi in F (C->Dm) ===")
for mi in range(max_mi + 1):
    mn = [n for n in notes if n.get('measureIndex') == mi]
    if not mn:
        continue
    beats = sorted(set(n.get('beat') for n in mn))
    beat_chords = []
    for b in beats:
        bnotes = [n for n in mn if n.get('beat') == b]
        pcs = set(nn.get('midi', 0) % 12 for nn in bnotes)
        chord = identify_chord(pcs)
        beat_chords.append((b, chord, pcs))
    
    # Check consecutive beats for C->Dm pattern (V->vi in F = deceptive cadence)
    for i in range(len(beat_chords) - 1):
        b1, c1, pcs1 = beat_chords[i]
        b2, c2, pcs2 = beat_chords[i + 1]
        # C major/C7 followed by Dm
        if c1 in ('CM', 'C7') and c2 in ('Dm', 'Dm7'):
            print(f"  m{mi+1}: CONSECUTIVE C->Dm at b{b1}->b{b2} (V->vi in F, deceptive!)")
        # A major followed by Dm (V->I in Dm)
        if c1 in ('AM', 'A7') and c2 in ('Dm', 'Dm7'):
            print(f"  m{mi+1}: A->Dm at b{b1}->b{b2} (V->I in Dm!)")
