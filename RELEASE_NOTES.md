## Novità in v1.0.14

### 🐛 Fix attivazione licenza
- **Risolto bug silenzioso nell'inserimento chiave di licenza su Windows**: in alcuni casi la chiave inserita non veniva trasmessa correttamente al processo principale (race condition), causando un loop silenzioso senza feedback. L'attivazione ora è robusta su tutti i sistemi operativi.
- **Errore di attivazione ora mostrato in un dialog dedicato** con opzione "Riprova" o "Annulla", invece di essere nascosto nel testo del messaggio principale.

## Novità in v1.0.13

### 🐛 Fix licenza
- **Voce "Gestisci Licenza…" sempre visibile nel menu** (non solo alla scadenza del trial): su macOS nel menu "Harmony Tutor", su Windows/Linux nel menu "Visualizza". Permette di inserire o gestire la licenza in qualsiasi momento.

## Novità in v1.0.10

### 🐛 Fix analisi armonica
- **Cadenza ii°→V→i rilevata anche con dominanti decorati** (es. A°→D7♭9→D11→D7→Gm in Life on Mars): eventi consecutivi sulla stessa root e stessa famiglia di quality vengono ora collassati per il pattern matcher
- **R-06 (salto melodico aug/dim) non scatta più su unisoni enarmonici**: intervalli come Bb→Cb, Cb→Bb, B#→C, Fb→E (≤ 2 semitoni reali) non sono più segnalati come errori di risoluzione
- **MIDI corretto per note octave-boundary** (Cb5, B#3 ecc.): la formula di calcolo ora considera lettera + alterazione, eliminando errori di ottava su spelling cross-letter

### 🐛 Fix sigle accordali
- **Triadi aumentate ora siglate per spelling delle terze**, non per nota al basso. Es. [Db, F, A] con A al basso → `Caug/A` (non `Aaug`); [G#, C, E] → `Caug/G#` (non `G#aug`). L'analisi armonica funzionale (Roman) resta invariata e continua a riconoscere correttamente `V+` in minore
- **Override ornamentali manuali (⌥O) ora rispettati anche dalla sigla**: marcando una nota con ⌥O viene esclusa anche dal computo del simbolo accordale (prima solo l'analisi Roman lo faceva). Es. melodia Eb sopra Gb-Bb-D → con ⌥O sull'Eb la sigla diventa `GbAug` (non più `EbmMaj7/Gb`)

### 🐛 Fix UI
- **Menu Aiuto → Scorciatoie** ora apre una finestra autonoma chiudibile (era una sheet macOS bloccata che superava l'altezza dello schermo, nascondendo il bottone OK)

## Novità in v1.0.9

### 🎵 Analisi armonica
- Cadenza d'inganno (V → vi/VI/♭VI) ora rilevata e mostrata nel pannello con tratteggio verde
- Cadential 6/4: I⁶⁄₄ → V → I rietichettato come V⁶⁄₄ → V → I (lettura funzionale moderna)

### 🎼 Editor
- Rallentando/accelerando: nuova curva di tempo applicabile a un range di note (effetto playback)
- Corona (fermata) sulle note con espansione automatica nel playback
- Analysis Lock: blocca l'analisi armonica con password (uso didattico)

### 🐛 Fix
- TempoCurve ora persistito correttamente nel file .htp
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
