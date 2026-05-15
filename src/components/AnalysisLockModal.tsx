import React, { useState, useCallback } from 'react';
import type { AnalysisLockOptions } from '../storage/projectSchema';
import { DEFAULT_ANALYSIS_LOCK_OPTIONS } from '../storage/projectSchema';

export type AnalysisLockModalProps = {
  isOpen: boolean;
  onClose: () => void;
  analysisLocked: boolean;
  teacherPasswordHash: string | undefined;
  analysisLockOptions: AnalysisLockOptions;
  /** Called when teacher sets a new lock with options (only valid when !analysisLocked). */
  onLock: (passwordHash: string, options: AnalysisLockOptions) => void;
  /** Called when teacher/student unlocks. permanent=true → remove from file; false → session-only. */
  onUnlock: (permanent: boolean) => void;
};

async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const OPTION_LABELS: { key: keyof AnalysisLockOptions; label: string }[] = [
  { key: 'hideViolations',   label: 'Linee colorate (errori voice-leading) e pannello violazioni' },
  { key: 'hideRomanLabels',  label: 'Etichette Roman numerals' },
  { key: 'hideChordSymbols', label: 'Sigle accordo (chord symbols)' },
  { key: 'hideOrnaments',    label: 'Ornamenti riconosciuti (P, V, A, R…)' },
  { key: 'hideAlternatives', label: 'Letture alternative (indicatore ≈)' },
  { key: 'disableExport',    label: 'Disabilita export e copia note (MIDI, MusicXML, PDF, PNG, copia/incolla)' },
];

export default function AnalysisLockModal({
  isOpen, onClose, analysisLocked, teacherPasswordHash, analysisLockOptions, onLock, onUnlock,
}: AnalysisLockModalProps) {
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [unlockPw, setUnlockPw] = useState('');
  const [options, setOptions] = useState<AnalysisLockOptions>({ ...DEFAULT_ANALYSIS_LOCK_OPTIONS, ...analysisLockOptions });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reset local state each time the modal opens
  React.useEffect(() => {
    if (isOpen) {
      setPw1(''); setPw2(''); setUnlockPw('');
      setOptions({ ...DEFAULT_ANALYSIS_LOCK_OPTIONS, ...analysisLockOptions });
      setError(null);
    }
  }, [isOpen, analysisLockOptions]);

  const toggleOption = useCallback((key: keyof AnalysisLockOptions) => {
    setOptions(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const handleLock = useCallback(async () => {
    if (!pw1.trim()) { setError('Inserisci una password.'); return; }
    if (pw1 !== pw2) { setError('Le due password non coincidono.'); return; }
    if (!Object.values(options).some(Boolean)) { setError('Seleziona almeno un elemento da nascondere.'); return; }
    setBusy(true);
    try {
      const hash = await sha256hex(pw1);
      onLock(hash, options);
      onClose();
    } finally {
      setBusy(false);
    }
  }, [pw1, pw2, options, onLock, onClose]);

  const handleUnlock = useCallback(async (permanent: boolean) => {
    if (!unlockPw.trim()) { setError('Inserisci la password docente.'); return; }
    setBusy(true);
    try {
      const hash = await sha256hex(unlockPw);
      if (hash !== teacherPasswordHash) {
        setError('Password errata.');
        return;
      }
      onUnlock(permanent);
      onClose();
    } finally {
      setBusy(false);
    }
  }, [unlockPw, teacherPasswordHash, onUnlock, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md p-6 flex flex-col gap-4 text-sm text-gray-100">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold">
            {analysisLocked ? '🔓 Sblocca analisi' : '🔒 Blocca analisi per studenti'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200 text-lg leading-none">✕</button>
        </div>

        {!analysisLocked && (
          <>
            <div>
              <p className="text-xs text-gray-400 mb-3">
                Il lock viene salvato nel file <code className="text-cyan-400">.htp</code>. Lo studente vedrà lo spartito ma non gli elementi selezionati qui sotto. Per sbloccare serve la password.
              </p>
              <p className="text-xs font-semibold text-gray-300 mb-2">Nascondi quando bloccato:</p>
              <div className="flex flex-col gap-1.5 mb-4">
                {OPTION_LABELS.map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={options[key]}
                      onChange={() => toggleOption(key)}
                      className="accent-cyan-500 w-4 h-4"
                    />
                    <span className="text-xs text-gray-200">{label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-xs text-gray-400">Password docente</label>
              <input
                type="password"
                value={pw1}
                onChange={e => { setPw1(e.target.value); setError(null); }}
                placeholder="Nuova password…"
                className="bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm focus:border-cyan-500 focus:outline-none"
                autoFocus
              />
              <input
                type="password"
                value={pw2}
                onChange={e => { setPw2(e.target.value); setError(null); }}
                placeholder="Conferma password…"
                className="bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm focus:border-cyan-500 focus:outline-none"
              />
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="flex gap-2 justify-end pt-2">
              <button onClick={onClose} className="px-4 py-1.5 rounded text-xs text-gray-300 hover:bg-gray-700">Annulla</button>
              <button
                onClick={handleLock}
                disabled={busy}
                className="px-4 py-1.5 rounded text-xs bg-cyan-600 hover:bg-cyan-500 text-white font-semibold disabled:opacity-50"
              >
                {busy ? '…' : '🔒 Blocca e salva'}
              </button>
            </div>
          </>
        )}

        {analysisLocked && (
          <>
            <p className="text-xs text-gray-400">
              Inserisci la password docente per sbloccare l'analisi.
              <br/>
              <span className="text-yellow-400">Sblocco sessione</span>: il file rimane bloccato alla prossima apertura.
              <br/>
              <span className="text-red-400">Rimuovi lock</span>: il lock viene eliminato dal file (salvataggio automatico).
            </p>
            <input
              type="password"
              value={unlockPw}
              onChange={e => { setUnlockPw(e.target.value); setError(null); }}
              placeholder="Password docente…"
              className="bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm focus:border-cyan-500 focus:outline-none"
              autoFocus
            />
            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="flex gap-2 justify-end pt-2 flex-wrap">
              <button onClick={onClose} className="px-4 py-1.5 rounded text-xs text-gray-300 hover:bg-gray-700">Annulla</button>
              <button
                onClick={() => handleUnlock(false)}
                disabled={busy}
                className="px-4 py-1.5 rounded text-xs bg-yellow-600 hover:bg-yellow-500 text-white font-semibold disabled:opacity-50"
              >
                {busy ? '…' : '🔓 Sblocca sessione'}
              </button>
              <button
                onClick={() => handleUnlock(true)}
                disabled={busy}
                className="px-4 py-1.5 rounded text-xs bg-red-700 hover:bg-red-600 text-white font-semibold disabled:opacity-50"
              >
                {busy ? '…' : '🗑 Rimuovi lock'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
