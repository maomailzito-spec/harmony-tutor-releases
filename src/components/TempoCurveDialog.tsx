import React, { useState, useEffect, useRef } from 'react';

interface Props {
    defaultFromBpm: number;
    defaultToBpm: number;
    onCancel: () => void;
    onConfirm: (fromBpm: number, toBpm: number) => void;
}

const clampBpm = (v: number) => Math.max(20, Math.min(300, Math.round(v)));

const TempoCurveDialog: React.FC<Props> = ({ defaultFromBpm, defaultToBpm, onCancel, onConfirm }) => {
    const [fromStr, setFromStr] = useState(String(defaultFromBpm));
    const [toStr, setToStr] = useState(String(defaultToBpm));
    const fromRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        fromRef.current?.focus();
        fromRef.current?.select();
    }, []);

    const submit = () => {
        const f = clampBpm(Number(fromStr) || defaultFromBpm);
        const t = clampBpm(Number(toStr) || defaultToBpm);
        onConfirm(f, t);
    };

    return (
        <div
            style={{
                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
            }}
            onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
        >
            <div
                style={{
                    background: '#fff', borderRadius: 8, padding: 20, minWidth: 320,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.2)', fontFamily: 'system-ui, sans-serif',
                }}
                onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') submit();
                    if (e.key === 'Escape') onCancel();
                }}
            >
                <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 600, color: '#111' }}>
                    Rallentando / Accelerando
                </h3>
                <p style={{ margin: '0 0 16px', fontSize: 13, color: '#555' }}>
                    Curva di tempo applicata dal primo all'ultimo nota selezionato.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                    <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, color: '#111' }}>
                        BPM iniziale
                        <input
                            ref={fromRef}
                            type="number"
                            min={20}
                            max={300}
                            value={fromStr}
                            onChange={(e) => setFromStr(e.target.value)}
                            style={{ marginTop: 4, padding: '6px 8px', border: '1px solid #ccc', borderRadius: 4, fontSize: 14, color: '#111', background: '#fff' }}
                        />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, color: '#111' }}>
                        BPM finale
                        <input
                            type="number"
                            min={20}
                            max={300}
                            value={toStr}
                            onChange={(e) => setToStr(e.target.value)}
                            style={{ marginTop: 4, padding: '6px 8px', border: '1px solid #ccc', borderRadius: 4, fontSize: 14, color: '#111', background: '#fff' }}
                        />
                    </label>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <button
                        onClick={onCancel}
                        style={{ padding: '6px 14px', border: '1px solid #ccc', borderRadius: 4, background: '#f5f5f5', cursor: 'pointer', fontSize: 13 }}
                    >
                        Annulla
                    </button>
                    <button
                        onClick={submit}
                        style={{ padding: '6px 14px', border: 'none', borderRadius: 4, background: '#2563eb', color: '#fff', cursor: 'pointer', fontSize: 13 }}
                    >
                        Applica
                    </button>
                </div>
            </div>
        </div>
    );
};

export default TempoCurveDialog;
