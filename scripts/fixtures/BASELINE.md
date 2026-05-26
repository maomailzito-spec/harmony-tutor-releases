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
- **FAIL**: SOLO i 6 known-broken sopra (o un sottoinsieme, se il refactor
  ne risolve alcuni)

Qualunque nuovo FAIL fuori da quella lista è una **regressione introdotta dal
refactor** e va investigata prima di proseguire.
