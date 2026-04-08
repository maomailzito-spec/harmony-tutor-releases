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

### Session continuazione (stessa giornata)

#### Fix applicati nella 2a parte della sessione:

**Fix 1 — Triple-nesting eliminato (useHarmonyLabels.ts ~L441, ~L537)**
- Cadential detector: `rS.roman.replace(/\/.*$/, '')` → strip suffisso secondario
- V/target lookahead: `localRoman.replace(/\/.*$/, '')` → strip suffisso secondario
- ii°/target: spostato da `autoOverrideByAbsBeat` (strutturale) a `autoRomanDisplayByAbsBeat` (display-only)

**Fix 2 — Tonica protetta (useHarmonyLabels.ts ~L2115)**
- Rimosso bypass `isSecondaryFn` che permetteva V/IV di sovrascrivere I
- Ora `isCurrentlyTonicForDisp` blocca SEMPRE il display override su I/i

**Fix 3 — Cadential detector solo cromatici (useHarmonyLabels.ts ~L441)**
- Aggiunto `_chordHasChromatic` check: solo accordi con almeno una nota cromatica ricevono label secondaria
- Risultato: C in C major → sempre I, mai V/IV

**Fix 4 — hideLabelAbsBeats (GrandStaffEditor.tsx ~L7270)**
- `!sigHere` → `continue` anziché `add` (non nascondere beat senza label)
- `sameAsPrev || sameAsNext` → `sameAsPrev && sameAsNext` (nascondere solo se identico a ENTRAMBI i vicini)

**Fix 5 — harmonicSig da analysisNotes (useHarmonyLabels.ts ~L1360)**
- `harmonicSig = signatureFromNotes(analysisNotes)` anziché `signatureFromNotes(baseHarmonicNotes)`
- Scopo: se un ritardo rende il PC-set identico al precedente, la rimozione del ritardo fa apparire la label

#### ⚠️ PROBLEMA ANCORA APERTO: label mancanti a m8 b4 e m12 b4
L'utente conferma che i fix 1-4 funzionano (label triple sparite, analisi coerente).
Il fix 5 NON ha risolto le label mancanti.

**Diagnosi incompleta** — possibili cause ancora da indagare:
1. `shouldSuppressAsCompletion` potrebbe sopprimere (se 2→3 note = "completion" del triade)
2. `hasSuspensionOnsetHere` = false (il ritardo è in lastStructural, non analyzedNotes)
3. La nota "falso ritardo" potrebbe NON avere `isSuspension` ma essere semplicemente uguale alla nota precedente → `lastStructural` mantiene la nota vecchia → PC-set invariato

**Punti chiave del codice di soppressione:**
- L1487: `if (!hasSuspensionOnsetHere && !hasHiddenChange && ((prevSig === harmonicSig && prevCtx === ctxKey) || shouldSuppressAsCompletion))`
- L1489: `if (previewRoman && prevRoman && previewRoman !== prevRoman)` → rescue se Roman diverso
- `hasSuspensionOnsetHere` cerca in `analyzedNotes` (non lastStructural) per `isSuspension.fromAbsBeat === event.absBeat`
- `shouldSuppressAsCompletion` sopprime quando 2-note shell → 3-note triade (e.g. vi6 shell → vi6 full)
- `harmonicSig` = `signatureFromNotes(analysisNotes)` (dopo fix 5)
- `isNonChordToneAtLabelEvent` su nota con `isSuspension.fromAbsBeat === currentBeat` → return true → `lastStructural.delete(v)`
- `analysisNotes` = `harmonicNotesNoSuspAtThisBeat` se >= 2, altrimenti fallback a `harmonicNotes`

**Approccio per il debug:**
- Aggiungere `console.warn` temporaneo alla L1487 per absBeat vicini a 31 (m8 b4) e 47 (m12 b4)
- Stampare: `prevSig`, `harmonicSig`, `fullSig`, `hasSuspensionOnsetHere`, `shouldSuppressAsCompletion`, `previewRoman`, `prevRoman`, `baseHarmonicNotes.length`, `analysisNotes.length`

### DEBUG LOG GIÀ INSERITO (useHarmonyLabels.ts ~L1486)
Un `console.warn` è attivo per absBeat 27-48. Stampa tutti i valori critici.
L'utente deve: `npm run build && npm run electron:dev`, aprire DevTools (Cmd+Shift+I), 
caricare "Corale 1D Bach" e leggere le righe `[HarmLabel] m8 b4` e `[HarmLabel] m12 b4`.

### STATO ATTUALE CODICE (dopo tutti i fix della 2a parte sessione)

**useHarmonyLabels.ts fix applicati:**
1. ~L441: cadential detector strip suffix `.replace(/\/.*$/, '')` + solo accordi cromatici
2. ~L537: ii°/target → autoRomanDisplayByAbsBeat (display-only, non strutturale)  
3. ~L1360: `harmonicSig = signatureFromNotes(analysisNotes)` (non baseHarmonicNotes)
4. ~L2115: tonica I/i MAI sovrascritta da auto display (rimosso bypass isSecondaryFn)

**GrandStaffEditor.tsx fix applicato:**
- ~L7270: `!sigHere → continue`, `sameAsPrev && sameAsNext` (non ||)

**File test:** `tests/Corale 1D Bach.htp` e `scripts/Corale 1D Bach.json`

### PROSSIMO PASSO
Scrivere uno script di debug standalone (tipo `scripts/_debug_corale1d_m8_v3.ts`) che:
1. Carica `scripts/Corale 1D Bach.json`
2. Replica la logica `lastStructural` + `isNonChordToneAtLabelEvent` del hook
3. Stampa per ogni beat: lastStructural content, harmonicNotes, analysisNotes, 
   harmonicSig, prevSig, shouldSuppressAsCompletion, previewRoman
4. Identifica ESATTAMENTE perché m8 b4 e m12 b4 vengono soppressi

### ARCHITETTURA DEL HOOK useHarmonyLabels.ts (numeri riga aggiornati post-fix)
- L67: compactTonicization preference
- L119: harmonyLabelsBySystem = useMemo(...)
- L292-293: autoOverrideByAbsBeat, autoRomanDisplayByAbsBeat
- L361-458: Cadential tonicization detector (span detection)
- L460-560: V/target lookahead
- L819-1015: isNonChordToneAtLabelEvent() function
- L1013: isSuspension.fromAbsBeat === absBeat → return true (nota=ornamento)
- L1086-1103: signatureFromNotes() → pitch-class set sorted
- L1171: lastStructural = lastStructuralByVoiceBySystem.get(systemIndex)
- L1204: if (isNonChordToneAtLabelEvent(n, event.absBeat)) → skip note
- L1209-1212: suspension onset → lastStructural.delete(v) 
- L1237: lastStructural.set(v, n) — update structural for voice
- L1240-1260: harmonicNotes = Array.from(lastStructural.values()).filter(...)
- L1262-1280: fallbackHarmonicNotes (2+ notes fallback chain)
- L1282-1290: baseHarmonicNotes (2+ notes fallback chain)
- L1296-1302: harmonicNotesNoSuspAtThisBeat = fallbackHarm.filter (remove susp onset)
- L1305: analysisNotes = harmNotesNoSusp if >=2 else harmonicNotes
- L1360: harmonicSig = signatureFromNotes(analysisNotes) [FIXED: was baseHarmonicNotes]
- L1361: fullSig = signatureFromNotes(fullNotes)
- L1362: if (!harmonicSig || baseHarmonicNotes.length < 2) return; — early exit
- L1431-1443: hasSuspensionOnsetHere — checks analyzedNotes for isSuspension.fromAbsBeat
- L1486-1500: ── DEBUG console.warn ATTIVO per absBeat 27-48 ──
- L1502: if (!hasSuspOnset && !hasHiddenChg && (prevSig===harmSig || shouldSuppress))
- L1504: if (previewRoman !== prevRoman) → rescue
- L1506-1515: suppress → return (hiddenMarker or silent skip)
- L2048-2060: autoOverrideByAbsBeat application (overwrites roman structurally)
- L2110-2130: autoRomanDisplayByAbsBeat application (romanDisplay only, never roman)

### NOTA: Debug log console.warn da RIMUOVERE dopo diagnosi
Il console.warn a ~L1486 per absBeat 27-48 è temporaneo.
Va rimosso una volta identificata e risolta la causa delle label mancanti.

### RISULTATI DEBUG SCRIPT v3 (standalone)
Lo script standalone (`npx tsx scripts/_debug_corale1d_m8_v3.ts`) mostra che:
- m8 b4 (abs=31): `prevSig="0-4-7-9"`, `harmonicSig="2-6-9"` → DIFF → V/V calcolato e NON soppresso
- Le note: A4(v1), F4(v2,midi66→F#?), D4(v3), D3(v4) → V/V correttamente
- Il problema NON è nella logica di soppressione nello standalone

**DISCREPANZA**: la logica standalone produce V/V correttamente, ma la UI lo nasconde.
Possibili cause nell'hook LIVE:
1. `filterTimelineForHarmonyLabels` può essere diverso nella UI (la UI usa `timelineForLabels` dal componente)
2. Il rendering in GrandStaffEditor usa `hideLabelAbsBeats` che potrebbe nascondere il beat
3. L'hook potrebbe calcolare `analysisNotes` con un set diverso di note (dipende da analyzedNotes dal componente)
4. Il `autoRomanDisplayByAbsBeat` potrebbe interagire con il rendering e nascondere il label
5. Il console.warn debug inserito nell'hook dovrebbe chiarire tutto → L'UTENTE DEVE RUNNARE L'APP

### ⚠️ RISULTATI DEBUG IN-APP (24 febbraio, sera)
L'utente ha eseguito l'app e il console.warn mostra:
- **m8 b4 (abs=31): shouldSuppress=false, previewR=V/V, prevR=vi → NESSUNA SOPPRESSIONE NELL'HOOK**
- **m12 b4 (abs=47): shouldSuppress=false, previewR=V, prevR=V/V → NESSUNA SOPPRESSIONE**
- Le label VENGONO GENERATE nell'hook ma NON APPAIONO nell'UI

**CONCLUSIONE: Il problema è nel RENDERER (GrandStaffEditor.tsx), NON nell'hook**

### ⚠️ Dove cercare nel renderer (GrandStaffEditor.tsx):
1. **L7618-7625**: `isHiddenMarker` — se `hiddenMarker: true` sul label, viene nascosto
   - `showRoman = showRomanAnalysis && !!lbl.roman && !isHiddenMarker && !hideLabelAbsBeats.has(lblAbsQ)`
2. **L7220-7290**: `hideLabelAbsBeats` Set — se `isPassing` note a quel beat E sig uguale entrambi vicini
3. **L7654**: `romanShown = lbl.romanDisplay ?? lbl.sequenceRomanFunctional ?? lbl.sequenceRoman ?? lbl.roman`
   - Se romanDisplay è settato ma vuoto, potrebbe nascondere?
4. **L7748**: hold-line renderer `isHidden = hiddenMarker || hideLabelAbsBeats.has(abs)`
5. **L7702**: `{showRoman ? (` — solo se showRoman è true

### ⚠️ SCOPERTA CRITICA (24 feb, sera tardi)
Il `[Renderer]` debug log NON APPARE per abs=31 e abs=47.
Questo significa che il label NON VIENE MAI PUSHATO in `labelsBySystem`.
Il console.warn dell'hook appare (previewR=V/V, shouldSuppress=false) → il label supera
il check di soppressione L1502, MA qualcosa tra L1530 e il push finale (~L2200) lo ferma.

**Path da L1530 al push finale:**
1. L1530: lastSigBySystem.set() — aggiorna le signature
2. L1538: `let figures = computeFiguredBassFromNotes(...)` 
3. L1541: `let roman = ''` — inizia vuoto, poi viene calcolato
4. L1548-1560: `getRomanAnalysis(analysisNotesForNaming, ...)` → roman = V/V
5. Da qui in poi ci sono molti try/catch blocchi per rescue/override
6. eventualmente si arriva a L~2148 `if (!roman && !symbol && !(figures && figures.length)) return;`
   - Se roman diventa vuoto per qualche rescue → return (niente push)
7. Poi c'è il `allUserOrn` check — se tutte le onset notes sono ornamenti user → hiddenMarker
8. Infine il push a labelsBySystem

**POSSIBILE COLPEVOLE**: una delle rescue/override tra L1560 e L2148 potrebbe azzerare `roman`.
O il `autoOverrideByAbsBeat` / `autoRomanDisplayByAbsBeat` potrebbe interferire.

**AZIONE**: Spostare il console.warn debug DOPO il calcolo di `roman` finale (prima del push),
oppure aggiungere un secondo console.warn appena prima di L2148 per stampare roman/symbol/figures.

### CODICE DA LEGGERE (numeri riga aggiornati con debug log):
- L1486-1500: console.warn DEBUG (prima della soppressione)
- L1502: if (!hasSuspOnset && !hasHiddenChg && (prevSig===harmSig || shouldSuppress))
- L1530: lastSigBySystem.set()
- L1538: figures calc
- L1541: let roman = ''
- L1548: getRomanAnalysis → roman
- L~2148: if (!roman && !symbol && !(figures...)) return; — IL GATE FINALE
- L~2160: allUserOrn check → hiddenMarker
- L~2200: push a labelsBySystem

### ⚠️ DA RIMUOVERE DOPO DEBUG
- console.warn in useHarmonyLabels.ts (~L1493) — `[HarmLabel]` per absBeat 27-48
- console.warn in useHarmonyLabels.ts (~L2168) — `[HarmLabel-GATE]` per absBeat 27-48
- console.warn in GrandStaffEditor.tsx (~L7623) — `[Renderer]` per absBeat 27-48

### 🔴 TROVATA LA CAUSA FINALE (24 feb, notte)

**DIAGNOSI CONFERMATA:**
Il `[HarmLabel-GATE]` per abs=31 mostra:
```
roman="" symbol="" figures=[] romanDisplay="I=ii" willReturn=true
```
- `roman` è VUOTO → il gate `if (!roman && !symbol && !figures.length) return;` lo uccide
- `romanDisplay="I=ii"` è settato ma inutile (il label muore prima di essere pushato)

**IL COLPEVOLE**: L'override `autoOverrideByAbsBeat` al ~L2060 sovrascrive `roman`.
Ma in realtà, l'issue è che `roman` viene calcolato DENTRO un try-catch (L1547-L1727) e 
probabilmente qualcosa nel blocco di rescue/override lo svuota.

OPPURE: l'`autoRomanDisplayByAbsBeat` è settato su abs=31 come "I=ii" (risoluzione V/ii).
La fonte è il V/target lookahead (~L516-522) che setta `autoRomanDisplayByAbsBeat.set(bk.q, 'I=ii')`.
Ma `bk` sarebbe il chord di destinazione (la risoluzione), non V/target stesso...

**PROBLEMA**: V/target lookahead interpreta:
- j = chord V/ii (quelche beat) 
- k = arrival chord "ii" → mette "I=ii" display su bk.q
Ma bk.q potrebbe corrispondere ad abs=31! Se il V/ii è a un beat e la risoluzione (ii = Dm) è a abs=31...
No, abs=31 è D maggiore (V/V), non Dm (ii).

**POSSIBILITÀ PIÙ PROBABILE**: 
Il cadential detector span a ~L436-454 (dopo il fix cromatico) mette una display label
su abs=31. Ma il fix cromatico dovrebbe impedire label su accordi puramente diatonici.
D-F#-A ha F# (cromatico in C) → IL CADENTIAL DETECTOR LO ETICHETTA come `localR/${degLabel}`.
Ma il cadential detector calcola `localR` nella chiave K (tonicizzata), dove potrebbe dare "I".
Poi il display diventa `I/${degLabel}` = "I/ii" o simile.

**FLUSSO ESATTO DEL BUG per abs=31:**
1. V/target lookahead trova V/ii pattern
2. Resolution chord (ii = Dm) è a qualche beat vicino → mette "I=ii" display su quel beat  
3. Il cadential detector span (L436-454) ANCHE processa abs=31
4. `autoRomanDisplayByAbsBeat.set(base[s].q, ...)` sovrascrive con display span
5. Ma il cadential detector ORA skip non-cromatici... ma F# è cromatico → processa
6. `localR` in key K = I (se K è la chiave di D) → display = "I=ii" (j===s → `localR=degLabel`)

**FIX NECESSARI:**
1. Il gate `if (!roman && !symbol && !figures.length) return;` (L2168) dovrebbe anche 
   considerare `romanDisplay` — se c'è un romanDisplay non vuoto, il label dovrebbe passare
2. OPPURE: il `roman` non dovrebbe MAI essere svuotato — il bug è nel codice che lo svuota
3. Aggiungere debug per tracciare DOVE `roman` viene modificato tra L1548 e L2168

### CODICE CRITICO (numeri riga aggiornati):
- L241-256: getNear() — tolleranza EPS ≈ 0.005 (molto piccola, non confonde beat)
- L436-454: Cadential detector span — usa autoRomanDisplayByAbsBeat (display-only)
- L515-525: V/target lookahead resolution — `autoRomanDisplayByAbsBeat.set(bk.q, 'I=ii')`
- L1540: `let roman = ''` — inizia vuoto
- L1547-1727: Grande try-catch che calcola roman/symbol
- L1723: `} catch (_) { // ignore }` — inner catch
- L1727: `} catch (_) { // ignore }` — outer catch → ORA con debug log
- L2060: `if (auto.roman !== undefined) roman = auto.roman;` — autoOverrideByAbsBeat
- L2125: `romanDisplay = autoRomanDisplayByAbsBeat` — display-only override
- L2168: `if (!roman && !symbol && !(figures...)) return;` — GATE FINALE

### DEBUG LOG ATTIVI (da rimuovere dopo fix):
- useHarmonyLabels.ts ~L1493: `[HarmLabel]` per abs 27-48
- useHarmonyLabels.ts ~L2168: `[HarmLabel-GATE]` per abs 27-48
- useHarmonyLabels.ts ~L1723: `[HarmLabel-CATCH-OUTER]` per abs 27-48
- useHarmonyLabels.ts ~L1727: `[HarmLabel-CATCH-INNER]` per abs 27-48
- GrandStaffEditor.tsx ~L7623: `[Renderer]` per abs 27-48

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
