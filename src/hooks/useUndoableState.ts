// FIX: Import SetStateAction to resolve React namespace error.
import { useState, useCallback, SetStateAction } from 'react';

export type UndoableStateSetter<T> = (newState: SetStateAction<T>, options?: { undoable?: boolean }) => void;

interface HistoryState<T> {
    history: T[];
    currentIndex: number;
}

export function useUndoableState<T>(initialState: T): [
    T,
    UndoableStateSetter<T>,
    () => void,
    () => void,
] {
    // Keep history+currentIndex in a single state so updates can use the
    // functional-updater pattern. This avoids stale-closure bugs when callers
    // hold an older reference to the setter (e.g., a useCallback with []
    // deps that captured the setter at an earlier render).
    const [hs, setHs] = useState<HistoryState<T>>({ history: [initialState], currentIndex: 0 });

    const state = hs.history[hs.currentIndex];

    const setState = useCallback<UndoableStateSetter<T>>((action, options) => {
        setHs(curr => {
            const { history: h, currentIndex: ci } = curr;
            const s = h[ci];
            const resolvedState = typeof action === 'function' ? (action as (prevState: T) => T)(s) : action;

            // Silent (non-undoable) update: replace the current history entry in
            // place without pushing a new one and without the expensive
            // JSON.stringify check. Used for transient/config changes (volume
            // slider drag, mute, visibility…) that should not pollute the undo
            // history nor block the main thread.
            if (options && options.undoable === false) {
                if (resolvedState === s) return curr;
                const newHistory = h.slice();
                newHistory[ci] = resolvedState;
                return { history: newHistory, currentIndex: ci };
            }

            if (JSON.stringify(s) === JSON.stringify(resolvedState)) {
                return curr;
            }
            const newHistory = h.slice(0, ci + 1);
            newHistory.push(resolvedState);
            return { history: newHistory, currentIndex: newHistory.length - 1 };
        });
    }, []);

    const undo = useCallback(() => {
        setHs(curr => (curr.currentIndex > 0
            ? { history: curr.history, currentIndex: curr.currentIndex - 1 }
            : curr));
    }, []);

    const redo = useCallback(() => {
        setHs(curr => (curr.currentIndex < curr.history.length - 1
            ? { history: curr.history, currentIndex: curr.currentIndex + 1 }
            : curr));
    }, []);

    return [state, setState, undo, redo];
}
