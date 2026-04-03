import { useEffect, useRef, useCallback, useState } from 'react';

/**
 * useMidiStepInput — MIDI step-input for single-voice note entry.
 *
 * When enabled, listens for MIDI noteOn messages from any connected
 * MIDI input device and calls `onNoteOn(midiNumber)` for each.
 */

export type UseMidiStepInputArgs = {
  /** Callback invoked with the MIDI note number (0-127) on each noteOn */
  onNoteOn: (midi: number) => void;
};

export function useMidiStepInput({ onNoteOn }: UseMidiStepInputArgs) {
  const [enabled, setEnabled] = useState(false);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const onNoteOnRef = useRef(onNoteOn);
  onNoteOnRef.current = onNoteOn;

  const cleanupRef = useRef<(() => void) | null>(null);

  const activate = useCallback(async () => {
    if (!navigator.requestMIDIAccess) return;
    try {
      const midiAccess = await navigator.requestMIDIAccess();
      const inputs = Array.from(midiAccess.inputs.values());
      if (inputs.length === 0) {
        setDeviceName(null);
        return;
      }

      const handleMessage = (e: Event) => {
        const msg = e as any;
        const data: Uint8Array | undefined = msg?.data;
        if (!data || data.length < 3) return;
        const [status, note, velocity] = data;
        // noteOn: 0x90-0x9F with velocity > 0
        if ((status & 0xf0) === 0x90 && velocity > 0 && note >= 0 && note <= 127) {
          onNoteOnRef.current(note);
        }
      };

      // Attach listener to all inputs
      for (const input of inputs) {
        input.addEventListener('midimessage', handleMessage as EventListener);
      }

      setDeviceName(inputs[0].name ?? 'MIDI Device');
      setEnabled(true);

      cleanupRef.current = () => {
        for (const input of inputs) {
          input.removeEventListener('midimessage', handleMessage as EventListener);
        }
      };
    } catch {
      // MIDI not available
    }
  }, []);

  const deactivate = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    setEnabled(false);
    setDeviceName(null);
  }, []);

  const toggle = useCallback(async () => {
    if (enabled) {
      deactivate();
    } else {
      await activate();
    }
  }, [enabled, activate, deactivate]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupRef.current?.();
    };
  }, []);

  return { enabled, deviceName, toggle, activate, deactivate };
}
