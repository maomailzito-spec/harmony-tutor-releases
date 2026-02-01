export type AppFlavor = 'united' | 'grandstaff' | 'guitar';

export function getAppFlavor(): AppFlavor {
  const raw = String(import.meta.env.VITE_APP_FLAVOR || '').toLowerCase();
  if (raw === 'grandstaff') return 'grandstaff';
  if (raw === 'guitar') return 'guitar';
  return 'united';
}

export function isModeEnabled(flavor: AppFlavor, mode: string): boolean {
  if (flavor === 'united') return true;
  if (flavor === 'grandstaff') return mode === 'grandStaff';
  // guitar
  return mode === 'scales' || mode === 'chords' || mode === 'intervals' || mode === 'editor';
}
