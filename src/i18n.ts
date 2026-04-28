import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import itUi from './locales/it/ui.json';
import itToolbar from './locales/it/toolbar.json';
import itPreferences from './locales/it/preferences.json';
import itRules from './locales/it/rules.json';
import itRuleTexts from './locales/it/ruleTexts.json';
import itAnalysis from './locales/it/analysis.json';

import enUi from './locales/en/ui.json';
import enToolbar from './locales/en/toolbar.json';
import enPreferences from './locales/en/preferences.json';
import enRules from './locales/en/rules.json';
import enRuleTexts from './locales/en/ruleTexts.json';
import enAnalysis from './locales/en/analysis.json';

const LANGUAGE_STORAGE_KEY = 'app.language';

const readStoredLanguage = (): 'it' | 'en' => {
    try {
        const v = localStorage.getItem(LANGUAGE_STORAGE_KEY);
        if (v === 'it' || v === 'en') return v;
    } catch { /* ignore */ }
    return 'en';
};

i18n
    .use(initReactI18next)
    .init({
        lng: readStoredLanguage(),
        fallbackLng: 'it',
        defaultNS: 'ui',
        ns: ['ui', 'toolbar', 'preferences', 'rules', 'ruleTexts', 'analysis'],
        resources: {
            it: {
                ui: itUi,
                toolbar: itToolbar,
                preferences: itPreferences,
                rules: itRules,
                ruleTexts: itRuleTexts,
                analysis: itAnalysis,
            },
            en: {
                ui: enUi,
                toolbar: enToolbar,
                preferences: enPreferences,
                rules: enRules,
                ruleTexts: enRuleTexts,
                analysis: enAnalysis,
            },
        },
        interpolation: {
            escapeValue: false,
        },
        returnEmptyString: false,
    });

i18n.on('languageChanged', (lng) => {
    try {
        if (lng === 'it' || lng === 'en') {
            localStorage.setItem(LANGUAGE_STORAGE_KEY, lng);
        }
    } catch { /* ignore */ }
});

export default i18n;
