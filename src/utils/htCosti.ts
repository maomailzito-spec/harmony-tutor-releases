/**
 * DOVE SE NE VA IL TEMPO — cronometro a nomi.
 *
 * `__htRender()` risponde a «quanti ridisegni e quanto costano». Quando la risposta è
 * «pochi e non troppo cari» ma premere un tasto resta faticoso, la domanda successiva è
 * un'altra: il tempo se ne va PRIMA del ridisegno, in uno dei calcoli che lo preparano.
 * Lì `__htRender()` non arriva, e senza un nome si tira a indovinare — cosa che in questa
 * caccia è già costata tre piste sbagliate.
 *
 * Qui ogni calcolo caro si dichiara: `misuraCosto('nome', () => …)` somma quanto ci mette
 * e quante volte parte. `__htCosti()` mette in fila i nomi, dal più caro al meno caro, e
 * dice sia il TOTALE (chi consuma il monte ore) sia il PEGGIORE (chi produce lo scatto).
 * I due non coincidono: un calcolo da un millesimo chiamato diecimila volte e uno da
 * duecento millesimi chiamato una volta pesano uguale nel totale, ma solo il secondo si
 * sente sotto le dita.
 *
 * Costo della sonda: due letture dell'orologio per calcolo misurato — trascurabile
 * rispetto a ciò che misura, e comunque si accende soltanto sui calcoli che dichiariamo.
 */

type Voce = { chiamate: number; ms: number; peggiore: number };

const registro: Record<string, Voce> = {};

/** Segna quanto è costato un calcolo già eseguito. */
export function segnaCosto(nome: string, ms: number): void {
  const v = (registro[nome] ||= { chiamate: 0, ms: 0, peggiore: 0 });
  v.chiamate++;
  v.ms += ms;
  if (ms > v.peggiore) v.peggiore = ms;
}

/** Esegue `fn` cronometrandola sotto `nome`, e ne restituisce il risultato. */
export function misuraCosto<T>(nome: string, fn: () => T): T {
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    segnaCosto(nome, performance.now() - t0);
  }
}

/** Azzera i conti (utile per misurare UN gesto solo: azzera, premi il tasto, leggi). */
export function azzeraCosti(): void {
  for (const k of Object.keys(registro)) delete registro[k];
}

export function tabellaCosti(): Array<{
  calcolo: string; chiamate: number; totale_ms: number; peggiore_ms: number; medio_ms: number;
}> {
  return Object.entries(registro)
    .map(([calcolo, v]) => ({
      calcolo,
      chiamate: v.chiamate,
      totale_ms: Math.round(v.ms),
      peggiore_ms: Math.round(v.peggiore * 10) / 10,
      medio_ms: Math.round((v.ms / Math.max(1, v.chiamate)) * 100) / 100,
    }))
    .sort((a, b) => b.totale_ms - a.totale_ms);
}

/** Registra `__htCosti()` in console. Chiamata una volta all'avvio. */
export function registraComandoCosti(): void {
  try {
    const w = window as any;
    w.__htCosti = (azzera?: boolean) => {
      const righe = tabellaCosti();
      if (!righe.length) {
        // eslint-disable-next-line no-console
        console.log('nessun calcolo misurato finora: fai il gesto che pesa, poi richiama __htCosti().');
        return righe;
      }
      // eslint-disable-next-line no-console
      console.table(righe);
      // eslint-disable-next-line no-console
      console.log(
        'totale_ms = chi consuma il monte ore; peggiore_ms = chi produce lo SCATTO che si sente.\n' +
        'Per misurare un gesto solo: __htCosti(true) per azzerare, fai il gesto, poi __htCosti().'
      );
      if (azzera) azzeraCosti();
      return righe;
    };
  } catch { /* la diagnostica non deve disturbare */ }
}
