import React, { useEffect, useMemo, useState } from 'react';
import { RuleViolation, SequenceMatch } from '../types';

interface HarmonyAnalysisPanelProps {
    violations: RuleViolation[];
    sequenceMatches?: SequenceMatch[];
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


const HarmonyAnalysisPanel: React.FC<HarmonyAnalysisPanelProps> = ({ violations, sequenceMatches, onHoverViolation, selectedViolationIndex, onSelectViolation }) => {
    const FILTERS_STORAGE_KEY = 'harmony.analysis.filters.v1';

    const [showError, setShowError] = useState(true);
    const [showWarning, setShowWarning] = useState(true);
    const [showException, setShowException] = useState(true);
    const [disabledRuleIds, setDisabledRuleIds] = useState<Record<string, boolean>>({});
    const [ruleSearch, setRuleSearch] = useState('');

    // Load persisted filters.
    useEffect(() => {
        try {
            const raw = localStorage.getItem(FILTERS_STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (typeof parsed?.showError === 'boolean') setShowError(parsed.showError);
            if (typeof parsed?.showWarning === 'boolean') setShowWarning(parsed.showWarning);
            if (typeof parsed?.showException === 'boolean') setShowException(parsed.showException);
            if (parsed?.disabledRuleIds && typeof parsed.disabledRuleIds === 'object') setDisabledRuleIds(parsed.disabledRuleIds);
        } catch {
            // ignore
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Persist filters.
    useEffect(() => {
        try {
            localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify({ showError, showWarning, showException, disabledRuleIds }));
        } catch {
            // ignore
        }
    }, [showError, showWarning, showException, disabledRuleIds]);

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

    const counts = useMemo(() => {
        const c = { error: 0, warning: 0, exception: 0 };
        for (const v of (violations || [])) {
            if (v?.severity === 'error') c.error++;
            else if (v?.severity === 'exception') c.exception++;
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
            const rid = String(v.ruleId || '');
            if (rid && disabledRuleIds[rid]) return;
            out.push({ v, index });
        });
        return out;
    }, [violations, showError, showWarning, showException, disabledRuleIds]);

    const sequences = (sequenceMatches || []).slice();
    return (
        <div className="bg-gray-800/50 rounded-lg p-3 h-full min-h-0 overflow-y-auto">
            <div className="mb-3 bg-gray-900/30 border border-gray-700/50 rounded-lg p-2">
                <div className="flex items-center justify-between gap-2">
                    <p className="text-xs uppercase tracking-wide text-gray-400">Filtri</p>
                    <p className="text-[11px] text-gray-400">Mostrati: {filtered.length}/{violations.length}</p>
                </div>

                <div className="flex items-center gap-1 mt-2">
                    <button
                        onClick={() => setShowError(v => !v)}
                        className={`px-2 py-0.5 text-xs font-semibold rounded-md transition-colors ${showError ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
                        title="Mostra/Nascondi errori"
                    >
                        Errori ({counts.error})
                    </button>
                    <button
                        onClick={() => setShowWarning(v => !v)}
                        className={`px-2 py-0.5 text-xs font-semibold rounded-md transition-colors ${showWarning ? 'bg-orange-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
                        title="Mostra/Nascondi warning"
                    >
                        Warning ({counts.warning})
                    </button>
                    <button
                        onClick={() => setShowException(v => !v)}
                        className={`px-2 py-0.5 text-xs font-semibold rounded-md transition-colors ${showException ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
                        title="Mostra/Nascondi eccezioni"
                    >
                        Eccezioni ({counts.exception})
                    </button>
                </div>

                <div className="mt-2">
                    <div className="flex items-center justify-between gap-2">
                        <p className="text-xs text-gray-400">Regole</p>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => setDisabledRuleIds({})}
                                className="px-2 py-0.5 text-[11px] font-semibold rounded-md bg-gray-700 text-gray-200 hover:bg-gray-600"
                                title="Mostra tutte le regole"
                            >
                                Tutte
                            </button>
                            <button
                                onClick={() => {
                                    const next: Record<string, boolean> = {};
                                    for (const rid of uniqueRuleIds) next[rid] = true;
                                    setDisabledRuleIds(next);
                                }}
                                className="px-2 py-0.5 text-[11px] font-semibold rounded-md bg-gray-700 text-gray-200 hover:bg-gray-600"
                                title="Nascondi tutte le regole"
                            >
                                Nessuna
                            </button>
                        </div>
                    </div>

                    <input
                        value={ruleSearch}
                        onChange={e => setRuleSearch(e.target.value)}
                        placeholder="Cerca ruleId (es. R-N-RES, ORN-, CAD-)"
                        className="mt-1 w-full bg-gray-700/60 border border-gray-600 rounded-md px-2 py-1 text-xs text-gray-100 placeholder:text-gray-400"
                    />

                    <div className="mt-2 max-h-40 overflow-y-auto pr-1">
                        {visibleRuleIds.length === 0 ? (
                            <p className="text-xs text-gray-400">Nessuna regola trovata.</p>
                        ) : (
                            <div className="grid grid-cols-2 gap-1">
                                {visibleRuleIds.map(rid => {
                                    const enabled = !disabledRuleIds[rid];
                                    return (
                                        <button
                                            key={rid}
                                            onClick={() => setDisabledRuleIds(prev => ({ ...prev, [rid]: enabled }))}
                                            className={`text-left px-2 py-1 text-[11px] rounded-md border transition-colors ${enabled ? 'bg-gray-700/40 border-gray-600 text-gray-200 hover:bg-gray-700/70' : 'bg-gray-900/40 border-gray-800 text-gray-500 hover:bg-gray-800/50'}`}
                                            title={enabled ? 'Clicca per nascondere questa regola' : 'Clicca per mostrare questa regola'}
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

            {sequences.length > 0 && (
                <div className="mb-4">
                    <p className="text-xs uppercase tracking-wide text-gray-400 mb-2">Sequenze trovate</p>
                    <ul className="space-y-2">
                        {sequences.map((seq, idx) => {
                            const conf = Math.round(seq.confidence * 100);
                            const range = seq.startMeasure === seq.endMeasure
                                ? `Misura ${seq.startMeasure + 1}`
                                : `Misure ${seq.startMeasure + 1}–${seq.endMeasure + 1}`;
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
                                        {range} · L={seq.lengthSteps} · conf {conf}%
                                    </p>
                                    {modelRange && repeatRange && (
                                        <p className="text-[11px] text-gray-300 mt-1">Modello {modelRange} → {repeatRange}</p>
                                    )}
                                    {seq.label && (
                                        <p className="text-[11px] text-gray-400 mt-1">{seq.label}</p>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}
            {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center text-gray-400">
                    <CheckCircleIcon />
                    <p className="mt-2 font-semibold">Nessun elemento da mostrare.</p>
                    <p className="text-sm">Prova a modificare i filtri.</p>
                </div>
            ) : (
                <ul className="space-y-3">
                    {filtered.map(({ v: violation, index }) => {
                        const isError = violation.severity === 'error';
                        const isException = violation.severity === 'exception';
                        const isCadenceMarker = typeof violation.ruleId === 'string' && violation.ruleId.startsWith('CAD-');
                        const Icon = isError ? ErrorIcon : isException ? ExceptionIcon : WarningIcon;
                        const textColor = isError ? 'text-red-400' : isException ? 'text-green-400' : 'text-orange-400';
                        const isSelected = selectedViolationIndex === index;
                        return (
                            <li
                                key={`${violation.ruleId}-${index}`}
                                className={`bg-gray-700/50 p-2 rounded-lg border border-gray-700/50 hover:bg-gray-600/50 transition-colors cursor-pointer ${isSelected ? 'ring-1 ring-cyan-400 border-cyan-400' : ''}`}
                                onMouseEnter={() => onHoverViolation(violation.noteIds)}
                                onMouseLeave={() => onHoverViolation(null)}
                                onClick={() => onSelectViolation && onSelectViolation(index)}
                            >
                                <div className="flex items-start gap-2">
                                    <Icon />
                                    <div className="flex-grow">
                                        <p className={`font-bold ${textColor}`} style={{ fontSize: '0.8em' }}>
                                            {isCadenceMarker ? (
                                                <>
                                                    <span className="text-white">{violation.description}</span>
                                                </>
                                            ) : (
                                                <>
                                                    {isException ? 'Eccezione' : violation.ruleId}: <span className="text-white">{violation.description}</span>
                                                </>
                                            )}
                                        </p>
                                        {violation.suggestion && (
                                            <p className="text-xs text-gray-400 mt-1 italic">
                                                <span className="font-semibold not-italic">Consiglio:</span> {violation.suggestion}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
};

export default HarmonyAnalysisPanel;