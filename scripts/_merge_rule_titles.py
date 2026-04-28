#!/usr/bin/env python3
"""One-off: merge rule titles (canonical + variants) into ruleTexts.json IT/EN."""
import json, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IT = os.path.join(ROOT, 'src/locales/it/ruleTexts.json')
EN = os.path.join(ROOT, 'src/locales/en/ruleTexts.json')

# IT canonical titles (per ruleId). Variants is { IT runtime text -> IT-display (= same) }.
TITLES_IT = {
  'R-01': {'title': 'Ottave parallele'},
  'R-02': {'title': 'Quinte parallele'},
  'R-02c': {'title': 'Quinte consecutive per moto contrario'},
  'R-03': {'title': "Arrivo all'unisono — le voci perdono indipendenza"},
  'R-04': {'title': 'Incrocio di voci', 'titleVariants': {
    'Incrocio di voci grave (Basso sopra Tenore)': 'Incrocio di voci grave (Basso sopra Tenore)',
    'Incrocio di voci grave (Alto sopra Soprano)': 'Incrocio di voci grave (Alto sopra Soprano)',
  }},
  'R-05': {'title': 'Quinte/ottave nascoste', 'titleVariants': {
    'Quinte nascoste (dirette) tra voci estreme': 'Quinte nascoste (dirette) tra voci estreme',
    'Ottave nascoste (dirette) tra voci estreme': 'Ottave nascoste (dirette) tra voci estreme',
    'Quinte nascoste (dirette) in cambio di posizione (stessa sonorità)': 'Quinte nascoste (dirette) in cambio di posizione (stessa sonorità)',
    'Ottave nascoste (dirette) in cambio di posizione (stessa sonorità)': 'Ottave nascoste (dirette) in cambio di posizione (stessa sonorità)',
    'Quinte nascoste (dirette) in progressione imitata (tollerate)': 'Quinte nascoste (dirette) in progressione imitata (tollerate)',
    'Ottave nascoste (dirette) in progressione imitata (tollerate)': 'Ottave nascoste (dirette) in progressione imitata (tollerate)',
    'Quinte nascoste S–A in progressione imitata': 'Quinte nascoste S–A in progressione imitata',
    'Ottave nascoste S–A in progressione imitata': 'Ottave nascoste S–A in progressione imitata',
    'Ottava nascosta S–A con Alto per grado ascendente (tollerata con riserva)': 'Ottava nascosta S–A con Alto per grado ascendente (tollerata con riserva)',
    'Ottava nascosta S–A con Alto per grado discendente (non ammessa)': 'Ottava nascosta S–A con Alto per grado discendente (non ammessa)',
    'Ottava nascosta S–A per salto in entrambe le voci (proibita)': 'Ottava nascosta S–A per salto in entrambe le voci (proibita)',
    'Quinta nascosta S–A per salto senza nota comune': 'Quinta nascosta S–A per salto senza nota comune',
  }},
  'R-06': {'title': 'Risoluzione errata salto aug/dim', 'titleVariants': {
    'Risoluzione errata di salto melodico aumentato': 'Risoluzione errata di salto melodico aumentato',
    'Risoluzione errata di salto melodico diminuito': 'Risoluzione errata di salto melodico diminuito',
  }},
  'R-07': {'title': 'Risoluzione errata della sensibile', 'titleVariants': {
    'Risoluzione errata della sensibile': 'Risoluzione errata della sensibile',
    'Risoluzione della sensibile (tollerata in sequenza/imitazione)': 'Risoluzione della sensibile (tollerata in sequenza/imitazione)',
  }},
  'R-08': {'title': 'Spaziatura eccessiva tra le voci', 'titleVariants': {
    'Spaziatura eccessiva tra Soprano e Alto (> 8va)': 'Spaziatura eccessiva tra Soprano e Alto (> 8va)',
    'Spaziatura eccessiva tra Alto e Tenore (> 8va)': 'Spaziatura eccessiva tra Alto e Tenore (> 8va)',
  }},
  'R-09': {'title': 'Falsa relazione cromatica'},
  'R-10': {'title': 'Raddoppio della sensibile', 'titleVariants': {
    'Raddoppio della sensibile': 'Raddoppio della sensibile',
    'Raddoppio della sensibile (tollerato in sequenza/imitazione)': 'Raddoppio della sensibile (tollerato in sequenza/imitazione)',
  }},
  'R-10-6': {'title': 'Raddoppio in accordo di 6', 'titleVariants': {
    'Preferenza di raddoppio in 6: basso su grado forte': 'Preferenza di raddoppio in 6: basso su grado forte',
    'Preferenza di raddoppio in 6: basso su grado forte (tollerato in sequenza/imitazione)': 'Preferenza di raddoppio in 6: basso su grado forte (tollerato in sequenza/imitazione)',
  }},
  'R-12': {'title': 'Risoluzione errata della settima dell’accordo'},
  'R-13': {'title': 'Moto parallelo di tutte le voci', 'titleVariants': {
    'Moto parallelo di tutte le voci': 'Moto parallelo di tutte le voci',
    'Moto parallelo di tutte le voci (attenuato: Soprano per grado congiunto)': 'Moto parallelo di tutte le voci (attenuato: Soprano per grado congiunto)',
    'Moto parallelo di tutte le voci (tollerato in sequenza/imitazione)': 'Moto parallelo di tutte le voci (tollerato in sequenza/imitazione)',
  }},
  'R-15': {'title': 'Salto melodico ampio nelle voci interne (> 6a)'},
  'R-16': {'title': 'Salto melodico problematico', 'titleVariants': {
    'Salto melodico di tritono (4ª eccedente / 5ª diminuita)': 'Salto melodico di tritono (4ª eccedente / 5ª diminuita)',
    'Semitono cromatico — da evitare nella scrittura diatonica': 'Semitono cromatico — da evitare nella scrittura diatonica',
    'Sincope armonica (accordo sul debole che “entra” sul battere successivo)': 'Sincope armonica (accordo sul debole che “entra” sul battere successivo)',
    'Ottava discendente — preferibilmente ascendente': 'Ottava discendente — preferibilmente ascendente',
    'Sesta minore discendente — preferibilmente ascendente': 'Sesta minore discendente — preferibilmente ascendente',
  }},
  'R-N-RES': {'title': 'Risoluzione atipica della Napolitana (N)'},
  'R-RANGE': {'title': 'Nota fuori dal registro tipico della voce'},
  'R-CAD64': {'title': '6/4 cadenziale non risolto su V'},
  'R-CHORD-COMPLETE': {'title': 'Accordo incompleto', 'titleVariants': {
    'Accordo incompleto (manca la 3ª)': 'Accordo incompleto (manca la 3ª)',
    'Accordo incompleto/ambiguo (manca la 3ª)': 'Accordo incompleto/ambiguo (manca la 3ª)',
    'Accordo di 7ª incompleto (manca la 7ª)': 'Accordo di 7ª incompleto (manca la 7ª)',
  }},
  'R-SPACING-TB': {'title': 'Spaziatura eccessiva tra Tenore e Basso (> 2 ottave + 5a)'},
  'EXC-7-DELAYED': {'title': 'Eccezione: risoluzione della 7a ritardata/ornamentale'},
  'EXC-7-FREE': {'title': 'Eccezione: la 7a non ha una risoluzione disponibile nella sonorità di arrivo'},
  'EXC-7-P4-TO7': {'title': 'Eccezione: salto di 4ª perfetta verso un’altra 7a minore'},
  'EXC-7-STATIC': {'title': 'Eccezione: permanenza della 7a (reinterpretata come nota consonante)'},
  'EXC-7-TRANSFER': {'title': 'Eccezione: la 7a è trasferita ad altra voce prima della risoluzione'},
  'EXC-7-TRANSFERRED-RES': {'title': 'Eccezione: risoluzione della 7a “presa in carico” da un’altra voce (transference)'},
  'EXC-7-UP': {'title': 'Eccezione: la 7a risolve per moto ascendente'},
  'EXC-7m01': {'title': 'Risoluzione della settima trasferita'},
  'EXC-Aug2-LT': {'title': 'Seconda eccedente con sensibile', 'titleVariants': {
    'Seconda eccedente (♭6 ↔ ♮7 nel modo minore) — proibita': 'Seconda eccedente (♭6 ↔ ♮7 nel modo minore) — proibita',
    'Seconda eccedente verso la sensibile che risolve alla tonica (tollerata)': 'Seconda eccedente verso la sensibile che risolve alla tonica (tollerata)',
  }},
  'EXC-Hidden-BassStep': {'title': 'Quinta/ottava diretta attenuata', 'titleVariants': {
    'Quinta diretta attenuata (Basso per grado; salto piccolo al Soprano)': 'Quinta diretta attenuata (Basso per grado; salto piccolo al Soprano)',
    'Ottava diretta attenuata (Basso per grado; salto piccolo al Soprano)': 'Ottava diretta attenuata (Basso per grado; salto piccolo al Soprano)',
  }},
  'EXC-Hidden-Stepwise': {'title': 'Quinta/ottava nascosta ammessa per grado congiunto', 'titleVariants': {
    'Quinta nascosta S–A con nota comune ai due accordi (ammessa)': 'Quinta nascosta S–A con nota comune ai due accordi (ammessa)',
    'Quinta nascosta S–A con Soprano per grado congiunto (ammessa — regola classica)': 'Quinta nascosta S–A con Soprano per grado congiunto (ammessa — regola classica)',
    'Ottava nascosta S–A con Soprano per grado congiunto (ammessa — regola classica)': 'Ottava nascosta S–A con Soprano per grado congiunto (ammessa — regola classica)',
  }},
  'EXC-LT-Chromatic-Line': {'title': 'Sensibile in linea cromatica (eccezione)'},
  'EXC-LT-Transfer': {'title': 'Risoluzione trasferita della sensibile'},
  'EXC-OBL-PERF': {'title': 'Quinta/ottava successiva con moto obliquo', 'titleVariants': {
    'Quinta successiva con moto obliquo (una voce ferma)': 'Quinta successiva con moto obliquo (una voce ferma)',
    'Ottava successiva con moto obliquo (una voce ferma)': 'Ottava successiva con moto obliquo (una voce ferma)',
  }},
  'EXC-S02': {'title': 'Incrocio Alto/Tenore (tollerato)'},
  'EXC-STYLE-5': {'title': 'Quinte di stile (orchestrali)'},
  'EXC-Unison-Cadence': {'title': 'Unisono S+A sulla tonica in cadenza (sensibile + 2° grado → tonica)'},
  'EXC-Unison-Lower': {'title': 'Unisono raggiunto per moto contrario/obliquo nelle voci basse (tollerato)'},
  'EXC-Unison-Step': {'title': 'Unisono raggiunto per moto contrario/obliquo con grado congiunto (tollerato)'},
}

# EN translations: same shape, with EN strings.
TITLES_EN = {
  'R-01': {'title': 'Parallel octaves'},
  'R-02': {'title': 'Parallel fifths'},
  'R-02c': {'title': 'Consecutive fifths in contrary motion'},
  'R-03': {'title': 'Arrival at unison — voices lose independence'},
  'R-04': {'title': 'Voice crossing', 'titleVariants': {
    'Incrocio di voci grave (Basso sopra Tenore)': 'Severe voice crossing (Bass above Tenor)',
    'Incrocio di voci grave (Alto sopra Soprano)': 'Severe voice crossing (Alto above Soprano)',
  }},
  'R-05': {'title': 'Hidden fifths/octaves', 'titleVariants': {
    'Quinte nascoste (dirette) tra voci estreme': 'Hidden (direct) fifths between outer voices',
    'Ottave nascoste (dirette) tra voci estreme': 'Hidden (direct) octaves between outer voices',
    'Quinte nascoste (dirette) in cambio di posizione (stessa sonorità)': 'Hidden (direct) fifths in voice exchange (same chord)',
    'Ottave nascoste (dirette) in cambio di posizione (stessa sonorità)': 'Hidden (direct) octaves in voice exchange (same chord)',
    'Quinte nascoste (dirette) in progressione imitata (tollerate)': 'Hidden (direct) fifths in imitative sequence (tolerated)',
    'Ottave nascoste (dirette) in progressione imitata (tollerate)': 'Hidden (direct) octaves in imitative sequence (tolerated)',
    'Quinte nascoste S–A in progressione imitata': 'Hidden fifths S–A in imitative sequence',
    'Ottave nascoste S–A in progressione imitata': 'Hidden octaves S–A in imitative sequence',
    'Ottava nascosta S–A con Alto per grado ascendente (tollerata con riserva)': 'Hidden octave S–A with Alto rising stepwise (tolerated with reservations)',
    'Ottava nascosta S–A con Alto per grado discendente (non ammessa)': 'Hidden octave S–A with Alto descending stepwise (not allowed)',
    'Ottava nascosta S–A per salto in entrambe le voci (proibita)': 'Hidden octave S–A by leap in both voices (forbidden)',
    'Quinta nascosta S–A per salto senza nota comune': 'Hidden fifth S–A by leap without a common tone',
  }},
  'R-06': {'title': 'Incorrect resolution of augmented/diminished leap', 'titleVariants': {
    'Risoluzione errata di salto melodico aumentato': 'Incorrect resolution of an augmented melodic leap',
    'Risoluzione errata di salto melodico diminuito': 'Incorrect resolution of a diminished melodic leap',
  }},
  'R-07': {'title': 'Incorrect leading-tone resolution', 'titleVariants': {
    'Risoluzione errata della sensibile': 'Incorrect leading-tone resolution',
    'Risoluzione della sensibile (tollerata in sequenza/imitazione)': 'Leading-tone resolution (tolerated in sequence/imitation)',
  }},
  'R-08': {'title': 'Excessive spacing between voices', 'titleVariants': {
    'Spaziatura eccessiva tra Soprano e Alto (> 8va)': 'Excessive spacing between Soprano and Alto (> 8ve)',
    'Spaziatura eccessiva tra Alto e Tenore (> 8va)': 'Excessive spacing between Alto and Tenor (> 8ve)',
  }},
  'R-09': {'title': 'Chromatic cross relation'},
  'R-10': {'title': 'Doubled leading tone', 'titleVariants': {
    'Raddoppio della sensibile': 'Doubled leading tone',
    'Raddoppio della sensibile (tollerato in sequenza/imitazione)': 'Doubled leading tone (tolerated in sequence/imitation)',
  }},
  'R-10-6': {'title': 'Doubling in a 6 chord', 'titleVariants': {
    'Preferenza di raddoppio in 6: basso su grado forte': 'Preferred doubling in 6: bass on a strong scale degree',
    'Preferenza di raddoppio in 6: basso su grado forte (tollerato in sequenza/imitazione)': 'Preferred doubling in 6: bass on a strong scale degree (tolerated in sequence/imitation)',
  }},
  'R-12': {'title': 'Incorrect resolution of the chordal seventh'},
  'R-13': {'title': 'Parallel motion in all voices', 'titleVariants': {
    'Moto parallelo di tutte le voci': 'Parallel motion in all voices',
    'Moto parallelo di tutte le voci (attenuato: Soprano per grado congiunto)': 'Parallel motion in all voices (attenuated: Soprano stepwise)',
    'Moto parallelo di tutte le voci (tollerato in sequenza/imitazione)': 'Parallel motion in all voices (tolerated in sequence/imitation)',
  }},
  'R-15': {'title': 'Wide melodic leap in inner voices (> 6th)'},
  'R-16': {'title': 'Problematic melodic leap', 'titleVariants': {
    'Salto melodico di tritono (4ª eccedente / 5ª diminuita)': 'Tritone melodic leap (augmented 4th / diminished 5th)',
    'Semitono cromatico — da evitare nella scrittura diatonica': 'Chromatic semitone — to be avoided in diatonic writing',
    'Sincope armonica (accordo sul debole che “entra” sul battere successivo)': 'Harmonic syncopation (chord on the weak beat that “carries over” into the next downbeat)',
    'Ottava discendente — preferibilmente ascendente': 'Descending octave — preferably ascending',
    'Sesta minore discendente — preferibilmente ascendente': 'Descending minor sixth — preferably ascending',
  }},
  'R-N-RES': {'title': 'Atypical resolution of the Neapolitan (N)'},
  'R-RANGE': {'title': 'Note outside the typical voice range'},
  'R-CAD64': {'title': 'Cadential 6/4 not resolved on V'},
  'R-CHORD-COMPLETE': {'title': 'Incomplete chord', 'titleVariants': {
    'Accordo incompleto (manca la 3ª)': 'Incomplete chord (third missing)',
    'Accordo incompleto/ambiguo (manca la 3ª)': 'Incomplete/ambiguous chord (third missing)',
    'Accordo di 7ª incompleto (manca la 7ª)': 'Incomplete seventh chord (seventh missing)',
  }},
  'R-SPACING-TB': {'title': 'Excessive spacing between Tenor and Bass (> 2 octaves + 5th)'},
  'EXC-7-DELAYED': {'title': 'Exception: delayed/ornamental seventh resolution'},
  'EXC-7-FREE': {'title': 'Exception: no resolution available for the seventh in the destination chord'},
  'EXC-7-P4-TO7': {'title': 'Exception: perfect-fourth leap to another minor seventh'},
  'EXC-7-STATIC': {'title': 'Exception: held seventh (reinterpreted as a consonance)'},
  'EXC-7-TRANSFER': {'title': 'Exception: the seventh is transferred to another voice before resolving'},
  'EXC-7-TRANSFERRED-RES': {'title': 'Exception: seventh resolution taken over by another voice (transference)'},
  'EXC-7-UP': {'title': 'Exception: the seventh resolves upward'},
  'EXC-7m01': {'title': 'Transferred seventh resolution'},
  'EXC-Aug2-LT': {'title': 'Augmented second with leading tone', 'titleVariants': {
    'Seconda eccedente (♭6 ↔ ♮7 nel modo minore) — proibita': 'Augmented second (♭6 ↔ ♮7 in minor mode) — forbidden',
    'Seconda eccedente verso la sensibile che risolve alla tonica (tollerata)': 'Augmented second toward the leading tone resolving to the tonic (tolerated)',
  }},
  'EXC-Hidden-BassStep': {'title': 'Attenuated direct fifth/octave', 'titleVariants': {
    'Quinta diretta attenuata (Basso per grado; salto piccolo al Soprano)': 'Attenuated direct fifth (Bass stepwise; small leap in the Soprano)',
    'Ottava diretta attenuata (Basso per grado; salto piccolo al Soprano)': 'Attenuated direct octave (Bass stepwise; small leap in the Soprano)',
  }},
  'EXC-Hidden-Stepwise': {'title': 'Hidden fifth/octave allowed by stepwise motion', 'titleVariants': {
    'Quinta nascosta S–A con nota comune ai due accordi (ammessa)': 'Hidden fifth S–A with common tone between the two chords (allowed)',
    'Quinta nascosta S–A con Soprano per grado congiunto (ammessa — regola classica)': 'Hidden fifth S–A with Soprano stepwise (allowed — classical rule)',
    'Ottava nascosta S–A con Soprano per grado congiunto (ammessa — regola classica)': 'Hidden octave S–A with Soprano stepwise (allowed — classical rule)',
  }},
  'EXC-LT-Chromatic-Line': {'title': 'Leading tone in a chromatic line (exception)'},
  'EXC-LT-Transfer': {'title': 'Transferred leading-tone resolution'},
  'EXC-OBL-PERF': {'title': 'Subsequent fifth/octave by oblique motion', 'titleVariants': {
    'Quinta successiva con moto obliquo (una voce ferma)': 'Subsequent fifth by oblique motion (one voice held)',
    'Ottava successiva con moto obliquo (una voce ferma)': 'Subsequent octave by oblique motion (one voice held)',
  }},
  'EXC-S02': {'title': 'Alto/Tenor voice crossing (tolerated)'},
  'EXC-STYLE-5': {'title': 'Stylistic (orchestral) fifths'},
  'EXC-Unison-Cadence': {'title': 'S+A unison on the tonic at cadence (leading tone + scale-degree 2 → tonic)'},
  'EXC-Unison-Lower': {'title': 'Unison reached by contrary/oblique motion in lower voices (tolerated)'},
  'EXC-Unison-Step': {'title': 'Unison reached by contrary/oblique stepwise motion (tolerated)'},
}

def merge(path, titles):
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    added = 0
    skipped = 0
    for rid, fields in titles.items():
        if rid not in data:
            print(f'WARN: ruleId {rid} not in {path}, skipping')
            skipped += 1
            continue
        # Insert title (and optional titleVariants) preserving body/suggestion
        for k, v in fields.items():
            data[rid][k] = v
        added += 1
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write('\n')
    print(f'Updated {path}: {added} rules patched, {skipped} skipped')

merge(IT, TITLES_IT)
merge(EN, TITLES_EN)
