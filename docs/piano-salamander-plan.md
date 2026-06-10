# Piano tecnico — Pianoforte multi-velocity (Salamander) per le tracce ACC

> **STATO (fatto):**
> - ✅ Motore (`AudioService`) pronto: registry `VELOCITY_LAYERED` con
>   `acoustic_grand_piano → piano_salamander` (6 layer), loader per-layer,
>   selezione layer da velocity, **fallback automatico** al piano attuale se i
>   campioni mancano, e disattivazione del filtro velocity→timbro quando si usano
>   i layer reali. Decisioni: **6 layer, mp3 stereo (~175 kbps), strada A
>   (pre-render 88 note), solo piano**. (mp3 e non ogg perché il build locale di
>   ffmpeg non ha libvorbis; mp3 è comunque pienamente supportato e ~37–40 MB.)
> - ✅ Script `scripts/prepare-salamander.mjs` pronto (genera i 528 file mp3).
> - ✅ Toolchain verificata: `ffmpeg` già presente, `sox` installato, pipeline
>   sox→ffmpeg testata end-to-end.
> - ⏳ Da fare (utente): scaricare Salamander, lanciare lo script. Poi aggiungere
>   l'attribuzione CC-BY nel menu "Informazioni…".


Obiettivo: dare al pianoforte una **dinamica timbrica reale** (piano = rotondo,
forte = brillante) usando campioni con **più layer di velocity** (Salamander
Grand Piano V3), al posto del singolo campione attuale che può solo scalare il
volume. Scope: **solo pianoforte** (`acoustic_grand_piano`); gli altri strumenti
restano sui soundfont mono-layer.

---

## 1. Architettura attuale (punto di partenza)

- Campioni: `public/sounds/{instrument}/{NoteName}.mp3` — **un file per nota**
  (es. `piano/A3.mp3`, `piano/Db4.mp3`), tutte le ottave. Naming = output di
  `midiToName()`.
- `AudioService`:
  - `loadAudioFile(note)` (piano interno) / `_loadInstrumentFile(instrument,
    note)` (altri) → `fetch` locale poi fallback CDN FluidR3; cache in
    `audioBuffers: Map<string, AudioBuffer>` (chiave `note` o `instrument::note`).
  - `playNoteForInstrument(instrument, note, { volume, velocity, sustain, output })`
    crea `BufferSource → [lowpass opz.] → Gain → output`; `volume =
    velocityToGain(velocity)`; nessun `playbackRate` (niente pitch-shift).
- Limite: nessun layer di velocity → il filtro `velocityToCutoff` è solo
  un'**approssimazione** del cambio di timbro.

---

## 2. Licenza (vincoli)

Salamander Grand Piano V3 — **CC-BY 3.0**, autore **Alexander Holm**.
- ✅ uso commerciale, app closed-source, modifiche/ricompressione consentite.
- ⚠️ **obbligo di attribuzione**: credito + link licenza nella finestra
  "Informazioni…": *"Salamander Grand Piano V3 — Alexander Holm, CC BY 3.0
  (https://creativecommons.org/licenses/by/3.0/), campioni ricompressi/ridotti."*
- Formati sorgente: WAV 24/48 ≈ 1.18 GB, WAV 16/44.1 ≈ 394 MB (partire da questo).

---

## 3. Decisioni chiave

### 3a. Quanti layer di velocity
Salamander ha **16 layer**. Per un'app desktop conviene un sottoinsieme:
- **Consigliato: 4–6 layer** (buon compromesso qualità/peso). 6 layer danno
  transizioni morbide senza esagerare con i file.

### 3b. Copertura delle altezze (il punto architetturale)
Salamander è campionato ogni **terza minore** (~ogni 3 semitoni). Due opzioni:

- **Opzione A — pre-render di tutte le 88 note (CONSIGLIATA).**
  In fase di preparazione asset, generare offline un file per **ogni** semitono e
  layer (pitch-shift fatto fuori dall'app). Nessuna modifica alla logica di
  pitch del motore (che già non fa pitch-shift): si riusa il convenzionale
  `{Nota}{Ottava}` + suffisso layer.
  - Pro: motore semplice, coerente con l'attuale per-nota.
  - Contro: più file (88 × N layer).

- **Opzione B — campioni nativi (~30 altezze) × N layer + pitch-shift in-engine.**
  Spedire solo le altezze campionate e usare `source.playbackRate`/`detune` per
  le note intermedie (nearest sample).
  - Pro: meno file/peso.
  - Contro: richiede aggiungere il pitch-shifting a `AudioService` (scelta del
    campione più vicino + rapporto di frequenza) e gestione del timbro "stirato".

**Raccomandazione: Opzione A** (più semplice e robusta; il peso si controlla con
compressione e numero di layer).

### 3c. Formato e peso
- Convertire WAV → **mp3** (sicuro in Chromium/Electron) o **ogg** (qualità/peso
  migliori, supportati in Chromium). 128–160 kbps.
- **Mono vs stereo**: mono ~dimezza il peso (Salamander è AB stereo; per un'app
  il mono è accettabile). Stereo se si vuole l'immagine.
- Stima Opzione A, 6 layer, mono mp3 ~128 kbps, note ~3–4 s:
  88 note × 6 layer ≈ **528 file**, ~50–70 KB l'uno → **~30–40 MB** totali.
  (16 layer ≈ ~90–110 MB; valutare lazy-load.)

### 3d. Caricamento
- **Lazy-load on demand** come ora (carica nota+layer alla prima richiesta),
  cache in `audioBuffers` con chiave `salamander::{note}::v{layer}`.
- Opzionale: preload del range centrale (es. C2–C6) all'avvio per evitare
  latenza sulla prima nota.

---

## 4. Modifiche al codice (`AudioService`)

1. **Registry strumenti velocity-layered**:
   ```ts
   const VELOCITY_LAYERED: Record<string, { layers: number; dir: string }> = {
     acoustic_grand_piano: { layers: 6, dir: 'piano_salamander' },
   };
   ```
2. **Selezione layer da velocity**:
   ```ts
   const pickLayer = (velocity = 100, layers: number) =>
     Math.max(0, Math.min(layers - 1, Math.floor((velocity / 128) * layers)));
   ```
3. **Loader layer**: `_loadVelocitySample(dir, note, layer)` → fetch
   `./sounds/{dir}/{note}_v{layer}.mp3`, cache ``${dir}::${note}::v${layer}``.
4. **`playNoteForInstrument`**: se lo strumento è in `VELOCITY_LAYERED`:
   - calcola `layer = pickLayer(options.velocity, cfg.layers)`;
   - carica/usa il buffer del layer;
   - **disattiva il filtro `velocityToCutoff`** per questi strumenti (i layer
     reali sostituiscono l'approssimazione), oppure tienilo minimo;
   - mantieni inalterati: inviluppo `sustain`, `output` (gain traccia), gestione
     `activeSources`/cleanup.
5. **`playSustainedNote`** (monitoraggio): stessa logica di selezione layer, così
   live e registrato restano coerenti.
6. **`velocityToGain`**: con i layer reali, ridurre la sua escursione (il timbro
   ora porta gran parte della dinamica; il gain serve solo a rifinire). Eventuale
   **crossfade a 2 layer** adiacenti per transizioni più morbide (avanzato,
   opzionale).

Punti di chiamata già pronti: `playNoteForInstrument`/`playSustainedNote`
ricevono già `velocity` (aggiunto per il filtro), quindi non servono modifiche ai
call-site nell'editor.

---

## 5. Pipeline preparazione asset (offline, una tantum)

1. Scaricare Salamander V3 (16/44.1, ~394 MB) dalla fonte CC-BY.
2. Scegliere N layer (es. 6) tra i 16 (quelli a velocity rappresentative).
3. **Opzione A**: pitch-shift per coprire tutte le 88 note (SoX / ffmpeg /
   script con librosa, o render da un sampler SFZ). Naming `{Nota}{Ottava}_v{n}`.
4. Convertire in mp3/ogg (mono, ~128–160 kbps); normalizzare i livelli **tra le
   note** (non tra i layer — la differenza di layer è la dinamica).
5. Trim del silenzio iniziale/finale per ridurre il peso.
6. Output in `public/sounds/piano_salamander/`.
7. Script di verifica: tutte le 88 × N combinazioni presenti e decodificabili.

---

## 6. Rollout e test

- **A/B**: tenere il piano attuale come fallback; flag per scegliere il set.
- Verificare: latenza primo colpo (eventuale preload range centrale), assenza di
  "scalini" tra layer (se evidenti → crossfade 2 layer), peso bundle/installer.
- Aggiornare l'attribuzione nel menu "Informazioni…".
- Il **filtro velocity→timbro** attuale resta per gli strumenti mono-layer; per
  il piano Salamander va disattivato (layer reali).

---

## 7. Stima effort

- Preparazione asset (download, pitch-shift, conversione, naming, verifica):
  ~mezza/una giornata.
- Modifiche `AudioService` (registry, loader layer, selezione, integrazione):
  ~1 giornata.
- Tuning (mappatura velocity→layer, gain, eventuale crossfade): qualche ora.

---

## 8. Decisioni da prendere prima di partire

1. **N layer**: 4, 6 o 8?
2. **Mono o stereo**?
3. **Peso target** del bundle (quanto possiamo aggiungere all'installer?).
4. **Opzione A (pre-render 88 note)** o **B (pitch-shift in-engine)**?
5. **Solo piano** ora, o predisporre il meccanismo anche per futuri strumenti
   multi-layer?
