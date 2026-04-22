# Sessione 21 aprile 2026 — Ornamenti: cambiata auto/learned e rendering sul pentagramma

## Cosa è stato corretto

### 1. `cambiata` resa un vero ornamento della pipeline

- `StaffNote` ora espone anche `isCambiata`
- `useHarmonyLabels` copia, filtra e resetta `isCambiata` come gli altri NCT
- `musicTheory.ts` riconosce automaticamente la `cambiata` come figura distinta dalla sfuggita:
  - ingresso per salto
  - uscita per grado congiunto
  - direzioni opposte
  - nota dissonante / non chord-tone
  - controllo diatonicamente coerente (terza in ingresso, seconda in uscita)
- i learned patterns possono ora applicare anche `cambiata` quando è la classe dominante del pattern

### 2. UI: menu ornamenti ripulito

- rimossi dal menu contestuale:
  - `structural`
  - `ornamental`
- restano disponibili via shortcut per correzioni manuali in fase di scrittura:
  - `⌥H`
  - `⌥O`
- aggiunta `Nota cambiata ⌥C` al menu contestuale

### 3. Marker sul pentagramma resi meno ambigui

- i marker non usano più direttamente i codici interni (`v`, `a`, `s`, `r`)
- ora il pentagramma mostra etichette esplicite e leggibili:
  - `P` passaggio
  - `V` nota di volta
  - `A` appoggiatura
  - `S` sfuggita
  - `R` ritardo
  - `Ant` anticipazione
  - `C` cambiata
- aggiunta una sottile leader line tra marker e nota per ridurre l’ambiguità visiva
- testo con halo bianco per migliorare leggibilità sopra note e aste

### 4. Ritardo: confermata doppia rappresentazione

- il ritardo continua ad avere la hold-line vicino al roman/figure
- in più compare anche `R` vicino alla nota interessata, come richiesto

## Decisione presa

- `structural` e `ornamental` restano strumenti tecnici di correzione interna/manuale, non elementi di UI didattica primaria
- `cambiata` entra invece nel gruppo degli ornamenti reali che il sistema deve saper:
  - apprendere
  - riconoscere automaticamente
  - rendere visivamente sul pentagramma

## Impatto atteso

- maggiore coerenza tra override manuali, pattern appresi e riconoscimento automatico
- minori divergenze tra pipeline UI e pipeline headless
- marker più chiari, meno “attaccati alla nota sbagliata”