import { useState, useEffect, useCallback } from 'react';

export interface CustomScale {
  name: string;
  intervals: number[];
}

export interface CustomChord {
  name: string;
  formula: number[];
}

const CUSTOM_SCALES_KEY = 'guitarAppCustomScales';
const CUSTOM_CHORDS_KEY = 'guitarAppCustomChords';

const loadFromStorage = <T>(key: string, defaultValue: T): T => {
  try {
    const item = window.localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch (error) {
    console.error(`Error loading ${key} from storage`, error);
    return defaultValue;
  }
};

export const useCustomData = () => {
  const [customScales, setCustomScales] = useState<CustomScale[]>(() => loadFromStorage<CustomScale[]>(CUSTOM_SCALES_KEY, []));
  const [customChords, setCustomChords] = useState<CustomChord[]>(() => loadFromStorage<CustomChord[]>(CUSTOM_CHORDS_KEY, []));

  useEffect(() => {
    try {
      window.localStorage.setItem(CUSTOM_SCALES_KEY, JSON.stringify(customScales));
    } catch (error) {
      console.error("Error saving custom scales to storage", error);
    }
  }, [customScales]);

  useEffect(() => {
    try {
      window.localStorage.setItem(CUSTOM_CHORDS_KEY, JSON.stringify(customChords));
    } catch (error) {
      console.error("Error saving custom chords to storage", error);
    }
  }, [customChords]);

  const addCustomScale = useCallback((name: string, intervals: number[]) => {
    setCustomScales(prev => {
      const trimmedName = name.trim();
      const existing = prev.find(s => s.name.toLowerCase() === trimmedName.toLowerCase());
      if (existing) {
        return prev.map(s => s.name.toLowerCase() === trimmedName.toLowerCase() ? { name: trimmedName, intervals } : s);
      }
      return [...prev, { name: trimmedName, intervals }];
    });
  }, []);

  const deleteCustomScale = useCallback((name: string) => {
    setCustomScales(prev => prev.filter(s => s.name !== name));
  }, []);

  const addCustomChord = useCallback((name: string, formula: number[]) => {
    setCustomChords(prev => {
      const trimmedName = name.trim();
      const existing = prev.find(c => c.name.toLowerCase() === trimmedName.toLowerCase());
      if (existing) {
        return prev.map(c => c.name.toLowerCase() === trimmedName.toLowerCase() ? { name: trimmedName, formula } : c);
      }
      return [...prev, { name: trimmedName, formula }];
    });
  }, []);

  const deleteCustomChord = useCallback((name: string) => {
    setCustomChords(prev => prev.filter(c => c.name !== name));
  }, []);

  return {
    customScales,
    addCustomScale,
    deleteCustomScale,
    customChords,
    addCustomChord,
    deleteCustomChord,
  };
};
