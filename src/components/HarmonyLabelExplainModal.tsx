import React, { useEffect } from 'react';
import type { StaffNote } from '../types';

export type HarmonyExplainConfidenceLevel = 'high' | 'medium' | 'low';

export type HarmonyExplainData = {
    absBeat: number;
    ui?: {
        measureIndex?: number;
        beatInMeasure?: number;
        preferFlats?: boolean;
    };
    context: { tonic: string; isMinor: boolean };
    label: {
        roman?: string;
        romanDisplay?: string;
        symbol?: string;
        figures?: string[];
        pcsSig?: string;
        isOverride?: boolean;
    };
    notes: StaffNote[];
    debugSnapshot: {
        pcsBase: number[];
        pcsFigures: number[];
        pcsRoman: number[];
        removedForFigures: string[];
        removedForRoman: string[];
    };
    candidates: Array<{
        rootPc: number | null;
        type: string;
        matchType: string;
        score: number;
    }>;
    confidence: {
        level: HarmonyExplainConfidenceLevel;
        reasons: string[];
    };
};

function levelLabel(level: HarmonyExplainConfidenceLevel): { text: string; cls: string } {
    if (level === 'high') return { text: 'Alta', cls: 'bg-green-600/20 text-green-200 border-green-600/40' };
    if (level === 'medium') return { text: 'Media', cls: 'bg-amber-600/20 text-amber-200 border-amber-600/40' };
    return { text: 'Bassa', cls: 'bg-red-600/20 text-red-200 border-red-600/40' };
}

function formatNoteFriendly(n: StaffNote): string {
    const acc = n.accidental === 'sharp' ? '♯' : n.accidental === 'flat' ? '♭' : n.accidental === 'natural' ? '♮' : n.accidental === 'double-sharp' ? '𝄪' : n.accidental === 'double-flat' ? '𝄫' : '';
    const voice = n.voice ? `Voce ${n.voice}` : 'Voce';
    return `${voice}: ${n.pitch}${acc}${n.octave}`;
}

function formatNoteTechnical(n: StaffNote): string {
    const acc = n.accidental === 'sharp' ? '#' : n.accidental === 'flat' ? 'b' : n.accidental === 'natural' ? 'n' : n.accidental === 'double-sharp' ? '##' : n.accidental === 'double-flat' ? 'bb' : '';
    const voice = n.voice ? ` v${n.voice}` : '';
    const midi = Number.isFinite(n.midi) ? ` (${n.midi})` : '';
    return `${n.pitch}${acc}${n.octave}${voice}${midi}`;
}

function pcToName(pc: number, preferFlats: boolean): string {
    const sharp = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
    const flat = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
    const idx = (((Number(pc) % 12) + 12) % 12);
    return (preferFlats ? flat : sharp)[idx] || String(pc);
}

function pcsToNames(pcs: number[], preferFlats: boolean): string {
    try {
        const uniq = Array.from(new Set((pcs || []).filter((x) => Number.isFinite(x)).map((x) => (((x % 12) + 12) % 12))));
        uniq.sort((a, b) => a - b);
        return uniq.map((pc) => pcToName(pc, preferFlats)).join(' – ');
    } catch {
        return '';
    }
}

const HarmonyLabelExplainModal: React.FC<{ isOpen: boolean; onClose: () => void; data: HarmonyExplainData | null }> = ({ isOpen, onClose, data }) => {
    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, onClose]);

    if (!isOpen || !data) return null;

    const conf = levelLabel(data.confidence.level);
    const preferFlats = !!data.ui?.preferFlats;
    const where = (() => {
        const m = data.ui?.measureIndex;
        const b = data.ui?.beatInMeasure;
        if (typeof m === 'number' && typeof b === 'number' && Number.isFinite(m) && Number.isFinite(b)) {
            const beatTxt = b.toFixed(b % 1 === 0 ? 0 : 2);
            return `Battuta ${m + 1}, beat ${beatTxt}`;
        }
        return null;
    })();

    return (
        <div className="fixed inset-0 z-[1000] bg-black/40 flex items-center justify-center p-4" onMouseDown={onClose}>
            <div
                className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 shadow-xl"
                onMouseDown={(e) => e.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-3 p-4 border-b border-slate-700">
                    <div>
                        <div className="text-sm font-semibold text-slate-100">Spiegazione etichetta armonica</div>
                        <div className="text-xs text-slate-400 mt-1">
                            {where ? `${where} — ` : ''}Tonalità attiva: {data.context.tonic}{data.context.isMinor ? ' min' : ' maj'}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-2 py-1 text-xs font-semibold rounded-md bg-slate-700/60 border border-slate-600 text-slate-100 hover:bg-slate-700"
                    >
                        Chiudi
                    </button>
                </div>

                <div className="p-4 space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center gap-2 px-2 py-1 rounded-md border text-xs font-semibold ${conf.cls}`}>
                            Affidabilità: {conf.text}
                        </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-3">
                            <div className="text-xs font-semibold text-slate-200">Etichetta mostrata</div>
                            <div className="text-[12px] text-slate-100 mt-2 space-y-1">
                                <div><span className="text-slate-400">Romano:</span> {String(data.label.romanDisplay ?? data.label.roman ?? '') || '—'}</div>
                                <div><span className="text-slate-400">Sigla accordo:</span> {String(data.label.symbol ?? '') || '—'}</div>
                                <div><span className="text-slate-400">Fondamentale:</span> {(() => {
                                    const rpc = data.candidates?.[0]?.rootPc;
                                    if (rpc == null || !Number.isFinite(rpc)) return '—';
                                    const names = preferFlats
                                        ? ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B']
                                        : ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
                                    return names[((rpc % 12) + 12) % 12] ?? '—';
                                })()}</div>
                                <div><span className="text-slate-400">Basso figurato:</span> {(data.label.figures || []).length ? (data.label.figures || []).join(' ') : '—'}</div>
                                <div><span className="text-slate-400">Override:</span> {data.label.isOverride ? 'sì' : 'no'}</div>
                            </div>
                        </div>

                        <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-3">
                            <div className="text-xs font-semibold text-slate-200">Perché (in breve)</div>
                            <ul className="text-[12px] text-slate-200 mt-2 space-y-1 list-disc pl-5">
                                {(data.confidence.reasons || []).map((r, i) => (
                                    <li key={i} className="text-slate-200">{r}</li>
                                ))}
                            </ul>
                        </div>
                    </div>

                    <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-3">
                        <div className="text-xs font-semibold text-slate-200">Note presenti (in questo punto)</div>
                        <ul className="text-[12px] text-slate-200 mt-2 space-y-1">
                            {(data.notes || []).map((n) => {
                                const id = String(n?.id ?? '');
                                const removedF = data.debugSnapshot.removedForFigures.includes(id);
                                const removedR = data.debugSnapshot.removedForRoman.includes(id);
                                const badge = removedR ? 'non conta per l’accordo' : removedF ? 'non conta per le figure' : null;
                                return (
                                    <li key={id} className="flex items-center gap-2">
                                        <span className="text-slate-100">{formatNoteFriendly(n)}</span>
                                        {badge ? (
                                            <span className="text-[10px] px-1.5 py-0.5 rounded border border-slate-600 bg-slate-800 text-slate-200">
                                                {badge}
                                            </span>
                                        ) : null}
                                    </li>
                                );
                            })}
                        </ul>
                    </div>

                    <details className="rounded-lg border border-slate-700 bg-slate-950/40 p-3">
                        <summary className="cursor-pointer text-xs font-semibold text-slate-200">Dettagli tecnici (debug)</summary>
                        <div className="mt-3 space-y-3 text-[12px] text-slate-200">
                            <div className="text-slate-400">
                                Posizione interna (absBeat): <span className="font-mono text-slate-100">{Number.isFinite(data.absBeat) ? data.absBeat.toFixed(3) : String(data.absBeat)}</span>
                            </div>

                            {data.label.pcsSig ? (
                                <div className="text-slate-400">
                                    Impronta note (pcsSig): <span className="font-mono text-slate-100">{data.label.pcsSig}</span>
                                </div>
                            ) : null}

                            <div>
                                <div className="text-xs font-semibold text-slate-200">Classi di altezza (pitch classes)</div>
                                <div className="mt-2 space-y-1">
                                    <div><span className="text-slate-400">Base:</span> {(data.debugSnapshot.pcsBase || []).join(', ') || '—'} {data.debugSnapshot.pcsBase?.length ? <span className="text-slate-400">({pcsToNames(data.debugSnapshot.pcsBase, preferFlats)})</span> : null}</div>
                                    <div><span className="text-slate-400">Dopo filtro figure:</span> {(data.debugSnapshot.pcsFigures || []).join(', ') || '—'} {data.debugSnapshot.pcsFigures?.length ? <span className="text-slate-400">({pcsToNames(data.debugSnapshot.pcsFigures, preferFlats)})</span> : null}</div>
                                    <div><span className="text-slate-400">Dopo filtro roman:</span> {(data.debugSnapshot.pcsRoman || []).join(', ') || '—'} {data.debugSnapshot.pcsRoman?.length ? <span className="text-slate-400">({pcsToNames(data.debugSnapshot.pcsRoman, preferFlats)})</span> : null}</div>
                                </div>
                            </div>

                            <div>
                                <div className="text-xs font-semibold text-slate-200">Candidati accordo (top)</div>
                                <div className="mt-2 space-y-1">
                                    {(data.candidates || []).length ? (
                                        (data.candidates || []).slice(0, 6).map((c, i) => (
                                            <div key={i} className="flex items-center justify-between gap-2">
                                                <span className="text-slate-100">{c.type}</span>
                                                <span className="text-slate-400">{c.matchType} · {c.score}</span>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="text-slate-400">—</div>
                                    )}
                                </div>
                            </div>

                            <div>
                                <div className="text-xs font-semibold text-slate-200">Note (tecnico)</div>
                                <ul className="mt-2 space-y-1">
                                    {(data.notes || []).map((n) => (
                                        <li key={String(n?.id ?? '')} className="font-mono text-slate-100">{formatNoteTechnical(n)}</li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    </details>
                </div>
            </div>
        </div>
    );
};

export default HarmonyLabelExplainModal;
