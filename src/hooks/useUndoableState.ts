// FIX: Import SetStateAction to resolve React namespace error.
import { useState, useCallback, SetStateAction } from 'react';

export function useUndoableState<T>(initialState: T): [
    T,
    // FIX: Use imported SetStateAction type.
    (newState: SetStateAction<T>) => void,
    () => void,
    () => void,
] {
    const [history, setHistory] = useState<T[]>([initialState]);
    const [currentIndex, setCurrentIndex] = useState(0);

    const state = history[currentIndex];

    // FIX: Use imported SetStateAction type.
    const setState = useCallback((action: SetStateAction<T>) => {
        const resolvedState = typeof action === 'function' ? (action as (prevState: T) => T)(state) : action;
        if (JSON.stringify(state) === JSON.stringify(resolvedState)) {
            return;
        }
        const newHistory = history.slice(0, currentIndex + 1);
        newHistory.push(resolvedState);
        setHistory(newHistory);
        setCurrentIndex(newHistory.length - 1);
    }, [currentIndex, history, state]);

    const undo = useCallback(() => {
        if (currentIndex > 0) {
            setCurrentIndex(prevIndex => prevIndex - 1);
        }
    }, [currentIndex]);

    const redo = useCallback(() => {
        if (currentIndex < history.length - 1) {
            setCurrentIndex(prevIndex => prevIndex + 1);
        }
    }, [currentIndex, history.length]);

    return [state, setState, undo, redo];
}
