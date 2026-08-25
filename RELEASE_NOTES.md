## Novità nella versione 1.8.0

### 🎺 Strumenti traspositori

Una parte si può assegnare a uno strumento traspositore, e viene riscritta come quello strumento la legge: cambiano le note sul suo rigo e la sua armatura, mentre tutto il resto — analisi, riproduzione, esportazione — continua a lavorare sul suono vero. Nel file resta sempre il suono reale.

La spunta **Suoni reali** passa da una vista all'altra: accesa mostra quello che si sente, spenta quello che ogni strumentista legge sul leggio.

### 🎻 Partitura d'orchestra

A sinistra dei righi compaiono le parentesi di famiglia — archi con archi, legni con legni — dedotte dallo strumento della traccia. Restano distinte da quelle blu dell'analisi, che raccolgono i righi letti insieme: sono due domande diverse e ora si vedono separate.

### 🎹 Arpeggiatore

Le decisioni che riguardano un arpeggio — disposizione delle note, figura, suddivisione, verso — stanno in un pannello unico invece che sparse fra barra e scorciatoie. Lo stesso disegno si applica a più accordi in una volta, e cambiando figura l'accordo non si consuma: le note restano quelle, cambia come sono distribuite nel tempo.

### ⚡️ Velocità

Su brani con molte parti l'editing era diventato faticoso: la nota fantasma arrivava in ritardo sul puntatore e ogni tasto premuto si faceva aspettare. Ora si disegnano solo i sistemi che si vedono, e il fantasma si muove per conto suo senza far ridisegnare la pagina. Su una partitura a tredici parti la differenza è quella fra scrivere e aspettare.

Chi lavora su corali a quattro voci non noterà nulla: lì non c'era niente da guadagnare.

### 🖨 Stampa ed esportazione

Stampa e PDF adattano la pagina al foglio: se un sistema è più largo o più alto dello spazio disponibile, tutto si rimpicciolisce quanto basta perché ogni sistema entri intero. Prima usciva tagliato a destra, con i sistemi spezzati fra le pagine.

L'esportazione in immagine produce più file numerati quando il brano è lungo, e taglia sempre fra un sistema e l'altro: nessun pentagramma resta a metà.

### 🎼 Analisi

L'accordo dichiarato con **⌥⇧H** non è più un'etichetta fissa. Ricorda da quali note è nato e li segue: cancellandone una si rifà sulle altre — tolto il Si da un Do maggiore con settima, torna a dire Do — e quando ne restano meno di due sparisce, lasciando tornare l'analisi automatica.

Gli attacchi che stanno ancora suonando nel punto in cui dichiari tengono la loro sigla. È quello che permette di tenere un accordo lungo nel coro e aggiungergli una nota per movimento, ottenendo Do, Do maggiore con settima, La minore con settima, Do con nona aggiunta.

Un passaggio come I → ii non viene più scambiato per una cadenza d'inganno in un'altra tonalità. Era il motivo per cui, in certi esercizi, il primo grado veniva letto come dominante e tutta la frase seguente risultava spostata di quarta.

Le cadenze vengono riconosciute solo dove una frase finisce davvero, e il riconoscimento tiene ora conto della tonalità in vigore in quel punto del brano, non di quella iniziale. Nei brani che modulano la differenza si vede.

### ✍️ Scrittura

Scrivendo più note nello stesso punto, la voce di ciascuna può essere dedotta da come si dispongono sul rigo: la più acuta va alla voce più alta, la più grave alla più bassa. Finché la disposizione non è chiara, vale la voce scelta in barra.

I pulsanti S/A/T/B convertono le note **solo quando la selezione l'hai fatta tu**, cliccando o con un riquadro. La nota appena scritta resta selezionata per comodità, ma premendo un'altra voce si prepara soltanto la nota successiva: prima si convertiva quella appena scritta.

Cancellando una nota resta una pausa al suo posto, per non far slittare quello che segue. Ma ciò che era della nota se ne va con lei: alterazioni, corone, articolazioni, ornamenti, gambi e travature decisi a mano, e le legature che la riguardavano. Annullando torna tutto.

### ♯ Sensibile automatica

Funziona anche dopo un cambio di tonalità a metà brano. Prima si fermava alla tonalità con cui il pezzo cominciava: se il brano partiva in maggiore, dal punto del cambio in poi la sensibile non veniva più alzata.

### 🎨 Tavolozza

L'armatura si sceglie da un elenco che mostra **entrambe le tonalità** — «Mi♭ Mag / Do min» — come nella barra dei comandi. Prima compariva la sola nota, e per ottenere Do minore bisognava sapere di dover scegliere Mi♭ e poi «min».

I segni che valgono su una battuta — armatura, metro, metronomo, stanghette, rallentando e accelerando — si posano anche con un **clic**, nel punto dove si trova la linea di lettura. Il trascinamento resta.

### 💾 Quello che il file si ricorda

Riaprendo un brano tornano l'a capo di sistema e la disposizione della barra dei comandi, che prima andavano persi. Dopo un ricaricamento tornano anche i cambi d'armatura, le legature di portamento e i segni d'ottava.

Il contatore delle misure indica quante misure ci sono davvero, e il «+» ne aggiunge una a quelle esistenti. Prima, dopo aver aperto un file, poteva segnarne quattro su venti e il pulsante sembrava non funzionare.

### 🌍 Versione inglese

Tavolozza, mixer, dialogo del nuovo progetto, menù del tasto destro, pannello delle proprietà e barra dei comandi sono ora completamente in inglese.

### 🔧 Correzioni

- Il corpo delle righe del pentagramma compariva due volte nelle preferenze e la scelta non aveva effetto sulla pagina
- Trascinando un'armatura, l'etichetta che segue il puntatore indicava l'armatura invece della tonalità (Mi♭m dove si intendeva Do minore)
- Lo zoom torna al 100% col doppio clic su una parte vuota, senza più azzerarsi da solo
- Le parentesi delle terzine sulle tracce finivano dentro il pentagramma della traccia sopra, e a gambi in su si appoggiavano alla traversa
- Su musica fitta le note dell'ultima misura potevano uscire dal pentagramma: ora la riga si chiude prima, e il numero di battute per riga resta un tetto e non un obbligo
- Una legatura di valore rimasta senza la nota d'arrivo si scioglie, invece di restare appesa o riagganciarsi a una nota lontana
- Il manuale, in italiano e in inglese, è aggiornato a questa versione

## Novità nella versione 1.7.0

### 🎹 Inserimento delle note

La nota si aggancia alla posizione libera più vicina al punto in cui clicchi, tenendo conto di ciò che è già scritto: i movimenti del metro, la fine delle note precedenti e l'inizio di una nota già presente, per costruire un accordo.

Le pause contano come le note. Tenendo premuto **Shift** l'aggancio si disattiva e si torna alla griglia libera.

I gruppi irregolari (terzine, quintine) si scrivono di nuovo correttamente con il mouse.

L'intensità dell'aggancio si regola in **Preferenze → Editor**.

### ✋ Avviso di incrocio delle voci

Quando una nota appena scritta finisce sotto o sopra la voce adiacente, compare un avviso che propone di scambiare le due voci con un clic. Non blocca la scrittura.

È utile soprattutto con le semibrevi: senza gambo non si vede a quale voce appartengono, e una nota finita nella voce sbagliata veniva segnalata dall'analisi come errore di condotta.

Chi scrive contrappunto con incroci voluti può disattivare l'avviso dal pulsante stesso.

### 📐 Impaginazione

**⌥Invio** manda a capo la riga sulla battuta dove si trova il cursore, oppure dal menù col tasto destro. L'a capo manuale ha la precedenza su tutto: compare come ⏎ a fine riga e si toglie cliccandoci sopra.

Battute per riga, vista e formato della carta ora si salvano nel file. Sono scelte che appartengono al brano, non alla sessione di lavoro.

Lo zoom torna al 100% con un **doppio** clic su una parte vuota della pagina.

### 🖱 Menù col tasto destro sulla nota

Ornamenti (nota di passaggio, volta, appoggiatura, ritardo, sfuggita, cambiata, anticipazione), forza strutturale, corona, articolazioni, spostamento di rigo e a capo di sistema: tutto ciò che riguarda una nota si trova ora sulla nota stessa.

Le letture alternative di un accordo compaiono accanto alla musica, e cliccando su un'etichetta dell'analisi si apre il punto in cui quella lettura si modifica.

### 🎨 Tavolozza dei segni

Ancorata al lato sinistro. Si possono tenere **più gruppi aperti insieme** e c'è un **campo di ricerca** per arrivare subito al segno che serve.

Contiene anche durate, pattern di accompagnamento e trasformazioni melodiche. Accanto all'armatura si trovano trasporto, modo e sensibile automatica.

Le forcelle si disegnano trascinandole sulla musica.

Metronomo e scritte si spostano anche in verticale, e la posizione resta salvata nel file. Una scritta si corregge con un doppio clic.

### 🛠 Barra dei comandi personalizzabile

Si sceglie quali gruppi tenere e li si riordina trascinandoli; un gruppo può essere mandato a capo. Disattivando l'analisi i suoi comandi restano al loro posto, spenti, così gli altri pulsanti non si spostano.

### 📊 Analisi

Le regole sui tempi forti e deboli seguono ora il metro in vigore in ciascuna battuta, non più quello iniziale del brano. Nei brani con cambi di metro il giudizio era errato dal punto del cambio in poi.

La regola della stanghetta riconosce di nuovo le sincopi nelle battute in tre.

Due nuove eccezioni, per evitare segnalazioni su scritture corrette: quando sul battere cambia il rivolto, e quando la stessa anticipazione si ripete per almeno tre battute — in quel caso è una figura ritmica voluta.

### 🔧 Correzioni

- Sei sedicesimi di terzina venivano travati come una sestina
- La linea di lettura durante l'ascolto segue ora esattamente la posizione suonata
- La larghezza delle battute non cambia più durante la scrittura
- Sulle tracce grand staff "a voci" la voce si sceglie dalla posizione del clic, come nel corale, e può reggere un accordo
- Le righe del pentagramma possono essere più spesse, per la stampa e per gli schermi molto densi

## Novità in v1.6.0

### 🎼 Le sigle degli accordi escono come accordi, non come scritte
- Finora, esportando, le sigle **non uscivano affatto**: chi apriva il file trovava numeri romani e cifratura, e nessun accordo. Ora escono come elementi veri del formato — `<harmony>` nel MusicXML, `<Harmony>` in MuseScore. Chi apre il file le vede come accordi: le **traspone insieme alle note**, le modifica, le ristampa con le proprie convenzioni.
- Una sigla che il programma non riesce a classificare non si perde: esce comunque, con la grafia esatta con cui l'hai scritta. Meglio un accordo dichiarato «altro» ma scritto giusto che una sigla mancante.

### 📤 Quel che si vede è quel che si esporta
- I tre interruttori dell'analisi — **numeri romani, sigle, cifratura del basso** — non governano più soltanto la pagina: decidono anche il contenuto dei file. Chi non usa il basso figurato non se lo porta più dietro nei file esportati.
- Lo stesso vale per i **righi**: uno rigo nascosto, il coro o una traccia, resta fuori dal file. È il modo per esportare una traccia sola, o due su tre — si spegne quello che non serve e si esporta. Vale per MusicXML, per il formato accessibile e per il MIDI.
- Prima di salvare, il dialogo dice per esteso che cosa sta per uscire: «Verrà esportato — Righi: Coro, Chitarra. Analisi: numeri romani, cifratura del basso.»

### ♿️ Le scelte che contano si raggiungono senza mouse
- I tre interruttori e la visibilità dei righi stavano solo su pulsanti piccoli della barra. Ora sono nel menu **Vista**, con le scorciatoie: `⌘⌥R` romani, `⌘⌥S` sigle, `⌘⌥F` cifratura, `⌘⌥C` coro. Le tracce si accendono e si spengono **una per una, col loro nome** — «Chitarra», «Basso» — così chi ascolta il menu sa quale sta togliendo.
- Nella lettura parlata le sigle si **sentono dette per esteso**: `Bb/D` diventa «Si bemolle basso Re». E se sono accesi sia i romani sia le sigle, il file dice tutt'e due: «Si bemolle basso Re, settima di dominante in primo rivolto». La sigla dice che accordo è, il romano che funzione ha.
- L'elenco delle scorciatoie (Aiuto → Scorciatoie…) esiste ora **anche in inglese**, e si legge nella lingua dell'applicazione.

### 📖 Il manuale viaggia dentro l'applicazione
- **Aiuto → «Manuale utente (PDF)…»** apre la guida nella lingua dell'interfaccia. Non va scaricata a parte, e soprattutto è sempre quella della **versione installata**: un manuale scaricato per conto suo invecchia senza che nessuno se ne accorga.

### 🔧 Correzioni
- **Le voci copiate nel grand staff «a voci» restavano quattro.** Incollando il coro in una traccia a voci le quattro parti diventavano una sola, e la divisione fra i righi seguiva l'altezza delle note invece delle parti: un tenore acuto finiva nel rigo di violino. Ora la voce si conserva e il rigo lo decide la voce.
- **Il rettangolo rosso delle misure incomplete** finiva sul coro anche quando l'errore era in una traccia. Ora segna il rigo che sbaglia davvero.
- **Le sigle nel file accessibile arrivavano vuote**: MuseScore 4 le scartava in silenzio perché scritte nella forma della versione 3. Il file si apriva benissimo e le sigle non c'erano.

## Novità in v1.5.4

### 🔊 I suoni dell'app tornano al loro posto
- **Le due versioni precedenti suonavano peggio, e la colpa era nostra.** Nella 1.5.2 e nella 1.5.3 i campioni dell'app non si aprivano più: il programma ripiegava in silenzio sul banco generico scaricato da Internet, quello che violino e archi li fa sembrare un altro strumento. Da questa versione si sentono di nuovo i campioni orchestrali dell'app.
- **Il selettore Orchestra / GM torna a funzionare.** Nelle due versioni precedenti spostarlo non cambiava niente, perché da una parte e dall'altra usciva comunque il banco generico.
- Le novità annunciate nella 1.5.2 e nella 1.5.3 — «i suoni sono dentro l'app», «non serve la connessione» — **non erano vere**: quel lavoro ha rotto ciò che già funzionava. Chi è rimasto sulla 1.5.1 non ha perso nulla; chi ha aggiornato ritrova ora i suoi suoni.

## Novità in v1.5.3

### 🔊 Adesso i suoni escono davvero dall'app
- La 1.5.2 aveva risolto **solo a metà**: il programma continuava a scaricare i campioni da Internet, e chi era senza rete restava muto. Da questa versione i suoni vengono dal programma, sempre e comunque.
- Si sente la differenza a parità di strumento: quelli scaricati erano un banco generico, questi sono i **campioni orchestrali dell'app**. Se il violino o gli archi vi sembrano un altro strumento, è perché fino a ieri lo erano.

### 🔄 Aggiornamenti
- L'avviso di aggiornamento mostra **solo le novità della versione nuova**. Prima elencava di seguito anche tutte quelle passate: un testo lunghissimo in cui il pulsante di conferma finiva fuori dallo schermo.

## Novità in v1.5.2

### 🔊 I suoni sono dentro l'app
- **Non serve più la connessione per sentire.** Fino a ieri il programma, una volta installato, andava a prendere i campioni su Internet a ogni nota: bastava una rete assente o filtrata — un treno, la rete di un conservatorio, una connessione lenta — e l'app restava **muta**, senza dire perché. Adesso i suoni vengono dal programma stesso, dove sono sempre stati.
- **E sono suoni migliori.** Quelli scaricati erano un banco generico; quelli che escono ora sono i campioni orchestrali dell'app, registrati e bilanciati apposta. Violino, archi, fiati e pianoforte suonano diversi da come li ha sentiti chiunque fino a questa versione.
- Se un campione non si apre, ora il programma lo dice invece di far finta di niente: era il silenzio di quel guasto ad averlo tenuto nascosto.

### ⚠️ Segnalazioni che tornano a segnalare
- **Il triangolo delle misure incomplete non si spegne più insieme ai riquadri.** Il riquadro rosso sulla misura è d'intralcio mentre si scrive — una misura a metà è normale finché la si riempie — e per questo si spegne cliccandoci sopra. Ma l'errore di metrica resta, e con lui un'analisi che in quel punto dice di meno. Ora il pulsante ⚠ resta acceso col **numero delle misure incomplete** anche a riquadri spenti, e spiega la conseguenza: l'analisi di quei punti è parziale.
- **L'analisi torna al coro da sé.** Chi aveva importato un brano su traccia si portava dietro quella scelta anche nei lavori successivi, e nel coro non compariva più nessuna segnalazione. Ora, se non ci sono tracce e il coro ha delle note, il soggetto torna al coro — a meno che non l'abbiate scelto voi a mano.

### ♿ Accessibilità
- **Le violazioni dicono dove sono**: «misura 4, movimento 2», nel pannello, oltre che nei colori sulla partitura. Prima la posizione si poteva solo guardare.
- I pulsanti-sigla della barra degli strumenti hanno un **nome leggibile** da uno screen reader, compreso quello delle misure incomplete, che ora annuncia anche il conto.

### 🔄 Aggiornamenti
- La finestra delle novità **scorre**: quando l'elenco era lungo, il pulsante di conferma finiva sotto il bordo dello schermo e non si riusciva a chiuderla.

## Novità in v1.5.1

### ♿ Accessibilità
- **L'analisi si sposta da sé sulla traccia.** Un brano strumentale importato — una chitarra, un pianoforte, le parti di un corale — entra come *traccia*, non nel coro; il programma però continuava ad analizzare il coro vuoto, in silenzio. Ora, se il coro è vuoto e c'è una traccia con delle note, l'analisi ci si sposta senza chiedere niente. Scegliendo a mano, comanda la scelta dell'utente.
- **Il soggetto dell'analisi è nel menù** (Strumenti ▸ *Analizza il coro* / *Analizza la traccia d'accompagnamento*), con le scorciatoie **⌘⌥1** e **⌘⌥2**. Prima esisteva solo come pulsante «ACC» in mezzo alla barra degli strumenti: tre lettere senza contesto, irraggiungibili per chi lavora con uno screen reader — e senza quel comando un brano importato non veniva analizzato affatto.

## Novità in v1.5.0

### 🎵 Dinamiche che si sentono
- **Segni di dinamica veri**: pp…fff, sf, sfz, rf, fp e forcelle di crescendo/diminuendo. Non sono disegni: comandano il volume dell'esecuzione, e la differenza fra un *pp* e un *ff* è di 28 dB — tarata a orecchio, non a tavolino.
- Le forcelle interpolano **in decibel**, con i passi più larghi dove il suono è debole: è lì che l'orecchio distingue di più. Su una nota tenuta di uno strumento ad arco la forcella gonfia il suono *dentro* la nota.
- Escono e rientrano nei file: `<dynamics>` e `<wedge>` nel MusicXML, velocity nel MIDI. Un file esportato e riletto conserva quello che avevi scritto.

### 🎼 Articolazioni, legature, ottave
- **Staccato, staccatissimo, accento, marcato, tenuto**: si posano trascinandoli su una nota o selezionando e cliccando. Si sentono davvero — lo staccato accorcia la nota *e* la sua coda, l'accento rinforza il volume e sceglie un campione più brillante.
- **Legature di portamento**: si tirano da una nota all'altra, si allungano afferrandone i capi, e sopravvivono all'a capo. Nel coro stanno dalla parte dei gambi, così quella del soprano non finisce addosso al contralto.
- **8va e 8vb**: per i passaggi che avrebbero troppi tagli addizionali. Le note **non si spostano**: scrivi dove vanno lette, il segno le fa suonare un'ottava sopra o sotto.
- Tasto destro su un segno per toglierlo, ovunque: sulla nota, sulla curva, sulla scritta.

### 🔑 Cambio d'armatura a metà brano
- Si sceglie la tonalità nella tavolozza e la si trascina sulla misura da cui vale. Compare l'armatura nuova coi bequadri che annullano la vecchia, e i righi successivi la portano in testa.
- **Da lì in poi si scrive nella tonalità nuova**: cliccando la riga del La in La bemolle nasce un La bemolle, senza segni da aggiungere a mano.
- **L'analisi segue**: romani e cifre si allineano da soli. E il cambio porta con sé la doppia barra, che ferma il confronto fra il prima e il dopo — attraversare un cambio di tonalità non è un errore di condotta delle parti.

### 🎨 Tavolozza dei segni
- Undici famiglie raccolte in **tre gruppi a fisarmonica** — Dinamiche, Articolazioni ed espressione, Struttura — divisi per che cosa il segno riguarda. Un gruppo aperto per volta, e resta aperto mentre trascini.
- Dentro ci sono anche i comandi che prima vivevano nascosti: rallentando, cambio di metro, ritornelli, doppia barra, testo, aggiungi e togli misura.

### ✍️ Scrittura
- **La voce si sceglie col cursore**: cliccando sul rigo si scrive nella voce di quella zona, e il fantasma ne prende il colore prima ancora del clic. Il tasto V resta e ha l'ultima parola.
- **Accordi per sigla anche sul coro**: l'accordo scritto si sente subito, come ogni nota inserita col mouse.

### 📥 Import ed export
- **Tutto il nuovo esce e rientra**: dinamiche, articolazioni, legature, 8va, cambi d'armatura — in MusicXML e, dove ha senso, in MIDI.
- **L'export per non vedenti funziona anche per i brani strumentali.** Un pezzo importato entra come *traccia*, non nel coro: prima quel file usciva vuoto e senza una riga d'analisi. Ora porta le note di cui l'analisi parla — e se le parti sono quattro, tutte e quattro.
- **Il tenore in chiave di violino con l'8 sotto** — come lo scrivono i corali — arriva dove deve: prima compariva un'ottava più in basso, con due tagli addizionali.
- **Ogni parte dichiara il proprio strumento**: senza, chi apriva il file lo indovinava dal nome, e un rigo chiamato «Tenore» veniva letto come sax tenore, con le note spostate di un tono.
- Le dinamiche di un file importato entrano come **segni**, non più solo come volume; le forcelle prima si perdevano del tutto.

### 🔊 Audio
- **Riavvia il motore audio** (menù *Partitura*): quando il suono non esce più — cuffie staccate, uscita cambiata, sistema audio non pronto all'avvio — si rimette in moto senza chiudere il programma e senza perdere il lavoro.

### ⌨️ Aiuto
- **L'elenco delle scorciatoie è stato riscritto leggendo il codice**: diceva che T è la legatura (T apre le proprietà, la legatura è L) e ne mancava una quindicina, fra cui l'importazione MusicXML.

## Novità in v1.4.1

### ♿ Accessibilità
- **Scorciatoia per importare MusicXML: ⌘⇧I** (Ctrl+Shift+I su Windows). L'importazione MIDI aveva già ⌘I, quella MusicXML nessuna: per chi lavora con uno screen reader il menù è la strada principale, e una voce senza scorciatoia costa ogni volta la navigazione dell'intero menù — proprio sulla via d'ingresso più usata da chi scambia file con altri programmi di notazione.

## Novità in v1.4.0

### ✍️ Scrittura
- **Coro a 3 o 2 parti**: dal menù *Altro ▸ Parti* si sceglie fra 4 (S A T B), 3 (S A B) e 2 (S B). Le voci spente spariscono dalla toolbar e non sono più scrivibili; la voce più grave resta il Basso, così le regole d'analisi mantengono il loro significato. Ridurre le parti non cancella nulla: se contengono musica il cambio viene rifiutato.
- **Spostamento delle note col mouse**: si trascina la testa in verticale, l'anteprima segue a scatti di un grado e al rilascio l'altezza è scritta. Muove tutta la selezione (un accordo si alza in un gesto), vale anche sulle tracce di accompagnamento. È diatonico — la grafia viene dall'armatura — mentre le frecce restano cromatiche.
- **Riscrittura enarmonica (tasto J)**: Re♯ ⇄ Mi♭ sulla selezione, stesso suono e grafia coerente.

### 🔎 Analisi
- **Grafia incoerente**: quando le note scritte non formano alcun accordo (per esempio Re♯–Sol–Si♭, dove da Re♯ a Sol c'è una quarta diminuita), l'analisi lo segnala e indica la nota da riscrivere. La sigla dedotta dai suoni compare **fra parentesi**, per non far credere che corrisponda a ciò che è scritto.
- **Sigle**: una quinta *assente* non viene più dichiarata diminuita (una settima minore senza quinta era siglata m7♭5).
- **Nuova eccezione**: quinta per moto retto fra i primi rivolti di IV e V, ammessa anche con salto in entrambe le parti.
- **Sequenze**: una sequenza deve ripetere anche il **ritmo**, non solo gli intervalli.
- **Incrocio delle parti** riconosciuto anche con meno di quattro voci; a due parti niente più avviso di "accordo incompleto".
- **Appoggiatura dichiarata a mano**: non torna più a essere marcata come ritardo.
- Titoli delle violazioni tradotti anche quando sono composti dinamicamente.

### 🎼 Impaginazione
- **Vista a nastro continuo**: tutte le misure su un rigo solo, scorrimento orizzontale.
- **L'impaginazione segue lo zoom**: rimpicciolendo entrano più misure per riga, invece di lasciare la fascia bianca a destra.
- **Spaziatura per contenuto**: ogni misura prende la larghezza che il suo contenuto richiede. Le etichette d'analisi seguono l'impaginazione in tutti i casi.

### 📥 Import ed export
- **Il dialogo dice cosa contiene il file** prima di chiedere dove metterlo: parti, numero di note, righi, chiave, strumento.
- **Strumento dedotto dal file** (Program Change nei MIDI, lista delle parti nei MusicXML) invece del pianoforte per tutto.
- **Percussioni riconosciute** dal canale 10 o dal nome della traccia, con il kit (orchestrale o rock) scelto dai pezzi usati; restano una traccia a sé anche fondendo le altre.
- **MusicXML**: esporta anche le tracce di accompagnamento; l'import non azzera più il progetto.
- **Trasporto per intervallo** e non per soli semitoni: cambiando tonalità la grafia resta corretta (Cm→Dm: Si♮ diventa Do♯, non Re♭).

### 🔊 Audio
- **Gli effetti del mixer si sentono anche cliccando le note**, non solo in riproduzione: volume, mute, solo, pan, EQ, compressore e riverbero passano dagli stessi canali.
- **Coda delle note**: il rilascio ora si spegne in modo esponenziale invece di essere tagliato di netto (si sentiva soprattutto sugli archi).

### 🐛 Fix
- Legature lunghissime sui file importati: ora la legatura unisce solo suoni contigui, e quella che continua a capo è un gancio breve.
- Crash aprendo una traccia MIDI con terzine.
- Il trascinamento parte al primo grado invece che dopo tre.

## Novità in v1.3.0

### ⚡ Prestazioni — editing fluido con l'analisi attiva
- **Analisi armonica off-thread**: il calcolo dell'analisi gira ora in un **Web Worker** separato e non blocca più l'interfaccia.
- **Editing molto più reattivo su brani lunghi**: inserimento, spostamento e selezione delle note restano fluidi anche con l'analisi attiva su partiture di molte misure. Cursore di riproduzione e overlay d'analisi ridisegnati in modo imperativo, senza ricalcolare l'intero brano a ogni azione.

### 🎼 Analisi — nuove numerazioni
- **Numerazione "scuola romana"**: opzione per numerare col **grado reale della nota al basso** (in maiuscolo, con le alterazioni) per il SATB.
- **Basso figurato più corretto**: le cifre rispettano l'**armatura di chiave** — aggiunta di ♯/♮ dove serve e soppressione degli accidenti ridondanti.

### 🐛 Fix
- **Spostamento cromatico delle note importate**: alzando o abbassando di un semitono una nota importata da MusicXML (es. un Mi♭ verso Mi in Do minore) ora compare correttamente il **♮** — prima la nota sembrava non essersi mossa.
- **Spiegazioni dell'analisi**: si aggiornano correttamente al cambio di lingua.

## Novità in v1.2.2

### 🐛 Fix download macOS (Apple Silicon)
- **Installer .dmg separati per architettura**: prima veniva pubblicato un solo `.dmg` (Intel) e i Mac **Apple Silicon** scaricavano dal sito la versione sbagliata. Ora vengono generati e pubblicati **due installer distinti** — Apple Silicon (arm64) e Intel (x64) — con nomi corretti anche nel manifest di auto-update.

## Novità in v1.2.1

### 🎹 Import MIDI multi-traccia + analisi d'insieme
- **Import MIDI a più tracce**: un file su più pentagrammi (es. una partitura MuseScore) viene importato con **un rigo per parte**, con chiave e nome presi dal file. All'import si sceglie tra SATB, Accompagnamento a **righi separati** o Accompagnamento **grand staff unico**.
- **Analisi armonica d'insieme**: le parti di uno stesso brano vengono lette **insieme** (sigla + numero romano sopra il gruppo), con un interruttore per includere/escludere una traccia; i righi del gruppo sono uniti da graffa e stanghette.

### 🎼 Grafia e analisi
- **Sensibile in minore all'import MIDI**: il tasto della sensibile viene scritto col **diesis** (es. Do# in Re minore) invece del bemolle d'armatura.

### 🖨️ Export
- **"Esporta musica"**: un unico dialogo unifica **MIDI**, **MusicXML** (con analisi visibile) e le modalità **per non vedenti** (Parlata / Token).

### 🐛 Fix
- **Import MusicXML**: le pause di misura senza `<type>` (tipiche di MuseScore) non slittano più l'audio.
- Affinamenti visivi delle tracce di accompagnamento (romani sopra il rigo, righi compattati).

## Novità in v1.2.0

### 🥁 Batteria evoluta
- **Traccia di batteria a 2 voci con stem separati**, pause indipendenti per layer e **Drum Mix per-pezzo in tempo reale** (cassa, rullante, charleston… regolabili mentre suona).

### 🎚️ Mixer — suite effetti completa
- **Catena FX per ogni canale**: pan, mandata **riverbero** (Room / Hall / Plate), **EQ a 3 bande** e **compressore**, in finestre flottanti stile plug-in (grafici, meter di riduzione; rotella sul punto centrale dell'EQ = regola il Q). Gli stessi EQ e compressore sono disponibili anche sul **master** e — novità della 1.2.0 — **sui bus di gruppo SATB e ACC**, per modellare coro e accompagnamento separatamente.
- **Chiave selezionabile direttamente cliccando sul pentagramma**.

### 🎻🎹 Suoni — scelta del banco
- **Banco timbrico per voce e traccia: Orchestrale o GM**, scegli e mescola liberamente (es. GM sulle parti interne, Orchestrale sulla melodia).

### ✅ Selezione multipla nel mixer
- **Canali selezionabili** (pallino in cima allo strip, **Shift-clic** per intervalli) con **azioni d'insieme**: Mute, Solo, Elimina; e **fader collegati** (trascinandone uno, si muovono insieme tutti i selezionati mantenendo il bilanciamento).

### 🐛 Fix
- Violino: livellata la fascia **B–D** (copre una "buca" timbrica percepita).
- **Mute/Solo azzerati all'apertura di un progetto**: i file vecchi (pre-mixer) non restano più silenziati ereditando lo stato mute/solo della sessione precedente.

## Novità in v1.1.0

### 🎚️ Mixer unificato
- Nuova **finestra mixer flottante** per le voci SATB e le tracce ACC: **colore** e **rigo/chiave** per traccia, **fader master** SATB / ACC / MIX, menu **"+"** per aggiungere tracce, **canale MIDI in uscita** per ciascun canale.

### 🎹 Tracce di accompagnamento (ACC)
- Editing manuale completo, **pattern di inserimento** (Block / Arpeggi), **copia/incolla cross-track** SATB ⇄ ACC, **copia di un'intera voce SATB**, **chiavi traspositrici 8vb** (basso e chitarra).

### ⏺ MIDI e dinamiche
- **Registrazione MIDI in tempo reale** con quantizzazione, **dinamiche (velocity)**, **import MIDI** migliorato, **output MIDI esterno** (Program Change per voce verso la DAW).

### 🎼 Analisi e tempo
- **Analisi armonica guidata dall'accompagnamento**; curve di **Rallentando / Accelerando**.

### 🖨️ Export e stampa
- **Export MIDI** e **stampa/PDF** con impaginazione e guida ai salti pagina.

### 🆕 Altro
- **Nuovo progetto** con scelta tracce e template; menu **"Informazioni…"**; nuovi suoni per la **sezione ritmica** (bassi).

### 🔧 Sotto il cofano
- Riscrittura **"spelling-first"** del riconoscimento accordi; vari fix, inclusi quelli di **licenza su Windows**.

## Novità in v1.0.17

### 🐛 Fix critico attivazione su Windows (trial scaduto)
- **Risolto un secondo bug Windows-specifico nel flusso di attivazione all'avvio**: quando il trial era scaduto e l'app mostrava il dialog di inserimento chiave PRIMA della finestra principale, su Windows la chiusura della finestrella di input (dopo il click su "Attiva") faceva scattare il listener `window-all-closed` di Electron, che chiamava `app.quit()` interrompendo la richiesta HTTP al server di licenze. Risultato: il dialog si chiudeva e l'app terminava senza alcun messaggio, prima che la chiave potesse essere validata. Il bug non si manifestava su macOS (dove `window-all-closed` non chiude l'app) né dal menu "Gestisci Licenza" (dove la finestra principale è già aperta). Ora un flag protegge il flusso di attivazione iniziale dalla chiusura automatica.

## Novità in v1.0.16

### 🐛 Fix critico attivazione licenza
- **Risolto bug bloccante nel dialog di inserimento chiave**: in v1.0.15 il preload chiamava un'API Electron inesistente (`exposeInWorld` invece di `exposeInMainWorld`), facendo fallire silenziosamente il caricamento dell'API IPC. Conseguenza: cliccando "Attiva" non veniva inviato alcun messaggio al processo principale, la chiave non veniva mai trasmessa al server di licenze e l'utente restava in un loop infinito tra "Inserisci Chiave" e "Acquista Licenza". Ora l'attivazione funziona correttamente su tutte le piattaforme.

## Novità in v1.0.15

### 🐛 Fix attivazione licenza su Windows
- **Riscritta la comunicazione del dialog inserimento chiave**: sostituito il meccanismo basato sul titolo della finestra (inaffidabile su Windows) con IPC nativo di Electron. La chiave viene ora trasmessa in modo sicuro e garantito su tutti i sistemi operativi.

## Novità in v1.0.14

### 🐛 Fix attivazione licenza
- **Risolto bug silenzioso nell'inserimento chiave di licenza su Windows**: in alcuni casi la chiave inserita non veniva trasmessa correttamente al processo principale (race condition), causando un loop silenzioso senza feedback. L'attivazione ora è robusta su tutti i sistemi operativi.
- **Errore di attivazione ora mostrato in un dialog dedicato** con opzione "Riprova" o "Annulla", invece di essere nascosto nel testo del messaggio principale.

## Novità in v1.0.13

### 🐛 Fix licenza
- **Voce "Gestisci Licenza…" sempre visibile nel menu** (non solo alla scadenza del trial): su macOS nel menu "Harmony Tutor", su Windows/Linux nel menu "Visualizza". Permette di inserire o gestire la licenza in qualsiasi momento.

## Novità in v1.0.10

### 🐛 Fix analisi armonica
- **Cadenza ii°→V→i rilevata anche con dominanti decorati** (es. A°→D7♭9→D11→D7→Gm in Life on Mars): eventi consecutivi sulla stessa root e stessa famiglia di quality vengono ora collassati per il pattern matcher
- **R-06 (salto melodico aug/dim) non scatta più su unisoni enarmonici**: intervalli come Bb→Cb, Cb→Bb, B#→C, Fb→E (≤ 2 semitoni reali) non sono più segnalati come errori di risoluzione
- **MIDI corretto per note octave-boundary** (Cb5, B#3 ecc.): la formula di calcolo ora considera lettera + alterazione, eliminando errori di ottava su spelling cross-letter

### 🐛 Fix sigle accordali
- **Triadi aumentate ora siglate per spelling delle terze**, non per nota al basso. Es. [Db, F, A] con A al basso → `Caug/A` (non `Aaug`); [G#, C, E] → `Caug/G#` (non `G#aug`). L'analisi armonica funzionale (Roman) resta invariata e continua a riconoscere correttamente `V+` in minore
- **Override ornamentali manuali (⌥O) ora rispettati anche dalla sigla**: marcando una nota con ⌥O viene esclusa anche dal computo del simbolo accordale (prima solo l'analisi Roman lo faceva). Es. melodia Eb sopra Gb-Bb-D → con ⌥O sull'Eb la sigla diventa `GbAug` (non più `EbmMaj7/Gb`)

### 🐛 Fix UI
- **Menu Aiuto → Scorciatoie** ora apre una finestra autonoma chiudibile (era una sheet macOS bloccata che superava l'altezza dello schermo, nascondendo il bottone OK)

## Novità in v1.0.9

### 🎵 Analisi armonica
- Cadenza d'inganno (V → vi/VI/♭VI) ora rilevata e mostrata nel pannello con tratteggio verde
- Cadential 6/4: I⁶⁄₄ → V → I rietichettato come V⁶⁄₄ → V → I (lettura funzionale moderna)

### 🎼 Editor
- Rallentando/accelerando: nuova curva di tempo applicabile a un range di note (effetto playback)
- Corona (fermata) sulle note con espansione automatica nel playback
- Analysis Lock: blocca l'analisi armonica con password (uso didattico)

### 🐛 Fix
- TempoCurve ora persistito correttamente nel file .htp
## Novità in v1.0.6

### 🎵 Analisi armonica — fix maggiori

- **ii° vs vii° per accordi diminuiti**: gli accordi diminuiti vengono ora etichettati correttamente in base al contesto. Un ii°7 in tonalità minore (es. Am7♭5 in Sol min) non viene più confuso con vii°7. Nuova regola di risoluzione: se l'accordo risolve al semitono superiore, è sempre vii°/X (dominante secondaria)
- **Override tonale manuale rispettato**: i modulation override inseriti manualmente non vengono più sovrascritti dal guard automatico "I/i in home key" — gli accordi come F in Bb major vengono ora etichettati V (non I)
- **Sigle accordali con spelling corretto**: C#7 genera ora C#–E#–G#–B (non C#–F–G#–B). La root dell'accordo mantiene la lettera originale attraverso tutta la pipeline
- **Cadential pattern ii°→V→I/i**: riconosciuto sia in tonalità minore (ii°7→V7→i) che maggiore con ii° prestato (ii°→V→I), inclusa la variante a 3 slot ii°→V→I in major

### 🔡 Enarmonia — refactoring fondamentale (Fase 2)

- Nuovo tipo `SpelledPitch` (lettera + alterazione) che preserva l'intenzione di scrittura attraverso l'intera pipeline di analisi
- `identifyChordCandidates` porta ora `rootSpelled` — la root dell'accordo usa la lettera originale della nota (C# rimane C#, non diventa Db)
- `calculateRomanNumeral` calcola il grado Romano tramite relazione diatonica (letter-steps) invece di aritmetica su pitch class
- `getChordSymbol` genera il simbolo partendo da `rootSpelled`, non da pc-lookup
- Calcolo ottava corretto per accidentali cross-letter (Cb5, E#3 ecc.)
- `ALL_NOTE_SPELLINGS` espanso con E#, Cb, Fb, B# per chord-spelling; nuovo `CROSS_LETTER_ENHARMONICS` per escluderli dal naming dell'editor
- Eliminato `src/data/constants.ts` (duplicato morto); unificate le 3 tabelle `NOTE_TO_PC`

### 🎹 Rilevamento modulazioni — miglioramenti

- **Note ornamentali rispettate**: le note marcate con ⌥O non vengono più usate nella cadential pattern detection — risolve i falsi positivi su pezzi con molte note di passaggio
- **Dedup eventi accordali**: eventi consecutivi con stesso accordo collassati prima del pattern matching — risolve i falsi negativi su pattern a 3 slot (ii°→V→i)
- **Preferenze analisi come prop React**: i toggle "Inferisci contesti" e "Riconoscimento pattern cadenzali" ora aggiornano le etichette in tempo reale

### 🖱️ UX

- **Selezione note vicine migliorata**: la banda Y del proximity-pick ridotta a 5px — note a distanza di seconda/terza vengono ora selezionate con maggiore precisione
- **⌥Alt+Click** su note sovrapposte cicla tra i candidati

### 🔧 Fix vari

- Sigle inserite da tastiera (C#, F# ecc.) ora mostrate sempre con # e non convertite in enarmonico bemolle
- Accordi half-diminished non più riscritti come vii°/X quando le note sono diatoniche
- Fix octave per note come Cb/E# nella voicizzazione corale e nel parser simboli
