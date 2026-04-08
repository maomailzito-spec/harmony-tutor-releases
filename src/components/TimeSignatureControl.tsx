import React, { useState, useEffect, useRef } from 'react';
import type { TimeSignature } from '../types';

export const VALID_DENOMINATORS = [2, 4, 8, 16];

export const denominatorStepFn = (current: number, direction: 'up' | 'down') => {
    const currentIndex = VALID_DENOMINATORS.indexOf(current);
    if (direction === 'up') {
        return VALID_DENOMINATORS[Math.min(VALID_DENOMINATORS.length - 1, currentIndex + 1)];
    }
    return VALID_DENOMINATORS[Math.max(0, currentIndex - 1)];
};

export const TimeSignatureControlNumber: React.FC<{
    value: number;
    onChange: (newValue: number) => void;
    min: number;
    max: number;
    stepFunction?: (current: number, direction: 'up' | 'down') => number;
}> = ({ value, onChange, min, max, stepFunction }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(value.toString());
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isEditing) {
            inputRef.current?.focus();
            inputRef.current?.select();
        }
    }, [isEditing]);

    const commitChange = (valStr: string) => {
        let val = parseInt(valStr, 10);
        if (!isNaN(val)) {
            val = Math.max(min, Math.min(max, val));
            onChange(val);
        }
        setIsEditing(false);
    };

    const step = (direction: 'up' | 'down') => {
        if (isEditing) return;
        if (stepFunction) {
            onChange(stepFunction(value, direction));
            return;
        }
        const delta = direction === 'up' ? 1 : -1;
        onChange(Math.max(min, Math.min(max, value + delta)));
    };

    if (isEditing) {
        return (
            <input
                ref={inputRef}
                type="text"
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                onBlur={() => commitChange(editValue)}
                onKeyDown={e => { if (e.key === 'Enter') commitChange(editValue); if (e.key === 'Escape') setIsEditing(false); }}
                className="w-full h-full text-center bg-gray-900 text-white font-serif text-xl p-0 border-0 outline-none"
            />
        );
    }

    return (
        <div className="w-full h-1/2 flex items-stretch">
            <button
                type="button"
                className="flex-1 flex items-center justify-center font-serif text-xl text-white"
                onClick={() => { setEditValue(value.toString()); setIsEditing(true); }}
            >
                {value}
            </button>

            <div className="w-5 flex flex-col border-l border-gray-600">
                <button
                    type="button"
                    className="h-1/2 text-[10px] leading-none text-white/80 hover:text-white"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); step('up'); }}
                    aria-label="Increment"
                >
                    ▲
                </button>
                <button
                    type="button"
                    className="h-1/2 text-[10px] leading-none text-white/80 hover:text-white"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); step('down'); }}
                    aria-label="Decrement"
                >
                    ▼
                </button>
            </div>
        </div>
    );
};

const TimeSignatureControl: React.FC<{ value: TimeSignature; onChange: (newValue: TimeSignature) => void; }> = ({ value, onChange }) => {
    const handleNumeratorChange = (newNum: number) => onChange({ ...value, numerator: newNum });
    const handleDenominatorChange = (newDenom: number) => onChange({ ...value, denominator: newDenom });
    
    return (
        <div className="flex flex-col items-center justify-center w-10 h-14 bg-gray-700 rounded-md text-white font-serif relative overflow-hidden divide-y divide-gray-600">
            <TimeSignatureControlNumber value={value.numerator} onChange={handleNumeratorChange} min={1} max={16} />
            <TimeSignatureControlNumber value={value.denominator} onChange={handleDenominatorChange} min={2} max={16} stepFunction={denominatorStepFn}/>
        </div>
    );
};

export default TimeSignatureControl;
