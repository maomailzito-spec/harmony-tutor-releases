/**
 * ORNAMENTI APPRESI — tavola estratta dalle correzioni manuali dell'utente.
 *
 * NON SCRIVERE A MANO: la produce `scripts/estrai-ornamenti.ts` dai file del corpus.
 *
 * Ogni riga dice: in questa situazione — tempo forte o debole, durata, come ci si arriva,
 * come si riparte — l'utente ha deciso così. Una situazione entra qui solo se ricorre
 * almeno 5 volte in almeno 3 brani diversi e con almeno il 75% di risposte
 * concordi: sotto quelle soglie non è conoscenza, è il ricordo di un caso — o una
 * situazione davvero ambigua, e lì il motore deve astenersi invece di indovinare.
 *
 * 54 situazioni tenute, 160 scartate.
 */
export type SituazioneAppresa = {
  /** true = l'utente l'ha chiamata ornamentale; false = nota reale dell'armonia. */
  ornamento: boolean;
  /** Il tipo scelto più spesso in questa situazione. */
  tipo: string;
  casi: number;
  brani: number;
  coerenza: number;
};

export const ORNAMENTI_APPRESI: Record<string, SituazioneAppresa> = {
  'd|eighth|gradoGiu|gradoGiu': { ornamento: true, tipo: 'passing', casi: 179, brani: 49, coerenza: 0.84 },
  'd|eighth|gradoSu|gradoSu': { ornamento: true, tipo: 'passing', casi: 108, brani: 32, coerenza: 0.88 },
  'd|sixteenth|gradoSu|gradoSu': { ornamento: true, tipo: 'ornamental', casi: 45, brani: 9, coerenza: 0.91 },
  'd|eighth|gradoSu|gradoGiu': { ornamento: true, tipo: 'ornamental', casi: 44, brani: 21, coerenza: 0.98 },
  'F|quarter|ferma|gradoGiu': { ornamento: true, tipo: 'appoggiatura', casi: 39, brani: 22, coerenza: 0.82 },
  'd|eighth|gradoGiu|gradoSu': { ornamento: true, tipo: 'neighbor', casi: 36, brani: 22, coerenza: 0.86 },
  'd|eighth|gradoGiu|ferma': { ornamento: true, tipo: 'ornamental', casi: 36, brani: 13, coerenza: 0.94 },
  'd|eighth|terzaGiu|gradoSu': { ornamento: true, tipo: 'ornamental', casi: 33, brani: 14, coerenza: 0.97 },
  'F|half|ferma|gradoGiu': { ornamento: true, tipo: 'ornamental', casi: 33, brani: 7, coerenza: 0.97 },
  'd|sixteenth|gradoGiu|gradoGiu': { ornamento: true, tipo: 'ornamental', casi: 32, brani: 12, coerenza: 0.94 },
  'd|eighth|ferma|gradoGiu': { ornamento: true, tipo: 'ornamental', casi: 31, brani: 16, coerenza: 1.00 },
  'F|quarter|gradoSu|gradoGiu': { ornamento: true, tipo: 'appoggiatura', casi: 26, brani: 17, coerenza: 0.77 },
  'F|half|ferma|ferma': { ornamento: true, tipo: 'ornamental', casi: 25, brani: 3, coerenza: 0.80 },
  'd|eighth|gradoSu|terzaGiu': { ornamento: true, tipo: 'escape', casi: 22, brani: 9, coerenza: 1.00 },
  'F|quarter|terzaSu|gradoGiu': { ornamento: true, tipo: 'appoggiatura', casi: 19, brani: 13, coerenza: 0.95 },
  'F|eighth|ferma|gradoGiu': { ornamento: true, tipo: 'ornamental', casi: 19, brani: 9, coerenza: 0.95 },
  'd|eighth|terzaSu|gradoGiu': { ornamento: true, tipo: 'cambiata', casi: 18, brani: 10, coerenza: 0.94 },
  'd|sixteenth|gradoSu|gradoGiu': { ornamento: true, tipo: 'ornamental', casi: 16, brani: 7, coerenza: 0.94 },
  'F|quarter|terzaGiu|gradoSu': { ornamento: true, tipo: 'appoggiatura', casi: 16, brani: 11, coerenza: 0.88 },
  'd|eighth|gradoGiu|terzaSu': { ornamento: true, tipo: 'ornamental', casi: 16, brani: 7, coerenza: 0.94 },
  'F|quarter|gradoGiu|gradoSu': { ornamento: true, tipo: 'neighbor', casi: 14, brani: 10, coerenza: 0.79 },
  'd|quarter|gradoSu|gradoGiu': { ornamento: true, tipo: 'neighbor', casi: 14, brani: 12, coerenza: 0.79 },
  'd|sixteenth|gradoGiu|gradoSu': { ornamento: true, tipo: 'ornamental', casi: 14, brani: 10, coerenza: 1.00 },
  'd|eighth|saltoGiu|saltoSu': { ornamento: true, tipo: 'ornamental', casi: 14, brani: 12, coerenza: 0.93 },
  'F|quarter|gradoSu|gradoSu': { ornamento: true, tipo: 'passing', casi: 13, brani: 6, coerenza: 0.92 },
  'd|sixteenth|terzaGiu|gradoSu': { ornamento: true, tipo: 'ornamental', casi: 13, brani: 3, coerenza: 1.00 },
  'd|eighth|saltoSu|gradoGiu': { ornamento: true, tipo: 'appoggiatura', casi: 13, brani: 11, coerenza: 0.85 },
  'F|eighth|gradoGiu|gradoGiu': { ornamento: true, tipo: 'ornamental', casi: 13, brani: 7, coerenza: 0.77 },
  'd|eighth|terzaSu|terzaSu': { ornamento: true, tipo: 'ornamental', casi: 12, brani: 8, coerenza: 1.00 },
  'd|eighth|ferma|ferma': { ornamento: true, tipo: 'ornamental', casi: 11, brani: 5, coerenza: 1.00 },
  'F|eighth|gradoGiu|gradoSu': { ornamento: true, tipo: 'appoggiatura', casi: 11, brani: 7, coerenza: 0.91 },
  'd|eighth|ferma|gradoSu': { ornamento: true, tipo: 'ornamental', casi: 10, brani: 6, coerenza: 0.80 },
  'd|quarter|terzaSu|gradoGiu': { ornamento: true, tipo: 'cambiata', casi: 10, brani: 5, coerenza: 0.90 },
  'd|quarter|saltoSu|saltoGiu': { ornamento: true, tipo: 'ornamental', casi: 9, brani: 3, coerenza: 1.00 },
  'd|eighth|terzaGiu|gradoGiu': { ornamento: true, tipo: 'ornamental', casi: 9, brani: 8, coerenza: 0.89 },
  'F|eighth|saltoSu|gradoGiu': { ornamento: true, tipo: 'appoggiatura', casi: 9, brani: 6, coerenza: 1.00 },
  'd|eighth|saltoGiu|gradoSu': { ornamento: true, tipo: 'ornamental', casi: 9, brani: 7, coerenza: 1.00 },
  'd|eighth|gradoSu|terzaSu': { ornamento: true, tipo: 'ornamental', casi: 9, brani: 7, coerenza: 0.78 },
  'd|eighth|gradoGiu|saltoSu': { ornamento: true, tipo: 'ornamental', casi: 9, brani: 5, coerenza: 0.78 },
  'F|eighth|ferma|gradoSu': { ornamento: true, tipo: 'suspension', casi: 9, brani: 7, coerenza: 0.89 },
  'd|eighth|ferma|terzaSu': { ornamento: true, tipo: 'ornamental', casi: 8, brani: 3, coerenza: 0.88 },
  'F|half|gradoGiu|ferma': { ornamento: false, tipo: 'structural', casi: 8, brani: 6, coerenza: 0.88 },
  'd|eighth|gradoSu|ferma': { ornamento: true, tipo: 'anticipation', casi: 8, brani: 7, coerenza: 1.00 },
  'd|eighth|terzaGiu|terzaGiu': { ornamento: true, tipo: 'ornamental', casi: 7, brani: 5, coerenza: 0.86 },
  'd|quarter|gradoSu|terzaGiu': { ornamento: true, tipo: 'escape', casi: 7, brani: 3, coerenza: 0.86 },
  'd|eighth|saltoSu|terzaGiu': { ornamento: true, tipo: 'ornamental', casi: 6, brani: 5, coerenza: 0.83 },
  'F|quarter|ferma|gradoSu': { ornamento: true, tipo: 'suspension', casi: 6, brani: 6, coerenza: 1.00 },
  'F|eighth|terzaGiu|gradoSu': { ornamento: true, tipo: 'appoggiatura', casi: 6, brani: 5, coerenza: 1.00 },
  'd|quarter|terzaGiu|terzaSu': { ornamento: true, tipo: 'ornamental', casi: 5, brani: 4, coerenza: 0.80 },
  'd|eighth|gradoSu|saltoGiu': { ornamento: true, tipo: 'ornamental', casi: 5, brani: 5, coerenza: 0.80 },
  'd|sixteenth|gradoGiu|terzaGiu': { ornamento: true, tipo: 'ornamental', casi: 5, brani: 3, coerenza: 1.00 },
  'd|eighth|gradoGiu|terzaGiu': { ornamento: true, tipo: 'passing', casi: 5, brani: 4, coerenza: 1.00 },
  'd|eighth|saltoGiu|terzaSu': { ornamento: true, tipo: 'ornamental', casi: 5, brani: 4, coerenza: 1.00 },
  'd|eighth|terzaGiu|ferma': { ornamento: true, tipo: 'ornamental', casi: 5, brani: 3, coerenza: 1.00 },
};

/** La situazione di una nota, nella stessa forma con cui è scritta la tavola. */
export function situazioneDi(args: {
  beat: number; duration: string; daPrima: number; aDopo: number;
}): string {
  const passo = (d: number) => d === 0 ? 'ferma' : Math.abs(d) <= 2 ? (d > 0 ? 'gradoSu' : 'gradoGiu')
    : Math.abs(d) <= 4 ? (d > 0 ? 'terzaSu' : 'terzaGiu') : (d > 0 ? 'saltoSu' : 'saltoGiu');
  const b = args.beat;
  const metro = (b === Math.floor(b) && (b === 1 || b === 3)) ? 'F' : 'd';
  return `${metro}|${args.duration}|${passo(args.daPrima)}|${passo(args.aDopo)}`;
}

/** Cosa ha deciso l'utente in questa situazione, se l'ha decisa abbastanza volte. */
export function cosaDisseLUtente(situazione: string): SituazioneAppresa | null {
  return ORNAMENTI_APPRESI[situazione] ?? null;
}
