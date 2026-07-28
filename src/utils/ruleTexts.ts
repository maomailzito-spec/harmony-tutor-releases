/**
 * ruleTexts.ts — Registro centralizzato dei testi educativi per le regole.
 *
 * Ogni regola ha:
 *   - body:       testo multi-riga espandibile (visibile cliccando ▼ nel pannello).
 *                 Se vuoto (''), non viene aggiunto al description.
 *   - suggestion: consiglio mostrato come "Consiglio:" nel pannello.
 *                 Se vuoto (''), il caller inline prevale.
 *
 * ━━━ Come funziona l'auto-enrichment ━━━
 * `addViolation()` in musicTheory.ts consulta questo registro:
 *   1. Se description NON contiene '\n' E body ≠ '', appende '\n' + body.
 *   2. Se suggestion del caller è undefined/vuota E suggestion ≠ '', usa quella del registro.
 *
 * ━━━ Rendering (HarmonyAnalysisPanel.tsx) ━━━
 *   description.split('\n') → riga 0 = intestazione (sempre visibile), righe 1+ = dettaglio ▼.
 */

export interface RuleText {
  /** Testo educativo espandibile (righe 2+). Vuoto = nessun body aggiuntivo. */
  body: string;
  /** Consiglio ("Consiglio:"). Vuoto = il caller inline prevale. */
  suggestion: string;
}

// ────────────────────────────────────────────────────────────
// REGISTRO
// ────────────────────────────────────────────────────────────

// --- INIZIO ESTRAZIONE TESTI ITALIANI ---
// Copia aggiornata di tutti i testi (body, suggestion) delle regole, errori, eccezioni, ornamenti, cadenze.
// Da usare per traduzione o revisione.
// ATTENZIONE: questa sezione è solo per estrazione/copia, non modificare qui!

// --- FINE ESTRAZIONE TESTI ITALIANI ---
export const RULE_TEXTS: Record<string, RuleText> = {
  // ═══════════════════════════════════════════════════════════
  // 1. ERRORI DI CONDOTTA VOCALE (error)
  // ═══════════════════════════════════════════════════════════

  'R-01': {
    body: [
      'Le ottave parallele si verificano quando due voci si muovono nella stessa direzione (moto retto) mantenendo tra loro l\'intervallo di ottava (o unisono) per due accordi consecutivi.',
      'Questo è uno degli errori più gravi nella scrittura a più voci: le due parti perdono la loro indipendenza melodica e si fondono in un\'unica linea, riducendo di fatto il tessuto a tre voci anziché quattro. La tradizione polifonica considera le ottave parallele una violazione fondamentale dell\'indipendenza delle parti.',
      'Il divieto vale per qualsiasi coppia di voci e per qualsiasi tipo di moto retto: non è attenuato dal fatto che le voci si trovino in voci interne.',
      'Le ottave sono invece permesse per moto obliquo (una voce ferma) e tollerate per moto contrario in certi contesti.',
    ].join('\n'),
    suggestion: 'Modifica la condotta di una delle due voci: porta almeno una in moto contrario o obliquo rispetto all\'altra, oppure ridistribuisci le note dell\'accordo per cambiare l\'intervallo tra le voci coinvolte.',
  },

  'R-02': {
    body: [
      'Le quinte parallele si verificano quando due voci si muovono nella stessa direzione (moto retto) mantenendo tra loro l\'intervallo di quinta giusta per due accordi consecutivi.',
      'Come le ottave, le quinte parallele compromettono l\'indipendenza delle parti: la quinta giusta è un intervallo così "vuoto" e consonante che due voci che la mantengono in moto retto sembrano fondersi, perdendo individualità melodica. È uno degli errori più codificati della teoria armonica classica, presente in tutti i trattati senza eccezioni.',
      'Il divieto si applica esclusivamente alla quinta giusta: la quinta diminuita non è soggetta allo stesso divieto (anche se va trattata con cura). Le quinte per moto contrario sono invece tollerate, e quelle per moto obliquo sono permesse.',
    ].join('\n'),
    suggestion: 'Modifica la condotta di una delle due voci portandola in moto contrario o obliquo. Una soluzione frequente è cambiare il raddoppio dell\'accordo o scegliere una diversa disposizione delle note tra le parti.',
  },

  'R-02c': {
      body: [
        'Due quinte perfette consecutive sono vietate anche quando le voci si muovono in direzioni opposte (moto contrario). Il divieto delle quinte parallele si estende a qualsiasi successione di due quinte giuste tra le stesse voci, indipendentemente dal tipo di moto.',
        'Il moto contrario attenua molte infrazioni nella scrittura a più voci, ma non questo: la successione di quinta giusta su quinta giusta produce comunque un effetto di vuoto armonico che i trattati classici condannano senza eccezioni.',
      ].join('\n'),
    suggestion: 'Interponi tra le due quinte un accordo con intervallo diverso, oppure modifica il raddoppio in modo da evitare la successione. Anche una sola quinta deve essere evitata se seguita immediatamente da un\'altra quinta tra le stesse voci.',
  },

  'R-04': {
      body: [
        'Si ha incrocio di voci quando una parte scende al di sotto della parte immediatamente inferiore, o sale al di sopra di quella immediatamente superiore. Nel coro SATB le voci devono rispettare l\'ordine di altezza: Soprano sopra l\'Alto, Alto sopra il Tenore, Tenore sopra il Basso.',
        'L\'incrocio è considerato grave perché altera la percezione delle singole linee vocali: l\'ascoltatore perde il filo di ciascuna parte e il tessuto armonico diventa confuso. Nella scrittura accademica è un errore di condotta delle parti da evitare sistematicamente.',
        'L\'incrocio si distingue dall\'attraversamento (crossing): nell\'incrocio le voci si scambiano di posizione per più di un battito, mentre l\'attraversamento è momentaneo e in certi contesti stilistici tollerato.',
      ].join('\n'),
    suggestion: 'Riordina le altezze rispettando la gerarchia delle voci. Se la linea melodica lo richiede, valuta una distribuzione diversa delle note dell\'accordo tra le parti.',
  },

  'R-06': {
      body: [
        'Gli intervalli melodici diminuiti e aumentati sono considerati difficili da intonare e creano tensione nella linea vocale. Per questo motivo richiedono una risoluzione immediata: dopo il salto, la voce deve invertire la direzione e procedere per grado congiunto.',
        'Esempio: dopo un salto di quarta aumentata ascendente (es. Fa→Si), la voce deve scendere per grado (Si→La o Si→Do). Dopo una quinta diminuita discendente, la voce deve salire per grado.',
        'quando si percorre la quarta eccedente (tritono) anche in due movimenti, l\'ultima nota deve proseguire ascendendo per semitono diatonico oppure scendendo per grado congiunto.',
        'La "risoluzione parziale" — quando la voce continua nella stessa direzione per grado congiunto invece di invertire — è considerata insufficiente e rimane un\'infrazione.',
      ].join('\n'),
    suggestion: 'Dopo un salto diminuito o aumentato, inverti la direzione della voce e procedi per grado congiunto (seconda maggiore o minore). Se la linea melodica non lo permette, sostituisci l\'intervallo con un salto consonante o con un movimento per gradi.',
  },

  'R-07': {
      body: [
        'La sensibile (VII grado della scala) ha una forte tendenza funzionale a salire di semitono alla tonica. Questa tendenza è particolarmente obbligatoria nelle voci esterne (Soprano e Basso) e negli accordi di dominante (V e V7).',
        'Quando la sensibile non risolve alla tonica — scendendo invece di salire, o saltando a un\'altra nota — l\'effetto cadenzale si indebolisce e la scrittura perde direzione tonale.',
        'Nelle voci interne (Alto e Tenore) la regola è meno rigida: in certi contesti la sensibile può scendere alla quinta dell\'accordo di tonica per evitare raddoppi problematici o ottave parallele. Tuttavia questa licenza va usata con consapevolezza e non sistematicamente.',
      ].join('\n'),
    suggestion: 'Porta la sensibile alla tonica per semitono ascendente. Nelle voci interne, se la risoluzione diretta crea parallele o raddoppi errati, è accettabile scendere di terza alla quinta dell\'accordo di tonica, ma solo come soluzione alternativa motivata.',
  },

  'R-09': {
      body: [
        'La falsa relazione cromatica si verifica quando una nota in una voce è seguita, nell\'accordo successivo, dalla sua alterazione cromatica in una voce diversa. Ad esempio: il Soprano presenta un Fa naturale, e nel battito seguente il Basso (o un\'altra voce) presenta Fa diesis.',
        'Questo crea una contraddizione armonica percepibile all\'ascolto: due voci diverse affermano simultaneamente due versioni incompatibili della stessa nota. Nella scrittura tonale tradizionale è considerato un errore, perché rompe la coerenza del piano tonale.',
        'La falsa relazione è invece tollerata — e talvolta ricercata — nello stile rinascimentale polifonico e in certi contesti del tardo romanticismo, ma non nella scrittura armonica accademica standard.',
      ].join('\n'),
    suggestion: 'Assegna l\'alterazione cromatica alla stessa voce che aveva la nota naturale, così che il semitono cromatico avvenga all\'interno di una sola parte. In alternativa, modifica la progressione armonica per evitare l\'accostamento.',
  },

  'R-10': {
    body: [
      'La sensibile (VII grado della scala) ha una forte tendenza funzionale a salire di semitono alla tonica. Raddoppiarla significa avere due voci che portano la stessa nota con la stessa tensione direzionale: entrambe dovranno salire alla tonica, generando quasi inevitabilmente ottave parallele nell\'accordo successivo.',
      'Per questo motivo il raddoppio della sensibile è considerato un errore grave, particolarmente nell\'accordo di dominante (V e V7) dove la sensibile ha il suo ruolo più marcato.',
      '• Nelle sequenze e progressioni imitative: il raddoppio può essere tollerato quando la necessità di mantenere la simmetria del disegno melodico tra modello e imitazione prevale sulla purezza del raddoppio.',
      '• Nell\'accordo V7: il problema è aggravato dalla presenza della settima; entrambe le note dissonanti (sensibile e settima) esercitano pressione sulla risoluzione.',
      '• Negli accordi viiø7 e vii°7: la tensione cumulata è già massima; raddoppiare la sensibile la aggrava ulteriormente.',
      '• In voce interna (Alto o Tenore): il raddoppio è meno grave ma andrebbe comunque evitato quando possibile.',
    ].join('\n'),
    suggestion: 'Ridistribuisci le note dell\'accordo raddoppiando invece la fondamentale o la quinta. Se il raddoppio della sensibile è l\'unica soluzione disponibile, assicurati che le due voci non creino ottave parallele nella risoluzione — una può salire alla tonica, l\'altra può scendere alla quinta.',
  },

  'R-10-7TH': {
    body: [
      'La settima di un accordo è una dissonanza che deve risolvere scendendo di grado nell\'accordo successivo. Raddoppiarla significa avere due voci che portano la stessa nota dissonante: entrambe dovranno scendere di grado nella stessa direzione, producendo quasi inevitabilmente ottave parallele nella risoluzione.',
      'Il problema è strutturale: non è possibile far risolvere correttamente due settime simultanee senza violare le regole di condotta delle parti. Per questo il raddoppio della settima è proibito in tutta la scrittura armonica classica.',
      '• Nell\'accordo V7: il problema è particolarmente grave perché la settima si trova in un accordo di massima tensione funzionale, dove la risoluzione è obbligatoria e netta.',
      '• Negli accordi viiø7 (semidiminuito): la settima è una settima minore, con tensione leggermente inferiore rispetto alla settima del V7; il problema resta però significativo.',
      '• Tipo di settima: la gravità varia in base al tipo — settima maggiore (massima tensione), settima minore, settima diminuita — ma in tutti i casi il raddoppio è da evitare.',
    ].join('\n'),
    suggestion: 'Elimina il raddoppio della settima distribuendo le note dell\'accordo in modo da avere una sola voce sulla settima. Negli accordi di settima a quattro voci è spesso la quinta a essere omessa per lasciare spazio alla settima senza raddoppiarla.',
  },

  'R-10-DIM5': {
    body: [
      'La quinta diminuita è un intervallo instabile con una tendenza a restringersi verso la terza (le due note si avvicinano per semitono). Raddoppiare una delle note che formano questo intervallo crea problemi analoghi al raddoppio della sensibile: la voce aggiuntiva è vincolata a muoversi nella stessa direzione della risoluzione, generando rischi di parallele.',
      'Nell\'accordo di vii° (accordo di sensibile), la quinta diminuita è formata dalla sensibile (che sale) e dal quarto grado della scala (che scende). Raddoppiare una di queste note aggiunge ulteriore pressione direzionale in un accordo già molto teso.',
      '• Quando la quinta diminuita è una nota cromatica (alterazione accidentale): il contesto può rendere il raddoppio meno problematico, ma va comunque valutato con attenzione.',
    ].join('\n'),
    suggestion: 'Ridistribuisci le note dell\'accordo raddoppiando la fondamentale invece della quinta diminuita. Se l\'accordo è vii° o vii°7, preferisci raddoppiare il terzo grado (la terza dell\'accordo) piuttosto che la quinta diminuita.',
  },

  'R-10-64': {
    body: [
      'Il secondo rivolto di una triade (accordo in posizione 6/4) ha la quinta dell\'accordo al basso. Nella sua forma cadenzale — il I6/4 che precede la dominante — questo accordo non è un accordo di tonica autonomo ma una preparazione della dominante: le voci di sesta e quarta devono scendere per grado alla quinta e alla terza della dominante.',
      'La regola del raddoppio nel 6/4 cadenzale è precisa: si deve raddoppiare la quinta (cioè la nota al basso), che rimarrà ferma come pedale mentre le altre voci scendono. Raddoppiare invece la fondamentale o la terza compromette la funzione cadenzale e crea problemi di condotta nella risoluzione.',
      '• 6/4 cadenzale: la regola del raddoppio è rigida — solo la quinta (basso) va raddoppiata.',
      '• 6/4 di passaggio: il raddoppio è meno critico perché l\'accordo ha funzione melodica di transizione.',
      '• 6/4 di volta e pedale: la funzione diversa rende il raddoppio valutabile con meno rigore.',
    ].join('\n'),
    suggestion: 'Nel 6/4 cadenzale raddoppia esclusivamente la nota al basso (quinta dell\'accordo). Assicurati che nell\'accordo successivo (la dominante) le voci di sesta e quarta scendano per grado congiunto.',
  },

  'R-10-3RD': {
    body: [
      'In un accordo in stato fondamentale la scelta di raddoppio preferita è la fondamentale (o in subordine la quinta). La terza — specialmente se maggiore — è la nota meno indicata da raddoppiare perché è quella che caratterizza più marcatamente il modo dell\'accordo, e la sua presenza doppia può appesantire il suono e creare difficoltà di condotta.',
      'La regola non è assoluta: in certi contesti il raddoppio della terza è non solo accettabile ma raccomandato.',
      '• In progressioni imitative e sequenze: la necessità di mantenere la simmetria del disegno melodico prevale; il raddoppio è tollerato.',
      '• Nella cadenza d\'inganno V–VI: il VI grado che segue la dominante ha la terza che corrisponde alla tonica; raddoppiarla è raccomandato per favorire la condotta corretta delle voci ed evitare ottave parallele.',
      '• Nell\'accordo napoletano (bII): il raddoppio della terza (IV grado della scala) è la scelta preferibile per sottolineare la funzione dell\'accordo.',
      '• In primo rivolto: se la nota al basso (la terza dell\'accordo) è un grado forte della scala (I, IV o V), il suo raddoppio è accettabile.',
      '• Accordi minori: la gravità del warning è ridotta — il raddoppio della terza minore è considerato molto più accettabile rispetto alla terza maggiore.',
    ].join('\n'),
    suggestion: 'In stato fondamentale, privilegia il raddoppio della fondamentale. Se il contesto richiede il raddoppio della terza (cadenza d\'inganno, accordo napoletano, sequenza imitativa), verifica che la condotta delle voci sia corretta e che non si creino parallele nella progressione.',
  },

  'R-10-6': {
    body: [
      'Nel primo rivolto (accordo di sesta) la terza dell\'accordo si trova al basso. La scelta di raddoppio in questa posizione è più flessibile che nello stato fondamentale, ma segue comunque delle preferenze.',
      'La regola generale è di preferire il raddoppio della fondamentale o della quinta — non della terza, che si trova già al basso. Raddoppiare la nota al basso in primo rivolto crea una disposizione ridondante e può appesantire il passaggio.',
      'Tuttavia il contesto può giustificare il raddoppio della nota al basso:',
      '• Gradi forti della scala al basso (I, IV o V): quando la terza dell\'accordo in primo rivolto è un grado tonale forte, il suo raddoppio è ammesso e talvolta preferibile per la stabilità armonica.',
      '• Condotta delle voci: se il raddoppio della fondamentale o della quinta creerebbe problemi di parallele o di spaziatura, il raddoppio della terza (basso) è accettabile come soluzione alternativa motivata.',
    ].join('\n'),
    suggestion: 'In primo rivolto preferisci raddoppiare la fondamentale o la quinta. Se la nota al basso è un grado forte della scala (I, IV o V), il suo raddoppio è accettabile. Valuta sempre la condotta complessiva delle voci prima di scegliere il raddoppio.',
  },

  'R-12': {
    body: [
      'La settima di un accordo è una dissonanza che ha un obbligo preciso: deve risolvere scendendo di grado (seconda) nell\'accordo successivo. Questo movimento discendente è uno dei principi fondamentali della condotta delle voci nella scrittura tonale classica.',
      'Quando la settima non scende di grado — salta a un\'altra nota, rimane ferma senza diventare nota armonica del nuovo accordo, o sale — la dissonanza rimane irrisolta e il passaggio perde coerenza tonale.',
      'La regola vale per tutti i tipi di accordi di settima (V7, ii7, IV7, vii°7, ecc.) con alcune eccezioni riconosciute:',
      '• Risoluzione trasferita: la settima può essere "raccolta" da un\'altra voce che la porta alla risoluzione scendendo di grado.',
      '• Risoluzione ritardata: la settima può essere trattenuta per uno o più battiti come nota comune prima di scendere.',
      '• Settima trattenuta come nota armonica: se la settima diventa nota consonante dell\'accordo successivo (es. nelle catene di accordi di settima per quinta), la risoluzione può essere differita all\'accordo seguente.',
      '• Risoluzione ascendente: in voce interna e in presenza di circostanze speciali, la settima può risolvere salendo; è una licenza accettabile ma da usare con consapevolezza.',
    ].join('\n'),
    suggestion: 'Porta la voce che ha la settima a scendere di grado nell\'accordo successivo. Se la risoluzione diretta crea problemi di condotta, considera le alternative riconosciute: trasferimento a un\'altra voce, ritardo della risoluzione, o risoluzione ascendente in voce interna come ultima opzione.',
  },

  'R-17a': {
    body: [
      'Quando una voce compie due salti consecutivi nella stessa direzione e la loro somma produce una settima o una nona, l\'orecchio percepisce il contorno melodico complessivo come un unico grande salto dissonante. Anche se i singoli intervalli possono essere consonanti, il risultato è una linea melodica difficile da intonare e stilisticamente scorretta.',
      'Il problema non è nella singola nota ma nel profilo: una voce che salta per terza e poi ancora per quinta ascendente ha tracciato una settima, che è un intervallo proibito come salto melodico diretto. La scrittura accademica proibisce questo schema perché l\'ascoltatore "sente" il grande intervallo anche se è percorso in due tempi.',
      'Questa è un\'infrazione grave (error), più seria della variante R-17b dove uno dei movimenti è un grado congiunto.',
      'Condizione di sblocco: inserire un cambio di direzione tra i due salti, oppure sostituire uno dei due salti con un grado congiunto (seconda).',
    ].join('\n'),
    suggestion: 'Inserisci un cambio di direzione tra i due salti: dopo il primo salto ascendente, la voce deve scendere (anche di poco) prima di salire di nuovo. In alternativa, trasforma uno dei due salti in un movimento per grado congiunto (seconda maggiore o minore).',
  },

  'R-N-RES': {
      body: [
        'Ogni nota non armonica (ornamentale) ha una condotta attesa: la nota di passaggio scende o sale per gradi congiunti, l\'appoggiatura risolve per grado congiunto discendente (o più raramente ascendente), la nota di volta torna alla nota reale, e così via.',
        'Quando la nota successiva all\'ornamento non rispetta questa condotta attesa, la funzione ornamentale viene meno e la nota rischia di essere percepita come dissonanza irrisolta o come nota armonica fuori contesto.',
        'Questo non è sempre un errore grave: Bach e i compositori del periodo comune usano talvolta risoluzioni insolite per effetti espressivi. Nella scrittura accademica di base, tuttavia, è preferibile rispettare le condotte standard.',
      ].join('\n'),
    suggestion: 'Verifica la risoluzione dell\'ornamento e assicurati che proceda nella direzione attesa per quel tipo di nota non armonica. Se la risoluzione è intenzionalmente atipica, valuta se il contesto la giustifica stilisticamente.',
  },

  'R-AUG6-RES': {
      body: [
        'Gli accordi di sesta aumentata (italiano, francese, tedesco) contengono un intervallo di sesta eccedente tra il basso e una voce superiore. Questo intervallo ha una forte tensione direzionale: le due note che lo compongono devono espandersi verso l\'esterno, risolvendo normalmente sull\'accordo di dominante (V o V6/4 cadenzale).',
        'Quando la risoluzione non avviene sulla dominante, o le voci non si muovono nella direzione attesa, l\'accordo perde la sua funzione tensiva e il passaggio risulta armonicamente incoerente.',
      ].join('\n'),
    suggestion: 'L\'accordo di sesta aumentata risolve tipicamente su V: il basso scende di semitono (o sale di semitono a seconda del tipo) mentre la voce superiore sale di semitono. Assicurati che entrambe le voci si muovano verso l\'esterno verso la quinta della scala.',
  },

  'R-CAD64': {
      body: [
        'Il secondo rivolto dell\'accordo di tonica in posizione cadenzale (I6/4) è uno degli accordi più codificati della teoria armonica classica. Non è un accordo di tonica autonomo, ma una preparazione della dominante: le due "dissonanze" (la quarta e la sesta rispetto al basso) devono scendere per grado congiunto alla terza e alla quinta della dominante.',
        'Quando questo accordo non risolve su V — o le sue note non scendono nella direzione attesa — la funzione cadenzale viene completamente vanificata.',
      ].join('\n'),
    suggestion: 'Il I6/4 cadenziale deve risolvere su V: la sesta scende alla quinta, la quarta scende alla terza della dominante. Il basso rimane fermo sulla quinta della scala. Assicurati che l\'accordo successivo sia effettivamente la dominante.',
  },


  // ═══════════════════════════════════════════════════════════
  // 2. AVVERTIMENTI DI CONDOTTA VOCALE (warning)
  // ═══════════════════════════════════════════════════════════

  'R-03': {
      body: [
        'L\'unisono per moto retto (quando entrambe le voci si muovono nella stessa direzione per arrivare all\'unisono) è generalmente da evitare, poiché crea un effetto simile alle ottave parallele: le due voci convergono annullandosi reciprocamente.',
        'l\'unisono va sempre evitato e tollerato solo in casi difficili verso la tonica. Fa eccezione il contesto cadenzale tra Soprano e Contralto sulla tonica, preceduto da sensibile e secondo grado.',
      ].join('\n'),
    suggestion: 'Evita di far convergere due voci sull\'unisono per moto retto. Se l\'unisono è necessario, raggiungerlo per moto contrario o obliquo, e preferibilmente con almeno una voce che proceda per grado congiunto.',
  },

  'R-05': {
    body: [
      'Si ha quinta (od ottava) nascosta quando due voci si muovono nella stessa direzione (moto retto) per arrivare a una quinta o ottava giusta, anche se nell\'accordo precedente non erano in quel rapporto. L\'effetto è "nascosto" perché le quinte non sono consecutive, ma il movimento diretto verso di esse crea comunque un\'enfasi dell\'intervallo perfetto che i trattati classici considerano da evitare, specialmente nelle voci estreme.',
      'Le nascoste tra voci esterne (Soprano e Basso) sono più gravi di quelle tra voci interne. Per le voci interne il problema è attenuato e spesso classificato come semplice avvertimento.',
      'Eccezioni riconosciute: la nascosta è ammessa quando la voce superiore procede per grado congiunto (seconda); è ammessa tra voci interne su tutti i gradi se la voce più acuta procede per gradi; è ammessa su gradi tonali se è la voce inferiore a procedere per gradi congiunti; è sempre permessa per moto obliquo.',
    ].join('\n'),
    suggestion: 'Il modo più semplice per risolvere le nascoste è far procedere la voce superiore per grado congiunto (seconda) invece che per salto, oppure portare le due voci in moto contrario. Nelle voci interne l\'avvertimento è meno urgente e può essere accettato se la condotta complessiva è corretta.',
  },

  'R-08': {
      body: [
        'Nella scrittura a quattro parti, Soprano-Alto e Alto-Tenore non devono superare l\'intervallo di ottava tra di loro. Questa regola garantisce una distribuzione equilibrata delle voci e favorisce la fusione timbrica del coro.',
        'La spaziatura stretta (entro l\'ottava tra le voci superiori) è la norma nella scrittura corale accademica. Una distanza superiore crea un "buco" nel tessuto armonico, rendendo il suono meno compatto.',
        'Nota: il Basso può invece stare a distanza maggiore dal Tenore (fino a due ottave e quinta circa) senza che questo costituisca un\'infrazione grave.',
      ].join('\n'),
    suggestion: 'Redistribuisci le note dell\'accordo in modo che Soprano e Alto, e Alto e Tenore, non superino l\'ottava. Privilegia la disposizione stretta (close position) nelle voci superiori.',
  },

  'R-13': {
      body: [
        'Quando tutte e quattro le voci si muovono nella stessa direzione contemporaneamente, il risultato è un blocco armonico compatto ma privo di movimento interno. Questo tipo di condotta delle parti impoverisce la scrittura e, se prolungato, rischia di generare parallele o altri problemi di condotta.',
        'La scrittura a quattro parti deve tendere alla varietà di moto: l\'ideale è avere almeno una voce in moto contrario o obliquo rispetto alle altre. Il moto parallelo è accettabile in brevi passaggi, ma deve essere l\'eccezione e non la norma.',
        'Il contesto di sequenza o imitazione può giustificare il moto parallelo prolungato come necessità strutturale.',
      ].join('\n'),
    suggestion: 'Porta almeno una voce in moto contrario o obliquo rispetto alle altre. In genere è il Basso o il Soprano a garantire il moto contrario, creando l\'espansione e la contrazione armonica tipica della buona condotta delle parti.',
  },

  'R-14': {
      body: [
        'Si ha quinta (od ottava) nascosta quando Soprano e Basso si muovono nella stessa direzione (moto retto) per arrivare a una quinta o ottava giusta. L\'effetto è simile alle parallele: anche se le voci non erano in quinta prima, l\'arrivo "diretto" crea un\'enfasi dell\'intervallo perfetto che i trattati classici considerano da evitare nelle voci estreme.',
        'I trattati stabiliscono regole precise: l\'ottava per moto retto tra parti estreme è permessa solo se la parte superiore procede per seconda minore ascendente o discendente verso le tre note tonali; è tollerata con riserva su gradi tonali se il Soprano scende per seconda maggiore, principalmente in conclusione di frase.',
        'La quinta nascosta è permessa verso I e V se la parte superiore procede per intervallo congiunto; sugli altri gradi solo se la parte superiore procede per seconda minore discendente.',
      ].join('\n'),
    suggestion: 'Il modo più semplice per evitare le nascoste tra voci estreme è far procedere il Soprano per grado congiunto (seconda) invece che per salto, oppure portare Soprano e Basso in moto contrario.',
  },

  'R-15': {
      body: [
        'Le voci interne (Alto e Tenore) devono privilegiare il moto per gradi congiunti o per salti piccoli (terza, quarta). I salti superiori alla sesta sono considerati innaturali per voci di coro e rendono la linea difficile da intonare.',
        'I trattati elencano tra gli intervalli permessi: gradi congiunti, terze, quarte e quinte giuste, sesta minore e ottava (preferibilmente in senso ascendente). I salti maggiori sono tollerati nella parte del basso o in stile libero, ma non nelle voci interne della scrittura corale accademica.',
        'Un salto ampio in voce interna può essere giustificato se è seguito da un cambio di direzione e da un movimento per gradi, che "compensano" il salto.',
      ].join('\n'),
    suggestion: 'Riduci il salto utilizzando un\'altra disposizione dell\'accordo. Se il salto è inevitabile, assicurati che sia seguito da un cambio di direzione e da un movimento per grado congiunto nella stessa voce.',
  },

  'R-16': {
      body: [
        'La "regola della stanghetta" (o regola del tempo forte) stabilisce che i cambi di accordo devono avvenire preferibilmente sui tempi forti della misura. Quando un cambio armonico avviene su un tempo debole anticipando il battito successivo, si crea una sincope armonica che può destabilizzare il ritmo armonico.',
        'Nella scrittura accademica di base è preferibile che i cambi di accordo coincidano con i tempi metricamente forti. Le sincopi armoniche sono una risorsa espressiva legittima, ma richiedono consapevolezza e controllo.',
        'Per l\'intervallo melodico proibito: sono vietati i salti di settima (maggiore e minore), nona e qualsiasi intervallo superiore all\'ottava, tutti gli intervalli eccedenti, e il semitono cromatico nella scrittura diatonica.',
      ].join('\n'),
    suggestion: 'Per la sincope armonica: valuta se il cambio di accordo può essere spostato al tempo forte successivo. Per l\'intervallo melodico: sostituisci il salto con un intervallo consentito o con un movimento per gradi, eventualmente con una nota di passaggio.',
  },

  'R-17b': {
    body: [
      'Una settima o nona percorsa in due salti (senza che nessuno dei due sia un grado congiunto) crea un profilo melodico poco cantabile, anche se meno grave della variante R-17a dove entrambi i movimenti sono nella stessa direzione.',
      'Il problema è la mancanza di un grado congiunto di "appoggio": la linea salta due volte senza mai passare per una seconda, rendendo il percorso melodico astratto e difficile da intonare. Almeno uno dei due movimenti dovrebbe essere una seconda per ancorare la linea alla scala.',
      'Questa è un\'infrazione di gravità media (warning): i due salti possono essere entrambi consonanti e la direzione può cambiare, ma il risultato complessivo resta melodicamente insoddisfacente senza un grado congiunto intermedio.',
    ].join('\n'),
    suggestion: 'Sostituisci almeno uno dei due salti con un grado congiunto (seconda maggiore o minore). Se entrambi i salti sono necessari per la condotta armonica, considera di riscrivere il passaggio cambiando la distribuzione delle note tra le voci.',
  },

  'R-17c': {
    body: [
      'Il tritono (quarta eccedente o quinta diminuita) è l\'intervallo più instabile del sistema tonale. Quando viene "delineato" da due o più movimenti melodici consecutivi — cioè quando i punti estremi del percorso melodico formano un tritono — l\'orecchio percepisce la tensione irrisolta anche se le note intermedie sono consonanti.',
      'Il problema è nel contorno complessivo: la melodia ha tracciato un tritono "nascosto" che aspetta risoluzione. Nella scrittura accademica questo schema è da evitare perché crea instabilità melodica non intenzionale.',
      'La gravità dipende dal contesto:',
      '• Error: tritono percorso in 2 movimenti nella stessa direzione, nota finale breve, senza risoluzione per grado congiunto opposto. Massima tensione irrisolta.',
      '• Warning: nota intermedia più lunga (che attenua la percezione del contorno), oppure risoluzione presente ma parziale.',
      'La condizione di sblocco è la risoluzione: dopo il tritono, l\'ultima nota deve proseguire per grado congiunto in direzione opposta al tritono, "risolvendo" la tensione accumulata.',
    ].join('\n'),
    suggestion: 'Dopo il tritono delineato, porta la voce a risolvere per grado congiunto nella direzione opposta. Se la quarta eccedente è ascendente, la nota successiva deve scendere per grado; se la quinta diminuita è discendente, la nota successiva deve salire per grado.',
  },

  'R-18': {
    body: [
      'Due note con lo stesso nome ma alterazione diversa (es. Si naturale e Si♭) suonano contemporaneamente nello stesso accordo.',
      'Questo "scontro cromatico simultaneo" crea una forte dissonanza di seconda minore (o equivalente enarmonico) che non ha giustificazione funzionale nell\'armonia tonale. A differenza della falsa relazione (R-09), che avviene fra accordi consecutivi, qui le due versioni della stessa nota coesistono nello stesso istante.',
      'Il risultato è un suono confuso: l\'orecchio non riesce a decidere quale sia la "vera" versione della nota.',
    ].join('\n'),
    suggestion: 'Correggi una delle due note in modo che abbiano la stessa alterazione, oppure verifica se una delle due è un errore di inserimento.',
  },

  'R-CHORD-COMPLETE': {
      body: [
        'Un accordo si dice completo quando contiene almeno una voce per ciascuna delle sue note costitutive (fondamentale, terza e quinta per una triade; fondamentale, terza, quinta e settima per un accordo di settima).',
        'Nella scrittura a quattro voci è talvolta necessario omettere la quinta per raddoppiare la fondamentale, specialmente negli accordi di settima di dominante dove la quinta è spesso sacrificata. Questo è accettabile e previsto dai trattati. L\'omissione della terza è invece quasi sempre scorretta, perché è la terza a definire il modo (maggiore o minore) dell\'accordo.',
        'Negli accordi di settima, omettere la settima stessa vanifica la funzione dell\'accordo.',
      ].join('\n'),
    suggestion: 'Verifica quali note dell\'accordo sono presenti e quali mancano. Se manca la terza, ridistribuisci le voci per includerla. La quinta può essere omessa (specialmente nel V7) a favore del raddoppio della fondamentale.',
  },

  'R-RANGE': {
      body: [
        'Ogni voce del coro SATB ha un registro standard entro cui operare per garantire naturalezza nell\'intonazione e nel timbro. Scrivere al di fuori di questi limiti produce effetti artificiali o difficoltà esecutive.',
        'Registri indicativi (scrittura corale accademica):',
        '• Soprano: Do4 – Sol5 (zona di comfort: Mi4 – Re5)',
        '• Alto: Sol3 – Mi5 (zona di comfort: Do4 – Do5)',
        '• Tenore: Do3 – Sol4 (zona di comfort: Mi3 – Re4)',
        '• Basso: Mi2 – Do4 (zona di comfort: Sol2 – La3)',
        'Le note ai limiti estremi del registro sono praticabili ma da usare con moderazione e su tempi forti o valori lunghi.',
      ].join('\n'),
    suggestion: 'Trascrivi la nota nel registro appropriato per la voce, eventualmente cambiando ottava o ridistribuendo le note dell\'accordo tra le parti. Evita di spingere sistematicamente le voci agli estremi del loro registro.',
  },

  'R-SPACING-TB': {
      body: [
        'Tra le voci di Tenore e Basso è ammessa una distanza maggiore rispetto alle voci superiori (fino a circa due ottave e una quinta), perché il registro grave tollera meglio gli spazi ampi. Tuttavia, superare questo limite crea un\'apertura eccessiva che impoverisce il suono e può generare instabilità armonica nella zona grave.',
        'La spaziatura larga tra Tenore e Basso è caratteristica di certi stili (musica orchestrale, organo), ma nella scrittura corale accademica a quattro parti è preferibile mantenersi entro i limiti convenzionali.',
      ].join('\n'),
    suggestion: 'Avvicina Tenore e Basso scegliendo una diversa disposizione delle note dell\'accordo. Valuta se il Basso può salire di un\'ottava o se il Tenore può scendere per ridurre la distanza.',
  },


  // ═══════════════════════════════════════════════════════════
  // 3. ECCEZIONI — PARALLELE / NASCOSTE (exception)
  // ═══════════════════════════════════════════════════════════

  'EXC-M03': {
      body: [
        'Le ottave e le quinte consecutive per moto contrario (quando le voci si muovono in direzioni opposte passando attraverso lo stesso intervallo perfetto) sono considerate meno gravi delle parallele per moto retto, e in certi contesti tollerate.',
        'Questa eccezione è riconosciuta nei trattati classici: il moto contrario attenua l\'effetto di "scivolamento" delle parallele perché le voci si aprono invece di convergere. Resta comunque una soluzione da evitare quando possibile, preferendo una condotta che eviti del tutto la successione di intervalli perfetti.',
      ].join('\n'),
    suggestion: 'Pur essendo tollerate, cerca di evitare anche le parallele per moto contrario modificando il raddoppio o la disposizione dell\'accordo. Utilizzale solo quando la condotta delle voci non offre soluzioni migliori.',
  },

  'EXC-M04': {
      body: [
        'Il moto obliquo si ha quando una voce rimane ferma mentre l\'altra si muove. Quando questo produce una quinta o ottava giusta, il risultato è ammesso: poiché una delle due voci non si muove, non si crea l\'effetto di "scivolamento parallelo" tipico delle parallele per moto retto.',
        'l\'unisono e gli intervalli perfetti raggiunti per moto obliquo sono generalmente permessi, salvo l\'unisono per moto retto che va sempre evitato.',
      ].join('\n'),
    suggestion: 'Il moto obliquo verso intervalli perfetti è accettabile. Assicurati solo che la voce che si muove non crei altri problemi di condotta (salti scorretti, violazione del registro, ecc.).',
  },

  'EXC-OBL-PERF': {
      body: [
        'Quando una voce resta ferma su una nota comune ai due accordi consecutivi, il raggiungimento di una quinta o ottava giusta nell\'accordo successivo è ammesso. La nota pedal (la voce ferma) garantisce continuità e impedisce la percezione di movimento parallelo.',
        'Questa è una delle eccezioni classiche della teoria armonica: la nota comune trattiene l\'intervallo e ne neutralizza l\'effetto di parallela.',
      ].join('\n'),
    suggestion: 'Eccezione valida. Nessuna modifica necessaria se una delle due voci rimane effettivamente ferma sulla nota comune tra i due accordi.',
  },

  'EXC-IV6-V6': {
      body: [
        'Nel passaggio fra i primi rivolti dei gradi IV e V la quinta pu\u00F2 essere raggiunta per moto retto senza durezza, anche quando entrambe le parti che la formano procedono per intervalli disgiunti.',
        'La regola generale chiede, per le quinte raggiunte per moto retto, che almeno una delle due parti proceda per grado congiunto oppure che una delle due note della quinta sia comune ai due accordi. In questo incatenamento la condizione non serve: il legame fra i due rivolti \u00E8 gi\u00E0 saldo \u2014 il basso sale di grado dal sesto al settimo grado della scala e le parti superiori restano dentro la stessa regione armonica \u2014 e all\'ascolto l\'arrivo sulla quinta non risulta aspro.',
      ].join('\n'),
    suggestion: 'Nessuna correzione necessaria: in questo incatenamento l\'arrivo sulla quinta per moto retto \u00E8 ammesso anche con salto in entrambe le parti.',
  },

  'EXC-Hidden-Stepwise': {
      body: [
        'La quinta o ottava nascosta tra voci estreme è tollerata quando il Soprano (la parte superiore) si muove per grado congiunto (seconda maggiore o minore) invece che per salto. In questo caso il percorso melodico del Soprano è fluido e l\'effetto dell\'intervallo nascosto è attenuato.',
        'I trattati stabiliscono questa come eccezione classica: la quinta nascosta tra parti estreme è permessa verso I e V se la parte superiore procede per intervallo congiunto. L\'ottava nascosta è permessa se la parte superiore procede per seconda minore.',
      ].join('\n'),
    suggestion: 'Eccezione riconosciuta. Il movimento per grado congiunto del Soprano ammorbidisce la nascosta. Tienila presente come buona pratica da mantenere anche in futuro.',
  },

  'EXC-Hidden-BassStep': {
      body: [
        'Analogamente all\'eccezione per il Soprano, la quinta o ottava nascosta tra voci estreme è tollerata anche quando è il Basso (la parte inferiore) a procedere per grado congiunto.',
        'la quinta ed ottava per moto retto tra una parte intermedia e un\'altra parte qualunque sono permesse su tutti i gradi se la voce più acuta procede per intervalli congiunti; o soltanto sui gradi tonali se è la parte inferiore a procedere per grado congiunto.',
      ].join('\n'),
    suggestion: 'Eccezione valida. Il grado congiunto del Basso attenua la nascosta. Verifica che gli altri aspetti della condotta delle parti siano corretti.',
  },


  // ═══════════════════════════════════════════════════════════
  // 4. ECCEZIONI — INCROCIO E UNISONO (exception)
  // ═══════════════════════════════════════════════════════════

  'EXC-S02': {
      body: [
        'L\'incrocio tra le voci interne (Alto e Tenore) è considerato meno grave dell\'incrocio che coinvolge le voci estreme, e in certi contesti è tollerato quando la condotta melodica delle singole parti lo richiede.',
        'L\'incrocio momentaneo tra Alto e Tenore può essere accettabile se dura un solo battito, se è motivato da una linea melodica chiara in entrambe le voci, e se non genera altri problemi di condotta (parallele, spaziatura eccessiva). È comunque una soluzione da usare con parsimonia e consapevolezza.',
      ].join('\n'),
    suggestion: 'L\'incrocio è tollerato in questo contesto, ma valuta se esiste una distribuzione alternativa delle note che eviti l\'incrocio mantenendo una buona condotta delle parti. Preferisci sempre soluzioni senza incroci quando possibile.',
  },

  'EXC-Unison-Lower': {
      body: [
        'l\'unisono tra le voci basse (Tenore e Basso) raggiunto per moto contrario o obliquo è ammesso. Il moto contrario (le due voci si avvicinano da direzioni opposte) o il moto obliquo (una voce ferma, l\'altra si muove) neutralizzano il problema tipico dell\'unisono raggiunto per moto retto.',
        'Questa eccezione rispecchia la pratica corale tradizionale, dove le voci gravi occasionalmente convergono sull\'unisono in corrispondenza di note tonali importanti.',
      ].join('\n'),
    suggestion: 'Eccezione valida. L\'unisono raggiunto per moto contrario o obliquo nelle voci basse è accettabile.',
  },

  'EXC-Unison-Step': {
      body: [
        'L\'unisono raggiunto per moto contrario o obliquo è ammesso tra tutte le voci (non solo le basse) quando almeno una delle due voci procede per grado congiunto. La fluidità del movimento per grado compensa la convergenza sull\'unisono e rende il passaggio naturale all\'ascolto.',
        'Nella tradizione accademica: tra le parti intermedie l\'unisono è tollerato per moto contrario od obliquo e per intervalli congiunti in almeno una voce.',
      ].join('\n'),
    suggestion: 'Eccezione valida. Il grado congiunto in almeno una delle due voci rende l\'unisono accettabile in questo contesto.',
  },

  'EXC-Unison-Cadence': {
      body: [
        'Nella tradizione corale accademica, l\'unisono tra Soprano e Contralto (Alto) sulla tonica è tollerato in cadenza quando è preceduto da sensibile e secondo grado (ad esempio Sol#–Si che arriva a La–La in La maggiore).',
        'Questa eccezione è codificata nella pratica corale e si ritrova anche in Bach: il convergere delle due voci superiori sulla tonica in cadenza crea un effetto di chiusura e unità sonora che i teorici classici riconoscono come lecito.',
      ].join('\n'),
    suggestion: 'Eccezione cadenzale riconosciuta. L\'unisono sulla tonica in cadenza tra Soprano e Alto è accettabile quando la progressione lo giustifica.',
  },


  // ═══════════════════════════════════════════════════════════
  // 4b. ECCEZIONI — QUINTE DI STILE (warning)
  // ═══════════════════════════════════════════════════════════

  'EXC-STYLE-5': {
      body: [
        'Quinte parallele tollerate (Sesta Tedesca / Cromatismi).\n'
        + 'Successione di quinte parallele ammessa per ragioni di colore o rinforzo armonico in due contesti specifici:',
        'Ambito Classico (Quinte di Mozart): generate dalla risoluzione diretta della Sesta Tedesca (♭VI) sull\'accordo di Dominante (V). La tensione della sesta eccedente giustifica il movimento parallelo all\'orecchio.',
        'Ambito Moderno (prassi moderna): definite "quinte orchestrali", sono ammesse in movimenti cromatici su vari gradi per dare spessore alla massa sonora.',
        'Condizioni d\'uso:\n• Devono essere collocate preferibilmente nelle voci inferiori.\n• Vanno evitate nelle successioni diatoniche standard (es. V–IV o I–ii), dove produrrebbero un suono rigido e sgradevole.',
        '⚠️ Nota Tecnica: Nello stile rigoroso (Bach), si evita il caso di Mozart inserendo una quarta e sesta cadenzale (I⁶₄) prima del V.',
      ].join('\n'),
    suggestion: 'Quinte di stile riconosciute. In contesto orchestrale/cromatico, le quinte parallele nelle voci inferiori sono tollerate per rinforzo armonico.',
  },

  // ═══════════════════════════════════════════════════════════
  // 5. ECCEZIONI — SENSIBILE (exception)
  // ═══════════════════════════════════════════════════════════

  'EXC-LT-Transfer': {
      body: [
        'La sensibile non deve necessariamente risolvere nella stessa voce in cui si trova: è ammesso che la sua risoluzione sulla tonica avvenga in un\'altra voce che "raccoglie" il movimento tonale. Questo si chiama risoluzione trasferita o risoluzione per trasferimento.',
        'Questa eccezione è utile quando la risoluzione diretta della sensibile nella stessa voce creerebbe problemi di condotta (ottave parallele, raddoppi scorretti). La tonica deve però comparire nell\'accordo successivo in una voce diversa, solitamente il Soprano.',
        'la sensibile può non risolvere alla tonica quando abbiamo V–vi se la tonica è comunque al Soprano.',
      ].join('\n'),
    suggestion: 'Eccezione valida. La tonica viene "raccolta" da un\'altra voce, garantendo comunque la risoluzione tonale dell\'accordo.',
  },

  'EXC-LT-Chromatic-Line': {
      body: [
        'Quando la sensibile fa parte di una linea cromatica in una voce interna (Alto o Tenore), la risoluzione immediata alla tonica può essere differita o sostituita da un movimento cromatico che prosegue la linea. La forza espressiva e la coerenza della linea cromatica prevale in questo caso sull\'obbligo di risoluzione immediata.',
        'Questa licenza è propria dello stile più elaborato e si ritrova frequentemente in Bach, dove le voci interne tracciano linee cromatiche continue che temporaneamente "sospendono" le regole di risoluzione.',
      ].join('\n'),
    suggestion: 'Eccezione riconosciuta per le voci interne in contesto cromatico. Assicurati che la linea cromatica sia melodicamente coerente e che la sensibile risolva alla tonica in un punto successivo della frase.',
  },

  'EXC-LT-FREE': {
      body: [
        'L\'obbligo di risoluzione ascendente della sensibile (VII → I) è sospeso quando l\'accordo di destinazione non esercita una funzione di attrazione tonale risolutiva (non è I né vi).',
        'Priorità lineare: in passaggi non cadenzali (es. VII → IV o VII → III), la sensibile è considerata una nota melodica mobile. Se il soprano o una voce interna segue un disegno discendente, la coerenza della linea prevale sulla tensione del grado.',
        'Neutralizzazione della tensione: la spinta verso la tonica è massima solo nella successione V → I o vii° → I. In successioni non cadenzali la sensibile può scendere di grado congiunto o saltare alla quinta dell\'accordo successivo per garantire la completezza armonica.',
        'La sensibile è definita "libera" anche se l\'accordo di destinazione contiene la tonica come nota reale (es. il IV grado in stato fondamentale contiene la tonica), purché la successione non sia classificabile come cadenza perfetta o d\'inganno.',
      ].join('\n'),
    suggestion: 'Eccezione valida. L\'accordo di destinazione non è I né vi: la sensibile è melodicamente libera in contesto non cadenzale.',
  },


  // ═══════════════════════════════════════════════════════════
  // 6. ECCEZIONI — RISOLUZIONE DELLA SETTIMA (exception)
  // ═══════════════════════════════════════════════════════════

  'EXC-7-TRANSFERRED-RES': {
      body: [
        'Analogamente alla risoluzione trasferita della sensibile, la settima di un accordo può essere "raccolta" da un\'altra voce che la risolve scendendo per grado al posto della voce originale. Questo avviene quando la voce che ha la settima si trova in una posizione scomoda per risolvere direttamente.',
        'La risoluzione deve comunque avvenire: la nota di risoluzione (un grado sotto la settima) deve comparire nell\'accordo successivo in una voce diversa, creando così la risoluzione per trasferimento. Il risultato sonoro è corretto, anche se tecnicamente la settima "cambia voce" prima di risolvere.',
      ].join('\n'),
    suggestion: 'Eccezione valida. La risoluzione della settima avviene in un\'altra voce, garantendo comunque il movimento discendente di grado richiesto.',
  },

  'EXC-7-UP': {
      body: [
        'La settima di un accordo normalmente risolve scendendo di grado. In certi contesti, tuttavia, può risolvere salendo: questo avviene tipicamente quando la settima si trova in una voce interna e la risoluzione ascendente evita problemi di condotta (parallele, sovrapposizioni).',
        'La risoluzione ascendente della settima è considerata una licenza accettabile nella tradizione accademica, specialmente nelle voci interne, in presenza di circostanze che rendono la risoluzione discendente impraticabile.',
      ].join('\n'),
    suggestion: 'Eccezione accettabile, specialmente in voce interna. Usa questa risoluzione solo quando quella discendente creerebbe problemi di condotta più gravi.',
  },

  'EXC-7-P4-TO7': {
      body: [
        'Normalmente la settima di un accordo deve essere preparata: deve essere tenuta come nota comune dall\'accordo precedente, oppure raggiunta per grado congiunto. Il salto di quarta giusta ascendente nel basso verso la settima è una delle eccezioni classiche a questa regola, perché il salto di quarta è melodicamente naturale nel basso e il contesto armonico rende la settima chiaramente comprensibile.',
        'Questa licenza è riconosciuta nei trattati come eccezione alla preparazione obbligatoria della settima, in particolare nel basso.',
      ].join('\n'),
    suggestion: 'Eccezione riconosciuta per il Basso. Il salto di quarta verso la settima è melodicamente giustificato e tonalmente chiaro. Assicurati che la settima risolva correttamente nell\'accordo successivo.',
  },

  'EXC-7-STATIC': {
      body: [
        'La settima di un accordo può "ritardare" la propria risoluzione restando ferma come nota dell\'accordo successivo, se quella nota è armonica nel nuovo contesto. Questo è il principio della preparazione e della nota comune: la settima che era dissonante nel primo accordo diventa nota consonante nel secondo, e risolverà solo nel terzo accordo.',
        'Questo meccanismo è alla base delle catene di settime e delle progressioni per quinta (ii7–V7–I), dove ogni settima si "trasforma" in nota dell\'accordo successivo prima di risolvere.',
      ].join('\n'),
    suggestion: 'Eccezione valida nella progressione per quinta. La settima trattenuta come nota comune è una tecnica compositiva legittima e frequente in Bach e negli accordi a catena.',
  },

  'EXC-7-DELAYED': {
      body: [
        'La settima non deve necessariamente risolvere nel battito immediatamente successivo: è ammessa una risoluzione ritardata, in cui la nota della settima è prolungata per uno o più battiti prima di scendere al grado di risoluzione. Questo crea un effetto di sospensione che aumenta la tensione e rende la risoluzione più espressiva.',
        'Il ritardo nella risoluzione della settima è una risorsa frequente nello stile elaborato e nei corali di Bach: la settima "attende" la risoluzione, aumentando l\'aspettativa dell\'ascoltatore.',
      ].join('\n'),
    suggestion: 'Eccezione valida. La risoluzione ritardata è un effetto stilisticamente ricercato. Assicurati che la settima risolva comunque scendendo di grado, anche se con qualche battito di ritardo.',
  },

  'EXC-7m01': {
      body: 'La settima può essere "spostata" di ottava all\'interno della stessa voce prima di risolvere: la voce sale o scende di ottava sulla stessa nota (la settima), e poi risolve scendendo di grado. Questo tipo di trasferimento è ammesso e si ritrova nella pratica compositiva quando la voce deve raggiungere una posizione migliore per la risoluzione.',
    suggestion: 'Eccezione valida. Il cambio di posizione (ottava) non esonera dalla risoluzione: la settima deve comunque scendere di grado dopo il trasferimento.',
  },

  'EXC-7-TRANSFER': {
      body: [
        'La settima di un accordo può essere "ceduta" a un\'altra voce prima della risoluzione: la voce originale abbandona la settima (saltando o scendendo) mentre un\'altra voce "raccoglie" la stessa nota e la porta alla risoluzione. L\'effetto complessivo è che la settima risolve correttamente, anche se attraverso due voci diverse.',
        'Questa tecnica richiede che la nota di settima sia effettivamente presente nell\'accordo nella voce che la raccoglie, e che questa voce la risolva poi scendendo di grado nell\'accordo successivo.',
      ].join('\n'),
    suggestion: 'Eccezione valida. Verifica che la voce che raccoglie la settima la risolva correttamente scendendo di grado nell\'accordo successivo.',
  },

  'EXC-7-FREE': {
      body: [
        'Non tutte le settime richiedono risoluzione discendente obbligatoria. In certi contesti — accordi di settima di tonica (Imaj7 in stile moderno), accordi decorativi, o passaggi dove la settima è nota di passaggio — l\'obbligo di risoluzione è attenuato o assente.',
        'Il motore ha rilevato che in questo specifico contesto la settima non richiede la risoluzione discendente standard, in base al tipo di accordo, alla posizione metrica o al contesto armonico circostante.',
      ].join('\n'),
    suggestion: 'Nessuna correzione necessaria per questo contesto specifico. Se hai dubbi sulla classificazione, verifica il tipo di accordo e la funzione della settima nella progressione.',
  },


  // ═══════════════════════════════════════════════════════════
  // 7. ECCEZIONE — MELODIA (exception)
  // ═══════════════════════════════════════════════════════════

  'EXC-R17-Duration': {
      body: [
        'Quando due salti consecutivi nella stessa direzione delineano un intervallo di settima o nona, la regola R-17 normalmente segnala un\'infrazione. Tuttavia esiste un\'eccezione riconosciuta: se la nota intermedia (quella tra i due salti) ha un valore ritmico più lungo della nota precedente, la percezione del contorno melodico complessivo si attenua, perché l\'ascoltatore "dimentica" il punto di partenza prima di arrivare alla nota finale.',
        'La nota lunga in mezzo spezza psicologicamente la continuità del contorno melodico e rende il grande intervallo complessivo meno percepibile come un unico salto.',
      ].join('\n'),
    suggestion: 'Eccezione valida. La durata maggiore della nota intermedia giustifica il contorno. Mantieni comunque questa soluzione solo quando necessario, preferendo contorni melodici più contenuti quando possibile.',
  },


  // ═══════════════════════════════════════════════════════════
  // 8. ORNAMENTI (exception / warning)
  // ═══════════════════════════════════════════════════════════

  'ORN-NEIGH': {
      body: [
        'La nota di volta (neighbor note) è una nota non armonica che si allontana per grado congiunto dalla nota reale e vi ritorna immediatamente. Può essere superiore (sale e torna) o inferiore (scende e torna).',
        'Condotta corretta: la nota di volta parte dalla nota reale, si muove di una seconda (maggiore o minore) e ritorna alla stessa nota reale. Solitamente si trova su tempi deboli o su suddivisioni del battito.',
        'Questo ornamento è stato riconosciuto correttamente: la condotta della voce rispetta i criteri standard della nota di volta.',
      ].join('\n'),
    suggestion: 'Nota di volta correttamente condotta. Nessuna modifica necessaria.',
  },

  'R-ORN-NEIGH': {
      body: [
        'La nota di volta rilevata presenta caratteristiche atipiche: potrebbe trovarsi su un tempo forte invece che debole, non tornare esattamente alla nota di partenza, o presentare un intervallo diverso dalla seconda.',
        'La nota di volta su tempo forte è ammessa — è chiamata appoggiatura inferiore o superiore in certi trattati — ma richiede maggiore attenzione: l\'effetto dissonante è più marcato e la risoluzione deve essere ancora più chiara.',
      ].join('\n'),
    suggestion: 'Verifica che la nota torni alla nota reale per grado congiunto e che il contesto ritmico giustifichi la posizione insolita. Se la nota è su tempo forte e ha valore significativo, potrebbe essere più correttamente classificata come appoggiatura.',
  },

  'ORN-APP': {
      body: [
        'L\'appoggiatura è una nota non armonica che si trova su un tempo forte o relativamente forte, crea una dissonanza con l\'armonia sottostante, e risolve per grado congiunto (di solito discendente) sulla nota reale dell\'accordo.',
        'Il nome stesso (dall\'italiano "appoggiarsi") indica la sua funzione: la voce si "appoggia" sulla dissonanza prima di scendere alla nota reale. Questo crea un effetto espressivo di tensione e rilascio particolarmente efficace.',
        'L\'appoggiatura è stata riconosciuta correttamente: si trova su posizione forte, è dissonante con l\'accordo e risolve per grado nella direzione attesa.',
      ].join('\n'),
    suggestion: 'Appoggiatura correttamente condotta. Nessuna modifica necessaria.',
  },

  'R-ORN-APP': {
      body: [
        'L\'appoggiatura rilevata presenta caratteristiche insolite: potrebbe trovarsi su un tempo debole, risolvere in una direzione inattesa, o avere un intervallo di risoluzione diverso dalla seconda.',
        'Nella tradizione accademica l\'appoggiatura è strettamente legata alla sua posizione metrica forte e alla risoluzione discendente per grado. Un\'appoggiatura che risolve ascendendo o che si trova su tempo debole è meno tipica e potrebbe essere classificata diversamente (nota di volta, nota di passaggio).',
      ].join('\n'),
    suggestion: 'Verifica la posizione metrica e la direzione di risoluzione. Se la nota è su tempo debole, considera se si tratta invece di una nota di volta o di passaggio. Se la risoluzione è ascendente, l\'appoggiatura è stilisticamente meno convenzionale ma non necessariamente scorretta.',
  },

  'ORN-ANT': {
      body: [
        'L\'anticipazione è una nota non armonica che "anticipa" una nota dell\'accordo successivo prima che quell\'accordo arrivi. Si trova tipicamente su un tempo debole o su una suddivisione, ha un valore breve, e coincide esattamente con una nota dell\'accordo che seguirà.',
        'A differenza dell\'appoggiatura, l\'anticipazione non crea tensione da risolvere: è già la nota "giusta" dell\'accordo successivo, solo presentata in anticipo. L\'effetto è di fluidità e proiezione verso l\'accordo successivo.',
        'L\'anticipazione è stata riconosciuta correttamente.',
      ].join('\n'),
    suggestion: 'Anticipazione correttamente condotta. Nessuna modifica necessaria.',
  },

  'R-ORN-ANT': {
      body: [
        'L\'anticipazione rilevata presenta caratteristiche insolite: si trova su un tempo forte oppure ha un valore ritmico lungo rispetto alla nota che anticipa.',
        'Un\'anticipazione lunga o su tempo forte rischia di essere percepita come una dissonanza o come una nota dell\'accordo fuori posto, perdendo la sua funzione di "proiezione" verso l\'accordo successivo. Nella scrittura accademica standard le anticipazioni sono brevi e su tempi deboli.',
      ].join('\n'),
    suggestion: 'Se la nota è lunga o su tempo forte, valuta se si tratta di un\'anticipazione intenzionale o di un problema di voice leading. Un\'anticipazione efficace è solitamente breve (semicroma, croma) e su tempo o suddivisione debole.',
  },

  'ORN-ESC': {
      body: [
        'La nota di sfuggita (escape note o échappée) è una nota non armonica che si allontana per grado dalla nota reale e poi salta in direzione opposta verso la nota reale successiva, invece di tornare per grado. È quindi l\'opposto della nota di passaggio per la direzione del salto finale.',
        'Esempio tipico: Do (armonica) → Re (sfuggita, sale per grado) → Si (nota reale successiva, scende per salto di terza). La nota di sfuggita "scappa" via con un salto invece di risolvere per grado.',
        'È stata riconosciuta correttamente: grado congiunto verso la sfuggita, salto in direzione contraria verso la nota reale.',
      ].join('\n'),
    suggestion: 'Nota di sfuggita correttamente condotta. Nessuna modifica necessaria.',
  },

  'R-ORN-ESC': {
      body: [
        'La nota di sfuggita rilevata presenta caratteristiche atipiche: potrebbe trovarsi su un tempo forte, avere un salto finale troppo ampio, o il grado congiunto di avvicinamento potrebbe essere assente.',
        'La nota di sfuggita è tipicamente su tempi deboli e il salto finale è generalmente di terza. Su tempi forti o con salti più ampi l\'effetto diventa più aspro e può risultare stilisticamente fuori contesto nella scrittura accademica standard.',
      ].join('\n'),
    suggestion: 'Verifica la posizione metrica e l\'ampiezza del salto finale. Se la nota si trova su tempo forte o il salto supera la terza, considera se la condotta è stilisticamente giustificata o se è preferibile modificare la linea melodica.',
  },

  'ORN-PASS': {
      body: [
        'La nota di passaggio è una nota non armonica che collega per gradi congiunti due note armoniche consecutive in una stessa voce. Può essere diatonica (all\'interno della scala) o cromatica (con alterazione).',
        'La nota di passaggio si trova solitamente su tempo debole, ha un valore breve, e scorre tra due note armoniche distanti di terza (diatonica) o di seconda aumentata (cromatica).',
        'È stata riconosciuta correttamente: si muove per gradi congiunti tra due note armoniche e si trova su posizione metrica appropriata.',
      ].join('\n'),
    suggestion: 'Nota di passaggio correttamente condotta. Nessuna modifica necessaria.',
  },


  // ═══════════════════════════════════════════════════════════
  // 9. CADENZE — MARKER INFORMATIVI (exception)
  // ═══════════════════════════════════════════════════════════

  'CAD-PAC': {
      body: [
        'La cadenza autentica perfetta è la formula cadenzale più conclusiva e stabile del sistema tonale. Si realizza con il movimento V → I (o V7 → I) con entrambi gli accordi in stato fondamentale e la tonica al Soprano nell\'accordo finale.',
        'La presenza di tutte queste condizioni — stato fondamentale di entrambi gli accordi, tonica al Soprano, movimento di quinta discendente (o quarta ascendente) nel Basso — produce la massima sensazione di chiusura e conclusione.',
        'È la cadenza tipica di fine periodo, fine sezione e fine brano. È la formula cadenzale più conclusiva della tradizione tonale.',
      ].join('\n'),
    suggestion: 'Marker informativo — nessuna correzione necessaria. La cadenza autentica perfetta è stata rilevata correttamente.',
  },

  'CAD-IAC': {
      body: [
        'La cadenza autentica imperfetta condivide il movimento V → I con la cadenza perfetta, ma manca di una o più delle sue condizioni di "perfezione": l\'accordo di dominante o di tonica possono essere in rivolto, oppure il Soprano nell\'accordo finale può avere la terza o la quinta invece della tonica.',
        'Il risultato è una cadenza che conclude ma con minore definitività rispetto alla PAC: crea un senso di chiusura relativa, spesso usata alla fine della frase antecedente di un periodo, o come cadenza interna di una sezione più ampia.',
      ].join('\n'),
    suggestion: 'Marker informativo — nessuna correzione necessaria. La cadenza autentica imperfetta è stata rilevata correttamente.',
  },

  'CAD-HC': {
      body: [
        'La semicadenza (half cadence) è una cadenza che conclude su V — l\'accordo di dominante — invece di risolvere alla tonica. Crea un senso di sospensione e attesa: la frase si ferma su un punto di tensione che "chiede" una continuazione.',
        'È la cadenza tipica della frase antecedente nel periodo binario: la domanda (antecedente) si ferma sulla dominante, la risposta (conseguente) concluderà sulla tonica.',
        'Qualsiasi accordo può precedere la dominante nella semicadenza; la forma più comune è IV–V oppure I–V.',
      ].join('\n'),
    suggestion: 'Marker informativo — nessuna correzione necessaria. La semicadenza è stata rilevata correttamente.',
  },

  'CAD-PLAG': {
      body: [
        'La cadenza plagale si realizza con il movimento IV → I (sottodominante → tonica). A differenza della cadenza autentica, non passa per la dominante e quindi manca della tensione della sensibile. Il risultato è una conclusione più morbida e distesa, spesso associata a un carattere solenne o meditativo.',
        'È frequente come conclusione aggiuntiva dopo una cadenza autentica (il classico "Amen" della musica sacra), oppure come cadenza interna in brani di carattere tranquillo. È considerata una cadenza di "conferma" più che di "risoluzione".',
      ].join('\n'),
    suggestion: 'Marker informativo — nessuna correzione necessaria. La cadenza plagale è stata rilevata correttamente.',
  },

  'CAD-DEC': {
      body: [
        'La cadenza d\'inganno (deceptive cadence) si realizza quando la dominante (V) — invece di risolvere sulla tonica attesa — si muove verso un altro accordo che condivide due note con la tonica: il vi grado in modo maggiore, il VI in minore, oppure ♭VI in versione cromatica.',
        'L\'effetto è di sorpresa: l\'orecchio attende la tonica e riceve un accordo "ingannevole" che prolunga la frase, spesso preparando una nuova cadenza più conclusiva. È particolarmente espressiva quando la dominante è preceduta da un I⁶⁄₄ cadenzale.',
        'Nella condotta a quattro voci la sensibile, di norma libera di scendere, si comporta come nella cadenza perfetta: sale alla tonica per evitare le ottave parallele tra la sensibile e la fondamentale del vi.',
      ].join('\n'),
    suggestion: 'Marker informativo — nessuna correzione necessaria. La cadenza d\'inganno è stata rilevata correttamente.',
  },

  'CAD-PIC': {
      body: [
        'Rilevata conclusione su accordo di tonica maggiore (I) in un brano in tonalità minore. Questa pratica, detta Terza Piccarda, è considerata regolare sia nella formula di cadenza perfetta (V→I) che in quella plagale (IV→I o iv→I).',
        'L\'uso della Terza Piccarda trasforma il carattere della risoluzione finale, conferendo un senso di maggiore stabilità, solennità o "luce" rispetto alla conclusione in minore. È particolarmente comune nel periodo barocco e classico (es. Bach).',
      ].join('\n'),
    suggestion: 'Marker informativo — nessuna correzione necessaria. L\'accordo di I maggiore sostituisce il i minore nella formula di cadenza finale.',
  },

};

// ────────────────────────────────────────────────────────────
// API
// ────────────────────────────────────────────────────────────

import i18n from '../i18n';
// IT registry of titles is the source-of-truth for matching the runtime first line.
// We import the JSON directly because matching must NOT depend on the active language.
import itRuleTexts from '../locales/it/ruleTexts.json';

type RuleEntry = {
  body?: string;
  suggestion?: string;
  title?: string;
  titleVariants?: Record<string, string>;
  titlePrefix?: string;
  titleSuffix?: string;
  /** Parole della parte DINAMICA del titolo da tradurre una per una (nomi di voce,
   *  modi, unità di misura…). Serve dove il motore compone la riga con pezzi variabili:
   *  "Sovrapposizione di voci: Alto supera la posizione precedente del Soprano" oppure
   *  "… · in A minore". Senza, la cornice veniva tradotta e il contenuto restava
   *  italiano. Le chiavi sono i termini ITALIANI (il motore produce italiano). */
  titleTokens?: Record<string, string>;
};

/**
 * Ottiene body + suggestion per una regola, localizzati nella lingua corrente.
 *
 * Il dict italiano `RULE_TEXTS` qui sopra resta come fallback statico:
 *   - se i18n non è inizializzato (es. test unit, esecuzione fuori React),
 *   - se la chiave manca dal namespace `ruleTexts`,
 *   - se la lookup ritorna stringa vuota.
 */
export function getRuleText(ruleId: string): RuleText {
  const fallback = RULE_TEXTS[ruleId] ?? { body: '', suggestion: '' };
  try {
    const bodyKey = `${ruleId}.body`;
    const sugKey = `${ruleId}.suggestion`;
    const bodyHit = i18n.exists(bodyKey, { ns: 'ruleTexts' });
    const sugHit = i18n.exists(sugKey, { ns: 'ruleTexts' });
    const body = bodyHit ? (i18n.t(bodyKey, { ns: 'ruleTexts' }) as string) : fallback.body;
    const suggestion = sugHit ? (i18n.t(sugKey, { ns: 'ruleTexts' }) as string) : fallback.suggestion;
    return { body: body || '', suggestion: suggestion || '' };
  } catch {
    return fallback;
  }
}

/**
 * Applica ai violation i testi localizzati del registro ruleTexts (titolo tradotto, body multi-riga
 * appeso, suggestion di default), nella lingua CORRENTE. Da chiamare sul MAIN THREAD dopo l'analisi
 * (l'analisi resta i18n-free → eseguibile in un Web Worker; e si ri-localizza al cambio lingua senza
 * rianalizzare). Logica identica a quella che prima era dentro applyHarmonyRules.
 */
export function enrichViolationsWithText<T extends { ruleId: string; description: string; suggestion?: string }>(violations: T[]): T[] {
  if (!Array.isArray(violations)) return violations;
  return violations.map((v) => {
    let out = v;
    const localizedTitle = localizeViolationTitle(v.ruleId, v.description);
    if (localizedTitle !== v.description) out = { ...out, description: localizedTitle };
    const rt = getRuleText(v.ruleId);
    if (rt.body && !out.description.includes('\n')) out = { ...out, description: out.description + '\n' + rt.body };
    if (rt.suggestion && !out.suggestion) out = { ...out, suggestion: rt.suggestion };
    return out;
  });
}

/**
 * Localizza la prima riga di una `description` di violazione.
 *
 * Match in due passi (sempre contro l'IT, perché il codice produce stringhe IT):
 *   1. titleVariants[firstLineIT] → traduce la specifica variante.
 *   2. title === firstLineIT → traduce il titolo canonico.
 * Se nessun match (caso dinamico con interpolazione), ritorna `description` immutata.
 */
export function localizeViolationTitle(ruleId: string, description: string): string {
  if (!description) return description;
  const itEntry = (itRuleTexts as Record<string, RuleEntry>)[ruleId];
  if (!itEntry) return description;
  const nlIdx = description.indexOf('\n');
  const firstLine = nlIdx >= 0 ? description.slice(0, nlIdx) : description;
  const rest = nlIdx >= 0 ? description.slice(nlIdx) : '';

  let translated: string | null = null;
  // Variant lookup
  if (itEntry.titleVariants && Object.prototype.hasOwnProperty.call(itEntry.titleVariants, firstLine)) {
    try {
      const lng = i18n.language || 'it';
      const localEntry = i18n.getResource(lng, 'ruleTexts', ruleId) as RuleEntry | undefined;
      const local = localEntry?.titleVariants?.[firstLine];
      translated = (local && typeof local === 'string' && local.length > 0) ? local : firstLine;
    } catch {
      translated = firstLine;
    }
  }
  // Canonical title lookup
  else if (itEntry.title && itEntry.title === firstLine) {
    try {
      const titleHit = i18n.exists(`${ruleId}.title`, { ns: 'ruleTexts' });
      translated = titleHit ? (i18n.t(`${ruleId}.title`, { ns: 'ruleTexts' }) as string) : firstLine;
    } catch {
      translated = firstLine;
    }
  }

  // Prefix (+optional suffix) matching for dynamic titles (e.g. R-18 chromatic clash).
  // Replaces the known IT prefix with the localised prefix, and optionally
  // replaces a known IT suffix with the localised suffix, keeping the dynamic
  // middle part (e.g. note names) intact.
  else if (itEntry.titlePrefix && firstLine.startsWith(itEntry.titlePrefix)) {
    try {
      const lng = i18n.language || 'it';
      const localEntry = i18n.getResource(lng, 'ruleTexts', ruleId) as RuleEntry | undefined;
      const localPfx = (localEntry?.titlePrefix && localEntry.titlePrefix.length > 0)
        ? localEntry.titlePrefix
        : itEntry.titlePrefix;
      let dynPart = firstLine.slice(itEntry.titlePrefix.length);
      // Also translate a known suffix if present
      if (itEntry.titleSuffix && dynPart.endsWith(itEntry.titleSuffix)) {
        const localSfx = (localEntry?.titleSuffix && localEntry.titleSuffix.length > 0)
          ? localEntry.titleSuffix
          : itEntry.titleSuffix;
        dynPart = dynPart.slice(0, dynPart.length - itEntry.titleSuffix.length) + localSfx;
      }
      // Parte dinamica: traduce i termini noti (nomi di voce, modi, unità). Dal più
      // lungo al più corto, così "quinta più che eccedente" non viene spezzato da "quinta".
      const tokens = localEntry?.titleTokens;
      if (tokens) {
        for (const src of Object.keys(tokens).sort((x, y) => y.length - x.length)) {
          const dst = tokens[src];
          if (!src || !dst || src === dst) continue;
          dynPart = dynPart.split(src).join(dst);
        }
      }
      translated = localPfx + dynPart;
    } catch {
      translated = firstLine;
    }
  }

  if (translated == null || translated === firstLine) return description;
  return translated + rest;
}
