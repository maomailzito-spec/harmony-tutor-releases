import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RuleViolation, SequenceMatch } from '../types';
import { pronunciaSigle } from '../utils/pronunciaSigle';
import { usePreference } from '../preferences/usePreference';
import type { HarmonyAnalysisFiltersPref } from '../preferences/preferencesRegistry';

interface HarmonyAnalysisPanelProps {
    violations: RuleViolation[];
    /** DOVE sta la violazione nel brano. Il pannello è già leggibile da uno screen
     *  reader — è testo — ma diceva solo CHE COSA non va, non in quale punto: chi non
     *  vede la pagina restava senza il dato più importante. */
    /** Avviso del MODO: quando si scrive in un modo senza sensibile, le regole che
     *  parlano di lei non si applicano — e va detto, altrimenti chi impara non capisce
     *  perché una regola vista ieri oggi non compare. */
    avvisoModale?: string | null;
    posizioneViolazione?: (v: RuleViolation) => { misura: number; movimento?: number } | null;
    sequenceMatches?: SequenceMatch[];
    sequencesEnabled?: boolean;
    onToggleSequences?: () => void;
    motifsEnabled?: boolean;
    onToggleMotifs?: () => void;
    motifMatches?: Array<{ type: string; mode: string; modelVoice: number; imitationVoice: number; length: number; color: string }>;
    onHoverViolation: (noteIds: string[] | null) => void;
    selectedViolationIndex?: number | null;
    onSelectViolation?: (index: number) => void;
}

const ErrorIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-red-400 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
    </svg>
);

const WarningIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-orange-400 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.21 3.03-1.742 3.03H4.42c-1.532 0-2.492-1.696-1.742-3.03l5.58-9.92zM10 13a1 1 0 110-2 1 1 0 010 2zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
    </svg>
);


const CheckCircleIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-green-400" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
    </svg>
);

const ExceptionIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-green-400 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
    </svg>
);


const VOICE_ABBR: Record<number, string> = { 0: 'Acc', 1: 'S', 2: 'A', 3: 'T', 4: 'B' };
const MOTIF_TYPE_LABEL: Record<string, string> = { transpose: 'Trasposizione', invert: 'Inversione', retrograde: 'Retrogrado', retrogradeInvert: 'Retro-inverso' };
const MOTIF_TYPE_HUE: Record<string, string> = { invert: '#6d28d9', retrograde: '#0f766e', retrogradeInvert: '#a21caf', transpose: '#be185d' };

const HarmonyAnalysisPanel: React.FC<HarmonyAnalysisPanelProps> = ({ violations, avvisoModale, posizioneViolazione, sequenceMatches, sequencesEnabled, onToggleSequences, motifsEnabled, onToggleMotifs, motifMatches, onHoverViolation, selectedViolationIndex, onSelectViolation }) => {
    const { t } = useTranslation('analysis');
    const { t: tUi } = useTranslation('ui');
    const [filters, setFilters] = usePreference<HarmonyAnalysisFiltersPref>('analysis.filters');
    const [ruleSuggestions] = usePreference<Record<string, string>>('analysis.ruleSuggestions');
    const showError = !!filters?.showError;
    const showWarning = !!filters?.showWarning;
    const showException = !!filters?.showException;
    const showChromatic = filters?.showChromatic !== false;
    const disabledRuleIds = (filters?.disabledRuleIds && typeof filters.disabledRuleIds === 'object') ? filters.disabledRuleIds : {};
    const [ruleSearch, setRuleSearch] = useState('');

    const suppressBroadcastRef = useRef(false);
    const itemRefs = useRef<Map<number, HTMLLIElement>>(new Map());

    // Auto-scroll to selected violation when selectedViolationIndex changes
    // (e.g. user clicked a note overlay on the staff).
    useEffect(() => {
        if (selectedViolationIndex == null) return;
        const el = itemRefs.current.get(selectedViolationIndex);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }, [selectedViolationIndex]);

    // Broadcast changes for overlays that listen to the legacy event.
    useEffect(() => {
        if (suppressBroadcastRef.current) {
            suppressBroadcastRef.current = false;
            return;
        }
        try {
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('harmony-analysis-filters-changed', {
                    detail: { showError, showWarning, showException, showChromatic, disabledRuleIds },
                }));
            }
        } catch {
            // ignore
        }
    }, [disabledRuleIds, showError, showException, showWarning, showChromatic]);

    // Listen for external updates (e.g. profile presets) and sync UI.
    useEffect(() => {
        const onExternal = (ev: any) => {
            try {
                const d = ev?.detail;
                if (!d || typeof d !== 'object') return;
                suppressBroadcastRef.current = true;
                setFilters(prev => {
                    const next: HarmonyAnalysisFiltersPref = {
                        showError: typeof d.showError === 'boolean' ? d.showError : !!prev.showError,
                        showWarning: typeof d.showWarning === 'boolean' ? d.showWarning : !!prev.showWarning,
                        showException: typeof d.showException === 'boolean' ? d.showException : !!prev.showException,
                        showChromatic: typeof d.showChromatic === 'boolean' ? d.showChromatic : prev.showChromatic !== false,
                        disabledRuleIds: (d.disabledRuleIds && typeof d.disabledRuleIds === 'object') ? d.disabledRuleIds : (prev.disabledRuleIds || {}),
                    };
                    return next;
                });
            } catch {
                // ignore
            }
        };
        try {
            window.addEventListener('harmony-analysis-filters-changed', onExternal as any);
        } catch {
            // ignore
        }
        return () => {
            try {
                window.removeEventListener('harmony-analysis-filters-changed', onExternal as any);
            } catch {
                // ignore
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const uniqueRuleIds = useMemo(() => {
        const ids = new Set<string>();
        for (const v of (violations || [])) {
            const rid = String(v?.ruleId || '').trim();
            if (rid) ids.add(rid);
        }
        return Array.from(ids).sort((a, b) => a.localeCompare(b));
    }, [violations]);

    const visibleRuleIds = useMemo(() => {
        const q = String(ruleSearch || '').trim().toLowerCase();
        if (!q) return uniqueRuleIds;
        return uniqueRuleIds.filter(rid => rid.toLowerCase().includes(q));
    }, [uniqueRuleIds, ruleSearch]);

    const toggleShowError = useCallback(() => {
        setFilters((prev) => ({ ...prev, showError: !prev?.showError }));
    }, [setFilters]);

    const toggleShowWarning = useCallback(() => {
        setFilters((prev) => ({ ...prev, showWarning: !prev?.showWarning }));
    }, [setFilters]);

    const toggleShowException = useCallback(() => {
        setFilters((prev) => ({ ...prev, showException: !prev?.showException }));
    }, [setFilters]);

    const toggleShowChromatic = useCallback(() => {
        setFilters((prev) => ({ ...prev, showChromatic: prev?.showChromatic === false ? true : false }));
    }, [setFilters]);

    const setDisabledRuleIds = useCallback((next: Record<string, boolean>) => {
        setFilters((prev) => ({ ...prev, disabledRuleIds: next || {} }));
    }, [setFilters]);

    const counts = useMemo(() => {
        const c = { error: 0, warning: 0, exception: 0, chromatic: 0 };
        for (const v of (violations || [])) {
            if (v?.severity === 'error') c.error++;
            else if (v?.severity === 'exception') c.exception++;
            else if (v?.severity === 'chromatic') c.chromatic++;
            else c.warning++;
        }
        return c;
    }, [violations]);

    const filtered = useMemo(() => {
        const out: Array<{ v: RuleViolation; index: number }> = [];
        (violations || []).forEach((v, index) => {
            if (!v) return;
            if (v.severity === 'error' && !showError) return;
            if (v.severity === 'warning' && !showWarning) return;
            if (v.severity === 'exception' && !showException) return;
            if (v.severity === 'chromatic' && !showChromatic) return;
            const rid = String(v.ruleId || '');
            if (rid && disabledRuleIds[rid]) return;
            out.push({ v, index });
        });
        return out;
    }, [violations, showError, showWarning, showException, showChromatic, disabledRuleIds]);

    const sequences = (sequenceMatches || []).slice();
    const hasAnyViolations = (violations || []).length > 0;
    return (
        <div className="bg-gray-800/50 rounded-lg p-3 h-full min-h-0 overflow-y-auto">
            {avvisoModale && (
                <div
                    role="note"
                    className="mb-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] leading-snug text-amber-200"
                >
                    {avvisoModale}
                </div>
            )}
            <div className="mb-3 bg-gray-900/30 border border-gray-700/50 rounded-lg p-2">
                <div className="flex items-center justify-between gap-2">
                    <p className="text-xs uppercase tracking-wide text-gray-400">{t('filters_title')}</p>
                    <p className="text-[11px] text-gray-400">{t('shown_count', { shown: filtered.length, total: violations.length })}</p>
                </div>

                <div className="flex items-center gap-1 mt-2">
                    <button
                        onClick={toggleShowError}
                        className={`px-2 py-0.5 text-xs font-semibold rounded-md transition-colors ${showError ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
                        title={t('filter_errors_tooltip')}
                    >
                        {t('filter_errors', { count: counts.error })}
                    </button>
                    <button
                        onClick={toggleShowWarning}
                        className={`px-2 py-0.5 text-xs font-semibold rounded-md transition-colors ${showWarning ? 'bg-orange-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
                        title={t('filter_warnings_tooltip')}
                    >
                        {t('filter_warnings', { count: counts.warning })}
                    </button>
                    <button
                        onClick={toggleShowException}
                        className={`px-2 py-0.5 text-xs font-semibold rounded-md transition-colors ${showException ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
                        title={t('filter_exceptions_tooltip')}
                    >
                        {t('filter_exceptions', { count: counts.exception })}
                    </button>
                    <button
                        onClick={toggleShowChromatic}
                        className={`px-2 py-0.5 text-xs font-semibold rounded-md transition-colors ${showChromatic ? 'bg-violet-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
                        title={t('filter_chromatics_tooltip')}
                    >
                        {t('filter_chromatics', { count: counts.chromatic })}
                    </button>
                </div>

                <div className="mt-2">
                    <div className="flex items-center justify-between gap-2">
                        <p className="text-xs text-gray-400">{t('rules_title')}</p>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => setDisabledRuleIds({})}
                                className="px-2 py-0.5 text-[11px] font-semibold rounded-md bg-gray-700 text-gray-200 hover:bg-gray-600"
                                title={t('rules_show_all_tooltip')}
                            >
                                {t('rules_show_all')}
                            </button>
                            <button
                                onClick={() => {
                                    const next: Record<string, boolean> = {};
                                    for (const rid of uniqueRuleIds) next[rid] = true;
                                    setDisabledRuleIds(next);
                                }}
                                className="px-2 py-0.5 text-[11px] font-semibold rounded-md bg-gray-700 text-gray-200 hover:bg-gray-600"
                                title={t('rules_hide_all_tooltip')}
                            >
                                {t('rules_hide_all')}
                            </button>
                        </div>
                    </div>

                    <input
                        value={ruleSearch}
                        onChange={e => setRuleSearch(e.target.value)}
                        placeholder={t('rules_search_placeholder')}
                        className="mt-1 w-full bg-gray-700/60 border border-gray-600 rounded-md px-2 py-1 text-xs text-gray-100 placeholder:text-gray-400"
                    />

                    <div className="mt-2 max-h-40 overflow-y-auto pr-1">
                        {visibleRuleIds.length === 0 ? (
                            <p className="text-xs text-gray-400">{t('rules_none_found')}</p>
                        ) : (
                            <div className="grid grid-cols-2 gap-1">
                                {visibleRuleIds.map(rid => {
                                    const enabled = !disabledRuleIds[rid];
                                    return (
                                        <button
                                            key={rid}
                                            onClick={() => {
                                                setFilters((prev) => {
                                                    const cur = (prev?.disabledRuleIds && typeof prev.disabledRuleIds === 'object')
                                                        ? (prev.disabledRuleIds as Record<string, boolean>)
                                                        : {};
                                                    // enabled=true means currently visible, so click should disable it.
                                                    return { ...prev, disabledRuleIds: { ...cur, [rid]: enabled } };
                                                });
                                            }}
                                            className={`text-left px-2 py-1 text-[11px] rounded-md border transition-colors ${enabled ? 'bg-gray-700/40 border-gray-600 text-gray-200 hover:bg-gray-700/70' : 'bg-gray-900/40 border-gray-800 text-gray-500 hover:bg-gray-800/50'}`}
                                            title={enabled ? t('rule_click_hide') : t('rule_click_show')}
                                        >
                                            {rid}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {typeof onToggleMotifs === 'function' && (
                <div className="mb-4">
                    <div className="flex items-center justify-between gap-2 mb-1">
                        <p className="text-xs uppercase tracking-wide text-gray-400">Motivi melodici (T/I/R/RI)</p>
                        <button
                            onClick={onToggleMotifs}
                            className={`px-2 py-0.5 text-[11px] font-semibold rounded-md border transition-colors ${motifsEnabled ? 'bg-violet-600 text-white border-violet-500' : 'bg-gray-700 text-gray-200 border-gray-600 hover:bg-gray-600'}`}
                            title={tUi('motifs_tip')}
                        >
                            {motifsEnabled ? 'On' : 'Off'}
                        </button>
                    </div>
                    {motifsEnabled ? (
                        <>
                            <p className="text-[11px] text-gray-400 mb-1">
                                Note colorate = motivo (modello e imitazione, stesso colore). Il <span className="font-semibold">modello</span> ha in più la <span className="font-semibold">bracket</span> con la sigla. Colore FISSO per tipo:
                            </p>
                            <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2">
                                {(['invert', 'retrograde', 'retrogradeInvert', 'transpose'] as const).map(tp => (
                                    <span key={tp} className="flex items-center gap-1 text-[11px] text-gray-300">
                                        <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: MOTIF_TYPE_HUE[tp] }} />
                                        {MOTIF_TYPE_LABEL[tp]}
                                    </span>
                                ))}
                            </div>
                            {(motifMatches && motifMatches.length > 0) ? (
                                <ul className="space-y-1">
                                    {motifMatches.map((m, i) => (
                                        <li key={i} className="flex items-center gap-2 text-[11px] text-gray-300">
                                            <span className="inline-block w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: m.color }} />
                                            <span>
                                                {MOTIF_TYPE_LABEL[m.type] ?? m.type} <span className="text-gray-400">{m.mode === 'tonal' ? 'tonale' : 'reale'}</span>
                                                {' · '}{VOICE_ABBR[m.modelVoice] ?? m.modelVoice}→{VOICE_ABBR[m.imitationVoice] ?? m.imitationVoice}
                                                {' · '}{m.length} note
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-[11px] text-gray-500">Nessun motivo trasformato rilevato.</p>
                            )}
                        </>
                    ) : null}
                </div>
            )}

            {(typeof onToggleSequences === 'function' || sequences.length > 0) && (
                <div className="mb-4">
                    <div className="flex items-center justify-between gap-2 mb-2">
                        <p className="text-xs uppercase tracking-wide text-gray-400">{t('sequences_title')}</p>
                        {typeof onToggleSequences === 'function' ? (
                            <button
                                onClick={onToggleSequences}
                                className={`px-2 py-0.5 text-[11px] font-semibold rounded-md border transition-colors ${sequencesEnabled ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-gray-700 text-gray-200 border-gray-600 hover:bg-gray-600'}`}
                                title={sequencesEnabled ? t('sequences_disable_tooltip') : t('sequences_enable_tooltip')}
                            >
                                {sequencesEnabled ? t('sequences_toggle_on') : t('sequences_toggle_off')}
                            </button>
                        ) : null}
                    </div>

                    {sequences.length === 0 ? (
                        <p className="text-xs text-gray-400">
                            {sequencesEnabled ? t('sequences_none_found') : t('sequences_disabled')}
                        </p>
                    ) : (
                        <ul className="space-y-2">
                            {sequences.map((seq, idx) => {
                            const conf = Math.round(seq.confidence * 100);
                            const range = seq.startMeasure === seq.endMeasure
                                ? t('sequence_measure_one', { n: seq.startMeasure + 1 })
                                : t('sequence_measure_range', { from: seq.startMeasure + 1, to: seq.endMeasure + 1 });
                            const modelRange = (seq.modelStartMeasure != null && seq.modelEndMeasure != null)
                                ? (seq.modelStartMeasure === seq.modelEndMeasure
                                    ? `m${seq.modelStartMeasure + 1}`
                                    : `m${seq.modelStartMeasure + 1}–${seq.modelEndMeasure + 1}`)
                                : '';
                            const repeatRange = (seq.repeatStartMeasure != null && seq.repeatEndMeasure != null)
                                ? (seq.repeatStartMeasure === seq.repeatEndMeasure
                                    ? `m${seq.repeatStartMeasure + 1}`
                                    : `m${seq.repeatStartMeasure + 1}–${seq.repeatEndMeasure + 1}`)
                                : '';
                            return (
                                <li key={`seq-${idx}`} className="bg-gray-700/50 p-2 rounded-lg border border-gray-700/50">
                                    <p className="text-xs text-gray-200 font-semibold">
                                        {t('sequence_summary', { range, length: seq.lengthSteps, conf })}
                                    </p>
                                    {modelRange && repeatRange && (
                                        <p className="text-[11px] text-gray-300 mt-1">{t('sequence_model_to_repeat', { model: modelRange, repeat: repeatRange })}</p>
                                    )}
                                    {seq.label && (
                                        <p className="text-[11px] text-gray-400 mt-1">{seq.label}</p>
                                    )}
                                </li>
                            );
                            })}
                        </ul>
                    )}
                </div>
            )}
            {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center text-gray-400">
                    <CheckCircleIcon />
                    {hasAnyViolations ? (
                        <>
                            <p className="mt-2 font-semibold">{t('empty_filtered_title')}</p>
                            <p className="text-sm">{t('empty_filtered_hint')}</p>
                        </>
                    ) : (
                        <>
                            <p className="mt-2 font-semibold">{t('empty_clean_title')}</p>
                            <p className="text-sm">{t('empty_clean_hint')}</p>
                        </>
                    )}
                </div>
            ) : (
                <ul className="space-y-1">
                    {filtered.map(({ v: violation, index }) => {
                        const isError = violation.severity === 'error';
                        const isException = violation.severity === 'exception';
                        const isChromatic = violation.severity === 'chromatic';
                        const isCadenceMarker = typeof violation.ruleId === 'string' && violation.ruleId.startsWith('CAD-');
                        const Icon = isError ? ErrorIcon : isException ? ExceptionIcon : isChromatic ? ExceptionIcon : WarningIcon;
                        const textColor = isError ? 'text-red-400' : isException ? 'text-green-400' : isChromatic ? 'text-violet-400' : 'text-orange-400';
                        const isSelected = selectedViolationIndex === index;

                        // Split description: first line = summary, rest = detail
                        const descLines = (violation.description || '').split('\n');
                        const summaryLine = descLines[0];
                        const detailLines = descLines.slice(1).join('\n').trim();

                        // Il PUNTO del brano, detto a parole: si legge sullo schermo e si
                        // sente con lo screen reader. Il movimento si scrive solo se è un
                        // numero pulito — «misura 4, movimento 2,5» non aiuta nessuno.
                        const pos = posizioneViolazione?.(violation) ?? null;
                        const dove = pos
                            ? (pos.movimento != null && Math.abs(pos.movimento - Math.round(pos.movimento)) < 1e-6
                                ? t('violation_at_measure_beat', { m: pos.misura, b: Math.round(pos.movimento), defaultValue: `misura ${pos.misura}, movimento ${Math.round(pos.movimento)}` })
                                : t('violation_at_measure', { m: pos.misura, defaultValue: `misura ${pos.misura}` }))
                            : '';

                        return (
                            <li
                                key={`${violation.ruleId}-${index}`}
                                ref={(el) => { if (el) itemRefs.current.set(index, el); else itemRefs.current.delete(index); }}
                                className={`bg-gray-700/50 rounded-md border border-gray-700/50 hover:bg-gray-600/50 transition-colors ${isSelected ? 'ring-1 ring-cyan-400 border-cyan-400' : ''}`}
                                onMouseEnter={() => onHoverViolation(violation.noteIds)}
                                onMouseLeave={() => onHoverViolation(null)}
                            >
                                {/* UN PULSANTE VERO, non un riquadro cliccabile.
                                    Prima era un <li> con onClick: col mouse funzionava,
                                    da tastiera non si poteva né raggiungere né aprire, e
                                    uno screen reader annunciava il pannello e poi si
                                    fermava lì — non c'era niente su cui posarsi.
                                    Come pulsante ci si arriva col TAB, si apre con Invio
                                    o barra spaziatrice, e `aria-expanded` dice se il
                                    dettaglio è aperto. Il nome accessibile porta tutto
                                    ciò che serve per decidere se aprirla: gravità, punto
                                    del brano e sunto. */}
                                <button
                                    type="button"
                                    className="w-full text-left px-2 py-1.5 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 rounded-md"
                                    aria-expanded={!!isSelected}
                                    // La spiegazione si LEGA al pulsante invece di stare
                                    // lì accanto ad aspettare. Da sola era un gruppo in
                                    // cui VoiceOver proponeva di «entrare», e il testo
                                    // non lo diceva mai; così invece arriva subito dopo
                                    // il titolo, sullo stesso fuoco, senza navigare.
                                    aria-describedby={isSelected ? `viol-det-${index}` : undefined}
                                    aria-label={[
                                        isError ? t('violation_error', { defaultValue: 'Errore' })
                                            : isException ? t('violation_exception')
                                            : isChromatic ? t('violation_chromatic')
                                            : t('violation_warning', { defaultValue: 'Avvertimento' }),
                                        dove,
                                        // Le sigle dette a parole: «settima di
                                        // dominante» invece di «vu sette». Solo qui —
                                        // sullo schermo resta scritto V7.
                                        pronunciaSigle(summaryLine),
                                    ].filter(Boolean).join('. ')}
                                    onClick={() => onSelectViolation && onSelectViolation(index)}
                                    onFocus={() => onHoverViolation(violation.noteIds)}
                                    onBlur={() => onHoverViolation(null)}
                                >
                                <div className="flex items-start gap-2">
                                    <Icon />
                                    <div className="flex-grow">
                                        <p className={`font-bold ${textColor} text-xs leading-snug`}>
                                            {isCadenceMarker ? (
                                                <>
                                                    <span className="text-white">{summaryLine}</span>
                                                </>
                                            ) : (
                                                <>
                                                    {isException ? t('violation_exception') : isChromatic ? t('violation_chromatic') : violation.ruleId}: <span className="text-white">{summaryLine}</span>
                                                </>
                                            )}
                                            {(detailLines || violation.suggestion) && (
                                                <span className="ml-1 text-gray-500 text-[10px] font-normal">{isSelected ? '▲' : '▼'}</span>
                                            )}
                                        </p>
                                        {dove && (
                                            <p className="text-[10px] text-gray-400 leading-snug">{dove}</p>
                                        )}
                                    </div>
                                </div>
                                </button>
                                {/* IL DETTAGLIO STA FUORI DAL PULSANTE, ed è il punto:
                                    `aria-label` sostituisce TUTTO il contenuto del
                                    pulsante per uno screen reader. Finché la spiegazione
                                    stava dentro, veniva letto solo il titolo e il resto
                                    spariva — «legge i titoli ma non i contenuti».
                                    Fuori, è testo normale che si legge continuando a
                                    scorrere. È la forma consueta di un elenco che si
                                    apre: intestazione premibile, contenuto accanto. */}
                                {isSelected && (detailLines || violation.suggestion || (ruleSuggestions as Record<string,string>)?.[violation.ruleId]) && (
                                    <div
                                        id={`viol-det-${index}`}
                                        // Compare all'apertura: `polite` la fa annunciare
                                        // appena c'è, senza interrompere ciò che si sta
                                        // ascoltando. Senza, premendo Invio il fuoco resta
                                        // sul pulsante e niente segnala che il testo è
                                        // comparso.
                                        aria-live="polite"
                                        // Stessa ragione: si legge la forma parlata, si
                                        // vede la sigla. Il testo visibile qui sotto non
                                        // cambia di una virgola.
                                        aria-label={pronunciaSigle([
                                            detailLines,
                                            violation.suggestion,
                                            (ruleSuggestions as Record<string,string>)?.[violation.ruleId],
                                        ].filter(Boolean).join('. '))}
                                        className="px-2 pb-1.5 -mt-0.5">
                                        {detailLines && (
                                            <p className="text-[11px] text-gray-300 whitespace-pre-wrap leading-snug">
                                                {detailLines}
                                            </p>
                                        )}
                                        {(violation.suggestion || (ruleSuggestions as Record<string,string>)?.[violation.ruleId]) && (
                                            <p className="text-[11px] text-gray-300 mt-1 whitespace-pre-wrap leading-snug">
                                                {violation.suggestion && (
                                                    <><span className="font-semibold">{t('violation_suggestion_label')}</span> {violation.suggestion}</>
                                                )}
                                                {(ruleSuggestions as Record<string,string>)?.[violation.ruleId] && (
                                                    <span className="block mt-1 italic" style={{ color: '#fcd34d' }}>
                                                        📝 {(ruleSuggestions as Record<string,string>)[violation.ruleId]}
                                                    </span>
                                                )}
                                            </p>
                                        )}
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
};

export default HarmonyAnalysisPanel;