## Novità in v1.0.6

### 🎵 Analisi armonica — fix maggiori

- **ii° vs vii° per accordi diminuiti**: gli accordi diminuiti vengono ora etichettati correttamente in base al contesto. Un ii°7 in tonalità minore (es. Am7♭5 in Sol min) non viene più confuso con vii°7. Nuova regola di risoluzione: se l'accordo risolve al semitono superiore, è sempre vii°/X (dominante secondaria)
- **Override tonale manuale rispettato**: i modulation override inseriti manualmente non vengono più sovrascritti dal guard automatico "I/i in home key" — gli accordi come F in Bb major vengono ora etichettati V (non I)
- **Sigle accordali con spelling corretto**: C#7 genera ora C#–E#–G#–B (non C#–F–G#–B). La root dell'accordo mantiene la lettera originale attraverso tutta la pipeline
- **Cadential pattern ii°→V→I/i**: riconosciuto sia in tonalità minore (ii°7→V7→i) che maggiore con ii° prestato (ii°→V→I), inclusa la variante a 3 slot ii°→V→I in major

### 🔡 Enarmonia — refactoring fondamentale (Fase 2)

- Nuovo tipo `SpelledPitch` (lettera + alterazione) che preserva l'intenzione di scrittura attraverso l'intera pipeline di analisi
- `identifyChordCandidates` porta ora `rootSpelled` — la root dell'accordo usa la lettera originale della nota (C# rimane C#, non diventa Db)
- `calculateRomanNumeral` calcola il grado Romano tramite relazione diatonica (letter-steps) invece di aritmetica su pitch class
- `getChordSymbol` genera il simbolo partendo da `rootSpelled`, non da pc-lookup
- Calcolo ottava corretto per accidentali cross-letter (Cb5, E#3 ecc.)
- `ALL_NOTE_SPELLINGS` espanso con E#, Cb, Fb, B# per chord-spelling; nuovo `CROSS_LETTER_ENHARMONICS` per escluderli dal naming dell'editor
- Eliminato `src/data/constants.ts` (duplicato morto); unificate le 3 tabelle `NOTE_TO_PC`

### 🎹 Rilevamento modulazioni — miglioramenti

- **Note ornamentali rispettate**: le note marcate con ⌥O non vengono più usate nella cadential pattern detection — risolve i falsi positivi su pezzi con molte note di passaggio
- **Dedup eventi accordali**: eventi consecutivi con stesso accordo collassati prima del pattern matching — risolve i falsi negativi su pattern a 3 slot (ii°→V→i)
- **Preferenze analisi come prop React**: i toggle "Inferisci contesti" e "Riconoscimento pattern cadenzali" ora aggiornano le etichette in tempo reale

### 🖱️ UX

- **Selezione note vicine migliorata**: la banda Y del proximity-pick ridotta a 5px — note a distanza di seconda/terza vengono ora selezionate con maggiore precisione
- **⌥Alt+Click** su note sovrapposte cicla tra i candidati

### 🔧 Fix vari

- Sigle inserite da tastiera (C#, F# ecc.) ora mostrate sempre con # e non convertite in enarmonico bemolle
- Accordi half-diminished non più riscritti come vii°/X quando le note sono diatoniche
- Fix octave per note come Cb/E# nella voicizzazione corale e nel parser simboli
