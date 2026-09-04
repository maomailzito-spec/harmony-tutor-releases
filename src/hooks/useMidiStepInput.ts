import { useEffect, useRef, useCallback, useState } from 'react';

/**
 * useMidiStepInput — inserimento a passi dalla tastiera MIDI.
 *
 * Ascolta i `noteOn` di qualunque dispositivo collegato. Le note che arrivano
 * INSIEME vengono consegnate insieme: premendo un accordo si riceve un accordo,
 * non quattro note in fila.
 *
 * PERCHE' SERVE UN CESTINO. Un accordo suonato a mano non arriva come un
 * messaggio: arriva come quattro `noteOn` distinti, a pochi millisecondi l'uno
 * dall'altro. Senza raccoglierli, ognuno faceva il giro completo — inserisci e
 * avanza la playhead — e un accordo di quattro note diventava una MELODIA di
 * quattro note nella stessa voce.
 *
 * LA FINESTRA, e qual e' il limite VERO. Il ritardo fra il tasto e la nota che
 * compare non conta: questo e' inserimento a PASSI, non una registrazione —
 * nessuno sta suonando a tempo, e cio' che conta e' che le note entrino giuste.
 * Quindi il limite non e' di sopra ma di sotto: se la finestra fosse stretta,
 * un accordo suonato con la mano non perfettamente insieme si spezzerebbe in
 * due inserimenti, che e' l'errore vero.
 *
 * Il vincolo dall'altra parte e' un altro, e non e' il ritardo: due note che si
 * vogliono SEPARATE, suonate in rapida successione, si fonderebbero in un
 * accordo. A 120 ms bisogna battere piu' di otto note al secondo perche'
 * succeda — piu' veloce di come si scrive a passi.
 */
const FINESTRA_ACCORDO_MS = 120;

export type UseMidiStepInputArgs = {
  /** Le note premute insieme, in ordine di arrivo. Una sola nota e' un accordo
   *  di una nota: chi riceve decide se trattarla diversamente. */
  onNoteOn: (midi: number[]) => void;
};

export function useMidiStepInput({ onNoteOn }: UseMidiStepInputArgs) {
  const [enabled, setEnabled] = useState(false);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const onNoteOnRef = useRef(onNoteOn);
  onNoteOnRef.current = onNoteOn;

  const cleanupRef = useRef<(() => void) | null>(null);

  const activate = useCallback(async () => {
    // Clean up any previous connection first.
    cleanupRef.current?.();
    cleanupRef.current = null;

    if (!navigator.requestMIDIAccess) return;
    try {
      const midiAccess = await navigator.requestMIDIAccess();
      const inputs = Array.from(midiAccess.inputs.values());
      if (inputs.length === 0) {
        setDeviceName(null);
        return;
      }

        // Il cestino: si riempie coi `noteOn` che arrivano vicini e si svuota
        // quando la finestra si chiude.
        let cestino: number[] = [];
        let attesa: ReturnType<typeof setTimeout> | null = null;
        const consegna = () => {
          attesa = null;
          const note = cestino;
          cestino = [];
          if (note.length) requestAnimationFrame(() => onNoteOnRef.current(note));
        };

      const handleMessage = (e: Event) => {
        const msg = e as any;
        const data: Uint8Array | undefined = msg?.data;
        if (!data || data.length < 3) return;
        const [status, note, velocity] = data;
        // noteOn: 0x90-0x9F with velocity > 0
        if ((status & 0xf0) === 0x90 && velocity > 0 && note >= 0 && note <= 127) {
          // Nel cestino; la consegna avviene a finestra chiusa, e passa da
          // `requestAnimationFrame` per non chiamare uno stato di React da
          // dentro un evento MIDI, cioe' in mezzo a un render.
          if (!cestino.includes(note)) cestino.push(note);
          if (attesa) clearTimeout(attesa);
          attesa = setTimeout(consegna, FINESTRA_ACCORDO_MS);
        }
      };

      // Attach listener to all inputs
      for (const input of inputs) {
        input.addEventListener('midimessage', handleMessage as EventListener);
      }

      setDeviceName(inputs[0].name ?? 'MIDI Device');
      setEnabled(true);

      // Re-attach listeners when devices reconnect.
      const onStateChange = () => {
        const currentInputs = Array.from(midiAccess.inputs.values());
        for (const input of currentInputs) {
          input.removeEventListener('midimessage', handleMessage as EventListener);
          input.addEventListener('midimessage', handleMessage as EventListener);
        }
        if (currentInputs.length > 0) {
          setDeviceName(currentInputs[0].name ?? 'MIDI Device');
        }
      };
      midiAccess.addEventListener('statechange', onStateChange);

      cleanupRef.current = () => {
        // Il cestino va svuotato con le orecchie: spegnendo lo step-input con un
        // accordo ancora dentro, il temporizzatore scatterebbe lo stesso e
        // scriverebbe note che nessuno ha piu' chiesto.
        if (attesa) { clearTimeout(attesa); attesa = null; }
        cestino = [];
        for (const input of inputs) {
          input.removeEventListener('midimessage', handleMessage as EventListener);
        }
        midiAccess.removeEventListener('statechange', onStateChange);
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
