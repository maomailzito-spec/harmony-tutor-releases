# Session Memo — 27 febbraio 2026

## Stato Build & Regression
- **Build**: ✅ (2.25s)
- **Regression**: 37 OK / 1 FAIL (pre-existing: Dubois n3 p12 Bb→Gb modulation)
- **Log temporanei**: Nessuno
- **TICKS_PER_QUARTER**: 960

---

## BUG APERTO: Appoggiatura non include nota di risoluzione nella label

### Scenario di test
- **File**: Corale n4c bach:Schinelli.json (o qualsiasi nuovo file in C maggiore)
- **Misura 2, beat 2** (absBeat 5): note = C(48 basso), D(62), G(55), G(67)
- **Override utente**: appoggiatura sul C(48) — C ritarda il B (3a di V)
- **Atteso**: V (G-B-D)
- **Ottenuto**: I6 o iii (accordo sporco perché B manca dall'analisi)
- **Con override "ritardo" (suspension)**: funziona → V (perché isSuspension ha meccanismo incorporato)

### Root cause (analisi dettagliata)

Il **ritardo (suspension)** funziona perché:
1. `detectSuspensions()` lo rileva (richiede preparazione: nota uguale precede)
2. Setta `isSuspension = { fromAbsBeat, toAbsBeat, type, resolvedById }`
3. In `useHarmonyLabels.ts` L1215: al beat di onset, `lastStructural.delete(v)` rimuove la voce
4. Le altre voci hanno già le note del nuovo accordo → label corretta
5. **Override manuale "suspension"** bypassa l'obbligo di preparazione (L10995: `anyN.isSuspension = { type: 'susp', manual: true }`)

L'**appoggiatura** NON funziona perché:
1. Non ha preparazione → `detectSuspensions()` non la rileva
2. Override manuale setta solo `isAppoggiatura = true` (e ora anche `isSuspension = { type: 'app', manual: true }` da L10992)
3. **IL PROBLEMA REALE**: quando l'appoggiatura è nella voce del basso e viene rimossa, le note rimanenti (G, D, G) hanno solo 2 PC → accordo incompleto → ambiguo

### Pipeline delle note (il cuore del problema)

```
fullNotes at beat 5: [G(67), D(62), G(55), C(48)]    ← dal timeline, CORRETTE
    ↓ (via lastStructural Map + isNonChordToneAtLabelEvent filter)
    
Per ogni nota in fullNotes:
  - G(67) voice1: isNonChordToneAtLabelEvent → false → lastStructural.set(1, G67) ✓
  - D(62) voice2: isNonChordToneAtLabelEvent → TRUE (auto-detected!) → NON entra in lastStructural
                   → stale E(64) dal beat 4 resta nella voce 2! ← BUG PRINCIPALE
  - G(55) voice3: isNonChordToneAtLabelEvent → false → lastStructural.set(3, G55) ✓  
  - C(48) voice4: isNonChordToneAtLabelEvent → true (override appoggiatura)
                   → L1222: isAppoggiatura → cerca B(47) nel next event → lastStructural.set(4, B47) → continue
    
harmonicNotes = [G(67), E(64)←STALE!, G(55), B(47)]  ← E è sbagliato!
```

**Il D(62) viene auto-rilevato come nota ornamentale** da `isNonChordToneAtLabelEvent()` (L825) anche se è una nota reale dell'accordo V. L'engine di auto-detection (in `applyHarmonyRules` / `detectSuspensions`) marca D come anticipazione/passing/neighbor. Quando D non entra in `lastStructural`, resta il vecchio E(64) dal beat precedente.

### Tentativi fatti e risultato

| Tentativo | Descrizione | Risultato |
|-----------|-------------|-----------|
| `_hasManualOrnAtBeat` | Se c'è override manuale su una nota, bypassa auto-detection sulle altre | NON FUNZIONA — ornOverrideMap composite key mismatch |
| `nextBeatNotes` look-ahead in `getRomanAnalysis` | Aggiunge note dal beat successivo se < 3 PC | REVERTITO — troppo invasivo |
| `isSuspension.manual` filter | Filtra appoggiatura in getRomanAnalysis come suspension | REVERTITO — troppe linee cambiate senza successo |
| Appoggiatura resolution look-ahead (L1222) | Sostituisce voce appoggiatura con nota risoluzione dal next event | PRESENTE MA NON SUFFICIENTE — D(62) resta esclusa |
| `isSuspension = { type: 'app', manual: true }` su override appoggiatura (L10992) | Fa filtrare appoggiatura in filteredChord di getRomanAnalysis | PRESENTE MA NON RISOLVE perché il problema è D(62) esclusa |

### Il vero problema da risolvere

Il fix sull'appoggiatura (L1222 + L10992) funziona per la voce dell'appoggiatura stessa (C→B sostituzione). Ma il D(62) in un'ALTRA voce viene comunque auto-rilevato come ornamentale → non entra in `lastStructural` → stale E(64).

Serve capire **PERCHÉ** `isNonChordToneAtLabelEvent(D62, absBeat=5)` restituisce true. Possibili cause:
1. D(62) ha flag `isAnticipation` o `isAppoggiatura` settato da `applyHarmonyRules` nell'early/late pass
2. D(62) è rilevato come "neighbor" o "passing" dall'auto-detection

**PROSSIMO PASSO**: Mettere un console.log temporaneo per capire QUALE flag ha D(62):
```typescript
// In isNonChordToneAtLabelEvent (L825), dopo i check di ornOverrideMap:
if (n.midi === 62) console.log('[DBG-D62]', { 
    isPassing: n.isPassing, isNeighbor: n.isNeighbor, 
    isAnticipation: n.isAnticipation, isAppoggiatura: n.isAppoggiatura,
    isEscape: n.isEscape, isSuspension: n.isSuspension,
    ornamentOverride: n.ornamentOverride, voice: n.voice 
});
```

**OPPURE**: L'approccio `_hasManualOrnAtBeat` ERA corretto ma falliva per mismatch delle chiavi. Se si verifica che `ornOverrideMap` matcha correttamente per la nota C del timeline, la guardia "se c'è override manuale su altra nota → tratta D come strutturale" funzionerebbe.

---

## File modificati (TUTTI comprovati, build OK, regression 37/1)

### src/hooks/useHarmonyLabels.ts (8 modifiche)

1. **L~388**: `_globalRomanJ.includes('/')` — guardia per slash-roman nel detector cadenzale
2. **L612**: `const lastHadAppoggBySystem = new Map<number, number>()` — tracking appoggiatura per sistema
3. **L~1222-1237**: **APPOGGIATURA RESOLUTION LOOK-AHEAD** — quando `isAppoggiatura`, cerca nota di risoluzione (stessa voce, next timeline event) → `lastStructural.set(v, resolNote)` → `continue`
4. **L~1410**: `isAppoggResolSuppressible` — logica di soppressione risoluzione appoggiatura
5. **L~1515**: `hasHiddenChange = !!(fullSig && prevSig && fullSig !== prevSig && harmonicSig !== prevSig)` — rileva cambi armonici nascosti
6. **L~1525**: `hasManualOrnOverride = fullNotes.some(...)` — check semplice per override manuali
7. **L~1575**: `Number(event.absBeat)` — crash fix (white-screen su absBeat non numerico)
8. **L~2030**: `isSlashRoman` — guardia per identificazione slash-roman

### src/utils/musicTheory.ts (5 modifiche)

1. **L1081**: `flatSpelling || possibleNames[0]` — enharmonic per tonalità con bemolli
2. **L2146**: `formulaIntervals` Set in `getChordSymbol` (try-catch)
3. **L~5586**: `is64ChordTone` block (~40 righe) in `detectSuspensions` — previene false 6/4 suspension
4. **L10992**: `anyN.isSuspension = { type: 'app', manual: true }` su override appoggiatura
5. **L10995**: `anyN.isSuspension = { type: 'susp', manual: true }` su override suspension

### src/components/GrandStaffEditor.tsx (14 modifiche)

1. **L4677**: Right-click deselect (2 punti)
2. **L6329**: Cmd+0 zoom reset
3. **L6478**: T key toggle analisi
4. **L6705**: contextMenu deps
5. **L1284**: Enharmonic re-spelling
6. **L7312+**: Ornament label hiding (5 flag: isPassing, isNeighbor, isAppoggiatura, isAnticipation, isEscape)
7. **L7316**: measureStartAbsBeat computation
8. hideLabelAbsBeats semplificato
9. **~L5360**: existingAtSamePos + Shift multi-select toggle
10. **L4932**: Measure-boundary bail-out
11. **L4996**: Cross-check getTickRangeForEvent
12. **~L6625**: ROOT CAUSE durationTicks = `Math.max(1, Math.round(durBeats * TICKS_PER_QUARTER))`
13. **L7707-7708**: `(lbl as any).isOverride || !hideLabelAbsBeats.has(lblAbsQ)` — override sempre visibili
14. Varie props refactoring

### Altri file

- `docs/roadmap-professional.md`: Sezione 6 aggiornata
- `scripts/_check_repertoire.ts`: Aggiornato
- `scripts/extract-progression-stats.ts`: Aggiornato

---

## Key tecnici

- `TICKS_PER_QUARTER = 960`
- `qAbs(b) = Math.round(b * 960) / 960` — quantizzazione beat
- `ornOverrideMap` (L73-118): Map<string, string> con chiavi `noteId` + composite `${midi}-${measureIndex}-${beat}`
- `lastStructuralByVoiceBySystem`: Map<systemIndex, Map<voice, note>> — snapshot strutturale rolling per voce
- `isNonChordToneAtLabelEvent(n, absBeat)` (L825): restituisce true se la nota ha flag ornamentali
- Timeline: `timelineFiltered` array di eventi, ciascuno con `.notes`, `.absBeat`
- Voice numbering: 1=soprano, 2=alto, 3=tenore, 4=basso

## 13+ bug risolti nella sessione 24-27 Feb

Hidden-change suppression, appoggiatura resolution suppression, white-screen crash, enharmonic re-spelling, flat-key enharmonic, all-ornament label hiding, false suspension in 6/4, ghost note select boundary, shift multi-select overlap, cross-check getTickRangeForEvent, durationTicks ROOT CAUSE, override label hidden at ornament beats, slash-roman identification.

## 3 UX improvements

Right-click deselect, T toggle analysis, Cmd+0 zoom reset.
