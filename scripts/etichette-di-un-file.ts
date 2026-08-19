/**
 * LE ETICHETTE DI UN FILE, DA RIGA DI COMANDO.
 *
 * È ciò che l'estrazione rende possibile: far girare il calcolo delle etichette senza
 * aprire l'applicazione, e quindi poterlo confrontare su tutto il repertorio.
 *
 * L'impaginazione qui è FINTA — un sistema solo che contiene tutte le misure — perché al
 * calcolo serve per raggruppare e per la x, non per decidere i gradi. Quello che si
 * confronta sono i romani e le cifre, non dove finiscono sulla pagina.
 */
import { readFileSync } from 'fs';
import { applyHarmonyRules, getKeySignature } from '../src/utils/musicTheory';
import { computeHarmonyLabelsBySystemCore } from '../src/hooks/harmonyLabelsCore';
import { measureLengthMap, beatsOfMeasure } from '../src/utils/measureLengths';
import { tonicName } from '../src/utils/keySignatureOptions';

export type EtichettaPiatta = { absBeat: number; roman: string; figures: string[] };

export function etichetteDiUnFile(percorso: string): EtichettaPiatta[] {
  const p = JSON.parse(readFileSync(percorso, 'utf8'));
  const notes = p.notes || [];
  const ts = p.timeSignature || { numerator: 4, denominator: 4 };
  // LA TONICA NON È L'ARMATURA. `keySignatureRoot` è sempre la fondamentale MAGGIORE
  // (un brano in Do minore lo salva come 'Eb'); al motore e al condotto va passata la
  // tonica VERA, altrimenti si legge tutto nel relativo maggiore — e i gradi escono
  // shiftati: i→vi, iv→ii. È la trappola che questo confronto ha ripreso in pieno.
  const armatura = String(p.keySignatureRoot || 'C');
  const isMinor = Boolean(p.isMinorMode);
  const tonic = tonicName(armatura, isMinor);
  const contexts = p.analysisContexts || [];
  const keySig = getKeySignature(armatura, 'Major') as any;

  const res: any = applyHarmonyRules(notes as any, keySig, tonic, isMinor, contexts as any, ts as any,
    p.doubleBarlineMeasures || [], p.ornamentOverrides || [], p.harmonyOverrides || []);
  const analyzed = res.analyzedNotes || notes;

  // I CONTESTI CHE ARRIVANO AL CONDOTTO NON SONO SOLO QUELLI SCRITTI NEL FILE: l'editor
  // ci unisce quelli DEDOTTI dal motore (scartando i più deboli, punteggio < 12). Senza
  // questa unione i brani con modulazioni si leggono nella tonalità d'impianto — ed è la
  // differenza che il primo confronto aveva fatto emergere.
  const dedotti = ((res as any).inferredAnalysisContexts || [])
    .filter((c: any) => typeof c.score === 'number' && c.score >= 12);
  const contestiEffettivi = [...contexts, ...dedotti];

  // Griglia delle misure, come la costruisce l'impaginazione vera.
  const ultima = analyzed.reduce((mx: number, n: any) => Math.max(mx, Number(n.measureIndex) || 0), 0);
  const eccezioni = measureLengthMap(p.measureLengths);
  const battuteDi = (m: number) => {
    let attivo = ts;
    for (const c of (p.timeSignatureChanges || [])) if ((c.measureIndex ?? 0) <= m) attivo = c;
    return beatsOfMeasure(m, attivo.numerator * (4 / attivo.denominator), eccezioni);
  };
  const measureBeatsPerMeasure: number[] = [];
  const measureStartAbsBeat: number[] = [];
  let acc = 0;
  for (let m = 0; m <= ultima; m++) { measureStartAbsBeat[m] = acc; measureBeatsPerMeasure[m] = battuteDi(m); acc += measureBeatsPerMeasure[m]; }

  const measureIndices = measureBeatsPerMeasure.map((_, i) => i);
  const layoutData: any = {
    positionedNotes: analyzed.map((n: any) => ({ ...n, xPosition: 0 })),
    systemsParams: [{ measureIndices, startMeasuresX: measureIndices.map(i => i * 100), width: (ultima + 1) * 100 }],
    measureStartAbsBeat, measureBeatsPerMeasure,
  };

  const absBeatDi = (ctx: any) => Number.isFinite(ctx?.absBeat)
    ? Number(ctx.absBeat) : (Number(ctx?.measureIndex) || 0) * (ts.numerator * (4 / ts.denominator));

  const perSistema = computeHarmonyLabelsBySystemCore({
    analyzedNotes: analyzed, layoutData, timeSignature: ts, timeSignatureChanges: p.timeSignatureChanges || [],
    measureLengths: p.measureLengths || [], analysisContexts: contestiEffettivi, declaredAnalysisContexts: contexts, analysisContextAbsBeat: absBeatDi,
    currentTonic: tonic, isMinorMode: isMinor, isAnalysisEnabled: true,
    harmonyOverrides: p.harmonyOverrides || [], autoHarmonyLabelOverrides: [],
    accompanimentTracks: p.accompanimentTracks || [], tonicizationHints: p.tonicizationHints || [],
    inferredContextSuppressions: p.inferredContextSuppressions || [],
    enableInferredContexts: true, cadentialPatternsEnabled: true,
    useStatisticalCorrection: false, styleProfile: null,
    _chromaticModulationEnabled: true, accHintEnabled: false, compactTonicization: false,
    minSpanBeats: 0, ornOverrideMap: new Map(), ornOverrideRecord: {},
  } as any);

  return (perSistema || []).flat()
    .filter((l: any) => l && (l.roman || (l.figures || []).length))
    .map((l: any) => ({ absBeat: Number(l.absBeat), roman: String(l.roman || ''), figures: l.figures || [] }))
    .sort((a: EtichettaPiatta, b: EtichettaPiatta) => a.absBeat - b.absBeat);
}

// Solo quando lo si lancia da solo: importato da un altro script non deve fare niente.
if (process.argv[2] && process.argv[2].endsWith('.htp')) {
  const et = etichetteDiUnFile(process.argv[2]);
  console.log(`${et.length} etichette`);
  for (const e of et.slice(0, 20)) console.log(`   b.${e.absBeat}  ${e.roman}  ${e.figures.join('/')}`);
}
