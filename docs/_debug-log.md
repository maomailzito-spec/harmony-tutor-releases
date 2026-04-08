# Debug Log — Harmony Tutor

> File aggiornato ad ogni sessione di debug. Le entry più recenti sono in cima.

---

## 2 marzo 2026 — Cross-context roman bleeding (dyad D+F → "I in Dm")

### Problema

In Cantata BWV 19 (Bb maggiore), misura 11 battito 4 (absBeat=43), un **dyad D+F** (senza la quinta A) veniva etichettato come **"I in Dm"** anziché **"iii"**.
Aggiungendo la nota A (triade completa D+F+A), il label diventava correttamente **"vi=iii"** (pivot DRE).

Il bug si manifestava solo con verticali incomplete (2 note) a cavallo di un cambio di contesto tonale iniettato dal DRE (Dynamic Resolution Engine).

## Causa individuata

**Cross-context roman bleeding** in `src/hooks/useHarmonyLabels.ts`, in **due punti distinti**:

### 1. Shell continuation (~L1998)
```typescript
if (!isSecondaryOrSlashRoman && prevRoman && bassPc != null && pcs.size > 0 && pcs.size <= 2) {
    const prevTriad = inferDiatonicTriadFromRoman(prevRoman, contextTonic, contextIsMinor);
    // ...
    roman = prevRoman;   // ← BUG
}
```

### 2. Post-processing inversion (~L2055)
```typescript
if (prevRoman && bassPc != null && roman && roman !== prevRoman && !String(roman).includes('/')) {
    const prevTriad = inferDiatonicTriadFromRoman(prevRoman, contextTonic, contextIsMinor);
    // ...
    roman = prevRoman;   // ← BUG
}
```

**Meccanismo del bug:**
- Il beat 42 (F maggiore) era analizzato in contesto F (DRE) → `prevRoman = 'I'`
- Il beat 43 (D+F) tornava in contesto Bb (home key)
- `inferDiatonicTriadFromRoman('I', 'Bb', false)` → triade di Bb = {Bb=10, D=2, F=5}
- Il dyad D+F = {2, 5} è un **sottoinsieme** della triade di Bb
- Quindi `roman = prevRoman = 'I'` — ma 'I' era stato calcolato in contesto F, non Bb!

In pratica il codice interpretava `prevRoman='I'` nel contesto *corrente* (Bb) anziché nel contesto *precedente* (F), causando un falso match: "I in Bb = Bb maggiore contiene D e F, quindi il dyad D+F è una continuazione di I". Ma I in F (= F maggiore) e I in Bb (= Bb maggiore) sono accordi completamente diversi.

## Soluzione applicata

Aggiunta una **`lastContextBySystem`** Map che traccia il contesto tonale (tonic + isMinor) dell'ultimo roman calcolato per ogni sistema. Prima di applicare la shell continuation o il post-processing inversion, si verifica che il contesto sia lo stesso:

```typescript
const lastContextBySystem = new Map<number, { tonic: string; isMinor: boolean }>();

// Guard 1 — Shell continuation (~L1998):
const prevCtx = lastContextBySystem.get(systemIndex);
const sameCtx = !prevCtx || (prevCtx.tonic === contextTonic && prevCtx.isMinor === contextIsMinor);
if (... && sameCtx) { roman = prevRoman; }

// Guard 2 — Post-proc inversion (~L2055):
const prevCtx2 = lastContextBySystem.get(systemIndex);
const sameCtx2 = !prevCtx2 || (prevCtx2.tonic === contextTonic && prevCtx2.isMinor === contextIsMinor);
if (sameCtx2 && ...) { roman = prevRoman; }

// Tracking (~L2081):
lastContextBySystem.set(systemIndex, { tonic: contextTonic, isMinor: contextIsMinor });
```

**Build:** OK (2.16s) — **Regress:** 37/38 OK (il fail Dubois n3 p12 è pre-esistente).

## Casi simili da tenere d'occhio

1. **Qualunque uso di `prevRoman` a cavallo di un cambio contesto DRE** — ogni volta che il label precedente viene riusato nel beat successivo, verificare che il contesto tonale sia lo stesso. Il pattern `inferDiatonicTriadFromRoman(prevRoman, contextTonic, ...)` è pericoloso perché interpreta il numeral romano nel contesto *corrente*, non in quello in cui era stato calcolato.

2. **Dyad incompleti (2 note) ai confini di modulazione** — sono particolarmente vulnerabili perché sottoinsiemi di più triadi e quindi più facilmente catturati da match falsi.

3. **La sezione "Post-processing: infer inversions" (L2038-2068)** ha due sotto-blocchi: il primo usa `triadPcsFromRootAndType(prevRootPc, prevType)` (basato sul chord candidate, meno soggetto al bug perché usa il root effettivo), il secondo usa `inferDiatonicTriadFromRoman(prevRoman, contextTonic, ...)` (soggetto al bug cross-context). Il guard `sameCtx2` protegge solo il secondo. Se in futuro si aggiungono altri punti di "continuation" con `prevRoman`, ricordarsi di aggiungere lo stesso guard.

4. **Il primo sotto-blocco (L2038-2048)** potrebbe avere un problema analogo se `prevRootPc` e `prevType` vengono dal contesto sbagliato, ma al momento usa il root effettivo dell'accordo precedente (non un numeral romano), quindi il rischio è minore.

## Sessione di debug — Metodo

Il bug è stato trovato con debug log incrementali (`[DBG43-*]`) inseriti in punti chiave della pipeline di labeling, filtrati per `absBeat ∈ (42.5, 43.5)`. Sono stati necessari 3 round di debug:

1. **Round 1** ([DBG43-CTX], [DBG43-R0], [DBG43-FINAL]): ha mostrato che `roman` passava da 'iii' (L1884) a 'I' (L2469), con contextTonic='Bb' invariato.
2. **Round 2** ([DBG43-A], [DBG43-B], [DBG43-D]): ha ristretto il cambio tra L1884 e L2028.
3. **Round 3** ([DBG43-PRE], [DBG43-DYAD], [DBG43-SHELL]): ha mostrato che 'iii' sopravviveva fino a L2011 (shell continuation fixata), ma veniva sovrascritto in L2035-2068 (post-proc inversion).

Tutti i debug log sono stati rimossi dopo il fix.

## Sistema diagnostico permanente (aggiunto in questa sessione)

Per evitare il ciclo lento "aggiungi log → build → testa → ripeti", è stato creato un **tracer diagnostico permanente** in `useHarmonyLabels.ts` che si attiva dalla console del browser:

```
// Attivare (nella console Electron, Cmd+Option+I):
localStorage.setItem('_HT_DEBUG_BEAT', '43')

// Elencare TUTTI i beat (per trovare il numero giusto):
localStorage.setItem('_HT_DEBUG_BEAT', '-1')

// Disattivare:
localStorage.removeItem('_HT_DEBUG_BEAT')
```

Persiste attraverso i reload (Cmd+R). Impostare una volta, ricaricare, leggere l'output.

Quando attivo, per ogni beat che matcha (±0.5), produce un `console.groupCollapsed` con:
- **`console.table`** di tutti i passaggi della pipeline dove `roman` viene mutato (17 punti: R0–R13 + D1–D2)
- Contesto tonale, bassPc, prevRoman, applicableContext

**Punti tracciati:**
| Label | Descrizione |
|-------|-------------|
| R0:getRoman | Prima analisi `getRomanAnalysis` |
| R1:viiRescue | Rescue vii° → V7 per dyad incompleti |
| R2:secDom | Dominante secondaria |
| R3:I7 | Fallback I7 minore-maj7 |
| R4:dyadBass | Fallback dyad da basso (`inferDiatonicRomanFromBass`) |
| R5:shellCont | Shell continuation (con guard `sameCtx`) |
| R6:rootless | Inferenza rootless/shell diatonico |
| R7:postInvRoot | Post-proc inversione (da rootPc) |
| R8:postInvDiat | Post-proc inversione diatonica (con guard `sameCtx2`) |
| R9:domRes | Risoluzione dominante |
| R10:suspDedup | Dedup sospensione |
| R11:sparseRescue | Rescue texture sparse |
| R12:autoOvr | Auto override (DRE/cadenziale) |
| R13:manualOvr | Override manuale utente |
| D1:cadPivot | Display pivot cadenziale |
| D2:nonGlobalPivot | Display pivot contesto non-globale |

**Per il prossimo debug:** basta aprire la console, digitare `window._HT_DEBUG_BEAT = <numero>`, ricaricare (Cmd+R), e leggere l'output. Zero modifiche al codice.

---

## 3 marzo 2026 — Stale `isSuspension` flag su basso strutturale (Cantata 17 m39 b2)

### Problema

Beat 115 (m39 b2, contesto La Maggiore) mostrava **V6** invece di **vii°6** (o vii°/V).
Le 4 note suonanti: A4(69), A3(57), F#3(54), D#4(63) → PCs {3,6,9} = D#-F#-A = D#° diminuito.
Con la toolbar in **min** appariva correttamente vii°6; in **Maj** appariva V6.

### Investigazione (4 ore)

1. **Ipotesi 1 — Note mancanti nell'evento:** Verificato con script `_tmp_debug_b115.ts` → le 4 note erano TUTTE presenti in `event.notes` ✗
2. **Ipotesi 2 — `pitchClassOf` non legge D#:** Verificato con script `_tmp_test_roman.ts` → `getRomanAnalysis([A,A,F#,D#], 'A', false)` ritorna correttamente `vii°/V` con figure `["6"]` ✗
3. **Ipotesi 3 — `hasExplicitSpellingToken` blocca D#:** D#4 ha `pitch="D"`, `explicitAccidental="sharp"`, `noteIndex=3`. Il check su `explicitAccidental` era già coperto. ✗
4. **Ipotesi 4 — `analysisNotesForNaming` ha meno note:** Aggiunto dump diagnostico → confermato: **solo 3 note** (A,A,D#), F#3 mancante ✓

### Causa radice

**Catena di 5 passi** che eliminavano F#3:

1. F#3 (basso, v4) aveva un flag `isSuspension: {type:"susp", fromAbsBeat:115, ...}` attaccato dal rilevamento automatico dei ritardi.
2. `isNonChordToneAtLabelEvent(F#3, 115)` per la voce 4 (basso) controlla solo `isPassing|isEscape|isNeighbor|isAnticipation|isAppoggiatura` — **non** `isSuspension` → ritornava `false` ("nota strutturale").
3. La nota entrava in `lastStructural.set(v, n)` con il flag `isSuspension` ancora presente (come un'etichetta dimenticata sulla valigia).
4. Il filtro `harmonicNotesNoSuspAtThisBeat` (L1646) leggeva il flag `isSuspension` e **scartava** F#3.
5. `analysisNotesForNaming` aveva solo A+A+D# (2 PC distinti) → `getRomanAnalysis` vedeva un tritono (dyad) → fallback dyadBass → **V6**.

### Perché in minor funzionava

In modalità minore il DRE (Dynamic Resolution Environment) cambiava contesto, probabilmente tonicizzando a E. In quel caso il percorso di analisi era diverso e il filtro non scattava con lo stesso effetto.

### Soluzione

File: `src/hooks/useHarmonyLabels.ts`, ~L1579.

Se una nota raggiunge `lastStructural.set()` — cioè ha **già superato** il test di strutturalità `isNonChordToneAtLabelEvent()` — le puliamo unconditionally il flag `isSuspension`:

```typescript
const _suspFlag = (n as any)?.isSuspension;
lastStructural.set(v, _suspFlag ? { ...n, isSuspension: undefined } : n);
```

### Regressione

Build OK, **37/38** (invariato — unico fail pre-esistente: Dubois n3 p12).

### Lezione appresa

Quando una funzione gate (`isNonChordToneAtLabelEvent`) dichiara una nota "strutturale" ma **non pulisce** i flag residui, un filtro a valle che legge quegli stessi flag può contraddire la decisione. I flag auto-detection devono essere trattati come "consumati" una volta che la nota è stata giudicata strutturale.
