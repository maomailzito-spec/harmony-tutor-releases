export const ANALYSIS_PROFILE_BASE_IDS = ['academic', 'symbols'] as const;

export type AnalysisProfileBaseId = (typeof ANALYSIS_PROFILE_BASE_IDS)[number];
export type AnalysisProfileSelectionValue = AnalysisProfileBaseId | 'custom';

export type AnalysisProfilePreset = {
    showRomanAnalysis: boolean;
    showSymbolAnalysis: boolean;
    sequencesEnabled: boolean;
    analysisFilters: {
        showError: boolean;
        showWarning: boolean;
        showException: boolean;
    };
};

export const ANALYSIS_PROFILE_PRESETS: Record<AnalysisProfileBaseId, {
    label: string;
    description: string;
    preset: AnalysisProfilePreset;
}> = {
    academic: {
        label: 'Accademico',
        description: 'Focus su Romani + cifratura e diagnostica completa.',
        preset: {
            showRomanAnalysis: true,
            showSymbolAnalysis: false,
            sequencesEnabled: true,
            analysisFilters: {
                showError: true,
                showWarning: true,
                showException: true,
            },
        },
    },
    symbols: {
        label: 'Sigle',
        description: 'Focus su sigle; riduce rumore (warning/eccezioni) e sequenze.',
        preset: {
            showRomanAnalysis: false,
            showSymbolAnalysis: true,
            sequencesEnabled: false,
            analysisFilters: {
                showError: true,
                showWarning: false,
                showException: false,
            },
        },
    },
};

export function isAnalysisProfileBaseId(value: unknown): value is AnalysisProfileBaseId {
    return value === 'academic' || value === 'symbols';
}

export function getAnalysisProfileSelectionValue(
    baseId: AnalysisProfileBaseId,
    isCustomized: boolean
): AnalysisProfileSelectionValue {
    return isCustomized ? 'custom' : baseId;
}
