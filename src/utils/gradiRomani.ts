/**
 * «COMINCIA PER V» NON VUOL DIRE «È UNA DOMINANTE».
 *
 * Il numero romano è una stringa, e la tentazione di leggerlo come tale è forte: per
 * sapere se un accordo ha funzione di dominante si guardava se il romano comincia per «v».
 * Ma cominciano per «v» anche `vi` e `VI` — il sesto grado, cioè esattamente l'accordo
 * della cadenza d'inganno, quello che una dominante NON è.
 *
 * Il difetto stava in tredici punti, sempre con la stessa intenzione dichiarata nei
 * commenti («dominant-function», «V or vii°»), e in nove di quelli scritto così:
 *
 *     roman.startsWith('v') || roman.startsWith('vii')
 *
 * dove il secondo termine è MORTO — `'vii°'.startsWith('v')` è già vero — e serviva solo a
 * far sembrare completo un test che non lo era. Chi l'ha scritto stava pensando alla cosa
 * giusta (aggiungere la sensibile) e non si è accorto che intanto entrava il sesto grado.
 *
 * Un test su STRINGA dove serviva un test su FUNZIONE: la stessa forma di errore della
 * guardia sulla tonica col `(I|i)` indifferenziato.
 */

/** Il grado, senza cifre, alterazioni di cifra, spazi: `V6/5` → `v`, `vii°7` → `vii°`. */
function grado(roman: string): string {
    return String(roman || '').replace(/\s+/g, '').toLowerCase();
}

/**
 * Il romano ha FUNZIONE DI DOMINANTE: il quinto grado in qualunque forma — settima,
 * rivolto, dominante secondaria (`V/V`) — oppure il settimo, che ne è il sostituto.
 *
 * NON il sesto: `vi` e `VI` cominciano per «v» e non sono dominanti di niente.
 */
export function haFunzioneDiDominante(roman: string): boolean {
    const raw = String(roman || '').replace(/\s+/g, '');
    const r = raw.toLowerCase();
    if (!r.startsWith('v')) return false;
    // LA SENSIBILE, che è dominante per sostituzione, si scrive MINUSCOLA: `vii°`, `viiø7`.
    // Il `VII` maiuscolo è un'altra cosa — il settimo grado abbassato del modo minore,
    // triade maggiore che non ha funzione di dominante e tipicamente va al III. Il vecchio
    // `startsWith('vii')` li prendeva tutt'e due.
    if (r.startsWith('vii')) return raw.startsWith('vii');
    return !r.startsWith('vi');               // tutto il resto tranne il sesto grado
}

/**
 * Il romano è il QUINTO GRADO vero e proprio, sensibile esclusa.
 * Serve dove una figura promette la dominante e non un suo sostituto — la sesta eccedente,
 * la napoletana, il 6/4 cadenzale.
 */
export function eIlQuintoGrado(roman: string): boolean {
    const r = grado(roman);
    return r.startsWith('v') && !r.startsWith('vi');
}
