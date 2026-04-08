# REST vs NOTE Collision Avoidance — Promemoria per Parti Strette

## Data: 13 febbraio 2026

## Cosa è stato fatto (Parti Late — COMPLETATO ✅)

In `src/components/VexflowGrandStaff.tsx`, intorno a riga ~1258, è stato implementato un sistema di collision avoidance tra pause e note delle voci adiacenti in modalità **grandstaff parti late**.

### Architettura del sistema

Il codice è **dentro** la funzione `drawNotesAtX(staffNotes, stave, clef)` (riga ~773), che viene chiamata separatamente per treble e bass staff. Le variabili `treble` e `bass` (Stave objects) sono accessibili dall'outer scope (closure).

### Componenti chiave implementati

1. **`isPartiLate`** = `staffMode === 'grandstaff' && !isClosePositionTreble`
   - Gate per attivare la logica solo in parti late

2. **`getAdjacentVoices(voice, clef)`** → `number[]`
   - Treble: voice 1 → [2], voice 2 → [1, 3] (cross-staff!)
   - Bass: voice 3 → [4, 2] (cross-staff!), voice 4 → [3]

3. **`getNoteYOnStave(sn)`** → pixel Y | null
   - Crea un probe VexFlow `StaveNote` per la nota
   - **Cross-staff aware**: usa `bass`/`treble` stave dall'outer scope in base a `sn.clef`
   - Restituisce `.getYs()[0]` (pixel Y reale sulla canvas)

4. **`getRestYAtLine(line, duration)`** → pixel Y | null
   - Crea un probe VexFlow `StaveNote` rest con `setKeyLine(0, line)`
   - Usa lo stave corrente (`stave` dal parametro di `drawNotesAtX`)
   - Restituisce `.getYs()[0]`

5. **`restLineUpStep`** → +1 o -1
   - Determinato empiricamente: confronta `getRestYAtLine(5)` vs `getRestYAtLine(6)`
   - Se Y(6) < Y(5) → +1 muove su, altrimenti -1 muove su
   - **CRITICO**: VexFlow `setKeyLine` ha convenzione OPPOSTA a `getYForLine`! Non assumere mai la direzione.

6. **`REST_BASS_CLEARANCE_PX = 20`** — margine in pixel

7. **Baseline delle pause** (`defaultRestLineForVoice`):
   - Treble: voice 1 → line 3, voice 2 → line -1
   - Bass: voice 3 → line 5, voice 4 → line 1

### Logica di collisione (nel loop `for (const r of rests)`)

```
if (isPartiLate) {
  adjVoices = getAdjacentVoices(voice, clef)
  overlapping = allNotes filtered by adjVoices + time overlap
  closestNoteY = nota più vicina alla pausa (per distanza pixel)
  
  // Direzione basata sulla POSIZIONE REALE, non sul numero di voce!
  if (restY <= noteY)  → push UP   (step = +restLineUpStep)
  if (restY > noteY)   → push DOWN (step = -restLineUpStep)
  
  while (gap < clearance) { line += step }
}
```

### Bug risolti durante lo sviluppo (da non ripetere!)

1. **`stave.getYForLine()` vs `setKeyLine()` hanno convenzioni OPPOSTE** per il mapping line→Y.
   - NON usare `getYForLine` per determinare la direzione di spostamento delle pause.
   - Usare SEMPRE `getRestYAtLine()` (probe empirico via `setKeyLine` + `getYs`).

2. **`moveRestUp` deve essere empirico**, non basato su `lineUpDecreasesY`.
   - Confrontare Y reali di line+1 e line-1 per decidere quale direzione è "su".

3. **Cross-staff: usare lo stave corretto!**
   - Se la nota è `clef:'bass'` ma stiamo nel loop treble, usare `bass` (Stave dall'outer scope).
   - Altrimenti `getNoteYOnStave` restituisce Y errata → collisione invertita.

4. **Direzione basata su posizione, NON su voice number.**
   - `isUpperVoice(2)` → false, ma l'alto (v2) è SOPRA il tenore (v3)!
   - Usare `restY <= noteY` per decidere la direzione, non il numero di voce.

5. **Guard nel while loop**: se la nota è già passata dall'altra parte della pausa, il loop poteva girare 40+ volte mandando la pausa fuori schermo. Il check `closestBassY > restY` (o equiv.) previene questo.

---

## Cosa fare per PARTI STRETTE (TODO)

### Differenze rispetto a parti late

In parti strette (`isClosePositionTreble === true`):
- Voci 1, 2, 3 sono tutte sul pentagramma **treble**
- Voice 4 è sul pentagramma **bass**
- Le pause hanno già un aggiustamento via `raisePx` (riga ~1355):
  ```
  voice === 1 ? 13 : (voice === 2 ? 25 : (voice === 3 ? 20 : 0))
  ```

### Piano di implementazione

1. **Aggiungere un gate `isPartiStrette`**:
   ```ts
   const isPartiStrette = staffMode === 'grandstaff' && isClosePositionTreble && clef === 'treble';
   ```

2. **Definire `getAdjacentVoices` per parti strette**:
   - Voice 1 (soprano) → [2] (evita alto)
   - Voice 2 (alto) → [1, 3] (evita soprano e tenore)
   - Voice 3 (tenore) → [2, 4] (evita alto e basso cross-staff)
   - In parti strette v1/v2/v3 sono tutte su treble, quindi non serve cross-staff tra queste.

3. **Riutilizzare** `getNoteYOnStave`, `getRestYAtLine`, `restLineUpStep` — funzionano già.

4. **Aggiungere il blocco `if (isPartiStrette)` DOPO il blocco `isClosePositionTreble` raisePx**, nella stessa posizione dove ora c'è `if (isPartiLate)`. La logica è identica:
   - Filtra note overlap dalle voci adiacenti
   - Trova nota più vicina
   - Determina direzione dalla posizione reale
   - Spingi la pausa finché c'è abbastanza margine

5. **Attenzione**: il `raisePx` esistente modifica già `line` prima del collision check. Il collision check deve partire dalla line GIÀ modificata dal raisePx.

6. **Testare**: creare una situazione con v1/v2/v3 su treble + v4 su bass, e verificare che le pause si spostano correttamente.

### Variabili chiave da conoscere

- `stave` = lo Stave corrente della closure `drawNotesAtX`
- `clef` = 'treble' o 'bass' della closure
- `staffNotes` = note filtrate per questo staff
- `allNotes` = TUTTE le note (entrambi gli staff), nell'outer scope
- `treble`, `bass` = Stave objects nell'outer scope (per cross-staff Y)
- `byTimeKeyAll` = Map di onset (tick-space) → note per note/pausa nello stesso momento
- `restLineOverrideById` = Map<string, number> che `makeVfNote` usa per `setKeyLine`

### Dove trovare il codice

- `drawNotesAtX`: riga ~773
- Collision avoidance block: riga ~1258
- `defaultRestLineForVoice`: riga ~155
- `makeVfNote` (usa `restLineOverride`): riga ~167
- Chiamate a `drawNotesAtX`: riga ~2581 (treble) e ~2582 (bass)
