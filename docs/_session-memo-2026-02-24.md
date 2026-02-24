# Session Memo — 24 febbraio 2026

## Obiettivi della sessione

1. Fix sovrapposizione note (VexflowGrandStaff.tsx)
2. Fix label V/V mancante a mis. 8 beat 4 in "Corale 1D Bach.json" (C major, 4/4)
3. Fix compact tonicization — dovrebbe essere solo estetico, non strutturale
4. Fix label annidate assurde (V/ii/IV, V/IV/V, vii°/vi/IV)
5. Fix label tempo debole che nascondono quelle tempo forte
6. StyleProfile Phase 1-3 — sistema di apprendimento dallo stile dell'utente

---

## Modifiche applicate

### 1. `src/components/VexflowGrandStaff.tsx` — Fix sovrapposizione note (4 modifiche)

| Riga~ | Cosa | Prima | Dopo |
|-------|------|-------|------|
| ~890  | Soglia merge secondi | `eligible.length < 2` | `eligible.length < 3` — non unire secondi a 2 note |
| ~1484 | onsetSecondsIds | non preservava offsetMap | preserva entries offsetMap durante un-merge |
| ~2111 | Soppressione xShift accidentali | `>= 2` | `>= 4` — soglia più alta |
| ~2148 | setNoteDisplaced | `setNoteDisplaced(idx, true)` | `setNoteDisplaced(true)` — API VexFlow 4.x corretta |

### 2. `src/components/GrandStaffEditor.tsx` L7265-7298 — `hideLabelAbsBeats` rewrite

**Problema**: il codice che decide quali label armoniche nascondere (perché "ridondanti" per note di passaggio) nascondeva label sui tempi FORTI anziché quelli deboli.

**Fix**:
- **Strong-beat guard**: le label sui tempi forti (beat 1, 3 in 4/4) non vengono MAI nascoste
- **Rimosso bug `!sigHere → add`**: aggiungeva beat al set "nascosti" anche quando non c'era nessuna label
- **Solo `sameAsPrev`**: nasconde solo label su tempi deboli che sono ripetizioni identiche della precedente

```typescript
// Codice attuale (dopo fix):
const inMeasureBeat = curAbs - Math.floor(curAbs / beatsPerMeasure) * beatsPerMeasure;
const isStrongBeat = Math.abs(inMeasureBeat) < 1e-6
    || (beatsPerMeasure >= 4 && Math.abs(inMeasureBeat - Math.floor(beatsPerMeasure / 2)) < 1e-6);
if (isStrongBeat) continue;  // MAI nascondere tempi forti
const sigHere = labelSigAtAbs.get(curAbs);
if (!sigHere) continue;  // nessuna label → niente da nascondere
// ... trova prevSig ...
if (!!prevSig && prevSig === sigHere) hideLabelAbsBeats.add(curAbs);
```

### 3. `src/hooks/useHarmonyLabels.ts` — 5 fix per label armoniche

#### 3a. L462-470 — Compact tonicization first-chord exception
- Con compact ON: primo accordo nello span mantiene la label naturale (es. V/V) — nessun override
- Accordi successivi: solo numerale romano locale (es. V, IV, ii) senza suffisso /target

```typescript
if (compactTonicization) {
    if (s !== firstIdx) {
        autoRomanDisplayByAbsBeat.set(base[s].q, rS.roman); // solo locale
    }
    // primo accordo: nessun override → mantiene V/V naturale
}
```

#### 3b. L~482 — V/target lookahead disabilitato in compact mode
L'intero blocco lookahead (L482-577 pre-fix) che crea label tipo `I=V`, `vi=iv`, `ii°/iii` è avvolto in:
```typescript
if (!compactTonicization) {
    // ... tutto il blocco V/target lookahead ...
}
```
In compact mode: label pulite senza suffix complessi.

#### 3c. L~553 — Anti-nesting per ii°/target override
```typescript
if (!localRoman.includes('/')) {
    autoOverrideByAbsBeat.set(bi.q, { absBeat: bi.absBeat, roman: `${localRoman}/${targetRoman}` });
}
```
Previene label tipo `ii°/vi/IV` — non annida se già contiene `/`.

#### 3d. L~570-572 — Anti-nesting per pivot display
```typescript
if (globalRomanHere && !globalRomanHere.includes('/')) {
    autoRomanDisplayByAbsBeat.set(bi.q, `${globalRomanHere}=${localRoman}`);
} else if (!localRoman.includes('/')) {
    autoRomanDisplayByAbsBeat.set(bi.q, `${localRoman}/${targetRoman}`);
}
```
Previene `V/ii=iv` e simili.

#### 3e. L2140 — `autoRomanDisplayByAbsBeat` solo cosmetico
```typescript
// Prima: if (s.includes('/')) { roman = s; romanDisplay = undefined; }
// Dopo: SEMPRE romanDisplay = s — mai sovrascrivere roman (strutturale)
romanDisplay = s;
```
Toggle compact tonicization = puramente visuale, non cambia mai l'analisi.

### 4. `src/utils/computeHarmonyLabelsBySystem.ts` (NON usato dalla UI)
- L79: aggiunto `useStatisticalCorrection` al destructuring
- L1174: aggiunta eccezione `previewRoman !== prevR` per soppressione weak-beat

> **NOTA**: questa funzione NON è importata da nessun file in `src/`. È usata solo dagli script di debug. La UI usa esclusivamente `src/hooks/useHarmonyLabels.ts`.

### 5. `src/utils/harmonyLabelPipeline.ts` L892
- Fix scoping: `if (opts?.useStatisticalCorrection)` — evita accesso a undefined

### 6. StyleProfile — Sistema di apprendimento stile (Phase 1-3)

#### File nuovi:
- **`src/engine/choralStyleProfile.ts`** — definisce interfaccia `ChoralStyleProfile` e funzione `extractStyleProfile()`
  - Estrae: frequenze ornamenti (tutti tranne ritardo), intervalli melodici, progressioni armoniche, uso rivolti
  - Analizza tutte le voci, contesti metrici, transizioni
  
- **`src/engine/defaultStyleProfile.json`** — profilo di default pre-calcolato
  - Contiene: `ornamentFrequencies`, `melodicIntervals`, `harmonicProgressions`, `inversionUsage`

- **`scripts/buildDefaultStyleProfile.ts`** — costruisce profilo default da corpus batch
  - Eseguire con: `npx tsx scripts/buildDefaultStyleProfile.ts`

#### File modificati:
- **`src/engine/choralRealization.ts`** — usa il profilo stile durante la generazione
- **`src/components/RomanProgressionEditor.tsx`** — pulsante "Carica da repertorio" che chiama `extractStyleProfile()` sui brani caricati

#### Come funziona:
1. L'utente inserisce brani nella partitura
2. Preme "Carica da repertorio" nel RomanProgressionEditor
3. `extractStyleProfile()` analizza tutti i brani e costruisce un profilo completo
4. Il profilo viene salvato in localStorage e persiste tra sessioni
5. Il generatore (`choralRealization.ts`) usa il profilo durante la realizzazione

#### Cosa impara il generatore:
- **Note ornamentali** (tutte tranne ritardo): frequenze per voce e contesto metrico
- **Movimenti melodici**: distribuzione intervalli, preferenza moto congiunto/salti
- **Progressioni armoniche**: transizioni frequenti (I→V, V→I, ii→V, ecc.)
- **Uso rivolti**: fondamentale vs. 1°/2°/3° rivolto per grado

#### Usage:
- **"Carica da repertorio"**: va premuto ogni volta che si aggiunge un nuovo brano. Non serve ogni sessione se il repertorio non cambia.
- **Script da terminale**: NON più necessari per uso normale. Servono solo per generare il profilo default da un corpus batch o per debug.

### 7. Script di debug creati
- `scripts/_debug_corale1d_m8.ts` — analisi iniziale V/V mancante
- `scripts/_debug_corale1d_m8_v2.ts` — verifica computeHarmonyLabelsBySystem (produce V/V correttamente)
- `scripts/_debug_corale1d_m8_v3.ts` — replica logica `lastStructural` del hook (conferma V/V calcolato)

---

## Risultati test regressione

```
37 OK / 1 FAIL (pre-esistente: Dubois n3 p12 — "missing inferred context Gb@absBeat≈76")
```

---

## Problemi aperti / non risolti

### ⚠️ CRITICO: L'utente riporta che i fix per le label armoniche NON hanno effetto visivo

L'utente ha verificato:
1. **V/V a mis. 8 beat 4** — la label non compare ancora (né con compact ON né OFF)
2. **Compact tonicization** — le label cambiano comunque da I a IV/V
3. **Tempi deboli che nascondono tempi forti** — ancora presente in alcuni casi
4. **Label annidate** (V/ii/IV, V/IV/V) — ancora presenti

#### Possibili cause:
- L'utente potrebbe non aver riavviato l'app Electron dopo il build (serve restart completo, non solo hot reload)
- Il build Vite potrebbe avere cache non aggiornata
- I fix al `hideLabelAbsBeats` nella rendering (GrandStaffEditor.tsx) sono corretti nel codice ma il percorso di esecuzione potrebbe non essere quello previsto
- Il fix `romanDisplay = s` al L2140 potrebbe non bastare: se `autoRomanDisplayByAbsBeat` contiene ancora "IV/V" da un altro code path (non il lookahead, ma il span detection), la label appare come IV/V

#### Approccio consigliato per la prossima sessione:
1. **Verificare** che l'Electron app usi effettivamente il build aggiornato: `npm run build && npm run electron:dev` (stop → build → restart)
2. **Se il problema persiste**: aggiungere `console.log` temporanei nel renderer e usare `mainWindow.webContents.on('console-message')` in `electron/main.js` per vedere l'output
3. **Controllare** se `hideLabelAbsBeats` contiene effettivamente beat 31 (absBeat di m8 b4) durante il rendering
4. **Controllare** se `autoRomanDisplayByAbsBeat` è sovrascritto da un code path diverso dal lookahead (il span detection a L383-475 potrebbe anche aggiungere entries)

---

## Architettura chiave da ricordare

### Label armoniche — due sistemi INDIPENDENTI:
- **`src/utils/computeHarmonyLabelsBySystem.ts`** — funzione standalone. Produce V/V correttamente. **MA NON È USATA DALLA UI** — non importata in nessun file `src/`.
- **`src/hooks/useHarmonyLabels.ts`** — hook React usato dalla UI. Ha la propria logica indipendente di calcolo label basata su `lastStructural` Map (voice→last-structural-note). Produce anche V/V correttamente (verificato con script debug v3).
- **`src/components/GrandStaffEditor.tsx`** chiama `useHarmonyLabels()` a L2886, renderizza label a L7602. `hideLabelAbsBeats` è un Set calcolato nel rendering (L7223-7298) che nasconde label a certi beat.

### Rendering chain:
1. Hook computa label → `labelsBySystem[systemIndex].push({roman, romanDisplay, ...})`
2. GrandStaffEditor riceve `harmonyLabelsBySystemSequenced` dal hook
3. `hideLabelAbsBeats` calcolato nel JSX rendering
4. `showRoman = showRomanAnalysis && !!lbl.roman && !isHiddenMarker && !(hideLabelAbsBeats.has(lblAbsQ))`
5. `romanShown = String(romanDisplay ?? sequenceRomanFunctional ?? sequenceRoman ?? roman ?? '')`
6. `romanDisplay` ha priorità su `roman` per la visualizzazione
7. `roman` è usato per il check di visibilità (`!!lbl.roman`)

### Numeri di riga chiave in `useHarmonyLabels.ts`:
- L67: `compactTonicization` preferenza
- L119: `harmonyLabelsBySystem = useMemo(...)` — inizio calcolo label
- L293: `autoRomanDisplayByAbsBeat = new Map<number, string>()`
- L383-475: Rilevamento span tonicizzazione + autoRomanDisplay
- L462-470: **FIX** compact mode first-chord exception
- L~482: **FIX** `if (!compactTonicization)` — wrap V/target lookahead
- L~553: **FIX** nesting guard ii°/target
- L~570-572: **FIX** nesting guard pivot display
- L824: `isNonChordToneAtLabelEvent()` — classificatore NCT
- L1365: `harmonicSig = signatureFromNotes(baseHarmonicNotes)`
- L1370: `if (!harmonicSig || baseHarmonicNotes.length < 2) return;` — early exit
- L1490: Same-harmony suppression
- L2125-2145: **FIX** `autoRomanDisplayByAbsBeat` application (romanDisplay only)
- L2215: MAIN label push

### Numeri di riga chiave in `GrandStaffEditor.tsx`:
- L7223: `hideLabelAbsBeats = new Set<number>()`
- L7265-7298: **FIX** hideLabelAbsBeats loop (strong-beat guard)
- L7632: `showRoman` visibility check
- L7662: `romanShown` display priority

### File test: `scripts/Corale 1D Bach.json` (C major, 4/4)
- m8 b4 (absBeat=31): note A4(v1), F#4(v2), D4(v3), D3(v4) → D major = V/V in C major
- `isStrongPulseInMeasure` per 4/4: beat 0,2 (musica 1,3) forti. Beat 1,3 (musica 2,4) deboli.

---

## Comandi utili

```bash
# Build + run Electron
npm run build && npm run electron:dev

# Solo build
npm run build 2>&1 | tail -5

# Test regressione
npm run regress

# Conteggio risultati regression
npm run regress 2>&1 > /tmp/_regr.txt && grep -c '^OK' /tmp/_regr.txt && grep 'FAIL\|missing' /tmp/_regr.txt

# Debug script V/V mancante
npx tsx scripts/_debug_corale1d_m8_v3.ts

# Build profilo stile default
npx tsx scripts/buildDefaultStyleProfile.ts
```
