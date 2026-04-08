import { useState, useEffect, useCallback } from 'react';
import type { ScaleShape, Voicing } from '../types';
import {
  GUITAR_CUSTOM_CHORDS_KEY,
  GUITAR_CUSTOM_SCALES_KEY,
  GUITAR_CUSTOM_SCALE_SHAPES_KEY,
  GUITAR_CUSTOM_VOICINGS_KEY,
} from '../storage/storageKeys';
import { getJSON, setJSON } from '../storage/localStorage';

export interface CustomScale {
  name: string;
  intervals: number[];
}

export interface CustomChord {
  name: string;
  formula: number[];
  color?: string;
}

export interface CustomVoicing {
  id: string;
  chordType: string;
  rootNoteIndex: number;
  name: string;
  voicing: Voicing;
}

const CUSTOM_DATA_UPDATED_EVENT = 'guitarAppCustomDataUpdated';

const notifyCustomDataUpdated = () => {
  try {
    window.dispatchEvent(new Event(CUSTOM_DATA_UPDATED_EVENT));
  } catch {
    // no-op
  }
};

type GuitarLibraryPayload = {
  version?: number;
  updatedAt?: string;
  customScales?: CustomScale[];
  customChords?: CustomChord[];
  customScaleShapes?: Record<string, ScaleShape[]>;
  customVoicings?: CustomVoicing[];
};

function getElectronGuitarLibraryAPI(): null | {
  load: () => Promise<GuitarLibraryPayload>;
  save: (payload: GuitarLibraryPayload) => Promise<{ success: boolean; error?: string }>;
} {
  const api = (window as any).electronAPI;
  const gl = api?.guitarLibrary;
  if (!gl?.load || !gl?.save) return null;
  return {
    load: () => gl.load(),
    save: (payload) => gl.save(payload),
  };
}

export const useCustomData = () => {
  const [customScales, setCustomScales] = useState<CustomScale[]>(() => getJSON<CustomScale[]>(GUITAR_CUSTOM_SCALES_KEY, []));
  const [customChords, setCustomChords] = useState<CustomChord[]>(() => getJSON<CustomChord[]>(GUITAR_CUSTOM_CHORDS_KEY, []));
  const [customScaleShapes, setCustomScaleShapes] = useState<Record<string, ScaleShape[]>>(() => getJSON<Record<string, ScaleShape[]>>(GUITAR_CUSTOM_SCALE_SHAPES_KEY, {}));
  const [customVoicings, setCustomVoicings] = useState<CustomVoicing[]>(() => getJSON<CustomVoicing[]>(GUITAR_CUSTOM_VOICINGS_KEY, []));

  useEffect(() => {
    let cancelled = false;
    const gl = getElectronGuitarLibraryAPI();

    const reloadFromLocal = () => {
      setCustomScales(getJSON<CustomScale[]>(GUITAR_CUSTOM_SCALES_KEY, []));
      setCustomChords(getJSON<CustomChord[]>(GUITAR_CUSTOM_CHORDS_KEY, []));
      setCustomScaleShapes(getJSON<Record<string, ScaleShape[]>>(GUITAR_CUSTOM_SCALE_SHAPES_KEY, {}));
      setCustomVoicings(getJSON<CustomVoicing[]>(GUITAR_CUSTOM_VOICINGS_KEY, []));
    };

    const reloadFromElectron = async () => {
      if (!gl) return;
      try {
        const loaded = await gl.load();
        if (cancelled) return;
        if (loaded && typeof loaded === 'object') {
          if (Array.isArray(loaded.customScales)) setCustomScales(loaded.customScales);
          if (Array.isArray(loaded.customChords)) setCustomChords(loaded.customChords);
          if (loaded.customScaleShapes && typeof loaded.customScaleShapes === 'object') setCustomScaleShapes(loaded.customScaleShapes);
          if (Array.isArray(loaded.customVoicings)) setCustomVoicings(loaded.customVoicings);
        }
      } catch {
        // ignore
      }
    };

    const reload = () => {
      reloadFromLocal();
      void reloadFromElectron();
    };

    const onCustomEvent = () => reload();
    const onStorage = (e: StorageEvent) => {
      if (!e.key) return;
      if (
        e.key === GUITAR_CUSTOM_SCALES_KEY ||
        e.key === GUITAR_CUSTOM_CHORDS_KEY ||
        e.key === GUITAR_CUSTOM_SCALE_SHAPES_KEY ||
        e.key === GUITAR_CUSTOM_VOICINGS_KEY
      ) {
        reload();
      }
    };

    window.addEventListener(CUSTOM_DATA_UPDATED_EVENT, onCustomEvent);
    window.addEventListener('storage', onStorage);

    // On mount: prefer Electron-backed data when available.
    void reloadFromElectron();

    return () => {
      cancelled = true;
      window.removeEventListener(CUSTOM_DATA_UPDATED_EVENT, onCustomEvent);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const persistToElectron = useCallback(async (next: GuitarLibraryPayload) => {
    const gl = getElectronGuitarLibraryAPI();
    if (!gl) return;
    try {
      await gl.save(next);
    } catch {
      // ignore
    }
  }, []);

  const addCustomScale = useCallback((name: string, intervals: number[]) => {
    setCustomScales(prev => {
      const trimmedName = name.trim();
      const existing = prev.find(s => s.name.toLowerCase() === trimmedName.toLowerCase());
      const next = existing
        ? prev.map(s => (s.name.toLowerCase() === trimmedName.toLowerCase() ? { name: trimmedName, intervals } : s))
        : [...prev, { name: trimmedName, intervals }];

      setJSON(GUITAR_CUSTOM_SCALES_KEY, next);
      notifyCustomDataUpdated();
      void persistToElectron({ customScales: next, customChords, customScaleShapes, customVoicings });
      return next;
    });
  }, [customChords, customScaleShapes, customVoicings, persistToElectron]);

  const deleteCustomScale = useCallback((name: string) => {
    setCustomScales(prev => {
      const next = prev.filter(s => s.name !== name);
      setJSON(GUITAR_CUSTOM_SCALES_KEY, next);
      notifyCustomDataUpdated();
      void persistToElectron({ customScales: next, customChords, customScaleShapes, customVoicings });
      return next;
    });
  }, [customChords, customScaleShapes, customVoicings, persistToElectron]);

  const addCustomChord = useCallback((name: string, formula: number[], color?: string) => {
    setCustomChords(prev => {
      const trimmedName = name.trim();
      const existing = prev.find(c => c.name.toLowerCase() === trimmedName.toLowerCase());
      const next = existing
        ? prev.map(c => (c.name.toLowerCase() === trimmedName.toLowerCase() ? { name: trimmedName, formula, color } : c))
        : [...prev, { name: trimmedName, formula, color }];

      setJSON(GUITAR_CUSTOM_CHORDS_KEY, next);
      notifyCustomDataUpdated();
      void persistToElectron({ customScales, customChords: next, customScaleShapes, customVoicings });
      return next;
    });
  }, [customScales, customScaleShapes, customVoicings, persistToElectron]);

  const deleteCustomChord = useCallback((name: string) => {
    setCustomChords(prev => {
      const next = prev.filter(c => c.name !== name);
      setJSON(GUITAR_CUSTOM_CHORDS_KEY, next);
      notifyCustomDataUpdated();
      void persistToElectron({ customScales, customChords: next, customScaleShapes, customVoicings });
      return next;
    });
  }, [customScales, customScaleShapes, customVoicings, persistToElectron]);

  const addCustomScaleShape = useCallback((scaleType: string, shape: ScaleShape) => {
    const trimmedScaleType = scaleType.trim();
    const trimmedName = shape.name.trim();
    if (!trimmedScaleType || !trimmedName) return;

    setCustomScaleShapes(prev => {
      const existingShapes = prev[trimmedScaleType] ?? [];
      const nextShape: ScaleShape = { ...shape, name: trimmedName };
      const exists = existingShapes.some(s => s.name.toLowerCase() === trimmedName.toLowerCase());

      const nextShapes = exists
        ? existingShapes.map(s => (s.name.toLowerCase() === trimmedName.toLowerCase() ? nextShape : s))
        : [...existingShapes, nextShape];

      const next = { ...prev, [trimmedScaleType]: nextShapes };
      setJSON(GUITAR_CUSTOM_SCALE_SHAPES_KEY, next);
      notifyCustomDataUpdated();
      void persistToElectron({ customScales, customChords, customScaleShapes: next, customVoicings });
      return next;
    });
  }, [customScales, customChords, customVoicings, persistToElectron]);

  const deleteCustomScaleShape = useCallback((scaleType: string, shapeName: string) => {
    const trimmedScaleType = scaleType.trim();
    const trimmedName = shapeName.trim();
    if (!trimmedScaleType || !trimmedName) return;

    setCustomScaleShapes(prev => {
      const existingShapes = prev[trimmedScaleType] ?? [];
      const nextShapes = existingShapes.filter(s => s.name !== trimmedName);
      const next = { ...prev, [trimmedScaleType]: nextShapes };
      setJSON(GUITAR_CUSTOM_SCALE_SHAPES_KEY, next);
      notifyCustomDataUpdated();
      void persistToElectron({ customScales, customChords, customScaleShapes: next, customVoicings });
      return next;
    });
  }, [customScales, customChords, customVoicings, persistToElectron]);

  const addCustomVoicing = useCallback((chordType: string, rootNoteIndex: number, name: string, voicing: Voicing) => {
    const trimmedChordType = chordType.trim();
    const trimmedName = name.trim();
    if (!trimmedChordType || !trimmedName) return;

    setCustomVoicings(prev => {
      const existing = prev.find(v =>
        v.chordType === trimmedChordType &&
        v.rootNoteIndex === rootNoteIndex &&
        v.name.toLowerCase() === trimmedName.toLowerCase()
      );

      if (existing) {
        const next = prev.map(v => (v.id === existing.id ? { ...v, name: trimmedName, voicing } : v));
        setJSON(GUITAR_CUSTOM_VOICINGS_KEY, next);
        notifyCustomDataUpdated();
        void persistToElectron({ customScales, customChords, customScaleShapes, customVoicings: next });
        return next;
      }

      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const next = [...prev, { id, chordType: trimmedChordType, rootNoteIndex, name: trimmedName, voicing }];
      setJSON(GUITAR_CUSTOM_VOICINGS_KEY, next);
      notifyCustomDataUpdated();
      void persistToElectron({ customScales, customChords, customScaleShapes, customVoicings: next });
      return next;
    });
  }, [customScales, customChords, customScaleShapes, persistToElectron]);

  const deleteCustomVoicing = useCallback((id: string) => {
    setCustomVoicings(prev => {
      const next = prev.filter(v => v.id !== id);
      setJSON(GUITAR_CUSTOM_VOICINGS_KEY, next);
      notifyCustomDataUpdated();
      void persistToElectron({ customScales, customChords, customScaleShapes, customVoicings: next });
      return next;
    });
  }, [customScales, customChords, customScaleShapes, persistToElectron]);

  return {
    customScales,
    addCustomScale,
    deleteCustomScale,
    customChords,
    addCustomChord,
    deleteCustomChord,
    customScaleShapes,
    addCustomScaleShape,
    deleteCustomScaleShape,
    customVoicings,
    addCustomVoicing,
    deleteCustomVoicing,
  };
};
