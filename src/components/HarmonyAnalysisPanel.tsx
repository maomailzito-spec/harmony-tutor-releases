import React from 'react';
import { RuleViolation } from '../types';

interface HarmonyAnalysisPanelProps {
    violations: RuleViolation[];
    onHoverViolation: (noteIds: string[] | null) => void;
    selectedViolationIndex?: number | null;
    onSelectViolation?: (index: number) => void;
}

const ErrorIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-red-400 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
    </svg>
);

const WarningIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-orange-400 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.21 3.03-1.742 3.03H4.42c-1.532 0-2.492-1.696-1.742-3.03l5.58-9.92zM10 13a1 1 0 110-2 1 1 0 010 2zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
    </svg>
);


const CheckCircleIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-green-400" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
    </svg>
);

const ExceptionIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-green-400 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
    </svg>
);


const HarmonyAnalysisPanel: React.FC<HarmonyAnalysisPanelProps> = ({ violations, onHoverViolation, selectedViolationIndex, onSelectViolation }) => {
    return (
        <div className="bg-gray-800/50 rounded-lg p-3 h-full max-h-96 overflow-y-auto">
            {violations.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center text-gray-400">
                    <CheckCircleIcon />
                    <p className="mt-2 font-semibold">Nessun errore di armonia rilevato.</p>
                    <p className="text-sm">Ottimo lavoro!</p>
                </div>
            ) : (
                <ul className="space-y-3">
                    {violations.map((violation, index) => {
                        const isError = violation.severity === 'error';
                        const isException = violation.severity === 'exception';
                        const Icon = isError ? ErrorIcon : isException ? ExceptionIcon : WarningIcon;
                        const textColor = isError ? 'text-red-400' : isException ? 'text-green-400' : 'text-orange-400';
                        const isSelected = selectedViolationIndex === index;
                        return (
                            <li
                                key={`${violation.ruleId}-${index}`}
                                className={`bg-gray-700/50 p-3 rounded-lg border border-gray-600 hover:bg-gray-600/50 transition-colors cursor-pointer ${isSelected ? 'ring-2 ring-cyan-400 border-cyan-400' : ''}`}
                                onMouseEnter={() => onHoverViolation(violation.noteIds)}
                                onMouseLeave={() => onHoverViolation(null)}
                                onClick={() => onSelectViolation && onSelectViolation(index)}
                            >
                                <div className="flex items-start gap-3">
                                    <Icon />
                                    <div className="flex-grow">
                                        <p className={`font-bold ${textColor}`}>
                                            {isException ? 'Eccezione' : violation.ruleId}: <span className="text-white">{violation.description}</span>
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