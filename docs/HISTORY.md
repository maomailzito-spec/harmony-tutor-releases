# Harmony Tutor — Storia & Indice della documentazione

> **Scopo**: ritrovare velocemente decisioni, fix e chiarimenti del passato e
> avere una visione d'insieme dell'evoluzione dell'app. Cerca per **data** o per
> **parola chiave nel titolo**; ogni voce rimanda al file di dettaglio.
>
> Esempio d'uso reale: *"c'è qualcosa sulle regressioni dim7 / `vii°/♭III`?"* →
> voce **2026-04-22**.
>
> 📦 Tutti i documenti grezzi/storici sono in **[`archive/`](archive/)** — niente
> è stato cancellato, solo riordinato (e tutto resta comunque nella storia git).
> Questo file è un **catalogo**, non una riscrittura: i dettagli stanno nei file.

---

## 📄 Documenti attuali (stato corrente dell'app) — in `docs/`

| Argomento | File |
|---|---|
| **Funzioni nuove dalla 1.0.17** (ACC, mixer, registrazione MIDI, dinamiche, audio/Salamander) | [novita-post-1.0.17.md](novita-post-1.0.17.md) |
| **Pianoforte Salamander** (piano tecnico multi-velocity) | [piano-salamander-plan.md](piano-salamander-plan.md) |
| **Catalogo regole/eccezioni/ornamenti/cadenze** dell'analisi | [rule-descriptions-catalog.md](rule-descriptions-catalog.md) |
| **Spec accordi di nona** di dominante | [SPEC_V9_ninth_chords.md](SPEC_V9_ninth_chords.md) |
| **Cifrature basso figurato** (tabella) | [cifrature_basso_figurato_complete.txt](cifrature_basso_figurato_complete.txt) |
| **Note di terze parti** (licenze, es. Salamander CC-BY) | [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt) |
| **Baseline test di regressione** (known-broken, gap del harness) | [../scripts/fixtures/BASELINE.md](../scripts/fixtures/BASELINE.md) |

---

## 🗓 Cronologia eventi

### 2026-02 — Fondamenta, refactor editor, ornamenti
- **2026-02-14 — Stato progetto + split di `GrandStaffEditor.tsx` (Fase 2)** → [archive/_session-memo-2026-02-14.md](archive/_session-memo-2026-02-14.md)
- **2026-02-14 — 4 bug di rendering (working notes)** → [archive/_bugs-working-notes.md](archive/_bugs-working-notes.md)
- **2026-02-17 — Architettura chiave + TODO prioritari** → [archive/_session-memo-2026-02-17.md](archive/_session-memo-2026-02-17.md)
- **2026-02-18 — Filtro etichette su ornamenti (Ornament Override Label Filtering)** → [archive/_session-memo-2026-02-18.md](archive/_session-memo-2026-02-18.md)
- **2026-02-24 — Modifiche + risultati regressione** → [archive/_session-memo-2026-02-24.md](archive/_session-memo-2026-02-24.md)
- **2026-02-27 — Bug appoggiatura nella label + stato build** → [archive/_session-memo-2026-02-27.md](archive/_session-memo-2026-02-27.md)

### 2026-04 — Release v1.0.2 / v1.0.3, ornamenti, dim7 enarmonici
- **2026-04-20 — Auto-updater, release v1.0.2, modulazioni** → [archive/session-2026-04-20-auto-updater-release.md](archive/session-2026-04-20-auto-updater-release.md)
- **2026-04-21 — Ornamenti: cambiata auto/learned, rendering** → [archive/session-2026-04-21-ornament-pipeline-and-rendering.md](archive/session-2026-04-21-ornament-pipeline-and-rendering.md)
- **2026-04-22 — Fix °7 enarmonici (`vii°/♭III`) + release v1.0.3** ⭐ → [archive/session-2026-04-22-dim7-enharmonic-fix.md](archive/session-2026-04-22-dim7-enharmonic-fix.md)
  - *Perché `D-F-Ab-Cb` diventa `vii°/♭III` (e non `♭III=♭VI`); guard nei vari blocchi; fix `Gb→♭V`.*

### 2026-05 — Aumentati, refactor "spelling-first", mixer & ACC
- **2026-05-16 — Root degli accordi aumentati nell'analisi romana** → [archive/session-2026-05-16-aug-triad-roman-root.md](archive/session-2026-05-16-aug-triad-roman-root.md)
- **2026-05-26/27 — Refactor "spelling-first" (Fasi 0-5)** ⭐ → commit `e74634b`…`56c1903`; baseline in [../scripts/fixtures/BASELINE.md](../scripts/fixtures/BASELINE.md)
  - *Nuovo riconoscitore accordi basato sullo spelling; analisi romana letter-first e spelling-aware; espone file storici con note mis-spelled.*
- **2026-05-30 — Mixer: colore per traccia, scelta destinazione incolla, scroll per-sistema; analisi guidata da marcatura ACC (Opt+H), slash/rivolti ACC** → commit `8cf8a26`…`be2adf7`
- **2026-05-31 — Import MIDI: separazione automatica voci, quantizzazione terzine, pause, cifrato segue il basso ACC marcato** → commit `0efe34d`, `9dcccb1`, `edafff3`

### 2026-06 — Dinamiche, audio/Salamander, fix armonici, tooling test
- **2026-06-01 — Dinamiche (velocity) + rework quantizzazione registrazione + sync incolla ACC↔SATB** → commit `daf6cb0`, `9fc1c01`
- **2026-06-03/05 — Editing manuale ACC, hide-SATB, polifonia preservata, rallentando/accelerando su tracce ACC** → commit `beef8a1`, `4e732f6`, `f158628`
- **2026-06-10 — Audio: mixer console (fader in dB + LED di segnale), pianoforte Salamander multi-velocity** ⭐ → commit `d544c9a`; vedi [piano-salamander-plan.md](piano-salamander-plan.md) e [novita-post-1.0.17.md](novita-post-1.0.17.md)
  - *Inviluppo naturale, niente "scatto" sulla ri-pressione, livelli live↔registrato coerenti, attribuzione CC-BY.*
- **2026-06-12 — Salamander: layer soft [1-6] (timbro caldo; eliminato il metallico sulle acute)** → commit `39e00d5`
- **2026-06-12/13 — Tooling test gold: flag `--update-gold`, rigenerazione di 4 gold obsoleti, ricostruzione `dubois-n5-p-13` dalle note corrette (E♯ → beat 51 `V/vi`)** → commit `3727de1`
- **2026-06-13 — Fix armonico: `iiø7`/diminuito preso in prestito su grado diatonico resta `ii°` (non `vii°/♭X`)** ⭐ → commit `3727de1`
  - *Esteso lo skip delle note proprie dell'accordo a tutta la famiglia diminuita (triade, half-dim, fully-dim); risolti `Delamont C55 b` + 24 snapshot Delamont.*
- **2026-06-13 — Known-broken documentati + trial "gap di fedeltà del harness"** ⭐ → commit `b30cca5`; dettagli in [../scripts/fixtures/BASELINE.md](../scripts/fixtures/BASELINE.md)
  - *Il regress valuta lo strato `applyStatelessRules`, l'app la pipeline completa (`computeHarmonyLabelsBySystem`) → alcuni gold (es. `cantata-19`) falliscono pur essendo l'app corretta. Opzione "allinea harness alla pipeline" stimata (~292/513 fixture, ~2-3 gg) e **rinviata**.*
- **2026-06-13 — Riordino documentazione + questo indice** → questo file; storico spostato in [archive/](archive/).

---

## 📚 Riferimento storico (non datato) — in `archive/`

> ⚠️ Materiale **antecedente a maggio 2026**: NON riflette ACC/mixer/registrazione/
> dinamiche/Salamander/spelling-first. Per lo stato attuale vedi i "Documenti attuali".

- **Analisi completa dell'app** (3 copie storiche — `.txt` e `_confronto.txt` identiche, `.md` con testo di debug incollato per errore): [archive/ANALISI_COMPLETA_APP.txt](archive/ANALISI_COMPLETA_APP.txt) · [archive/ANALISI_COMPLETA_APP_confronto.txt](archive/ANALISI_COMPLETA_APP_confronto.txt) · [archive/ANALISI_COMPLETA_APP.md](archive/ANALISI_COMPLETA_APP.md)
- **Briefing per Claude Code** (committente, prodotto, stack): [archive/HARMONY_TUTOR_BRIEFING.md](archive/HARMONY_TUTOR_BRIEFING.md)
- **Direttive di progetto** ("source of truth", agg. 2026-02-02): [archive/project-directives.md](archive/project-directives.md)
- **Scansione funzioni** (entry point, flavor, Electron): [archive/capabilities.md](archive/capabilities.md)
- **Pipeline input→visualizzazione** (diagramma Mermaid): [archive/pipeline-overview.md](archive/pipeline-overview.md)
- **Roadmap "Professional"** (stato feature): [archive/roadmap-professional.md](archive/roadmap-professional.md)
- **Checklist commerciale v1**: [archive/Grandstaff-v1-Commercial-Checklist.md](archive/Grandstaff-v1-Commercial-Checklist.md)
- **Guida debug** + **debug log**: [archive/debug-guide.md](archive/debug-guide.md) · [archive/_debug-log.md](archive/_debug-log.md)
- **Memo: evitare collisioni delle pause**: [archive/REST_COLLISION_AVOIDANCE_MEMO.md](archive/REST_COLLISION_AVOIDANCE_MEMO.md)
- **Testi del pannello analisi (HTML)**: [archive/Harmony_Tutor_Pannello_Analisi_Testi_v2.html](archive/Harmony_Tutor_Pannello_Analisi_Testi_v2.html)
- **Appunti vari** (riassunto chat, simmetria, obiettivi, scorciatoie): [archive/riassunto-chat.txt](archive/riassunto-chat.txt) · [archive/simmetria.txt](archive/simmetria.txt) · [archive/Obiettivi.txt](archive/Obiettivi.txt) · [archive/Altre modifiche.txt](<archive/Altre modifiche.txt>)
- **Screenshot**: [archive/raw/](archive/raw/)

---

*Indice aggiornato il 2026-06-13. Per aggiungere una voce: `data — titolo riconoscibile` + link al file in `archive/` o al commit.*
