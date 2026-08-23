/**
 * I GRUPPI DELLA BARRA — elenco, ordine di fabbrica, fusione con quello salvato.
 *
 * Stanno in un file loro e non dentro `GrandStaffEditor.tsx` per una ragione che non e'
 * di ordine ma di STRUMENTI: un modulo che esporta un componente React E qualcos'altro
 * non puo' essere aggiornato a caldo. Vite lo diceva a ogni salvataggio — «Could not Fast
 * Refresh (fondiOrdineToolbar export is incompatible)» — e ogni modifica al file
 * INVALIDAVA il modulo invece di aggiornarlo: l'app si ricostruiva a meta', accumulando
 * stato vecchio, e le prove diventavano inaffidabili proprio mentre si cercava un guasto
 * intermittente. Un file di ventimila righe e' anche quello che si tocca piu' spesso.
 */

export type ToolbarGroupId =
    | 'playback'
    | 'measurePanel'
    | 'bpm'
    | 'key'
    | 'time'
    | 'measures'
    | 'voices'
    | 'voiceInstrument'
    | 'mixer'
    | 'signs'
    | 'insert'
    | 'chordInsert'
    | 'accidentals'
    | 'notations'
    | 'analysis'
    | 'incompleteMeasures'
    | 'midi'
    | 'more';

/**
 * A CAPO FISSATO A MANO.
 *
 * La barra è una fila sola che va a capo da sé quando finisce lo spazio: le righe non
 * esistono nel modello, sono il risultato dell'impaginazione. Per questo «metti questo
 * gruppo all'inizio della seconda riga» non era esprimibile — spostandolo, quello prima
 * scivolava in fondo alla prima, e non c'era modo di impedirlo.
 *
 * Questo segnaposto occupa tutta la larghezza rimasta e forza l'a capo dove lo si mette.
 * Da lì in poi l'ordine è quello scelto, e non dipende più dalla larghezza della finestra.
 */
/** L'A CAPO viaggia NELLO STESSO elenco dei gruppi, perche' la sua posizione e' fra due
 *  gruppi e non altrove: e' un segnaposto, non un comando. Il tipo lo dichiara membro
 *  dell'unione — cosa che il codice gia' faceva a forza di cast — cosi' i confronti
 *  `id === TOOLBAR_ACAPO` sono leciti invece di sembrare a TypeScript paragoni fra cose
 *  che non si incontrano mai. */
export const TOOLBAR_ACAPO = '__acapo__' as ToolbarGroupId;

export const DEFAULT_TOOLBAR_ORDER: ToolbarGroupId[] = [
    'playback',
    // Le PROPRIETÀ del luogo in cui si trova il cursore (metro, tonalità, stanghette, testo,
    // modulazioni, override): interventi al volo sulla partitura, non impostazioni di pagina —
    // per questo sta accanto ai comandi del cursore e non fra le misure, dove si confondeva
    // con "misure per riga" e "numero di misure".
    'measurePanel',
    'signs',
    'bpm',
    'key',
    'time',
    'measures',
    'voices',
    'voiceInstrument',
    'mixer',
    'insert',
    'chordInsert',
    'accidentals',
    'notations',
    'analysis',
    // L'avviso delle misure incomplete: era un pulsante FISSO appiccicato in alto a
    // destra, l'unico comando che non si poteva spostare. Ora è un gruppo come gli
    // altri — si mette dove serve e la posizione si salva.
    'incompleteMeasures',
    'midi',
    'more',
];

/**
 * FONDE UN ORDINE SALVATO CON QUELLO DI FABBRICA.
 *
 * Due cose che si sbagliano facilmente, e che infatti erano sbagliate in due dei tre
 * punti che ricostruiscono la barra:
 *
 * · GLI A CAPO VANNO TENUTI. Non sono gruppi e non stanno nell'elenco di fabbrica:
 *   filtrando «tengo solo ciò che conosco» sparivano tutti, e riaprendo un file la
 *   barra tornava su una riga sola pur avendo i pulsanti giusti.
 * · GLI A CAPO POSSONO ESSERE PIÙ D'UNO, quindi la deduplica vale per i gruppi (che
 *   sono unici) ma non per loro: passarli in un Set ne lasciava uno solo.
 *
 * I gruppi non ancora conosciuti si aggiungono in coda: una versione nuova che porta un
 * comando nuovo lo fa comparire, invece di nasconderlo a chi ha già personalizzato.
 */
export function fondiOrdineToolbar(salvato: unknown): ToolbarGroupId[] {
    const noti = new Set<ToolbarGroupId>(DEFAULT_TOOLBAR_ORDER);
    const elenco: any[] = Array.isArray(salvato) ? salvato : [];
    const visti = new Set<string>();
    const fuso: ToolbarGroupId[] = [];
    for (const id of elenco) {
        if ((id as string) === TOOLBAR_ACAPO) { fuso.push(id as ToolbarGroupId); continue; }
        if (!noti.has(id) || visti.has(id)) continue;
        visti.add(id);
        fuso.push(id);
    }
    for (const id of DEFAULT_TOOLBAR_ORDER) if (!visti.has(id)) fuso.push(id);
    return fuso;
}
