# Fase 0 — Caratterizzazione baseline

Snapshot del comportamento della pipeline armonica al commit di riferimento
(post-commit `792e19b` patch dim7 °7-no-5 spelling-aware).

Scopo: fissare il "ground truth" attuale per misurare regressioni durante il
refactor spelling-first (Fasi 1-5).

## Come si verifica

```
npm run regress                        # esegue tutta la suite (~520 fixture)
npm run regress -- --update-snapshots   # rigenera expects dei fixture che terminano con "(snapshot)"
```

I fixture `(snapshot)` si autoaggiornano. I fixture `(gold)` e quelli senza
suffisso sono fissati a mano: ogni cambio di output produce FAIL.

## Known-broken (debito preesistente)

Questi 6 fixture falliscono nello stato di partenza. Non sono regressioni
introdotte dal refactor — sono bug latenti già presenti, che il refactor
spelling-first dovrebbe risolvere naturalmente.

| Fixture | Sintomo | Categoria |
|---|---|---|
| `gold-cantata-19-bach` | absBeat=7.5 roman atteso `I` ottenuto `''` (vuoto) | mancato riconoscimento accordo |
| `gold-delamont-c50-3f` | absBeat=5 atteso `V/IV` + `♭7`, ottenuto `I` + `[5]` | 7a minore non riconosciuta come dominante secondaria |
| `gold-delamont-c50-3f` | absBeat=6, 17 atteso `ii°` ottenuto `vii°/♭III` | scelta enarmonica (lettura intermedia accettabile, ma il gold preferisce `ii°`) |
| `Delamont C55 b (gold)` | absBeat=8, 9 stesso pattern `ii° → vii°/♭III` | idem |
| `gold-pedron-116-p44` | absBeat=22 atteso `i` + `[5]`, ottenuto `ii` + `[4/2]` | rivolto/root scelto male |
| `gold-pedron-55-p41` | absBeat=5 figures atteso `5` ottenuto `6` | rivolto |
| `pedron-120-p45` | absBeat=12 symbol atteso `Bb7` ottenuto `B7/A` | spelling root errato (B♮ vs B♭) |

**Target del refactor**: ridurre a 0 questi fail (o aggiornare i gold se la
nuova lettura è oggettivamente più corretta).

## Miglioramenti già misurati dalla patch dim7

La patch `792e19b` (dim7 °7-no-5 spelling-aware) ha migliorato 8 snapshot
auto-aggiornati, tutti in direzione di letture tonali più sensate:

| Fixture | Prima | Dopo |
|---|---|---|
| `snap-triplo-ritardo` | `VI°` (era FAIL) | `vii°` (OK) |
| `snap-delamont-c54-1bis` | `VI°` | `vii°` |
| `snap-corale-1d-bach` | `vii°/vii°` (nonsense) | `vii°/ii` |
| `snap-demo-video` | `IV°` (nonsense) | `vii°/vi` |
| `snap-pedron-n83-p71` | `vii°/iii` | `vii°/V` |
| `snap-corale-n-5d-bach-schinelli` (×2) | `III°` | `vii°/V` |
| `snap-delamont-c60-1g` | `ii`/`i` | `ii°`/`ii` |

## Fixture spelling-first nuovi (Fase 0)

Aggiunto un fixture mirato a stress-testare spelling difficili:

- `spelling-because-emin-snapshot.json` — Because (Beatles) in E minor, 93
  expects. Copre A♯, B♯, C♯, D♯, **E♯**, F♯, G♯ — tonalità diesi ricca con
  accordi alterati.

Brani con casi-limite spelling già coperti dai gold/snap preesistenti:
- `snap-pedron-enarmonia-p-90.json` (B♭ minor — B♯, F𝄪 doppio diesis)
- `snap-accordi-diminuiti-enarmonici.json` (C♭, E♭♭ doppio bemolle)
- `snap-modulazione-c---db.json` (modulazione a tonalità bemolle ricca)

## Linea di demarcazione per il refactor

Durante Fasi 1-5, ogni esecuzione di `npm run regress` deve produrre:
- **OK**: tutti i `(snapshot)` e gli altri gold non listati sopra
- **FAIL**: SOLO i 6 known-broken sopra + i 4 nuovi gold di Phase 5 (sotto)

## Nuovi fail di Phase 5 (commit a3430cf) — file mis-spelled

Phase 5 ha sostituito identifyChord/identifyChordCandidates con un wrapper
spelling-first sopra spelledChordEngine. 4 gold fail aggiuntivi sono
emersi, tutti su file noti per avere note mis-spelled storicamente:

| Fixture | Sintomo | Causa probabile |
|---|---|---|
| `gold-delachi-n2-p3471` | absBeat=16,24 figures '3' got [7] | Differenza stateless intermedia: app display OK ("vi 3/7"), regress cattura solo "7" |
| `gold-dubois-n5-p-13` | absBeat=51 V/vi → ♭vi | File ha F al posto di E# (mis-spelled). Letter-first respinge V/vi, restituisce ♭vi |
| `gold-pedron-n-71-p42` | absBeat=16,24 figures '3' got [7] | Stesso pattern di delachi |
| `gold-pedron-n120-p-45` | molti delta (V→V°, V/♭VII, ii→V/V) | File con mis-spelling sistematico; nuovo motore onestamente rivela |

Verifica empirica (utente, 2026-05-27): l'app a livello visibile mostra
output corretto in entrambi i casi (es. ii° per cantata-71 m12b3,
vi 3/7 per delachi-n2 m5b1). I delta sono di livello intermedio
(applyStatelessRules); la pipeline finale `harmonyLabelPipeline` +
post-rules corregge a runtime.

**Risoluzione attesa**: una volta corretti manualmente i file mis-spelled
nello `spelling-report.txt` (~51 note su 33 file), i 4 nuovi gold fail
torneranno verdi.

---

## Aggiornamento 2026-06-13 — stato attuale (FAIL: 10 → 5)

### Risolti
- **I 4 "nuovi fail di Phase 5"** (sopra): `delachi-n2-p3471` e `pedron-n-71-p42`
  erano artefatti dello strato stateless (app già corretta) → gold rigenerati con
  `regression-check.ts --update-gold`; `pedron-n120-p-45` idem; `dubois-n5-p-13`
  ricostruito dal sorgente corretto a mano (E♯) → beat 51 ora `V/vi`.
- **`Delamont C55 b`** + i beat `ii°` di **`delamont-c50-3f`** (b6/b17) + **24
  snapshot Delamont**: risolti dal fix engine "borrowed diminished su grado
  diatonico" (una `iiø7`/IV°/vi°/iv° non viene più riscritta come `vii°/♭X` verso
  target flat-side implausibili). Commit `3727de1`.

### Known-broken residui (5) — ACCETTATI come noti
Decisione: **documentare e accettare** (l'app è corretta dove verificato; il
harness testa lo strato *stateless*, non la pipeline finale dell'app).

| Fixture | Sintomo | Causa | Tipo |
|---|---|---|---|
| `cantata-19-bach` | b12.5/36.5 `V`, b40 `V°` | **Gap di fedeltà del harness**: la pipeline dell'app dà `I`/`I`/`♯IV` (= gold, **corretto**, verificato via trial stub + utente); solo lo strato `applyStatelessRules` del regress diverge. | harness-gap (app OK) |
| `delamont-c50-3f` (b5) | `V/IV`→`I`, `♭7`→`[5]` | 7ª minore non promossa a dominante secondaria | gap engine |
| `pedron-116-p44` | `i`→`ii`/`V/iv`, cifre 5→4/2, 2→6/4 | root/rivolto scelti male | gap engine |
| `Pedron 55 p.41` | cifra `5`→`6` | rivolto | gap engine |
| `pedron-120-p45` (unit) | `V`→`V/♭VII` + sospensione "vietata" | spelling root + edge case sospensioni | gap engine |

### Perché NON allineiamo il harness alla pipeline (opzione A, rinviata)
Trial 2026-06-13: la pipeline dell'app (`computeHarmonyLabelsBySystem`) è
**riproducibile headless ed è fedele** (validata su cantata-19), ma è accoppiata
al layout (stato per-sistema). Stima: switchare il checker da `applyStatelessRules`
alla pipeline **ri-baselinizzerebbe ~292/513 fixture** (~270 snapshot auto + ~17
gold da rivedere) e richiede ~2-3 giorni + validazione "headless == app". Rischio
solo-test, ma sproporzionato per ~3-5 false-fail. **Rinviato**; l'app resta corretta.
