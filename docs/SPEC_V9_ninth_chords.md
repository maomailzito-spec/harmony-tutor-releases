# SPEC: Accordi di nona di dominante — Riconoscimento e numerazione

## Fonte
Dubois, *Trattato di armonia*, Capitolo Secondo — Armonia dissonante naturale, §89–94.
Documento interno: `02 - Cifrature e Basso Figurato.docx`, sezione D.

---

## Concetto

Gli accordi di 9a maggiore e di 9a minore sono accordi **strutturali** (non ornamenti/ritardi)
sul V grado. Sono formati da un V7 a cui si aggiunge la nona maggiore o minore.
Sono gli accordi "più completi del sistema armonico" (Dubois §89) e determinano
da soli sia il modo che il tono.

Hanno **tre note a risoluzione obbligata**: sensibile (sale), settima (scende), nona (scende).

---

## Struttura intervallare

### V9 maggiore (in Do maggiore: G-B-D-F-A)

| Nota | Funzione | Semitoni dalla fondamentale |
|------|----------|---------------------------|
| G    | fondamentale (V) | 0 |
| B    | 3a maggiore (sensibile) | 4 |
| D    | 5a giusta | 7 |
| F    | 7a minore | 10 |
| A    | 9a maggiore | 14 |

### V9 minore (in Do minore: G-B-D-F-Ab)

| Nota | Funzione | Semitoni dalla fondamentale |
|------|----------|---------------------------|
| G    | fondamentale (V) | 0 |
| B    | 3a maggiore (sensibile) | 4 |
| D    | 5a giusta | 7 |
| F    | 7a minore | 10 |
| Ab   | 9a minore | 13 |

---

## A quattro voci: soppressione della quinta

Dubois: "Questi accordi non sono completi che a cinque parti; a quattro si sopprime la 5a."

Quindi a 4 voci SATB, il V9 diventa:
- V9 maggiore: G-B-F-A (senza D)
- V9 minore: G-B-F-Ab (senza D)

Il motore deve riconoscere il V9 **anche senza la quinta**.

---

## Riconoscimento nel motore

### Condizioni per identificare un V9

L'accordo deve soddisfare TUTTE queste condizioni:
1. La fondamentale è il V grado della tonalità corrente
2. Contiene la 3a maggiore (sensibile del tono)
3. Contiene la 7a minore (10 semitoni dalla fondamentale)
4. Contiene la 9a (maggiore = 14 semitoni, o minore = 13 semitoni dalla fondamentale)
5. La 5a può essere presente o assente

### Distinzione V9 vs. ritardo 9-8

Il motore deve distinguere tra:
- **V9 strutturale**: la nona è parte dell'accordo, compare senza preparazione obbligatoria,
  l'accordo ha la settima presente
- **Ritardo 9-8**: la nona è preparata (nota comune dall'accordo precedente), risolve sulla
  fondamentale (8) nello stesso accordo, tipicamente senza settima simultanea

Criterio pratico: **se la settima (7a minore) è presente → V9 strutturale**.
Se la settima è assente e la nona è preparata → ritardo 9-8.

### Relazione con vii° senza fondamentale

Dubois e il documento interno già trattano il vii°7 come V9 senza fondamentale:
- V9 minore senza fondamentale = vii°7 (settima diminuita)
- V9 maggiore senza fondamentale = viiø7 (settima semidiminuita, in maggiore)

Questo è già implementato nel motore. Il V9 CON fondamentale è il caso nuovo.

---

## Regole di disposizione (Dubois §90)

### V9 maggiore — regole specifiche:
- La 9a dev'essere **sempre sopra la fondamentale**, a distanza almeno di 9a reale
- La 9a deve formare con la sensibile almeno un intervallo di **7a**
- **Disposizioni vietate**: 9a sotto la fondamentale, 9a a distanza di 2a dalla sensibile
- Il **4° rivolto è inusitato** (9a al basso viola la regola della distanza)

### V9 minore — regole specifiche:
- La 3a (sensibile) può stare sia sopra che sotto la 9a
- Il 4° rivolto con soppressione della fondamentale **è ammesso**

### Regole di risoluzione:
- Sensibile → sale alla tonica
- 7a → scende di grado
- 9a → scende di grado (alla fondamentale dell'accordo tonico o alla sua ottava)
- Fondamentale → sale di 4a o scende di 5a (moto di V→I)

---

## Cifrature (basso figurato)

Dalla tabella già definita in `02 - Cifrature e Basso Figurato.docx`:

| Rivolto | Basso | Cifratura | Note |
|---------|-------|-----------|------|
| Stato fondamentale | fondamentale (V) | 9/7 (o semplicemente 9) | — |
| 1° rivolto | 3a (sensibile) | 7/5 | derivato da 6/9 |
| 2° rivolto | 5a | 5/3 | derivato da 4/6/9 |
| 3° rivolto | 7a | 6/4/2 | derivato da 2/4 |
| 4° rivolto | 9a | 6/4/3 | raro/inusitato per V9M |

### Cifrature con alterazioni

Per la 9a minore, la cifra 9 avrà il bemolle se necessario:
- V9 minore in Do: 9♭/7 (o ♭9/7)

Per la 9a maggiore, nessuna alterazione aggiuntiva di norma.

---

## Label Roman numeral

### Formato sotto il pentagramma:

```
V           V           V           V
9/7         ♭9/7        9           ♭9
            (minore)    (senza 7    (minore,
                        nella       senza 7
                        cifra)      nella cifra)
```

Il Roman resta **V**. La cifra 9 (o ♭9) indica la nona.
La 7 appare nella cifra per chiarezza, ma può essere omessa se già implicita.

### Con rivolti:

```
V           V           V           V
9/7         7/5         5/3         6/4/2
(fond.)     (1° riv.)   (2° riv.)   (3° riv.)
```

---

## Sigla (chord symbol sopra il pentagramma)

| Tipo | Sigla |
|------|-------|
| V9 maggiore in Do | G9 |
| V9 minore in Do | G7(♭9) o Gm9 a seconda della convenzione |

---

## Warning e regole di condotta

### Nuovi warning possibili per V9:

1. **Distanza 9a-fondamentale**: se la 9a è a meno di una 9a reale dalla fondamentale
   → warning (Dubois §90: la 9a deve essere a distanza almeno di 9a dalla fondamentale)

2. **Distanza 9a-sensibile**: se la 9a è a distanza di 2a dalla sensibile (B-A o B-Ab)
   → warning (Dubois: devono formare almeno una 7a)

3. **Risoluzione della 9a**: la 9a deve scendere di grado nell'accordo successivo
   → stessa logica di R-12 per la settima, applicata alla nona

4. **4° rivolto V9M**: se la 9a maggiore è al basso
   → warning "disposizione inusitata" (Dubois: il 4° rivolto è inusitato per la 9M)

### Regole esistenti che si applicano anche al V9:
- R-12 (risoluzione settima) → si applica alla 7a del V9
- R-10-LT (raddoppio sensibile) → si applica alla sensibile del V9
- Regole di moto parallelo → normali

---

## Priorità implementazione

1. **Riconoscimento V9 con fondamentale** come accordo strutturale (non ritardo)
   → Roman: V, cifra: 9/7 (o ♭9/7)
2. **Riconoscimento nei rivolti** (1°-4°) con cifrature corrette
3. **Distinzione V9 vs ritardo 9-8** (criterio: presenza della 7a)
4. **Warning disposizione** (distanza 9a-fondamentale, 9a-sensibile) — post-beta
5. **Warning risoluzione 9a** — post-beta

---

## Note implementative

- Il V9 senza fondamentale è **già gestito** (vii°7 / viiø7). Non toccare.
- Il V9 con fondamentale è il caso nuovo: 5 note teoriche, 4 a SATB (senza 5a).
- La detection deve avvenire PRIMA del fallback a V7+ornamento, altrimenti la nona
  viene classificata come appoggiatura.
- Il V9 può comparire anche come dominante secondaria: V9/IV, V9/V, ecc.
  → estensione naturale dopo che il V9 diatonico funziona.
- **Regression:** eseguire `npm run regress` dopo il fix. Alcuni accordi attualmente
  classificati come V7 con appoggiatura potrebbero essere riclassificati come V9
  — questo è corretto ma va verificato manualmente.
