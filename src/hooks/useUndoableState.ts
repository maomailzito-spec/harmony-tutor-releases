// FIX: Import SetStateAction to resolve React namespace error.
import { useState, useCallback, SetStateAction } from 'react';

export type UndoableStateSetter<T> = (newState: SetStateAction<T>, options?: { undoable?: boolean }) => void;

interface HistoryState<T> {
    history: T[];
    currentIndex: number;
    /** Incremented every time a NEW entry is pushed into history.
     *  Does NOT change on undo/redo or silent (non-undoable) updates.
     *  Callers can watch this value with useLayoutEffect to reliably detect
     *  when the undo stack grows, without relying on callbacks that may fire
     *  outside React's batching cycle. */
    pushCount: number;
}

export function useUndoableState<T>(initialState: T): [
    T,
    UndoableStateSetter<T>,
    () => void,
    () => void,
    number, // pushCount
] {
    // Keep history+currentIndex in a single state so updates can use the
    // functional-updater pattern. This avoids stale-closure bugs when callers
    // hold an older reference to the setter (e.g., a useCallback with []
    // deps that captured the setter at an earlier render).
    const [hs, setHs] = useState<HistoryState<T>>({ history: [initialState], currentIndex: 0, pushCount: 0 });

    const state = hs.history[hs.currentIndex];

    const setState = useCallback<UndoableStateSetter<T>>((action, options) => {
        setHs(curr => {
            const { history: h, currentIndex: ci, pushCount: pc } = curr;
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
                return { history: newHistory, currentIndex: ci, pushCount: pc };
            }

            if (JSON.stringify(s) === JSON.stringify(resolvedState)) {
                return curr;
            }
            const newHistory = h.slice(0, ci + 1);
            newHistory.push(resolvedState);
            return { history: newHistory, currentIndex: newHistory.length - 1, pushCount: pc + 1 };
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const undo = useCallback(() => {
        setHs(curr => (curr.currentIndex > 0
            ? { history: curr.history, currentIndex: curr.currentIndex - 1, pushCount: curr.pushCount }
            : curr));
    }, []);

    const redo = useCallback(() => {
        setHs(curr => (curr.currentIndex < curr.history.length - 1
            ? { history: curr.history, currentIndex: curr.currentIndex + 1, pushCount: curr.pushCount }
            : curr));
    }, []);

    return [state, setState, undo, redo, hs.pushCount];
}
