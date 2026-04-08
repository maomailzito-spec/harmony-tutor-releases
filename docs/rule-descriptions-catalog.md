# Catalogo esaustivo — Regole, Eccezioni, Ornamenti, Cadenze

> **Scopo**: documento di lavoro per completare/revisionare il testo che l'utente vede nel pannello Analisi.
>
> Per ogni voce: il **testo attuale** (copiato dal codice) e una colonna **"Testo proposto"** dove scrivere la versione migliorata da inserire nel codice.
>
> **Come funziona il pannello**:
> - **Intestazione** (riga 1 del campo `description`) = sempre visibile nel badge.
> - **Dettaglio espandibile** (righe successive, separate da `\n`) = visibile cliccando ▼.
> - **Consiglio** (campo `suggestion`) = testo "Consiglio:" sotto il dettaglio.
>
> **Dove modificare**: `addViolation({...})` in `src/utils/musicTheory.ts` (L3956).
> Eccezione: ORN-\* e CAD-\* sono generati dalle pipeline ornamento/cadenza.
> **Rendering**: `src/components/HarmonyAnalysisPanel.tsx` (L337) → `description.split('\n')`.

---

## Legenda

| Simbolo | Significato |
|---------|-------------|
| ✅ | Testo multi-riga completo (già implementato) |
| ❌ | Solo intestazione sintetica — da completare |
| 🔴 | error |
| ⚠️ | warning |
| 🟢 | exception (eccezione/marker informativo) |

---

## 1. ERRORI DI CONDOTTA VOCALE (🔴 error)

### R-01 — Ottave / Unisoni paralleli ✅

**Severità**: `error`  
**Codice**: L9460 — generato dinamicamente con `_dubDesc`

**Intestazione attuale** (dinamica):
```
Ottave parallele tra [Voce1] e [Voce2]
```

**Dettaglio espanso** (costruito da `_dubDesc`):  
Testo dinamico che include: coppia di voci, tipo di intervallo (8ª/unisono), tipo di moto (retto), gradi coinvolti, contesto di sequenza/imitazione (se applicabile).

**Consiglio attuale** (dinamico):  
Varia in base al contesto — indica come evitare il moto parallelo.

**Testo proposto**: _(da compilare)_

---

### R-02 — Quinte parallele ✅

**Severità**: `error`  
**Codice**: L9460 — generato dinamicamente con `_dubDesc`

**Intestazione attuale** (dinamica):
```
Quinte parallele tra [Voce1] e [Voce2]
```

**Dettaglio espanso**: come R-01, specifico per quinte giuste.

**Consiglio attuale** (dinamico): indica come evitare quinte parallele.

**Testo proposto**: _(da compilare)_

---

### R-02c — Quinte consecutive per moto contrario ❌

**Severità**: `error`  
**Codice**: L9530

**Intestazione attuale**:
```
Quinte consecutive per moto contrario
```

**Dettaglio espanso**: _(assente — solo intestazione)_

**Consiglio attuale**:
```
Due quinte perfette consecutive sono vietate anche per moto contrario.
```

**Testo proposto**: _(da compilare)_

---

### R-04 — Incrocio di voci ❌

**Severità**: `error`  
**Codice**: L8914

**Intestazione attuale** (dinamica):
```
Incrocio di voci grave (Basso sopra Tenore)
Incrocio di voci grave (Alto sopra Soprano)
```

**Dettaglio espanso**: _(assente)_

**Consiglio attuale**:
```
Riordina le altezze: Basso deve restare sotto il Tenore.
Riordina le altezze: Alto deve restare sotto il Soprano.
```

**Testo proposto**: _(da compilare)_

---

### R-06 — Mancata risoluzione di salto diminuito/aumentato ❌

**Severità**: `error`  
**Codice**: L11057

**Intestazione attuale** (varianti):
```
Mancata risoluzione di salto diminuito/aumentato
Salto diminuito/aumentato risolto parzialmente (moto congiunto in stessa direzione)
```

**Dettaglio espanso**: _(assente)_

**Consiglio attuale**:
```
Dopo un salto diminuito o aumentato, la voce deve invertire la direzione
e procedere per grado congiunto.
```

**Testo proposto**: _(da compilare)_

---

### R-07 — Risoluzione errata della sensibile ❌

**Severità**: `error` / `warning` (in sequenza)  
**Codice**: L9430

**Intestazione attuale** (varianti):
```
Risoluzione errata della sensibile
Risoluzione errata della sensibile (tollerata in sequenza/imitazione)
```

**Dettaglio espanso**: _(assente)_

**Consiglio attuale**:
```
La sensibile tende a salire alla tonica (specie nelle voci esterne).
```
Variante sequenza: testo attenuato per contesto imitativo.

**Testo proposto**: _(da compilare)_

---

### R-09 — Falsa relazione cromatica ❌

**Severità**: `error`  
**Codice**: L9285

**Intestazione attuale**:
```
Falsa relazione cromatica tra [Voce1] e [Voce2]
```

**Dettaglio espanso**: _(assente)_

**Consiglio attuale**:
```
Evita che una voce presenti una nota e un'altra la sua alterazione
cromatica nel passaggio successivo.
```

**Testo proposto**: _(da compilare)_

---

### R-10 — Raddoppio della sensibile ✅

**Severità**: `error`  
**Codice**: L8442 — via `addDoublingViolation()`

**Intestazione attuale** (dinamica):
```
Raddoppio della sensibile ([nota]) in [accordo]
```

**Dettaglio espanso** (testo generico multi-riga):
```
Consiglio: Raddoppio della Sensibile
Rilevato raddoppio della sensibile (VII grado della scala) nell'accordo.
Regola: La sensibile ha una forte tendenza a risolvere sulla tonica (moto
ascendente di semitono). Raddoppiarla crea due voci che "devono" muoversi
nella stessa direzione, generando quasi inevitabilmente ottave parallele
proibite.
• ℹ️ Info: Licenza in Progressione Imitata
  Raddoppio della sensibile rilevato all'interno di una sequenza.
  L'errore è tollerato poiché la necessità di mantenere la simmetria
  del disegno melodico tra modello e imitazione prevale.
• ✅ Eccezione: Accordo di Dominante in Stato Fondamentale (V7)
  Il raddoppio della sensibile è particolarmente grave nell'accordo
  di V7 perché rafforza la funzione di dominante.
• ✅ Eccezione: viiø7 e vii°7 (Accordi di Settima Diminuita)
  Negli accordi completamente diminuiti la tensione è già massima;
  raddoppiare la sensibile aggrava il problema.
• ✅ Attenuazione: Voce Interna
  Se la sensibile raddoppiata si trova in una voce interna (Alto o
  Tenore), il raddoppio è meno grave, ma andrebbe comunque evitato.
```

**Testo proposto**: _(da compilare se si vuole revisionare)_

---

### R-10-7TH — Raddoppio della settima dell'accordo ✅

**Severità**: `error`  
**Codice**: L8528 — via `addDoublingViolation()`

**Intestazione attuale**:
```
Raddoppio della settima ([nota]) in [accordo]
```

**Dettaglio espanso** (testo generico multi-riga):
```
Consiglio: Raddoppio della Settima
Rilevato raddoppio della settima dell'accordo.
Regola: La settima dell'accordo è una dissonanza che deve risolvere
scendendo di grado. Raddoppiarla crea due dissonanze che devono
risolvere nella stessa direzione → ottave parallele quasi inevitabili.
• ℹ️ Info: Accordo di 7ª di Dominante (V7)
  Il raddoppio è particolarmente problematico nell'accordo di V7.
• ✅ Eccezione: Settima nell'Accordo di Sensibile (viiø7)
  Negli accordi di settima semidiminuiti la settima è meno "urgente".
• ✅ Attenuazione: Tipo di Settima
  La gravità del raddoppio varia in base al tipo di settima
  (maggiore, minore, diminuita).
```

**Testo proposto**: _(da compilare se si vuole revisionare)_

---

### R-10-DIM5 — Raddoppio della quinta diminuita ✅

**Severità**: `error`  
**Codice**: L8575 — via `addDoublingViolation()`

**Intestazione attuale**:
```
Raddoppio della 5ª diminuita ([nota]) in [accordo]
```

**Dettaglio espanso**:
```
Consiglio: Raddoppio della 5ª Diminuita
Rilevato raddoppio della quinta diminuita dell'accordo.
Regola: La 5ª diminuita è una nota instabile con tendenza a risolvere.
Raddoppiarla crea problemi di condotta vocale simili al raddoppio
della sensibile.
• ℹ️ Info: Contesto in Accordi vii°
  Nell'accordo di vii° la 5ª diminuita coincide con il IV grado
  della scala, che tende a scendere al III.
• ✅ Eccezione: 5ª Diminuita come Nota Cromatica
  Quando la 5ª diminuita è un'alterazione cromatica, il raddoppio
  può essere accettabile in certi contesti.
```

**Testo proposto**: _(da compilare se si vuole revisionare)_

---

### R-10-64 — Raddoppio nel quarto e sesto cadenzale ✅

**Severità**: `error`  
**Codice**: L8617 — via `addDoublingViolation()`

**Intestazione attuale**:
```
Raddoppio nel 6/4: [nota] raddoppiato in [accordo]
```

**Dettaglio espanso**:
```
Consiglio: Raddoppio nel Quarto e Sesto
In un accordo in secondo rivolto (6/4) la nota al basso è la 5ª.
Regola: Nel 6/4 cadenzale si deve raddoppiare la 5ª (= il basso);
raddoppiare la fondamentale o la 3ª compromette la funzione cadenzale.
• ℹ️ Info: Tipi di 6/4
  Esistono diversi tipi di 6/4: cadenzale, di passaggio, di volta,
  pedale. La regola del raddoppio è più rigida per il cadenzale.
• ✅ Eccezione: 6/4 di Passaggio
  In un 6/4 di passaggio il raddoppio è meno critico.
• ✅ Attenuazione: Funzione non cadenzale
  Se il 6/4 non ha funzione cadenzale, il raddoppio è valutato
  con meno rigore.
```

**Testo proposto**: _(da compilare se si vuole revisionare)_

---

### R-12 — Mancata risoluzione della settima ✅

**Severità**: `error`  
**Codice**: L10112 — template literal dinamico multi-riga

**Intestazione attuale** (dinamica):
```
Mancata risoluzione della 7ª: [voce]([nota]) non scende di grado
```

**Dettaglio espanso**: testo dinamico con voce, gradi, contesto dell'accordo, tipo di settima, e indicazione della risoluzione attesa. Include rami per diverse eccezioni (trasferimento, risoluzione ascendente, ritardo ecc.).

**Consiglio attuale** (dinamico): indica la risoluzione corretta in base al contesto.

**Testo proposto**: _(da compilare se si vuole revisionare)_

---

### R-17a — Due salti consecutivi stessa direzione → 7ª/9ª ✅

**Severità**: `error`  
**Codice**: L10831 — literal `\n`

**Intestazione attuale**:
```
R-17a: due salti consecutivi nella stessa direzione sommano una 7ª o 9ª
```

**Dettaglio espanso** (già nel codice):
```
Logica: due salti nella stessa direzione che sommano una 7ª o una 9ª
creano un contorno melodico che l'orecchio percepisce come un unico
grande salto dissonante, anche se le singole note possono essere
consonanti.
Gravità: error — infrazione grave nella condotta melodica.
Condizione di sblocco: inserisci un cambio di direzione tra i due
salti, oppure fai in modo che uno dei due movimenti sia un grado
congiunto (2ª).
```

**Consiglio attuale**:
```
Inserisci moto contrario tra i due salti, oppure fai passare uno
dei due per grado congiunto.
```

**Testo proposto**: _(da compilare se si vuole revisionare)_

---

### R-N-RES — Risoluzione atipica nota non armonica ❌

**Severità**: `warning`  
**Codice**: L8107

**Intestazione attuale**:
```
Risoluzione atipica dell'ornamento [tipo]
```

**Dettaglio espanso**: _(assente)_

**Consiglio attuale** (dinamico):
```
L'ornamento [tipo] dovrebbe risolvere per [risoluzione attesa],
ma qui la nota successiva non rispetta la conduzione attesa.
```

**Testo proposto**: _(da compilare)_

---

### R-AUG6-RES — Risoluzione atipica della sesta aumentata ❌

**Severità**: `warning`  
**Codice**: L6495

**Intestazione attuale**:
```
Risoluzione atipica di [label]
```

**Dettaglio espanso**: _(assente)_

**Consiglio attuale**:
```
L'accordo [label] dovrebbe risolvere sull'accordo di dominante;
qui la risoluzione è atipica.
```

**Testo proposto**: _(da compilare)_

---

### R-CAD64 — 6/4 cadenziale non risolto ❌

**Severità**: `warning`  
**Codice**: L6529

**Intestazione attuale**:
```
6/4 cadenziale non risolto su V
```

**Dettaglio espanso**: _(assente)_

**Consiglio attuale**:
```
L'accordo di [label] in posizione cadenzale dovrebbe risolvere
sull'accordo di dominante.
```

**Testo proposto**: _(da compilare)_

---

## 2. AVVERTIMENTI DI CONDOTTA VOCALE (⚠️ warning)

### R-03 — Arrivo all'unisono ❌

**Severità**: `warning` / `exception` (se cadenziale)  
**Codice**: L9604

**Intestazione attuale** (varianti):
```
Arrivo all'unisono tra [Voce1] e [Voce2]
Arrivo all'unisono (cadenziale, tollerato)
```

**Dettaglio espanso**: _(assente)_

**Consiglio attuale** (dinamico): varia in base al contesto cadenziale.

**Testo proposto**: _(da compilare)_

---

### R-05 — Quinte / Ottave nascoste ✅

**Severità**: `warning`  
**Codice**: L9661 — generato dinamicamente con `_desc`

**Intestazione attuale** (dinamica):
```
Ottava/quinta nascosta tra [Voce1] e [Voce2] per salto in moto retto
```

**Dettaglio espanso**: testo dinamico con coppia di voci, tipo intervallo (5ª/8ª), tipo di moto, contesto (voci interne → severity `warning`, voci esterne → più grave).

**Consiglio attuale** (dinamico).

**Testo proposto**: _(da compilare se si vuole revisionare)_

---

### R-08 — Spaziatura eccessiva tra voci adiacenti ❌

**Severità**: `warning`  
**Codice**: L8950

**Intestazione attuale** (varianti):
```
Spaziatura eccessiva tra Soprano e Alto (> 8va)
Spaziatura eccessiva tra Alto e Tenore (> 8va)
```

**Dettaglio espanso**: _(assente)_

**Consiglio attuale**:
```
Avvicina Alto e Soprano entro l'ottava.
Avvicina Tenore e Alto entro l'ottava.
```

**Testo proposto**: _(da compilare)_

---

### R-10-3RD — Raddoppio della terza ✅

**Severità**: `warning`  
**Codice**: L8671 — via `addDoublingViolation()`

**Intestazione attuale**:
```
Raddoppio atipico: 3ª raddoppiata in stato fondamentale: [nota] in [accordo]
```

**Dettaglio espanso** (testo generico multi-riga completo):
```
Consiglio: Raddoppio della Terza
Rilevato raddoppio della terza in un accordo in stato fondamentale.
Regola: Prediligere il raddoppio della fondamentale (o della quinta)
per garantire stabilità, specialmente se la terza è maggiore.
• ℹ️ Info: Licenza in Progressione Imitata
  Raddoppio della terza rilevato all'interno di una sequenza. L'errore
  è tollerato poiché la necessità di mantenere la simmetria del disegno
  melodico tra modello e imitazione prevale sulla purezza del raddoppio.
• ✅ Eccezione: Cadenza d'Inganno (V-VI)
  Il raddoppio della terza nell'accordo di VI grado (che corrisponde
  alla tonica) è raccomandato per favorire una corretta condotta delle
  voci ed evitare ottave parallele.
• ✅ Eccezione: Accordo Napoletano (bII)
  In questo contesto, il raddoppio della terza (IV grado della scala)
  è la scelta preferibile per sottolineare la funzione tonale dell'accordo.
• ✅ Attenuazione: Primo Rivolto (Accordo di Sesta)
  Il raddoppio della terza (nota al basso) è accettabile se tale nota è
  un grado forte della scala (I, IV o V), altrimenti è preferibile
  raddoppiare la fondamentale o la quinta.
• ℹ Nota di Stile: Accordi Minori
  La gravità del warning è ridotta se l'accordo è minore; il raddoppio
  della terza minore è considerato molto più accettabile rispetto a
  quello della terza maggiore.
```

**Testo proposto**: _(da compilare se si vuole revisionare)_

---

### R-10-6 — Raddoppio nel primo rivolto ✅

**Severità**: `warning`  
**Codice**: L8773 — via `addDoublingViolation()`

**Intestazione attuale**:
```
Raddoppio nel primo rivolto: [nota] raddoppiato in [accordo]
```

**Dettaglio espanso** (testo generico multi-riga):
```
Consiglio: Raddoppio nel Primo Rivolto
In un accordo in primo rivolto (accordo di sesta) la nota al basso
è la 3ª dell'accordo.
Regola: Nel primo rivolto è preferibile raddoppiare la fondamentale
o la 5ª piuttosto che la 3ª (= la nota al basso).
• ℹ️ Info: Grado della Scala al Basso
  La scelta del raddoppio dipende dal grado della scala che si trova
  al basso.
• ✅ Eccezione: Gradi Forti (I, IV, V) al Basso
  Quando la nota al basso è un grado forte della scala, il raddoppio
  del basso (= la 3ª dell'accordo) è ammesso.
• ✅ Attenuazione: Condotta delle Voci
  Se il raddoppio della 3ª è l'unica opzione per garantire una buona
  condotta delle voci, è accettabile.
```

**Testo proposto**: _(da compilare se si vuole revisionare)_

---

### R-13 — Moto parallelo di tutte le voci ❌

**Severità**: `warning`  
**Codice**: L9137

**Intestazione attuale** (varianti):
```
Moto parallelo di tutte le voci
Moto parallelo di tutte le voci (attenuato: Soprano per grado congiunto)
Moto parallelo di tutte le voci (tollerato in sequenza/imitazione)
```

**Dettaglio espanso**: _(assente)_

**Consiglio attuale** (dinamico): indica di portare almeno una voce in moto contrario.

**Testo proposto**: _(da compilare)_

---

### R-14 — Quinte/ottave nascoste tra voci estreme ❌

**Severità**: `warning`  
**Codice**: L9188

**Intestazione attuale** (varianti):
```
Quinte/ottave nascoste tra voci estreme (moto simile)
Ottave nascoste: Soprano si muove per 2ª maggiore
```

**Dettaglio espanso**: _(assente)_

**Consiglio attuale** (dinamico): porta il Soprano per grado congiunto.

**Testo proposto**: _(da compilare)_

---

### R-15 — Salto ampio in voce interna ❌

**Severità**: `warning`  
**Codice**: L10653

**Intestazione attuale**:
```
Salto melodico ampio nelle voci interne (> 6a)
```

**Dettaglio espanso**: _(assente)_

**Consiglio attuale**:
```
Preferisci moto congiunto o spezza il salto con note di passaggio.
```

**Testo proposto**: _(da compilare)_

---

### R-16 — Sincope armonica / Intervallo melodico proibito ❌

**Severità**: `warning` / `error`  
**Codice**: L10567 (armonica) + L10670 (melodica)

**Intestazione attuale** (varianti):
```
Cambio di armonia debole (beat [n]) anticipato (= sincope armonica,
regola della stanghetta)
Intervallo melodico proibito: [nomeIntervallo]
```

**Dettaglio espanso**: _(assente)_

**Consiglio attuale** (dinamico): regola della stanghetta.

**Testo proposto**: _(da compilare)_

---

### R-17b — 7ª/9ª in due movimenti senza grado congiunto ✅

**Severità**: `warning`  
**Codice**: L10856 — literal `\n`

**Intestazione attuale**:
```
R-17b: 7ª/9ª percorsa in due movimenti senza grado congiunto
```

**Dettaglio espanso** (già nel codice):
```
Logica: una 7ª o 9ª percorsa in due salti (senza grado congiunto
intermedio) crea un profilo melodico poco cantabile.
Gravità: warning — meno grave di R-17a perché i due salti possono
essere entrambi consonanti.
Condizione di sblocco: almeno uno dei due movimenti deve essere un
grado congiunto (2ª), oppure la nota intermedia deve essere più
lunga della precedente.
```

**Consiglio attuale**:
```
Uno dei due salti deve essere di 2ª (grado congiunto).
```

**Testo proposto**: _(da compilare se si vuole revisionare)_

---

### R-17c — Successione di tritono ✅

**Severità**: `error` / `warning` (in base a durata)  
**Codice**: L10912 — literal `\n`

**Intestazione attuale**:
```
R-17c: successione di tritono (4ª eccedente) delineata in [n] movimenti
```

**Dettaglio espanso** (già nel codice):
```
Logica: il tritono (4ª eccedente / 5ª diminuita) è l'intervallo più
instabile del sistema tonale. Quando viene delineato ("outlined") da
2+ movimenti melodici consecutivi, l'orecchio percepisce la tensione
irrisolta.
Filtro "Cambio Direzione": se la melodia cambia direzione prima di
completare il tritono, la percezione dell'outline si attenua.
Gerarchia di gravità:
  - error: tritono percorso in 2 movimenti nella stessa direzione,
    nota finale breve, senza risoluzione per grado congiunto opposto.
  - warning: nota intermedia più lunga, o risoluzione presente ma
    parziale.
Condizione di sblocco: dopo il tritono, l'ultima nota deve risolvere
per grado congiunto in senso opposto alla direzione del tritono.
```

**Consiglio attuale**:
```
Risolvere per grado congiunto in senso opposto al tritono.
```

**Testo proposto**: _(da compilare se si vuole revisionare)_

---

### R-CHORD-COMPLETE — Accordo incompleto ❌

**Severità**: `warning`  
**Codice**: L8322-8400

**Intestazione attuale** (varianti):
```
Accordo incompleto: manca [nota/i mancanti]
Accordo di 7ª incompleto: manca [nota/i]
Accordo al basso: possibile errore di inserimento
Nota grave isolata: possibile pedale o errore
```

**Dettaglio espanso**: _(assente)_

**Consiglio attuale** (dinamico): varia per tipo.

**Testo proposto**: _(da compilare)_

---

### R-RANGE — Nota fuori registro ❌

**Severità**: `warning`  
**Codice**: L8430

**Intestazione attuale**:
```
Nota fuori registro ammesso per [nomeVoce]
```

**Dettaglio espanso**: _(assente)_

**Consiglio attuale**:
```
La nota [nomNota] (MIDI [midi]) è fuori dal registro standard per [voce].
```

**Testo proposto**: _(da compilare)_

---

### R-SPACING-TB — Spaziatura Tenore-Basso ❌

**Severità**: `warning`  
**Codice**: L8982

**Intestazione attuale**:
```
Spaziatura eccessiva tra Tenore e Basso (> 2 ottave + 5a)
```

**Dettaglio espanso**: _(assente)_

**Consiglio attuale**:
```
Valuta di avvicinare Tenore e Basso per una tessitura più compatta.
```

**Testo proposto**: _(da compilare)_

---

## 3. ECCEZIONI — PARALLELE / NASCOSTE (🟢 exception)

### EXC-M03 — Parallele per moto contrario (tollerate) ❌

**Severità**: `exception`  
**Codice**: generato dinamicamente in blocco R-01/R-02 (`_dubDesc`)

**Intestazione attuale**:
```
Ottave consecutive per moto contrario (tollerato)
Quinte consecutive per moto contrario (tollerato)
```

**Dettaglio espanso**: generato con lo stesso `_dubDesc` di R-01/R-02 — include contesto voci e moto.

**Consiglio attuale** (dinamico).

**Testo proposto**: _(da compilare)_

---

### EXC-M04 — Perfetta per moto obliquo ❌

**Severità**: `exception`  
**Codice**: generato nel blocco R-01/R-02

**Intestazione attuale**:
```
Perfetta raggiunta per moto obliquo (tollerata)
```

**Dettaglio espanso**: _(dinamico)_

**Testo proposto**: _(da compilare)_

---

### EXC-OBL-PERF — 5ª/8ª per moto obliquo (tollerata) ❌

**Severità**: `exception`  
**Codice**: L9824

**Intestazione attuale**:
```
5ª/8ª giusta raggiunta per moto obliquo (tollerata)
```

**Dettaglio espanso**: _(assente)_

**Consiglio attuale**:
```
Se una nota resta ferma, il risultato di 5ª/8ª giusta è ammesso.
```

**Testo proposto**: _(da compilare)_

---

### EXC-Hidden-Stepwise — Nascoste per grado congiunto ❌

**Severità**: `exception`  
**Codice**: nel blocco R-14, L9198

**Intestazione attuale**:
```
Moto retto/nascosto ammesso (Soprano per grado congiunto)
```

**Dettaglio espanso**: _(assente)_

**Consiglio attuale**:
```
Eccezione classica: il Soprano si muove per grado congiunto.
```

**Testo proposto**: _(da compilare)_

---

### EXC-Hidden-BassStep — Nascosta ammessa (basso grado congiunto) ❌

**Severità**: `exception`  
**Codice**: nel blocco R-05/R-14

**Intestazione attuale**:
```
Nascosta ammessa: il basso si muove per grado congiunto
```

**Dettaglio espanso**: _(assente)_

**Testo proposto**: _(da compilare)_

---

## 4. ECCEZIONI — INCROCIO E UNISONO (🟢 exception)

### EXC-S02 — Incrocio momentaneo tollerato ❌

**Severità**: `exception`  
**Codice**: L8930

**Intestazione attuale**:
```
Incrocio Alto/Tenore (tollerato)
```

**Dettaglio espanso**: _(assente)_

**Consiglio attuale**:
```
Di norma evita l'incrocio; può essere accettabile per esigenze melodiche.
```

**Testo proposto**: _(da compilare)_

---

### EXC-Unison-Lower — Unisono voci basse ❌

**Severità**: `exception`  
**Codice**: L9565

**Intestazione attuale**:
```
Unisono raggiunto per moto contrario/obliquo nelle voci basse (tollerato)
```

**Dettaglio espanso**: _(assente)_

**Consiglio attuale**:
```
L'unisono raggiunto per moto contrario o obliquo tra Tenore e Basso
è ammesso.
```

**Testo proposto**: _(da compilare)_

---

### EXC-Unison-Step — Unisono per grado congiunto ❌

**Severità**: `exception`  
**Codice**: L9575

**Intestazione attuale**:
```
Unisono raggiunto per moto contrario/obliquo con grado congiunto (tollerato)
```

**Dettaglio espanso**: _(assente)_

**Consiglio attuale**:
```
L'unisono per moto contrario o obliquo è ammesso se almeno una voce
procede per grado congiunto.
```

**Testo proposto**: _(da compilare)_

---

### EXC-Unison-Cadence — Unisono in cadenza ❌

**Severità**: `exception`  
**Codice**: ~L9600 (blocco R-03)

**Intestazione attuale**:
```
Arrivo all'unisono (cadenziale, tollerato)
```

**Dettaglio espanso**: _(assente)_

**Testo proposto**: _(da compilare)_

---

## 5. ECCEZIONI — SENSIBILE (🟢 exception)

### EXC-LT-Transfer — Risoluzione trasferita della sensibile ❌

**Severità**: `exception`  
**Codice**: L9393

**Intestazione attuale**:
```
Risoluzione trasferita della sensibile
```

**Dettaglio espanso**: _(assente)_

**Consiglio attuale**:
```
Ammesso perché la tonica è presa dal Soprano.
```

**Testo proposto**: _(da compilare)_

---

### EXC-LT-Chromatic-Line — Sensibile in linea cromatica ❌

**Severità**: `exception`  
**Codice**: L9410

**Intestazione attuale**:
```
Sensibile in linea cromatica (eccezione)
```

**Dettaglio espanso**: _(assente)_

**Consiglio attuale**:
```
Eccezione: in una linea cromatica di voce interna la sensibile
può non risolvere subito alla tonica.
```

**Testo proposto**: _(da compilare)_

---

### EXC-LT-FREE — Risoluzione libera della sensibile (VII) ✅

**Severità**: `exception`

**Intestazione attuale**:
```
Risoluzione libera della sensibile
```

**Dettaglio espanso**:
L'obbligo di risoluzione ascendente della sensibile (VII → I) è sospeso quando
l'accordo di destinazione non esercita una funzione di attrazione tonale
risolutiva (non è I né vi).

- **Priorità lineare**: in passaggi non cadenzali (es. VII → IV o VII → III),
  la sensibile è considerata una nota melodica mobile. Se il soprano o una voce
  interna segue un disegno discendente, la coerenza della linea prevale sulla
  tensione del grado.
- **Neutralizzazione della tensione**: la spinta verso la tonica è massima solo
  nella successione V → I o vii° → I. In successioni non cadenzali la sensibile
  può scendere di grado congiunto o saltare alla quinta dell'accordo successivo
  per garantire la completezza armonica.
- **Nota tecnica**: la sensibile è definita "libera" anche se l'accordo di
  destinazione contiene la tonica come nota reale (es. il IV grado in stato
  fondamentale), purché la successione non sia classificabile come cadenza
  perfetta o d'inganno.

**Condizione di sblocco (algoritmo)**:
Il sistema disattiva R-07 se si verifica almeno una delle seguenti condizioni:
1. Movimento congiunto discendente verso una nota appartenente all'accordo
   successivo (es. Si → La su accordo di Fa o Re).
2. L'accordo di destinazione non è I né vi.
3. Il movimento discendente è necessario per evitare errori di 6/4 o per
   completare la triade di arrivo (voci interne, IV grado).

**Consiglio attuale**:
```
L'accordo di destinazione non è I né vi: la sensibile è melodicamente
libera in contesto non cadenzale.
```

---

## 6. ECCEZIONI — RISOLUZIONE DELLA SETTIMA (🟢 exception)

### EXC-7-TRANSFERRED-RES — Settima trasferita ❌

**Severità**: `exception`  
**Codice**: L10267

**Intestazione attuale** (dinamica):
```
Settima "trasferita": la 7ª di [voce]([nota]) non risolve scendendo
nella stessa voce, ma è "presa in carico" da [altraVoce]
```

**Dettaglio espanso**: _(assente)_

**Testo proposto**: _(da compilare)_

---

### EXC-7-UP — Settima risolve salendo ❌

**Severità**: `exception`  
**Codice**: L10290

**Intestazione attuale**:
```
Eccezione: 7ª di [voce]([nota]) risolve salendo (anziché scendendo)
```

**Dettaglio espanso**: _(assente)_

**Testo proposto**: _(da compilare)_

---

### EXC-7-P4-TO7 — Settima raggiunta per salto di 4ª ❌

**Severità**: `exception`  
**Codice**: L10310

**Intestazione attuale**:
```
Eccezione: 7ª raggiunta per salto di 4ª giusta dal basso
```

**Dettaglio espanso**: _(assente)_

**Testo proposto**: _(da compilare)_

---

### EXC-7-STATIC — Settima trattenuta ❌

**Severità**: `exception`  
**Codice**: L10328

**Intestazione attuale** (dinamica):
```
Settima trattenuta: [voce]([nota]) era 7ª di [accordo1]
e rimane nel nuovo accordo [accordo2]
```

**Dettaglio espanso**: _(assente)_

**Testo proposto**: _(da compilare)_

---

### EXC-7-DELAYED — Risoluzione ritardata della settima ❌

**Severità**: `exception`  
**Codice**: L10352

**Intestazione attuale** (dinamica):
```
Risoluzione ritardata della 7ª: [voce]([nota]) risolve a [notaRisolta]
dopo [n] beats
```

**Dettaglio espanso**: _(assente)_

**Testo proposto**: _(da compilare)_

---

### EXC-7m01 — Settima trasferita (posizione) ❌

**Severità**: `exception`  
**Codice**: L10403

**Intestazione attuale**:
```
7ª di [voce] risolve trasferendosi (cambio di ottava/posizione)
```

**Dettaglio espanso**: _(assente)_

**Testo proposto**: _(da compilare)_

---

### EXC-7-TRANSFER — Settima trasferita ad altra voce ❌

**Severità**: `exception`  
**Codice**: L10427

**Intestazione attuale**:
```
7ª trasferita: [voce] cede la 7ª a [altraVoce] (cambio posizione)
```

**Dettaglio espanso**: _(assente)_

**Testo proposto**: _(da compilare)_

---

### EXC-7-FREE — Settima senza obbligo di risoluzione ❌

**Severità**: `exception`  
**Codice**: L10447

**Intestazione attuale** (dinamica):
```
7ª senza risoluzione obbligata: la 7ª [nota] di [accordo]
non richiede risoluzione discendente perché [motivo]
```

**Dettaglio espanso**: _(assente)_

**Testo proposto**: _(da compilare)_

---

## 7. ECCEZIONE — MELODIA (🟢 exception)

### EXC-R17-Duration — R-17 tollerata per nota intermedia lunga ❌

**Severità**: `exception`  
**Codice**: L10817

**Intestazione attuale**:
```
R-17 tollerata: la nota intermedia è più lunga della precedente
(la percezione dell'outline melodico è attenuata)
```

**Dettaglio espanso**: _(assente)_

**Testo proposto**: _(da compilare)_

---

## 8. ORNAMENTI RICONOSCIUTI (🟢 exception / ⚠️ warning)

> **Nota**: ORN-\* e R-ORN-\* sono generati dalla pipeline di rilevamento ornamenti
> (non da `addViolation()` in musicTheory.ts). Il testo è costruito dinamicamente.

### ORN-NEIGH — Nota di volta riconosciuta ❌

**Severità**: `exception`  
**Intestazione**: `Nota di volta riconosciuta (condotta ok)`

**Testo proposto**: _(da compilare)_

---

### R-ORN-NEIGH — Nota di volta sospetta ❌

**Severità**: `warning`  
**Intestazione**: `Nota di volta sospetta/atipica (es. su tempo forte)`

**Testo proposto**: _(da compilare)_

---

### ORN-APP — Appoggiatura riconosciuta ❌

**Severità**: `exception`  
**Intestazione**: `Appoggiatura riconosciuta (condotta ok)`

**Testo proposto**: _(da compilare)_

---

### R-ORN-APP — Appoggiatura sospetta ❌

**Severità**: `warning`  
**Intestazione**: `Appoggiatura sospetta/atipica`

**Testo proposto**: _(da compilare)_

---

### ORN-ANT — Anticipazione riconosciuta ❌

**Severità**: `exception`  
**Intestazione**: `Anticipazione riconosciuta (breve, tempo debole)`

**Testo proposto**: _(da compilare)_

---

### R-ORN-ANT — Anticipazione atipica ❌

**Severità**: `warning`  
**Intestazione**: `Anticipazione lunga o su tempo forte`

**Testo proposto**: _(da compilare)_

---

### ORN-ESC — Nota di sfuggita riconosciuta ❌

**Severità**: `exception`  
**Intestazione**: `Nota di sfuggita riconosciuta`

**Testo proposto**: _(da compilare)_

---

### R-ORN-ESC — Sfuggita sospetta ❌

**Severità**: `warning`  
**Intestazione**: `Sfuggita sospetta (es. su tempo forte)`

**Testo proposto**: _(da compilare)_

---

### ORN-PASS — Nota di passaggio riconosciuta ❌

**Severità**: `exception`  
**Intestazione**: `Nota di passaggio riconosciuta (condotta ok)`

**Testo proposto**: _(da compilare)_

---

## 9. CADENZE — MARKER INFORMATIVI (🟢 exception)

> **Nota**: I marker CAD-\* sono generati dalla pipeline di rilevamento cadenze.
> Sono puramente informativi e non rappresentano errori o warning.

### CAD-PAC — Cadenza Autentica Perfetta ❌

**Severità**: `exception`  
**Intestazione**: `Cadenza autentica perfetta (PAC): V → I`

**Testo proposto**: _(da compilare)_

---

### CAD-IAC — Cadenza Autentica Imperfetta ❌

**Severità**: `exception`  
**Intestazione**: `Cadenza autentica imperfetta (IAC): V → I`

**Testo proposto**: _(da compilare)_

---

### CAD-HC — Semicadenza ❌

**Severità**: `exception`  
**Intestazione**: `Semicadenza (HC): → V`

**Testo proposto**: _(da compilare)_

---

### CAD-PLAG — Cadenza Plagale ❌

**Severità**: `exception`  
**Intestazione**: `Cadenza plagale: IV → I`

**Testo proposto**: _(da compilare)_

---

### CAD-PIC — Terza Piccarda (Cadenza Perfetta o Plagale) ✅

**Severità**: `exception`  
**Intestazione**: `Terza Piccarda: conclusione su I maggiore in tonalità minore`

**Testo proposto**:

Rilevata conclusione su accordo di tonica maggiore (I) in un brano in tonalità minore. Questa risoluzione è considerata regolare sia nella formula di cadenza perfetta (V−I) che in quella plagale (IV−I o iv−I).

ℹ️ **Effetto stilistico**: L'uso della Terza Piccarda trasforma il carattere della risoluzione finale, conferendo un senso di maggiore stabilità, solennità o "luce" rispetto alla conclusione in minore.

⚠️ **Nota tecnica**: Il marker CAD-PIC viene applicato ogni volta che l'ultimo accordo di una composizione in minore presenta la terza alzata (es. in Do minore, l'accordo finale è Do-Mi-Sol). Questa implementazione evita che il I maggiore finale venga interpretato come una dominante secondaria del IV grado (V/iv).

---

## 10. ARMONIA CROMATICA (🟣 chromatic)

### CHROM-AUG6-VAR — Sesta aumentata con alterazioni eccedenti

**Severità:** 🟣 chromatic (informativa, colore viola)

**Descrizione pannello (multi-riga):**

> **CHROM-AUG6-VAR — Sesta aumentata con alterazioni eccedenti**
>
> **Dettaglio:** Rilevato accordo di sesta aumentata contenente una o più note
> con intervallo eccedente o più che eccedente rispetto alla fondamentale
> (3+, 5x, 8x). Queste note aggiuntive non appartengono alla struttura
> tradizionale delle seste aumentate (Italiana, Francese, Tedesca) ma svolgono
> una funzione cromatica precisa: ciascuna di esse agisce come sensibile
> individuale, tendendo a risolvere per semitono ascendente su una nota specifica
> dell'accordo di destinazione.
>
> **ℹ️ Info — Funzione armonico-cromatica:** L'accordo che ne risulta è un
> aggregato di attrazioni semitonali convergenti — ogni nota alterata "punta"
> per moto cromatico alla nota corrispondente dell'accordo successivo.
>
> Le alterazioni possibili sono:
> — **8x** (ottava più che eccedente): risolve sulla 3a maggiore dell'accordo di
>   arrivo. Disponibile solo in tonalità maggiore.
> — **5x** (quinta più che eccedente): risolve sulla 7a maggiore dell'accordo di
>   arrivo.
> — **3+** (terza eccedente): risolve sulla 5a dell'accordo di arrivo.

**Fonte:** Delamont, *Tecnica Moderna di Armonia* vol. 2, pp. 34–35.

---

## Riepilogo

| Stato | Conteggio | Regole |
|-------|-----------|--------|
| ✅ Multi-riga completo | 13 | R-01, R-02, R-05, R-10, R-10-7TH, R-10-DIM5, R-10-64, R-10-3RD, R-10-6, R-12, R-17a, R-17b, R-17c |
| ❌ Da completare — Errori | 8 | R-02c, R-04, R-06, R-07, R-09, R-N-RES, R-AUG6-RES, R-CAD64 |
| ❌ Da completare — Avvisi | 9 | R-03, R-08, R-13, R-14, R-15, R-16, R-CHORD-COMPLETE, R-RANGE, R-SPACING-TB |
| ❌ Da completare — Eccezioni | 20 | EXC-M03, EXC-M04, EXC-OBL-PERF, EXC-Hidden-Stepwise, EXC-Hidden-BassStep, EXC-S02, EXC-Unison-Lower, EXC-Unison-Step, EXC-Unison-Cadence, EXC-LT-Transfer, EXC-LT-Chromatic-Line, EXC-LT-FREE, EXC-7-TRANSFERRED-RES, EXC-7-UP, EXC-7-P4-TO7, EXC-7-STATIC, EXC-7-DELAYED, EXC-7m01, EXC-7-TRANSFER, EXC-7-FREE, EXC-R17-Duration |
| ❌ Da completare — Ornamenti | 9 | ORN-NEIGH, R-ORN-NEIGH, ORN-APP, R-ORN-APP, ORN-ANT, R-ORN-ANT, ORN-ESC, R-ORN-ESC, ORN-PASS |
| ❌ Da completare — Cadenze | 4 | CAD-PAC, CAD-IAC, CAD-HC, CAD-PLAG |
| ✅ Cadenze completate | 1 | CAD-PIC |
| **Totale** | **63** | |

---

## Come inserire il testo nel codice

1. **Regole in `musicTheory.ts`**: cercare `addViolation({` con il `ruleId` desiderato.
   - Campo `description`: riga 1 = intestazione, righe successive (con `\n`) = dettaglio.
   - Campo `suggestion`: testo "Consiglio:".
2. **Regole R-10 family**: modificare il parametro `generic` passato a `addDoublingViolation()`.
3. **ORN-\* e CAD-\***: cercare nella pipeline ornamento/cadenza.
4. Dopo la modifica: `npm run build` → `npm run regress`.

**Rendering**: `src/components/HarmonyAnalysisPanel.tsx` (L337) → `description.split('\n')`.
