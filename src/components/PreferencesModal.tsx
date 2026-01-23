import React, { useEffect, useMemo, useState } from 'react';

type PreferencesTabId = 'editor' | 'midi' | 'font' | 'analysis';

export type PreferencesModalProps = {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: PreferencesTabId;
};

const TAB_LABEL: Record<PreferencesTabId, string> = {
  editor: 'Editor',
  midi: 'MIDI',
  font: 'Font / Render',
  analysis: 'Analisi',
};

const PreferencesModal: React.FC<PreferencesModalProps> = ({ isOpen, onClose, initialTab = 'editor' }) => {
  const tabs = useMemo(() => (Object.keys(TAB_LABEL) as PreferencesTabId[]), []);
  const [activeTab, setActiveTab] = useState<PreferencesTabId>(initialTab);

  useEffect(() => {
    if (!isOpen) return;
    setActiveTab(initialTab);
  }, [isOpen, initialTab]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[11000]">
      <div className="absolute inset-0 bg-black/40" onMouseDown={onClose} />
      <div className="absolute inset-0 flex items-center justify-center p-4" onMouseDown={onClose}>
        <div
          className="w-[860px] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)] overflow-hidden rounded-xl bg-slate-900/95 border border-slate-700 shadow-2xl"
          onMouseDown={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="Preferenze"
        >
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-700">
            <div>
              <div className="text-sm font-semibold text-slate-100">Preferenze</div>
              <div className="text-[11px] text-slate-400">Raggruppa impostazioni non essenziali alla toolbar.</div>
            </div>
            <button
              className="rounded-md bg-slate-700/60 border border-slate-600 px-2 py-1 text-[11px] font-semibold text-gray-200 hover:bg-slate-700"
              onClick={onClose}
              title="Chiudi (Esc)"
            >
              Chiudi
            </button>
          </div>

          <div className="flex items-center gap-1 px-3 py-2 border-b border-slate-700 bg-slate-900/70">
            {tabs.map((t) => {
              const isActive = activeTab === t;
              return (
                <button
                  key={t}
                  onClick={() => setActiveTab(t)}
                  className={
                    'px-3 py-1 rounded-md text-xs font-semibold transition-colors ' +
                    (isActive ? 'bg-cyan-600 text-white' : 'text-slate-200 hover:bg-slate-700')
                  }
                >
                  {TAB_LABEL[t]}
                </button>
              );
            })}
          </div>

          <div className="p-4 overflow-y-auto max-h-[calc(100vh-10rem)]">
            {activeTab === 'editor' && (
              <div className="space-y-2">
                <div className="text-sm font-semibold text-slate-100">Editor</div>
                <div className="text-sm text-slate-300">
                  Placeholder: qui confluiranno opzioni dell’editor che oggi sono sparse tra toolbar e menu.
                </div>
                <div className="text-xs text-slate-400">
                  Nota: per ora questa finestra non sposta né modifica alcuna funzione esistente.
                </div>
              </div>
            )}

            {activeTab === 'midi' && (
              <div className="space-y-2">
                <div className="text-sm font-semibold text-slate-100">MIDI</div>
                <div className="text-sm text-slate-300">
                  Placeholder: qui confluiranno le impostazioni MIDI (input/output, step input, canali, ecc.).
                </div>
                <div className="text-xs text-slate-400">Il pannello MIDI attuale resta invariato.</div>
              </div>
            )}

            {activeTab === 'font' && (
              <div className="space-y-2">
                <div className="text-sm font-semibold text-slate-100">Font / Render</div>
                <div className="text-sm text-slate-300">
                  Placeholder: opzioni di resa grafica, font del titolo, dimensioni, ecc.
                </div>
              </div>
            )}

            {activeTab === 'analysis' && (
              <div className="space-y-2">
                <div className="text-sm font-semibold text-slate-100">Analisi</div>
                <div className="text-sm text-slate-300">
                  Placeholder: opzioni dell’analisi armonica, visualizzazioni, livelli, filtri, ecc.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PreferencesModal;
