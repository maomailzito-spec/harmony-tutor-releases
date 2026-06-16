# SPEC A (definitiva) — Set orchestrale coerente: FLAC + SFZ + loop + LUFS, sostituzione in-place

**Obiettivo:** sostituire i campioni GM (FluidR3) interni con un set orchestrale
coerente e "semi-serio", in cui *tutti* gli strumenti suonino allo stesso livello
e — soprattutto — **tengano davvero** gli accordi lunghi (semibrevi, fermate,
pedali) senza spegnersi a metà battuta. Il piano (`acoustic_grand_piano` →
Salamander) **è già fatto e NON va toccato**.

**Decisioni bloccate** (motivate dallo Step 0): **FLAC** (loop sample-accurate,
lossless, ffmpeg-nativo, decodificabile da Chromium) · **render da SFZ** (loop
point + multicampionatura reali) · **loop di sostegno nel motore** · **LUFS**
(loudness coerente tra strumenti) · **sostituzione in-place** delle cartelle
esistenti.

**Struttura in due fasi:** la **Fase 1** valida l'intera catena (motore loop +
1 strumento FLAC da SFZ) all'ascolto su una nota tenuta lunga; il **render di
massa (Fase 2) parte SOLO se la Fase 1 suona pulita.**

---

## 0. Fatti accertati nello Step 0 (punto di partenza reale)

- **I set GM locali esistono già**: `public/sounds/{cello, choir_aahs,
  church_organ, clarinet, flute, french_horn, harpsichord, oboe, piano,
  string_ensemble_1, trumpet, violin}`, **88 mp3 ciascuno (~25 KB)**, naming
  `{Nota}{Ottava}.mp3`. Quindi questa spec **rimpiazza contenuti** in cartelle
  già esistenti (stesso naming/struttura), non costruisce da zero.
- **Naming note** = `midiToName(midi)` (GrandStaffEditor): bemolli
  `C,Db,D,Eb,E,F,Gb,G,Ab,A,Bb,B` + ottava `floor(midi/12)-1` → `A4`, `Db4`,
  `C8`. **Identico** al Salamander. Le chiavi strumento = **nomi delle cartelle**.
- **Caricamento on-demand, nessun range per strumento** nel codice (qualsiasi
  nota richiesta viene fetchata). Il range-limit è solo ottimizzazione di peso.
- **AudioService**: NON usa mai `source.loop`. Una nota tenuta più lunga del
  campione → il source finisce e **va in silenzio** (l'inviluppo HOLD tiene il
  gain ma senza segnale). Estensione **`.mp3` hard-coded** in 3 loader
  (`loadAudioFile`, `_loadInstrumentFile`, `_loadLayeredSample`).
- **ffmpeg locale**: `flac` ✅ e `libopus` ✅ presenti; **libvorbis ancora
  assente** (solo `vorbis` sperimentale). → FLAC è la strada pulita.
- **`decodeAudioData`** (Chromium/Electron) decodifica mp3/wav/**flac**/ogg.
- **Registry `VELOCITY_LAYERED`** generico, oggi solo il piano: estendibile a un
  velocity-layer selettivo (es. archi) senza modifiche strutturali.

---

## 1. Licenze e sorgenti

| Sorgente | Licenza | Uso commerciale closed-source | Attribuzione |
|---|---|---|---|
| **Sonatina Symphonic Orchestra** | CC0 | ✅ | non richiesta |
| **VSCO 2 Community Edition** | CC0 | ✅ | non richiesta |
| Salamander Grand Piano V3 | CC-BY 3.0 | ✅ (già in uso) | già in "Informazioni…" |
| Organo / Clavicembalo (fonte da scegliere) | **DA VERIFICARE** | ⚠️ | dipende |

- Preferire fonti **CC0 in formato SFZ** (Sonatina e/o VSCO2 CE). Scegliere **per
  famiglia** la migliore tra le due (sono entrambe CC0: si possono mischiare).
- ⚠️ **Blocco:** organo e clavicembalo NON vengono da queste fonti. Finché la
  licenza della fonte scelta non è verificata per uso commerciale +
  ridistribuzione, **lasciarli su fallback GM** (decisione separata, fuori da
  questa spec).

---

## FASE 1 — Validazione catena (motore + 1 strumento)

Obiettivo: dimostrare che **loop nel motore + FLAC da SFZ con loop point**
suonano puliti su una nota tenuta lunga. Niente render di massa qui.

### 1a. Intervento `loop` in `AudioService` (codice, minimo e localizzato)

**Design loop (semplice e robusto):** ogni nota dello strumento tenuto è
renderizzata come **attacco + corpo di sostegno loopabile** di durata fissa, con
il corpo già **crossfadato** così che `[loopStart .. fine]` sia un loop senza
giunta. Il motore quindi deve sapere solo **un valore per strumento**:
`loopStartSec` (inizio del corpo loopabile); `loopEnd = buffer.duration`.

1. **Nuovo registry** strumenti tenuti, accanto a `VELOCITY_LAYERED`:
   ```ts
   // Strumenti con campioni loopabili (attacco + sostegno crossfadato).
   // ext: formato file ('flac' per i nuovi set; 'mp3' resta il default storico).
   const SUSTAINED: Record<string, { loopStartSec: number; ext: 'flac' | 'mp3' }> = {
     string_ensemble_1: { loopStartSec: 1.0, ext: 'flac' }, // strumento di PROVA Fase 1 (loopStart oltre lo swell d'attacco)
   };
   ```
2. **Loader per estensione**: oggi i 3 loader hanno `.mp3` fisso. Renderli
   consapevoli del formato dello strumento (default `mp3`):
   - `_loadInstrumentFile(instrument, note)` → usa
     `SUSTAINED[instrument]?.ext ?? 'mp3'` per costruire il path locale; il
     fallback CDN GM resta `.mp3` (il CDN non ha i FLAC).
   - (Il piano `loadAudioFile`/`_loadLayeredSample` restano `.mp3`: NON toccare.)
3. **Applicare il loop** nelle DUE funzioni che creano il `BufferSource`:
   `playNoteForInstrument` e `playSustainedNote`. Subito dopo `source.buffer = …`:
   ```ts
   const sus = SUSTAINED[instrument];
   if (sus) {
     source.loop = true;
     source.loopStart = sus.loopStartSec;
     source.loopEnd = audioBuffer.duration; // corpo loopato fino alla fine
   }
   ```
   L'inviluppo esistente (HOLD a pieno fino a `noteEnd`, poi release 0.5 s) è già
   adatto: con `loop=true` la tenuta non si interrompe; alla fine il release
   chiude. `source.stop(noteEnd+release)` ferma comunque il loop.
4. **Niente altro** va toccato: `velocityToCutoff`/lowpass (resta per i
   mono-layer non in `SUSTAINED`), `velocityToGain`, gestione `activeSources`,
   fallback per-nota, registry `VELOCITY_LAYERED`/Salamander.

> Nota: tenere `playNoteForInstrument` (playback) e `playSustainedNote` (monitor
> live MIDI) **allineate**, o una nota lunga suonata dal vivo si spegne mentre il
> registrato no.

### 1b. Render dello strumento di prova → FLAC

Strumento consigliato: **`string_ensemble_1`** (il più usato come suono tenuto e
il "peggior offender" per gli accordi lunghi → se passa lui, passano tutti).

Pipeline offline (nuovo script `scripts/prepare-orchestra.mjs`, parallelo a
`prepare-salamander.mjs`, ma **render da SFZ** e **output FLAC**):
1. Sorgente SFZ CC0 (Sonatina o VSCO2 CE) per gli archi d'insieme.
2. **Render headless da SFZ** (es. `sfizz_render`/`sfizz` CLI, o renderer SFZ
   equivalente) per ogni nota del range, **usando i loop point nativi dell'SFZ**.
3. Produrre per ogni nota: **attacco + corpo di sostegno crossfadato** di durata
   fissa (es. ~2.0–2.5 s totali), così che `[loopStartSec .. fine]` sia un loop
   seamless. Annotare il `loopStartSec` usato (→ deve combaciare col registry).
4. **Trim** del solo silenzio iniziale (mantenere l'attacco) e finale.
5. **LUFS**: normalizzare a un target di integrated loudness (es. −18 LUFS) — da
   tarare poi a orecchio contro il piano Salamander.
6. **FLAC** (lossless): `ffmpeg -i in.wav -c:a flac out.flac` (mono accettabile
   per gli insieme tenuti; valutare stereo solo se serve l'immagine).
7. Naming **esatto** `{Nota}{Ottava}.flac` (stessa convenzione `midiToName`).
8. Output **in-place** in `public/sounds/string_ensemble_1/` (FLAC accanto/al
   posto degli mp3; con `ext:'flac'` nel registry il loader caricherà i FLAC).

### 1c. GATE di verifica Fase 1 (bloccante)

Nell'app (A/B contro il GM attuale), con `string_ensemble_1` su una voce:
- ✅ **Nota tenuta lunga** (semibreve a tempo lento / fermata / accordo SATB
  tenuto): **niente silenzio o taglio** — il sostegno regge per tutta la durata.
- ✅ **Nessun click/buco** al punto di loop (FLAC sample-accurate + crossfade).
- ✅ **Timbro** accettabile su tutto il range (no formanti "stirate": se un
  registro suona finto → campionare più fitto / ridurre lo shift in render).
- ✅ **Livello** coerente con il piano e tra le note (LUFS ok).
- ✅ **Monitor live MIDI** di una nota tenuta a lungo coerente col registrato.

**Solo se TUTTI i punti passano** si procede alla Fase 2. Altrimenti si itera su
loopStartSec / crossfade / LUFS / densità di campionamento.

### 1d. Esito Fase 1 (implementato, gate superato a orecchio)

Deltas rispetto al piano qui sopra, da tenere presenti per la Fase 2:

- **Loop NON è un crossfade a durata fissa.** VSCO2 CE non ha loop point e gli
  archi hanno vibrato → un crossfade cieco dava click + gradino di volume. La
  durata del loop è **trovata** per nota da `scripts/_make_loop.py`, che separa i
  due difetti: (1) **click** = fase della fondamentale (correlazione su finestra
  corta, declick); (2) **gradino** = fase dell'**inviluppo del vibrato** (loopEnd
  allo stesso punto del ciclo: stesso valore *e* stessa pendenza). Più: guardia
  "nota ferma" (se non c'è vibrato la fase è rumore → decide la fondamentale) e
  **rampa di pareggio livello** sulla stessa finestra 0.1 s del seam. Risultato:
  loop 2.4–3.8 s per nota, `loopStartSec = 1.0`, 32 FLAC G3–D6.
- **Bilanciamento = mappa di gain nel motore, NON LUFS per-strumento.** I FLAC
  restano a un **riferimento comune** (−18 LUFS); la bilancia orchestrale vive in
  `INSTRUMENT_GAIN` (AudioService): `string_ensemble_1: 0.32` (≈ −10 dB) per
  pareggiare l'attacco del piano. Vantaggio: mix in un solo punto, tarabile a
  orecchio **senza ri-renderizzare**; ogni strumento Fase 2 userà lo stesso trim.
  → In Fase 2 NON serve un LUFS diverso per strumento: render tutti a −18 e si
  bilancia con `INSTRUMENT_GAIN`.
- **Pipeline reale per nota** (`prepare-orchestra.mjs`): MIDI 1-nota →
  `sfizz_render` → `_make_loop.py` (loop-finder + rampa + crossfade declick) →
  misura loudness + **gain costante** (loop-safe, non loudnorm dinamico) → FLAC.

---

## FASE 2 — Render di massa (solo dopo Fase 1 pulita)

1. **Stessa pipeline** della Fase 1 applicata a tutti gli strumenti tenuti, con
   **sostituzione in-place** delle cartelle esistenti e **aggiunta** delle
   mancanti, riconciliando i nomi alle chiavi reali:
   - Esistenti da rimpiazzare: `cello, choir_aahs, clarinet, flute, french_horn,
     oboe, string_ensemble_1, trumpet, violin`.
   - Da aggiungere (oggi su CDN GM): `viola, contrabass, bassoon, trombone, tuba,
     timpani, pizzicato_strings` **— ma SOLO con le chiavi GM esatte usate
     dall'app** (verificare il nome chiave reale prima di creare la cartella, o i
     file finiscono in path non letti).
   - `church_organ`, `harpsichord`: **NON** in questa spec (blocco licenza →
     restano sui campioni attuali/GM finché la fonte non è verificata).
   - `acoustic_grand_piano`/`piano_salamander`/`piano`: **NON toccare**.
2. **Range-limit per strumento** (no violino sotto Sol3, no contrabbasso sopra il
   registro utile, ecc.): genera solo le note realistiche → meno peso. (Il motore
   non si rompe per le note mancanti: fallback per-nota.)
3. **Ogni strumento tenuto** va aggiunto al registry `SUSTAINED` con il suo
   `loopStartSec` e `ext:'flac'`. Strumenti percussivi/decadenti (es. `timpani`,
   `pizzicato_strings`) NON in `SUSTAINED` (one-shot, niente loop) → restano mp3
   o FLAC senza loop.
4. **Velocity-layer selettivo (opzionale)**: per i 2–3 strumenti più presenti nei
   preset (es. `string_ensemble_1`) valutare 2–3 layer via `VELOCITY_LAYERED`
   (la logica è già pronta: file `{nota}_v{n}.flac` + una riga nel registry).
   Tutti gli altri restano mono-layer (il lowpass velocity→timbro li copre).
5. **LUFS cross-strumento**: target unico per tutto il set (no coro flebile vs
   tromba che spara).
6. **Script di verifica**: tutte le note del range presenti, decodificabili,
   durata utile/loop corretti, loudness entro tolleranza.
7. **Peso bundle/installer**: misurare la somma dei nuovi asset; se eccessiva,
   stringere i range, valutare mono, o lasciare su GM gli strumenti rari.

---

## File toccati

- **Codice (Fase 1, minimo):** `src/services/AudioService.ts` — registry
  `SUSTAINED`, loader per-estensione (3 punti), `source.loop` nelle 2 funzioni di
  play. Nessun'altra logica.
- **Asset:** `scripts/prepare-orchestra.mjs` (**nuovo**) e i contenuti di
  `public/sounds/{instrument}/` (FLAC).
- **Menu "Informazioni…":** attribuzione solo se una fonte la richiede (Sonatina
  e VSCO2 sono CC0 → nessuna; organo/clavicembalo se inclusi in futuro).

## NON toccare
- ❌ Piano Salamander (`acoustic_grand_piano` / `piano_salamander` / `piano`) e il
  registry `VELOCITY_LAYERED` del piano.
- ❌ Inviluppo/gain/`activeSources`, fallback CDN GM, lowpass per i mono-layer.
- ❌ Motore di analisi, editor, qualunque cosa non audio.

---

## Rischi e mitigazioni (dal codice reale)

1. **Loop non seamless → click.** Mitigazione: FLAC sample-accurate + corpo
   crossfadato in render; `loopStartSec` allineato tra render e registry. È il
   motivo del GATE 1c prima del render di massa.
2. **Pitch-shift/formanti su registri estremi.** Mitigazione: render da SFZ con
   multicampionatura nativa; range-limit; campionare più fitto dove serve.
3. **Loudness incoerente.** Mitigazione: LUFS integrato cross-strumento.
4. **Peso installer.** Mitigazione: mono, range-limit, lazy-load già presente,
   GM-fallback per strumenti rari.
5. **Chiavi/naming sbagliati → file non letti.** Mitigazione: usare ESATTAMENTE
   `midiToName` e le chiavi-cartella reali; verificare i nomi delle cartelle
   nuove prima di generare.
6. **Monitor live vs registrato.** Mitigazione: stesso loop in
   `playSustainedNote` e `playNoteForInstrument`.

## Definizione di "fatto"
- Fase 1: lo strumento di prova regge una nota tenuta lunga senza silenzi né
  click, livello coerente, monitor live coerente. Commit separato (codice loop +
  asset di prova).
- Fase 2: tutti gli strumenti previsti sostituiti/aggiunti, verifica script +
  A/B, piano Salamander invariato, peso entro target. Commit (o commit per
  famiglia, per poter annullare un singolo strumento).

---

## Esito Fase 2A (implementato)

Deltas rispetto al piano della Fase 2, dall'implementazione reale:

- **Ambito reale = solo i 12 strumenti esposti** da `src/constants/instruments.ts`
  (`gmToSoundfont`). viola/contrabass/trombone/tuba/timpani/pizzicato NON sono
  selezionabili (cadono sul piano) → spostati alla **Fase 2B** (estendere il
  selettore). Rimpiazzati 9 strumenti tenuti: `string_ensemble_1, cello, violin,
  flute, oboe, clarinet, trumpet, french_horn, church_organ`. `choir_aahs` e
  `harpsichord` **restano GM** (nessuna fonte in VSCO2 CE). `church_organ` invece
  **si è potuto fare** (VSCO2 CE ha l'organo, CC0 → il "blocco licenza" era errato).
- **Loop = "campione lungo + loop SOLO in coda"** (riscrittura di `_make_loop.py`).
  Si tiene il campione naturale fino a `cap ~8s`; le note ≤ durata-file suonano
  naturali, SENZA loop né giunta (come i sampler veri); il loop scatta solo per
  tenute estreme. Motore invariato (loopStart fisso, loopEnd=durata). Questo ha
  superato il limite del crossfade-loop corto, che dava "toc" percepibili.
- **violin = violino SOLO** (`SViolinVib`), distinto da `string_ensemble_1` (la
  sezione). I sorgenti solisti avevano **cambi d'arco** incisi (toc ~ogni pochi s):
  ripuliti a mano in Logic (taglia+crossfade) sui 15 file `_f`, poi ri-renderizzati.
- **Mono** (downmix): per un tutor armonico lo stereo non serve → asset ~93MB
  invece di ~192MB. **Tutti a −18 LUFS**, bilanciati con `INSTRUMENT_GAIN` (0.32).
- **In-place**: rimossi i vecchi `.mp3` GM dalle 9 cartelle (mai letti per gli
  strumenti SUSTAINED: il loader prova `.flac` locale → poi CDN).

## Fase 2B (da fare)
Aggiungere strumenti nuovi (viola, contrabass, bassoon, trombone, tuba, pizzicato):
estendere `INSTRUMENTS` in `src/constants/instruments.ts` + etichette i18n
`instrument_<key>` + render con la stessa pipeline. Commit separato.
