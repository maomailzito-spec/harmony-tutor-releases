# Novità dalla versione 1.0.17 in poi

> Documento di lavoro per l'aggiornamento del manuale. Raccoglie le nuove
> funzioni, le modifiche e i fix introdotti **dopo** il tag `v1.0.17`
> (24 mag 2026) fino al rilascio **1.1.0** (giu 2026). Le sezioni 1–14
> coprono il lavoro fino al 5 giu; le sezioni 15–22 gli aggiornamenti di
> giugno confluiti nella 1.1.0.
>
> Nota: il tag `v1.0.17` conteneva solo fix di licenza, quindi il confine è
> netto. La versione reale è gestita dai **tag git**; con la 1.1.0 il
> `package.json` è stato allineato a `1.1.0`.

---

## 1. Mixer unificato (finestra flottante)

**Cos'è.** Una finestra mixer flottante e trascinabile che unisce in un unico
pannello le 4 voci del corale SATB e tutte le tracce di accompagnamento (ACC).
Sostituisce il vecchio mixer a barra laterale (che "scivolava" insieme al
pentagramma).

**Cosa fa / come si usa.**
- Si apre dal pulsante **"Mixer"** in toolbar (nuovo gruppo `mixer`); la
  finestra si trascina liberamente.
- Ogni canale è una strip verticale con: **selettore strumento**, **fader
  volume**, **mute**, **solo**.
- Le tracce ACC hanno in più: **toggle visibilità**, pulsante **"+ Nuova"**
  (aggiunge una traccia), **nome modificabile** inline (utile per etichette
  d'orchestrazione), **selettore di rigo/chiave** e **color picker**.
  Eliminazione traccia con **tasto destro** sulla strip.
- **Mute / Solo / Volume agiscono in tempo reale** durante la riproduzione
  (prima richiedevano stop/play).
- **Persistenza:** strumenti, volumi e mute delle voci SATB + le tracce ACC
  (incluso il solo) vengono salvati nel file di progetto e ripristinati
  all'apertura. I file vecchi senza questi campi ripartono dai default
  (pianoforte, volume 1, nessun mute).
- **Fader stile console (look DAW):** ogni canale ha un fader verticale con
  scanalatura incisa, "cappello" del cursore e **scala dB** a lato; la corsa usa
  una curva audio dolce (≈ −19 dB a 1/3, −5 dB a 3/4, 0 dB in cima) così la metà
  bassa resta utilizzabile, e il livello è mostrato in **dB**
  (0 dB = unità, −∞ in fondo). Il riempimento del fader usa il colore del
  canale (accent SATB / colore traccia). Accanto al fader una colonna di
  **LED di segnale** (20 segmenti con rampa di colore continua verde → giallo →
  arancio → rosso e peak-hold) mostra il livello d'uscita in tempo reale:
  più il segnale è forte, più salgono i segmenti rossi. I LED si accendono
  durante la riproduzione, durante il **monitoraggio** e in **ingresso** mentre
  si registra (il segnale di monitoraggio passa per il gain della traccia). Il
  volume salvato resta un gain lineare 0..1: l'audio non cambia, cambia solo la
  resa.

**Dove.** `src/components/MixerPanel.tsx` (nuovo), catalogo strumenti condiviso
`src/constants/instruments.ts` (nuovo), wiring/gain per-voce in
`src/components/GrandStaffEditor.tsx`, persistenza in
`src/controllers/grandStaffProjectIOAdapter.ts`. Il vecchio `TrackMixerPanel.tsx`
è stato rimosso.

### 1a. Colore per traccia
Ogni traccia ACC può avere un **colore**: appare come banda verticale a sinistra
del suo rigo e, in modalità colore, le sue note vengono disegnate in quel colore
(le voci SATB mantengono i colori fissi). Il fader della strip si tinge dello
stesso colore. Campo `color` su `AccompanimentTrack`.

### 1b. Rigo/chiave configurabili per traccia
Ogni traccia ACC può essere un **grandstaff** (violino+basso con graffa)
**oppure un singolo rigo** in una delle chiavi supportate (violino, basso,
soprano, contralto, tenore). Il rendering disegna **un blocco di rigo per
traccia** anziché un unico rigo condiviso. Selettore nel Mixer. Campi
`clef`/`staffMode` su `AccompanimentTrack` in `src/types.ts`; layout in
`src/components/VexflowGrandStaff.tsx`.

---

## 2. Tracce di accompagnamento (ACC) — fondamenta + editing manuale

**Cos'è.** Tracce di accompagnamento indipendenti dal corale SATB, per scrivere
orchestrazioni / linee strumentali accanto alle 4 voci.

**Cosa fa / come si usa.**
- Si aggiunge dal Mixer ("+ Nuova").
- **Inserimento manuale**: clic sul rigo della traccia inserisce la nota su quel
  rigo; input da tastiera/MIDI (step) va alla **traccia ACC attiva**. Lo snap
  dell'attacco è limitato all'ottavo, così quarti/metà si possono mettere anche
  **sul levare** (off-beat).
- **Pause**: il tasto **R** alterna nota/pausa (anche con traccia ACC visibile);
  l'inserimento della pausa rispetta la chiave del rigo.
- **Polifonia preservata**: inserire una nota non cancella più le note ad
  attacchi diversi che si sovrappongono in durata (es. una nota tenuta sotto
  note in movimento resta). Seconde/unisoni con durate diverse vengono spostate
  orizzontalmente per non sovrapporsi graficamente.
- **Notazione consapevole dell'accordo**: la **legatura di valore** lega ogni
  nota dell'accordo alla stessa altezza dell'accordo adiacente; il **pedale
  (let ring)** è ora un'azione sulla selezione (le note selezionate risuonano
  fino all'attacco successivo); il **beam** in toolbar si estende all'intero
  accordo (serve ≥2 attacchi).

**Dove.** `src/components/GrandStaffEditor.tsx`, `src/components/VexflowGrandStaff.tsx`,
`src/types.ts`, `src/hooks/useGrandStaffMidi.ts`, `src/services/AudioService.ts`.

### 2a. Pattern di inserimento (Block / Arpeggi)
Quando il rigo attivo è un'ACC, in toolbar compaiono 4 pulsanti per il **pattern
di inserimento accordi**: **Bl** (Block Chords), **Ar▲** (Arpeggio Up), **Ar▼**
(Arpeggio Down), **Brk** (Broken / boom-chick). Implementato in
`src/components/GrandStaffToolbar.tsx` e `src/components/GrandStaffEditor.tsx`.

---

## 3. Registrazione MIDI in tempo reale + quantizzazione

**Cos'è.** Registrazione MIDI dal vivo nelle tracce ACC, con quantizzazione
configurabile.

**Cosa fa / come si usa.**
- **Pulsante REC** in toolbar (cerchio rosso). Workflow: **Shift+R** arma/disarma
  la registrazione (solo se c'è una traccia ACC visibile), poi **Spazio** avvia
  (con count-in; il pulsante pulsa arancione durante il pre-conteggio, rosso
  durante la registrazione). Premere di nuovo per fermare. Se non c'è una traccia
  ACC il REC è disabilitato.
- **Griglia di quantizzazione** (menu a tendina in toolbar): **1/16, 1/8, 1/4,
  1/2** e le terzine **1/8 T, 1/4 T**. Default 1/16.
- **Quantizzazione "dura" + estensione all'attacco successivo**: assorbe i buchi
  di staccato senza creare note/pause spurie.
- **Terzine esplicite** (griglie 1/8 T, 1/4 T) al posto del riconoscimento
  automatico inaffidabile.
- **Q selettiva**: ri-quantizza **solo le note selezionate** lasciando il resto
  invariato → misure miste binario/terzine possono coesistere. Pulsante **"Q"**
  per quantizzare la traccia ACC.
- **Livello di monitoraggio coerente** (fix): quando si lavora su una traccia
  ACC (in registrazione o con l'area accompagnamento attiva) il monitoraggio
  suona con lo **stesso strumento e volume** che avrà la nota in playback,
  attraverso il gain della traccia. Prima usava il piano interno (più forte dei
  soundfont), perciò il "live" risultava molto più forte del registrato.
- **Inviluppo "pieno" per piano ACC e SATB** (fix): il playback delle note di
  pianoforte (sia ACC sia voci SATB) usa ora un inviluppo *attacco istantaneo +
  mantieni-a-volume + rilascio* invece del vecchio calo lineare su tutta la durata:
  la nota resta piena per tutta la sua lunghezza (non più sorda/spenta) e mantiene
  il transiente d'attacco naturale (che scala con la velocity). SATB e ACC condividono
  ora lo **stesso suono di pianoforte** (Salamander, vedi sotto), in playback e in
  monitoraggio.
- **Monitoraggio = nota reale** (fix): suonando dal vivo (ACC o SATB), il
  monitoraggio parte sul note-on e si ferma sul note-off con lo **stesso
  strumento, volume, gain e inviluppo** del playback. Così ciò che si sente dal
  vivo coincide **esattamente** (livello, attacco e durata) con ciò che viene
  registrato. Il monitoraggio/registrazione segue la **traccia ACC cliccata**
  (non più sempre la prima visibile).
- **Niente "scatto" sulla ri-pressione** (fix): ripremendo rapidamente la stessa
  nota, la coda di rilascio precedente viene tagliata in ~20 ms prima della nuova,
  evitando la sovrapposizione di due copie identiche del campione (comb filtering).
- **Dinamica timbrica (filtro velocity→timbro)** [sperimentale]: poiché i
  campioni hanno un solo layer di velocity (la velocity scala solo il volume, non
  il timbro come negli strumenti multi-campione tipo Logic), le note ACC passano
  per un passa-basso pilotato dalla velocity: piano = più scuro/rotondo, forte =
  più aperto/brillante. È un'approssimazione tarabile (`velocityToCutoff` in
  `AudioService.ts`), non sostituisce campioni multi-velocity.
- I **LED di segnale** si muovono anche **suonando senza registrare** (conferma
  del segnale d'ingresso), oltre che durante la riproduzione.

**Dove.** `src/hooks/useRealtimeRecording.ts` (nuovo),
`src/components/GrandStaffToolbar.tsx`, `src/components/GrandStaffEditor.tsx`.

---

## 4. Dinamiche (velocity)

**Cos'è.** Le note hanno ora una **velocity** che incide su riproduzione ed export.

**Cosa fa.** La velocity viene letta dall'import MIDI e dalla registrazione dal
vivo, usata per una **riproduzione espressiva**, per il **monitoraggio live** e
l'**output MIDI esterno** sensibili alla dinamica, e mantenuta fedelmente
nell'**export MIDI**. Campo `velocity` su `StaffNote` in `src/types.ts`.

---

## 5. Import MIDI migliorato

**Cosa fa / come si usa.** Importando un MIDI di pianoforte in una traccia di
accompagnamento:
- **Separazione automatica delle voci**: la mano destra viene resa come due voci
  (come in un editor di notazione), senza dover pre-dividere le tracce in una
  DAW. Massimo 2 voci per rigo, con gambi fissati (v1 su / v2 giù).
- **Assegnazione della chiave per traccia MIDI** (traccia bassa → rigo di basso),
  così una nota grave della mano destra non finisce sul rigo di basso.
- **Quantizzazione consapevole delle terzine**, **legature attraverso la
  stanghetta** (una nota tenuta sopravvive alla misura successiva), **conteggio
  misure** corretto anche per import di sole tracce ACC.

**Dove.** `src/utils/midiParser.ts`, `src/hooks/useGrandStaffMidi.ts`,
`src/components/VexflowGrandStaff.tsx`.

---

## 6. Output MIDI esterno

**Cos'è.** Possibilità di pilotare uno strumento/DAW esterno via MIDI invece del
piano interno.

**Cosa fa / come si usa.** Quando è selezionato un output MIDI esterno, il **piano
interno (Web Audio) tace** e si monitora dalla DAW; i **CC** (es. pedale di
sustain CC64) vengono inoltrati per evitare note bloccate. Lo scheduler usa una
finestra di lookahead da 100 ms (tick 50 ms) e, allo stop, esegue il flush
esplicito dei note-off pendenti. È stato aggiunto anche un **pulsante ⚠** per
nascondere/mostrare gli avvisi di misure incomplete. Implementato in
`src/components/GrandStaffEditor.tsx`.

---

## 7. Analisi armonica guidata dall'accompagnamento

**Cos'è.** Le note di accompagnamento ora **non entrano automaticamente**
nell'analisi armonica (prima la sigla "saltava" perché l'euristica del basso
indovinava). L'utente decide chirurgicamente quali note ACC sono strutturali.

**Cosa fa / come si usa.**
- **Opt+H** marca la/le nota/e ACC selezionata/e come **strutturale**: solo
  allora partecipa sia al numero romano sia alla sigla dell'accordo. Per default
  le note ACC "suonano e basta".
- **Opt+Shift+H** (≥2 note selezionate) collassa una selezione sparsa — anche un
  arpeggio su più movimenti — in **un unico accordo sotto la testina di
  lettura**, sopprimendo gli attacchi intermedi; funziona anche per accordi di
  sola ACC.
- L'**analisi è ora disaccoppiata** dalla visibilità e dal mute della traccia ACC.
- **Cifratura del basso e rivolti** seguono la nota ACC marcata (es. SATB A‑C +
  ACC F marcato → ii, Dm7/F).
- I marchi per-nota **sopravvivono al copia/incolla** tra tracce.

**Dove.** `src/components/GrandStaffEditor.tsx`, `src/hooks/useHarmonyLabels.ts`.

---

## 8. Copia/incolla cross-track (SATB ⇄ ACC)

**Cos'è / come si usa.** Il copia/incolla ora funziona tra qualsiasi traccia.
- **Destinazione = traccia attiva**: un **clic semplice** sul rigo di una traccia
  ACC (o sul rigo SATB) la imposta come destinazione e posiziona il cursore dove
  hai cliccato, senza inserire nulla. Quindi: copia → clic dove vuoi → incolla.
- Le note vengono **convertite alla destinazione**: in ACC diventano voce 0 con
  la chiave della traccia (o split treble/bass se grandstaff); in SATB prendono
  la voce e la chiave selezionate.
- **Copia robusta** anche di selezioni ACC e **terzine**.

**Dove.** `src/components/GrandStaffEditor.tsx`.

---

## 9. Ritardando / Accelerando (curve di tempo) su accompagnamento

**Cos'è / come si usa.** **Alt+Shift+R** crea una curva di tempo
(rallentando/accelerando) dalla selezione. Ora funziona anche partendo da una
**selezione in una traccia ACC** e su **file caricati** (prima il marcatore
appariva ma su file con legature non si sentiva il rallentamento). Il marcatore
si posiziona sopra il rigo ACC corretto.

**Dove.** `src/hooks/useGrandStaffMidi.ts`, `src/components/GrandStaffEditor.tsx`.

---

## 10. Scroll / playback più fluidi

Durante la riproduzione lo **scroll automatico scatta solo al cambio di rigo
(sistema)**, non a ogni tick: si può **scorrere liberamente** mentre un rigo
suona (niente più "rimbalzi"), e al cambio di rigo viene rivelato **l'intero
sistema** — numeri romani e righi di accompagnamento inclusi — allineandolo in
alto. `src/components/GrandStaffEditor.tsx`.

---

## 11. Menu "Informazioni…"

Nuova voce **"Informazioni su Harmony Tutor…"** nel menu Aiuto (IT/EN): mostra
nome app, **versione**, copyright e URL del sito. Su macOS si integra nell'About
automatico; su Windows è l'**unico modo** per leggere la versione installata.
Il dialog è correttamente localizzato in **entrambe le lingue** (IT/EN).

Aggiunto anche un automatismo CI (in `release.yml`) che aggiorna a ogni release
i link di download e l'etichetta "Versione attuale: vX.Y.Z" mostrata **sul
sito**. Nota: originariamente aggiornava **solo la pagina italiana**
(`index.html`); ora il workflow aggiorna anche la pagina inglese (`en.html`).
Perché la versione compaia su `en.html` è però necessario che la pagina
contenga l'elemento `<strong>vX.Y.Z</strong>` (es. "Current version:
<strong>v1.0.17</strong>") — da aggiungere nel repo del sito
`maomailzito-spec/harmonytutor`.

---

## 12. Fix / migliorie minori (rivolte all'utente)

- **Selezione note vicine**: cliccando la più alta di due note ravvicinate ora
  viene selezionata la testina **sotto il cursore**, non quella il cui
  gambo/alterazione invade l'area.
- **Chiavi antiche SATB**: note nascoste da un `clefOverride` ora si vedono
  correttamente sui righi in chiave di Do.
- **Note puntate**: fix gestione note puntate.
- **Undo**: correzioni alla cronologia annulla.
- **Riposizionamento hint / fader**: correzioni al posizionamento degli hint +
  voci aggiunte alle Preferenze.

---

## 13. Licenza (fix — soprattutto Windows)

- Su Windows, l'attivazione da trial scaduto chiudeva la finestra senza messaggi:
  ora un flag blocca `app.quit()` durante il flusso di attivazione.
- Corretto `exposeInWorld` → `exposeInMainWorld` nel preload del dialog chiave
  (in v1.0.15 il preload falliva in silenzio e la chiave non veniva trasmessa).
- Riscritta la trasmissione della chiave via IPC per eliminare una race condition
  + dialog di errore esplicito su attivazione fallita.
- Voce **"Gestisci Licenza" sempre visibile** nel menu, non solo durante il trial.

**Dove.** `electron/main.js`, preload e dialog chiave.

---

## 14. Sotto il cofano — riscrittura "spelling-first" del riconoscimento accordi

Non è una funzione visibile ma **cambia il comportamento dell'analisi**:

- Nuovo motore di riconoscimento accordi **basato sullo spelling**
  (`src/engine/spelledChordEngine.ts`): migliora la correttezza enarmonica
  (es. E#°7 in Do# minore non più letto come D° enarmonico; F#°7 in Do maggiore
  → vii°/V corretto).
- Analisi dei numeri romani **letter-first** e spelling-aware (naming corretto
  sul lato diesis/bemolle in base alla tonalità d'impianto).
- **File vecchi**: alcuni file salvati con versioni precedenti hanno note con
  spelling incoerente (es. pitch "C" con MIDI 61 = C#). Il vecchio motore lo
  mascherava, il nuovo lo **espone visivamente**. Script di migrazione:
  `scripts/respell-notes-file.ts`
  (`tsx scripts/respell-notes-file.ts <file.htp|cartella> [--dry-run] [--no-backup]`).
- Numerosi fix di correttezza su **modulazioni/sequenze/tonicizzazioni** che
  impattano l'etichettatura di brani specifici, non l'uso quotidiano.

---

# Aggiornamenti giugno 2026 (verso la 1.1.0)

> Lavoro successivo al 5 giugno, incluso nel rilascio **1.1.0**.

## 15. Traccia di batteria (percussioni)
Nuova traccia ACC di **batteria** (MIDI canale 10): notazione standard (chiave di
percussione, teste ✕ per piatti/charleston), kit **orchestrale** o **rock**,
inserimento col mouse sul rigo e da un **modulo percussioni flottante** (toggle 🥁
in toolbar).

## 16. Mixer — fader master, menu "+", canale MIDI
- **Tre fader MASTER**: gruppo **SATB**, gruppo **ACC** e **MIX** globale, con
  routing gerarchico (canale → master di gruppo → master globale), LED di livello
  propri e i tre valori salvati nel progetto.
- Pulsante **"+"** unico nell'header TRACCE che apre un menu (*Nuova traccia* /
  *Batteria*), al posto dei due bottoni separati — area dei fader più pulita.
- **Selettore di canale MIDI in uscita** per ogni voce e traccia (Auto, oppure un
  canale fisso 1–16; con Auto: voci 1–4, tracce ACC dal 5 in su, batteria sempre 10).

## 17. Strumento dalla toolbar anche per le ACC + multi-selezione
Il selettore strumento in toolbar ora agisce anche sulla **traccia ACC attiva** (non
solo sulle voci SATB) e, se sono selezionate note appartenenti a **più voci/tracce**,
applica lo strumento a **tutte** in una sola volta.

## 18. Chiavi traspositrici (8vb)
Per le tracce a rigo singolo: opzioni **"𝄞 Chitarra (8vb)"** e **"𝄢 Basso (8vb)"** —
la notazione mostra un "8" sotto la chiave e il suono è **un'ottava sotto** lo scritto
(chitarra, contrabbasso/basso elettrico). La notazione resta invariata; campo
`octaveTranspose` su `AccompanimentTrack`.

## 19. Copia un'INTERA voce SATB
Copia tutte le note di una voce nell'intero brano in un colpo solo (per incollarle in
blocco su una traccia ACC → orchestrazione): **tasto destro** sui pulsanti S/A/T/B,
oppure scorciatoia **⇧⌘/Ctrl+C**.

## 20. Nuovo progetto con scelta tracce e template
Creando un nuovo progetto si apre un dialog: rigo **SATB** on/off, aggiunta di
strumenti/batteria iniziali, e **template** salvabili/ricaricabili (conservati
localmente, offerti a ogni nuovo progetto).

## 21. Suoni — sezione ritmica (bassi)
Aggiunti **contrabbasso pizzicato**, **basso elettrico (dita)** e **basso elettrico
(plettro)** come strumenti selezionabili (campioni one-shot locali).

## 22. Motore d'analisi della 1.1.0 (nota di rilascio)
La 1.1.0 adotta il **motore spelling-first** della riscrittura. I 16 hotfix d'analisi
usciti su `releases` dopo la 1.0.17 sono stati verificati uno per uno in fase di
merge: la maggior parte è già gestita dal nuovo motore con una sua implementazione;
**due** sono stati ri-applicati esplicitamente — *tonalità locale nella descrizione
della cadenza* e *sensibile libera sulla cadenza d'inganno V→vi*. Suite di
regressione alla baseline del refactor, **nessuna regressione introdotta**.

## 23. Export MIDI e stampa/PDF
- **Program Change nell'export MIDI su file**: il `.mid` esportato ora scrive, per
  ogni voce SATB, il Program Change con lo **strumento assegnato** nel mixer (GM),
  sia in multi-traccia (Type 1) sia in traccia unica (Type 0). Prima il file
  conteneva solo nomi traccia + note, e in una DAW partiva tutto su pianoforte.
- **Stampa/PDF — niente righi tagliati**: un esercizio lungo non viene più spezzato
  a metà su un rigo tra una pagina e l'altra (`break-inside: avoid` sui sistemi).
- **Guida ai salti pagina (opzionale)**: nuovo interruttore **"Mostra salti pagina"**
  nel menù ⋯ (sezione *Format*), spento di default. Acceso, mostra un separatore
  tratteggiato **"▽ Pagina N"** negli spazi tra i righi, dove cadrebbe il taglio
  pagina A4, così si regola il layout (misure per riga) senza dover stampare alla
  cieca. Segue l'orientamento Page/Landscape. È una stima (l'impaginazione vera
  resta quella del motore di stampa) e non compare in stampa/PDF.

---

# Scorciatoie da tastiera — novità dalla 1.0.17

## Registrazione MIDI (tracce ACC)
| Scorciatoia | Azione | Stato |
|---|---|---|
| **Shift + R** | Arma / disarma / ferma la registrazione (solo con una traccia ACC visibile) | 🆕 nuova |
| **Spazio** | Avvia la registrazione una volta armata (con count-in); altrimenti Play/Pausa | contesto |

## Inserimento / editing nelle tracce ACC
| Scorciatoia | Azione | Stato |
|---|---|---|
| **+** | Aggiunge una **nuova traccia ACC** vuota (come il pulsante "+ Nuova" del Mixer); funziona anche col **+** del tastierino numerico | 🆕 nuova |
| **R** | Alterna **pausa / nota** (anche con traccia ACC visibile) | ✳️ cambiato — prima R avviava la registrazione |
| **.** (punto) | Attiva/disattiva il valore **puntato** | contesto |
| **b / n / # (à)** | Bemolle / bequadro / diesis sulla nota | contesto |

## Analisi armonica (note ACC)
| Scorciatoia | Azione | Stato |
|---|---|---|
| **Opt + H** | Marca la/le nota/e selezionata/e come **strutturale** → entra nell'analisi (numero romano + sigla) | 🆕 nuova |
| **Opt + Shift + H** | Collassa la selezione (≥2 note, anche un arpeggio) in **un unico accordo sotto la testina di lettura** | 🆕 nuova |

## Tempo
| Scorciatoia | Azione | Stato |
|---|---|---|
| **Alt + Shift + R** | Crea una curva di **rallentando / accelerando** dalla selezione (ora anche da selezioni ACC e su file caricati) | ✳️ esteso |

## Marcatura ornamenti (⌥ + lettera, senza Shift; richiede ≥1 nota selezionata)
| Scorciatoia | Tipo |
|---|---|
| **Opt + H** | structural (strutturale / nota d'accordo) |
| **Opt + P** | passing (nota di passaggio) |
| **Opt + A** | appoggiatura |
| **Opt + V** | neighbor (nota di volta) |
| **Opt + R** | suspension (ritardo) |
| **Opt + S** | escape (sfuggita) |
| **Opt + C** | cambiata |
| **Opt + N** | anticipation (anticipazione) |
| **Opt + O** | ornamental (ornamentale) |

## Azioni senza scorciatoia (solo da interfaccia)
- **Mixer**: pulsante "Mixer" in toolbar; "+ Nuova" per aggiungere una traccia
  ACC (anche col tasto **+**); tasto destro sulla strip per eliminarla.
- **Pattern di inserimento ACC** (Bl / Ar▲ / Ar▼ / Brk): pulsanti in toolbar,
  visibili solo quando il rigo attivo è un'ACC.
- **Quantizzazione**: menu a tendina griglia (1/16, 1/8, 1/4, 1/2, 1/8 T, 1/4 T)
  + pulsante **Q** (quantizza la traccia, o solo le note selezionate).
- **Scelta destinazione incolla**: clic semplice sul rigo della traccia (ACC o
  SATB) di destinazione.
- **Avvisi misure incomplete**: pulsante **⚠** per nascondere/mostrare.

> Nota: su layout di tastiera diversi, `#` può arrivare come `à`, e il tasto
> **.** può emettere `>` con Shift — l'app accetta entrambi.
