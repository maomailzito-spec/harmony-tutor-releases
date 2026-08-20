const { app, BrowserWindow, Menu, ipcMain, dialog, screen, session } = require('electron');
const path = require('path');
const fs = require('fs');

// -----------------------------------------------------------------------------
// Campioni audio: NIENTE protocollo su misura
// -----------------------------------------------------------------------------
// I campioni impacchettati si caricano con un percorso relativo (`./sounds/…`,
// vedi SOUNDS_ROOT in src/services/AudioService.ts): la pagina dell'app
// installata sta su `file://`, e da lì il percorso relativo resta nello stesso
// schema — quindi passa. Ha funzionato così fino alla 1.5.1 compresa.
//
// Qui c'era, nella 1.5.2/1.5.3, uno schema nostro (`ht://suoni/…`) servito dal
// processo principale: NON funziona e non è aggiustabile con le intestazioni.
// Da una pagina `file://` Chromium consente richieste solo verso chrome,
// chrome-extension, chrome-untrusted, data, http, https — la lista è chiusa.
// Risultato: ogni campione nostro falliva e si ripiegava sul CDN remoto.
const { autoUpdater } = require('electron-updater');
const { checkTrial, getTrialInfo } = require('./licensing/trialManager');
const { activateLicense, checkLicense, deactivateLicense, getLicenseInfo, areUpdatesEnabled } = require('./licensing/licenseManager');

// -----------------------------------------------------------------------------
// Stdio hardening (macOS / dev): when Electron is launched without an attached
// terminal (or the parent process closes pipes), writes to stdout/stderr can
// fail with EIO/EPIPE and crash the main process.
// -----------------------------------------------------------------------------
function isIgnorableStdioError(err) {
  try {
    const code = err && err.code;
    return code === 'EPIPE' || code === 'EIO';
  } catch {
    return false;
  }
}

function attachIgnoreStdioErrors(stream) {
  try {
    if (!stream || typeof stream.on !== 'function') return;
    stream.on('error', (err) => {
      if (isIgnorableStdioError(err)) return;
      // Avoid recursion if stderr is also broken.
      try { process.stderr && process.stderr.write && process.stderr.write(`[stdio:error] ${String(err && err.message ? err.message : err)}\n`); } catch {}
    });
  } catch {
    // ignore
  }
}

attachIgnoreStdioErrors(process.stdout);
attachIgnoreStdioErrors(process.stderr);

function safeStdioWrite(stream, line) {
  try {
    if (!stream || typeof stream.write !== 'function') return;
    stream.write(String(line) + '\n');
  } catch (err) {
    if (isIgnorableStdioError(err)) return;
  }
}

// In some environments (especially on certain macOS setups), Chromium GPU process
// can crash and leave the renderer as a white screen. Disable hardware acceleration
// to make the app robust.
try {
  app.disableHardwareAcceleration();
} catch {
  // ignore
}

// Extra hardening: force-disable Chromium GPU features.
// (Safe even when hardware acceleration is already disabled.)
try {
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
} catch {
  // ignore
}

const {
  MENU_ACTIONS,
  sendMenuAction,
  sendMenuError,
} = require('../shared/menuActionRegistry');

const { IPC_CHANNELS } = require('../shared/ipcChannels');

let mainWindow;
let recentFiles = [];
let selectOnlyCurrentVoiceEnabled = false;
let showMeasureNumbersEnabled = true;
let showHarmonyDebugEnabled = false;
let showVoiceColorsEnabled = false;
// I TRE STRATI D'ANALISI E I RIGHI, rispecchiati qui perché il menù possa mostrare la
// spunta giusta. Il renderer li manda con SET_MENU_STATE a ogni cambiamento: senza,
// la spunta direbbe una cosa e lo schermo un'altra. I difetti di partenza sono quelli
// delle preferenze (romani e cifratura accesi, sigle spente).
let showRomanEnabled = true;
let showSymbolsEnabled = false;
let showFiguredBassEnabled = true;
let satbVisibleEnabled = true;
/** [{ id, name, visible }] — le tracce di accompagnamento, per il sottomenu dei righi. */
let accTracksState = [];
let showQuickInsertBarEnabled = true;
let engravingMode = 'enhanced';
let currentLanguage = 'it';

const EXPORT_PDF_FILTERS = [{ name: 'PDF', extensions: ['pdf'] }];
const EXPORT_PNG_FILTERS = [{ name: 'PNG', extensions: ['png'] }];

function isFiniteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

function sanitizePdfScaleFactorPercent(raw, fallbackPercent) {
  // Electron printToPDF expects a percentage (default 100).
  try {
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallbackPercent;
    return Math.max(10, Math.min(200, Math.round(n)));
  } catch {
    return fallbackPercent;
  }
}

function sanitizeZoomFactor(raw, fallback) {
  // Browser zoom factor (1 = 100%).
  try {
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0.1, Math.min(4, n));
  } catch {
    return fallback;
  }
}

async function createHiddenExportWindow() {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    backgroundColor: '#ffffff',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Ensure the window is cleaned up even if the export fails.
  win.on('closed', () => { /* noop */ });
  return win;
}

function onceDidFinishLoad(webContents) {
  return new Promise((resolve, reject) => {
    try {
      const onDone = () => {
        cleanup();
        resolve();
      };
      const onFail = (_e, code, desc) => {
        cleanup();
        reject(new Error(`load failed (${code}): ${desc}`));
      };
      const cleanup = () => {
        try { webContents.removeListener('did-finish-load', onDone); } catch { /* ignore */ }
        try { webContents.removeListener('did-fail-load', onFail); } catch { /* ignore */ }
      };
      webContents.once('did-finish-load', onDone);
      webContents.once('did-fail-load', onFail);
    } catch (e) {
      reject(e);
    }
  });
}

async function loadHtmlInWindow(win, html) {
  const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(String(html || ''))}`;
  const p = onceDidFinishLoad(win.webContents);
  await win.loadURL(dataUrl);
  await p;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function numberedPath(basePath, index1) {
  const ext = path.extname(basePath);
  const base = basePath.slice(0, basePath.length - ext.length);
  return `${base}_${index1}${ext || '.png'}`;
}

function sendAction(action, payload) {
  if (!mainWindow) return false;
  return sendMenuAction(mainWindow.webContents, action, payload);
}

function sendError(code, message) {
  if (!mainWindow) return false;
  return sendMenuError(mainWindow.webContents, code, message);
}

// Dev build tag (helps verify you're running the workspace build).
// Bump this when debugging analysis changes so users can confirm the correct app instance.
const DEV_BUILD_TAG = 'restore-2026-01-23';
const SHOW_BUILD_TAG_DIALOG = String(process.env.ELECTRON_SHOW_BUILD_TAG_DIALOG || '') === '1';

function getAppFlavor() {
  // In production builds, read from package.json appFlavor field (set by electron-builder extraMetadata).
  // In dev, use APP_FLAVOR env var.
  const raw = String(process.env.APP_FLAVOR || '').toLowerCase();
  if (raw === 'grandstaff') return 'grandstaff';
  if (raw === 'guitar') return 'guitar';
  if (raw) return 'united';
  // Fallback: check package.json via multiple paths (asar vs dev)
  const tryPaths = [
    path.join(app.getAppPath(), 'package.json'),
    path.join(__dirname, '..', 'package.json'),
    path.join(__dirname, 'package.json'),
  ];
  for (const p of tryPaths) {
    try {
      const pkg = JSON.parse(require('fs').readFileSync(p, 'utf8'));
      const pf = String(pkg.appFlavor || '').toLowerCase();
      console.log('[FLAVOR]', pf || 'united');
      if (pf === 'grandstaff') return 'grandstaff';
      if (pf === 'guitar') return 'guitar';
      if (pf) return 'united';
    } catch (e) { /* try next */ }
  }
  return 'united';
}

// Project file extension (short, app-specific).
// Keep JSON compatibility for older saves.
const PROJECT_EXT = 'htp';
const PROJECT_FILTERS = [
  { name: 'Harmony Tutor Project', extensions: [PROJECT_EXT, 'json'] },
];

// When the app is opened via OS file association, the open-file event / argv may
// arrive before the window is ready. Queue it and apply once the renderer is loaded.
let pendingOpenFilePath = null;

function looksLikeProjectPath(p) {
  try {
    if (!p || typeof p !== 'string') return false;
    const ext = path.extname(p).toLowerCase();
    return ext === `.${PROJECT_EXT}` || ext === '.json';
  } catch {
    return false;
  }
}

function extractProjectPathFromArgv(argv) {
  try {
    if (!Array.isArray(argv)) return null;
    // On Windows/Linux: argv includes the exe path; in dev it may include electron flags.
    const candidates = argv.filter(a => typeof a === 'string' && looksLikeProjectPath(a));
    return candidates.length ? candidates[candidates.length - 1] : null;
  } catch {
    return null;
  }
}

function sendOpenToRenderer(filePath) {
  if (!mainWindow || !filePath) return;
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    touchRecentFile(filePath);
    const send = () => {
      try {
        sendAction(MENU_ACTIONS.OPEN, { data, filePath });
        setWindowTitleForPath(filePath);
      } catch (err) {
        console.error('Errore invio open al renderer:', err);
      }
    };

    if (mainWindow.webContents && mainWindow.webContents.isLoading()) {
      mainWindow.webContents.once('did-finish-load', send);
    } else {
      send();
    }
  } catch (err) {
    console.error('Errore lettura file associato:', err);
    try {
      sendError('open-failed', err.message);
    } catch { /* ignore */ }
  }
}

function ensureProjectExtension(fp) {
  try {
    if (!fp || typeof fp !== 'string') return fp;
    const ext = path.extname(fp);
    if (ext && ext.length > 1) return fp;
    return `${fp}.${PROJECT_EXT}`;
  } catch {
    return fp;
  }
}

// In development, Electron's default app.name is often "Electron".
// Setting a stable app name here ensures the macOS menu bar and window titles
// show the correct product name both in dev and when packaged.
try {
  const flavor = getAppFlavor();
  const name = (flavor === 'grandstaff')
    ? 'Harmony Tutor Grand Staff'
    : (flavor === 'guitar')
      ? 'Harmony Tutor Guitar'
      : 'Harmony Tutor';
  app.setName(name);

  // Ensure flavours can run side-by-side (separate single-instance lock + storage).
  // Keep the "united" flavour on the default userData to preserve existing data.
  if (flavor !== 'united') {
    try {
      const appData = app.getPath('appData');
      app.setPath('userData', path.join(appData, `harmony-tutor-${flavor}`));
    } catch {
      // ignore
    }
  }
} catch {
  // ignore
}

function getRecentsStorePath() {
  try {
    const userData = app.getPath('userData');
    return path.join(userData, 'recent-files.json');
  } catch {
    return null;
  }
}

function loadRecentFiles() {
  const storePath = getRecentsStorePath();
  if (!storePath) return;
  try {
    if (!fs.existsSync(storePath)) return;
    const raw = fs.readFileSync(storePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      recentFiles = parsed.filter((p) => typeof p === 'string' && p.trim().length > 0).slice(0, 10);
    }
  } catch (err) {
    console.warn('[MAIN] Failed to load recent files:', err);
  }
}

function saveRecentFiles() {
  const storePath = getRecentsStorePath();
  if (!storePath) return;
  try {
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, JSON.stringify(recentFiles, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[MAIN] Failed to save recent files:', err);
  }
}

// --- Guitar library persistence (custom scales/chords/shapes/voicings) ---
// Stored in userData so it works offline and survives cache clears.
function getGuitarLibraryPath() {
  try {
    const userData = app.getPath('userData');
    return path.join(userData, 'guitar-library.json');
  } catch {
    return null;
  }
}

function defaultGuitarLibrary() {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    customScales: [],
    customChords: [],
    customScaleShapes: {},
    customVoicings: [],
  };
}

function touchRecentFile(filePath) {
  if (!filePath || typeof filePath !== 'string') return;
  recentFiles = [filePath, ...recentFiles.filter((p) => p !== filePath)].slice(0, 10);
  saveRecentFiles();
  try {
    createMenu();
  } catch (err) {
    console.error('Errore aggiornamento menu recenti:', err);
  }
}

function removeRecentFile(filePath) {
  try {
    if (!filePath || typeof filePath !== 'string') return;
    const beforeLen = recentFiles.length;
    recentFiles = recentFiles.filter((p) => p !== filePath);
    if (recentFiles.length !== beforeLen) saveRecentFiles();
    try { createMenu(); } catch { /* ignore */ }
  } catch {
    // ignore
  }
}

function setWindowTitleForPath(filePath) {
  try {
    if (!mainWindow) return;
    const base = filePath && typeof filePath === 'string' ? path.basename(filePath) : app.name;
    const isDev = String(process.env.NODE_ENV || '').toLowerCase() === 'development';
    const suffix = isDev ? ` (dev:${DEV_BUILD_TAG})` : '';
    mainWindow.setTitle(`${base} — ${app.name}${suffix}`);
  } catch (err) {
    console.warn('Impossibile impostare il titolo della finestra:', err);
  }
}

function createMenu() {
  const isMac = process.platform === 'darwin';
  const isDev = String(process.env.NODE_ENV || '').toLowerCase() === 'development';
  const flavor = getAppFlavor();
  const enableGrandStaff = flavor !== 'guitar';
  const enableGuitar = flavor !== 'grandstaff';

  // ── Minimal i18n for the native menu (main process has no i18next) ──
  const lng = (currentLanguage || 'it').slice(0, 2);
  const _menuStrings = {
    it: {
      file: 'File', edit: 'Modifica', view: 'Vista', tools: 'Strumenti', help: 'Aiuto',
      preferences: 'Preferenze…', newProject: 'Nuovo Progetto', open: 'Apri...',
      importMidi: 'Importa MIDI...', importXml: 'Importa MusicXML...',
      exportXml: 'Esporta musica…',
      exportPdf: 'Esporta PDF…', exportPng: 'Esporta PNG…',
      print: 'Stampa', save: 'Salva', saveAs: 'Salva con nome...',
      closeProject: 'Chiudi progetto', undo: 'Annulla', redo: 'Ripeti',
      cut: 'Taglia', copy: 'Copia', paste: 'Incolla', selectAll: 'Seleziona tutto',
      selectVoice: 'Seleziona solo voce corrente (rettangolo)',
      titleFont: 'Titolo', serif: 'Serif', sansSerif: 'Sans-serif', mono: 'Monospace',
      titleIncrease: 'Aumenta dimensione titolo', titleDecrease: 'Diminuisci dimensione titolo',
      scales: 'Scale', chords: 'Accordi', intervals: 'Intervalli', editor: 'Editor',
      grandStaff: 'Grand Staff', engravingMode: 'Modalità incisione',
      reorderToolbar: 'Personalizza la barra…', transport: 'Barra comandi a toolbar nascosta (⌥T per nasconderla)',
      measureNumbers: 'Numeri misure', harmonyDebug: 'Debug harmony labels (pcs)',
      voiceColors: 'Colori voci (BTAS)',
      analysisLayers: 'Analisi mostrata', showRoman: 'Numeri romani',
      showSymbols: 'Sigle accordi', showFiguredBass: 'Cifratura del basso',
      staves: 'Righi da mostrare ed esportare', staffChoir: 'Coro (SATB)',
      exportFollowsView: 'Quel che si vede è quel che si esporta',
      generateChorale: 'Genera corale da Roman Numerals…',
      shortcuts: 'Scorciatoie…', manual: 'Manuale utente (PDF)…', manualMissing: 'Manuale non trovato',
      noRecent: 'Nessun file recente',
      collisionEnhanced: 'Verifica collisioni (Enhanced)…', collisionLegacy: 'Verifica collisioni (Legacy)…',
      manageLicense: 'Gestisci Licenza…',
      about: 'Informazioni su Harmony Tutor…',
    },
    en: {
      file: 'File', edit: 'Edit', view: 'View', tools: 'Tools', help: 'Help',
      preferences: 'Preferences…', newProject: 'New Project', open: 'Open...',
      importMidi: 'Import MIDI...', importXml: 'Import MusicXML...',
      exportXml: 'Export music…',
      exportPdf: 'Export PDF…', exportPng: 'Export PNG…',
      print: 'Print', save: 'Save', saveAs: 'Save As...',
      closeProject: 'Close project', undo: 'Undo', redo: 'Redo',
      cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select All',
      selectVoice: 'Select only current voice (marquee)',
      titleFont: 'Title', serif: 'Serif', sansSerif: 'Sans-serif', mono: 'Monospace',
      titleIncrease: 'Increase title size', titleDecrease: 'Decrease title size',
      scales: 'Scales', chords: 'Chords', intervals: 'Intervals', editor: 'Editor',
      grandStaff: 'Grand Staff', engravingMode: 'Engraving mode',
      reorderToolbar: 'Customize the toolbar…', transport: 'Command bar when the toolbar is hidden (⌥T to hide it)',
      measureNumbers: 'Measure numbers', harmonyDebug: 'Debug harmony labels (pcs)',
      voiceColors: 'Voice colors (BTAS)',
      analysisLayers: 'Analysis shown', showRoman: 'Roman numerals',
      showSymbols: 'Chord symbols', showFiguredBass: 'Figured bass',
      staves: 'Staves shown and exported', staffChoir: 'Choir (SATB)',
      exportFollowsView: 'What you see is what you export',
      generateChorale: 'Generate chorale from Roman Numerals…',
      shortcuts: 'Shortcuts…', manual: 'User manual (PDF)…', manualMissing: 'Manual not found',
      noRecent: 'No recent files',
      collisionEnhanced: 'Check collisions (Enhanced)…', collisionLegacy: 'Check collisions (Legacy)…',
      manageLicense: 'Manage License…',
      analyzeChoir: 'Analyse the choir (SATB)',
      analyzeTrack: 'Analyse the accompaniment track',
      about: 'About Harmony Tutor…',
    },
  };
  const ms = _menuStrings[lng] || _menuStrings['it'];
  const mt = (/** @type {string} */ key) => ms[key] || _menuStrings['it'][key] || key;
  let shortcutsWindow = null;
  const showShortcutsDialog = () => {
    try {
      // If already open, focus it instead of opening a duplicate
      if (shortcutsWindow && !shortcutsWindow.isDestroyed()) {
        shortcutsWindow.focus();
        return;
      }
      if (!mainWindow) return;
      // ELENCO VERIFICATO SUL CODICE (03/08/2026): estratto dal gestore dei tasti in
      // GrandStaffEditor.tsx e dagli acceleratori dei menù. Se aggiungi una scorciatoia
      // là, aggiungila QUI: era già capitato che l'elenco raccontasse cose false (diceva
      // che T è la legatura, mentre T apre le proprietà e la legatura è L).
      const sezioniIt = [
        { title: `MENU (${app.name})`, items: [
          'Cmd/Ctrl+N — Nuovo progetto',
          'Cmd/Ctrl+O — Apri…',
          'Cmd/Ctrl+I — Importa MIDI…   |   Cmd/Ctrl+Shift+I — Importa MusicXML…',
          'Cmd/Ctrl+Shift+E — Esporta musica…',
          'Cmd/Ctrl+Shift+P — Esporta PDF…   |   Cmd/Ctrl+Shift+G — Esporta PNG…',
          'Cmd/Ctrl+P — Stampa',
          'Cmd/Ctrl+S — Salva   |   Cmd/Ctrl+Shift+S — Salva con nome…',
          'Cmd/Ctrl+W — Chiudi progetto',
          'Cmd/Ctrl+, — Preferenze…',
          'Cmd/Ctrl+Z — Annulla   |   Shift+Cmd/Ctrl+Z — Ripeti',
          'Cmd/Ctrl+X — Taglia   |   Cmd/Ctrl+C — Copia   |   Cmd/Ctrl+V — Incolla   |   Cmd/Ctrl+A — Seleziona tutto',
          'Alt/Option+S — Seleziona solo la voce corrente (rettangolo)',
          'Ctrl+C — Colori delle voci',
          'Cmd/Ctrl+] — Titolo più grande   |   Cmd/Ctrl+[ — Titolo più piccolo',
        ]},
        { title: 'PANNELLI E VISTA', items: [
          'T — Proprietà del punto in cui sta il cursore (tonalità del passaggio, modulazioni, testo, override)',
          'P — Menù "Altro"',
          'Alt/Option+T — Mostra/nascondi la toolbar',
          'Alt/Option+L — Cicla i righi: grand staff ↔ chiavi antiche ↔ rigo singolo',
          'Alt/Option+M — Parti late/strette dal cursore in avanti',
          'Cmd/Ctrl+0 — Azzera lo zoom',
        ]},
        { title: 'ESECUZIONE', items: [
          'Spazio — Play / stop',
          'Freccia ← → — Sposta il cursore (Shift = passo più fine)',
          'Invio — Torna all\'inizio senza suonare',
          'K — Metronomo',
          'Shift+R — Registrazione (arma / disarma / ferma)',
        ]},
        { title: 'SCRITTURA', items: [
          'Cmd/Ctrl+clic sul rigo — Inserisci una nota (il clic semplice sceglie la voce)',
          '1…7 — Durata: semibreve, minima, semiminima, croma, semicroma, biscroma, semibiscroma',
          '. — Punto di valore',
          'R — Alterna nota / pausa',
          'b — bemolle   |   n — bequadro   |   # — diesis',
          'V — Cicla la voce (B→T→A→S)',
          'L — Legatura di valore',
          'J — Riscrittura enarmonica (Re♯ ⇄ Mi♭)',
          '+ — Aggiungi una traccia d\'accompagnamento',
          'Backspace / Canc — Cancella la selezione',
        ]},
        { title: 'ALTEZZE E RIGHI (note selezionate)', items: [
          'Freccia ↑ ↓ — Trasporta di un semitono',
          'Shift+↑ ↓ — Trasporta di un\'ottava',
          'Alt/Option+↑ ↓ — Sposta al rigo superiore / inferiore',
          'Trascinamento col mouse — Sposta di grado (diatonico)',
        ]},
        { title: "SOGGETTO DELL'ANALISI", items: [
          'Cmd/Ctrl+Alt+1 — Analizza il coro (SATB)',
          "Cmd/Ctrl+Alt+2 — Analizza la traccia d'accompagnamento (un brano importato entra come traccia)",
          'Cmd/Ctrl+Alt+3 — Elenco delle violazioni (si apre E ci si va dentro; chiudendolo il fuoco torna alla partitura)',
          "Le prime due voci stanno nel menù Strumenti. Se il coro è vuoto e c'è una traccia con delle note, l'analisi ci si sposta da sé.",
        ]},
        { title: 'ANALISI MOSTRATA E RIGHI (menù Vista)', items: [
          'Cmd/Ctrl+Alt+R — Numeri romani',
          'Cmd/Ctrl+Alt+S — Sigle degli accordi',
          'Cmd/Ctrl+Alt+F — Cifratura del basso',
          'Cmd/Ctrl+Alt+C — Coro (SATB): mostralo o nascondilo',
          "Le tracce d'accompagnamento si accendono e si spengono dal menù Vista → «Righi da mostrare ed esportare», ognuna col suo nome.",
          'QUEL CHE RESTA ACCESO È QUEL CHE FINISCE NEI FILE ESPORTATI: questi comandi scelgono anche il contenuto di ciò che si salva.',
        ]},
        { title: 'ANALISI E MARCATURE (note selezionate)', items: [
          'Alt/Option+P — Nota di passaggio   |   ⌥V — Nota di volta   |   ⌥A — Appoggiatura',
          'Alt/Option+R — Ritardo   |   ⌥S — Nota di sfuggita   |   ⌥C — Cambiata   |   ⌥N — Anticipazione',
          'Alt/Option+H — Forza nota STRUTTURALE   |   ⌥O — Forza nota ORNAMENTALE',
          'Alt/Option+Shift+H — Leggi la selezione come un solo accordo',
          'Alt/Option+F — Corona (fermata)',
          'Alt/Option+Shift+R — Curva di tempo (rallentando / accelerando) — ora anche dalla tavolozza dei Segni',
        ]},
        { title: 'TAVOLOZZA DEI SEGNI (pulsante "pf" in toolbar)', items: [
          'Trascina un segno sulla partitura per posarlo: dinamiche, rall./accel., metro, testo, doppia barra, ritornelli, +/− misura',
          'Tasto destro su un segno — Toglilo',
          'Trascina i capi di forcelle e rallentando — Allunga o accorcia',
          'In alternativa: seleziona una nota e clicca il segno (due note per una forcella)',
        ]},
        // Le viste Scale / Accordi / Intervalli appartengono alla versione "chitarra":
        // in Harmony Tutor (flavor grandstaff) non sono raggiungibili da nessun menù,
        // quindi elencarne le scorciatoie confondeva e basta.
        ...(getAppFlavor() !== 'grandstaff' ? [
          { title: 'VISTE CHITARRA (Scale · Accordi · Intervalli)', items: [
            'Scale: Cmd/Ctrl+Z annulla; Backspace/Canc rimuove il riquadro; frecce e numeri per muovere e selezionare',
            'Accordi: frecce ← → voicing precedente/successivo; ↑ ↓ cambia set di corde',
            'Intervalli: Cmd/Ctrl+Z annulla',
          ]},
        ] : []),
      ];
      // STESSO ELENCO IN INGLESE. Prima la finestra era in italiano anche con
      // l'interfaccia in inglese: un elenco di scorciatoie che non si legge non è
      // un elenco di scorciatoie. Le due liste vanno tenute allineate a mano —
      // aggiungendo una voce di là, aggiungerla anche qui.
      const sezioniEn = [
        { title: `MENU (${app.name})`, items: [
          'Cmd/Ctrl+N — New project',
          'Cmd/Ctrl+O — Open…',
          'Cmd/Ctrl+I — Import MIDI…   |   Cmd/Ctrl+Shift+I — Import MusicXML…',
          'Cmd/Ctrl+Shift+E — Export music…',
          'Cmd/Ctrl+Shift+P — Export PDF…   |   Cmd/Ctrl+Shift+G — Export PNG…',
          'Cmd/Ctrl+P — Print',
          'Cmd/Ctrl+S — Save   |   Cmd/Ctrl+Shift+S — Save as…',
          'Cmd/Ctrl+W — Close project',
          'Cmd/Ctrl+, — Preferences…',
          'Cmd/Ctrl+Z — Undo   |   Shift+Cmd/Ctrl+Z — Redo',
          'Cmd/Ctrl+X — Cut   |   Cmd/Ctrl+C — Copy   |   Cmd/Ctrl+V — Paste   |   Cmd/Ctrl+A — Select all',
          'Alt/Option+S — Select current voice only (marquee)',
          'Ctrl+C — Voice colors',
          'Cmd/Ctrl+] — Larger title   |   Cmd/Ctrl+[ — Smaller title',
        ]},
        { title: 'PANELS AND VIEW', items: [
          'T — Properties at the cursor (key of the passage, modulations, text, overrides)',
          'P — "More" menu',
          'Alt/Option+T — Show/hide the toolbar',
          'Alt/Option+L — Cycle staves: grand staff ↔ old clefs ↔ single staff',
          'Alt/Option+M — Wide/narrow parts from the cursor onwards',
          'Cmd/Ctrl+0 — Reset zoom',
        ]},
        { title: 'PLAYBACK', items: [
          'Space — Play / stop',
          'Arrow ← → — Move the cursor (Shift = finer step)',
          'Enter — Back to the start without playing',
          'K — Metronome',
          'Shift+R — Recording (arm / disarm / stop)',
        ]},
        { title: 'WRITING', items: [
          'Cmd/Ctrl+click on the staff — Insert a note (a plain click picks the voice)',
          '1…7 — Duration: whole, half, quarter, eighth, 16th, 32nd, 64th',
          '. — Dotted value',
          'R — Toggle note / rest',
          'b — flat   |   n — natural   |   # — sharp',
          'V — Cycle the voice (B→T→A→S)',
          'L — Tie',
          'J — Enharmonic respelling (D♯ ⇄ E♭)',
          '+ — Add an accompaniment track',
          'Backspace / Delete — Delete the selection',
        ]},
        { title: 'PITCHES AND STAVES (selected notes)', items: [
          'Arrow ↑ ↓ — Transpose by a semitone',
          'Shift+↑ ↓ — Transpose by an octave',
          'Alt/Option+↑ ↓ — Move to the staff above / below',
          'Mouse drag — Move by step (diatonic)',
        ]},
        { title: 'SUBJECT OF THE ANALYSIS', items: [
          'Cmd/Ctrl+Alt+1 — Analyse the choir (SATB)',
          'Cmd/Ctrl+Alt+2 — Analyse the accompaniment track (an imported piece comes in as a track)',
          'Cmd/Ctrl+Alt+3 — Violations list (it opens AND moves the focus there; closing it returns the focus to the score)',
          'The first two also sit in the Tools menu. If the choir is empty and a track has notes, the analysis moves there by itself.',
        ]},
        { title: 'ANALYSIS SHOWN AND STAVES (View menu)', items: [
          'Cmd/Ctrl+Alt+R — Roman numerals',
          'Cmd/Ctrl+Alt+S — Chord symbols',
          'Cmd/Ctrl+Alt+F — Figured bass',
          'Cmd/Ctrl+Alt+C — Choir (SATB): show or hide it',
          'Accompaniment tracks are switched on and off from View → "Staves shown and exported", each by its own name.',
          'WHAT STAYS ON IS WHAT GOES INTO THE EXPORTED FILES: these commands also choose the contents of what you save.',
        ]},
        { title: 'ANALYSIS AND MARKINGS (selected notes)', items: [
          'Alt/Option+P — Passing note   |   ⌥V — Neighbour note   |   ⌥A — Appoggiatura',
          'Alt/Option+R — Suspension   |   ⌥S — Escape note   |   ⌥C — Cambiata   |   ⌥N — Anticipation',
          'Alt/Option+H — Force STRUCTURAL note   |   ⌥O — Force ORNAMENTAL note',
          'Alt/Option+Shift+H — Read the selection as a single chord',
          'Alt/Option+F — Fermata',
          'Alt/Option+Shift+R — Tempo curve (rallentando / accelerando) — also from the Signs palette',
        ]},
        { title: 'SIGNS PALETTE ("pf" button in the toolbar)', items: [
          'Drag a sign onto the score to drop it: dynamics, rall./accel., time signature, text, double barline, repeats, +/− measure',
          'Right-click on a sign — Remove it',
          'Drag the ends of hairpins and rallentando — Lengthen or shorten',
          'Or: select a note and click the sign (two notes for a hairpin)',
        ]},
        ...(getAppFlavor() !== 'grandstaff' ? [
          { title: 'GUITAR VIEWS (Scales · Chords · Intervals)', items: [
            'Scales: Cmd/Ctrl+Z undoes; Backspace/Delete removes the box; arrows and numbers to move and select',
            'Chords: arrows ← → previous/next voicing; ↑ ↓ change string set',
            'Intervals: Cmd/Ctrl+Z undoes',
          ]},
        ] : []),
      ];
      const sections = lng === 'en' ? sezioniEn : sezioniIt;
      const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const sectionsHtml = sections.map(sec =>
        `<section><h2>${escapeHtml(sec.title)}</h2><ul>${sec.items.map(it => `<li>${escapeHtml(it)}</li>`).join('')}</ul></section>`
      ).join('');
      const titoloFinestra = lng === 'en' ? 'Keyboard shortcuts' : 'Scorciatoie da tastiera';
      const intestazione = lng === 'en'
        ? '⌨️ Keyboard shortcuts and quick actions'
        : '⌨️ Scorciatoie da tastiera e funzioni rapide';
      const chiudi = lng === 'en' ? 'Close (Esc)' : 'Chiudi (Esc)';
      const html = `<!DOCTYPE html>
<html lang="${lng === 'en' ? 'en' : 'it'}">
<head>
<meta charset="utf-8">
<title>${titoloFinestra}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; height: 100%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; line-height: 1.5; }
  body { display: flex; flex-direction: column; background: #fafafa; color: #222; }
  @media (prefers-color-scheme: dark) { body { background: #1e1e1e; color: #ddd; } header { background: #2a2a2a !important; border-bottom-color: #444 !important; } h2 { color: #6cb6ff !important; border-bottom-color: #444 !important; } footer { background: #2a2a2a !important; border-top-color: #444 !important; } button { background: #3a3a3a !important; color: #ddd !important; border-color: #555 !important; } button:hover { background: #4a4a4a !important; } }
  header { padding: 12px 20px; background: #fff; border-bottom: 1px solid #e0e0e0; flex-shrink: 0; }
  header h1 { margin: 0; font-size: 15px; font-weight: 600; }
  main { flex: 1; overflow-y: auto; padding: 8px 20px 16px; }
  section { margin-top: 16px; }
  h2 { font-size: 12px; font-weight: 600; color: #0066cc; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 6px; padding-bottom: 4px; border-bottom: 1px solid #e0e0e0; }
  ul { margin: 0; padding-left: 18px; }
  li { margin: 2px 0; }
  footer { padding: 10px 20px; background: #fff; border-top: 1px solid #e0e0e0; text-align: right; flex-shrink: 0; }
  button { padding: 6px 18px; font-size: 13px; border: 1px solid #ccc; border-radius: 4px; background: #f5f5f5; cursor: pointer; }
  button:hover { background: #e8e8e8; }
</style>
</head>
<body>
<header><h1>${intestazione}</h1></header>
<main>${sectionsHtml}</main>
<footer><button id="closeBtn" autofocus>${chiudi}</button></footer>
<script>
  const { ipcRenderer } = require('electron');
  document.getElementById('closeBtn').addEventListener('click', () => window.close());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close(); });
</script>
</body>
</html>`;
      shortcutsWindow = new BrowserWindow({
        parent: mainWindow,
        modal: false,
        width: 720,
        height: 640,
        minWidth: 480,
        minHeight: 360,
        title: titoloFinestra,
        autoHideMenuBar: true,
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false,
        },
      });
      shortcutsWindow.removeMenu();
      shortcutsWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      shortcutsWindow.on('closed', () => { shortcutsWindow = null; });
    } catch (err) {
      console.warn('[MAIN] Failed to show shortcuts dialog:', err);
    }
  };
  /**
   * Apre il manuale dell'utente, nella lingua dell'applicazione.
   *
   * Il PDF viaggia DENTRO l'applicazione (extraResources), non sul sito: chi compra
   * scarica un file solo, e la guida che si ritrova è quella della versione che sta
   * usando — un manuale scaricato a parte invecchia per conto suo e nessuno se ne
   * accorge finché non cerca una funzione che nel testo non c'è.
   *
   * In sviluppo `resources/` non esiste: si ricade sulla copia nel repo, altrimenti
   * la voce di menù sarebbe morta proprio a chi sta lavorando al manuale.
   */
  const apriManuale = () => {
    try {
      const { shell } = require('electron');
      const path = require('path');
      const fs = require('fs');
      const nome = lng === 'en' ? 'Harmony_Tutor_Manual_EN.pdf' : 'Harmony_Tutor_Manuale_ITA.pdf';
      const candidati = [
        path.join(process.resourcesPath || '', 'manuali', nome),
        path.join(app.getAppPath(), 'docs', 'manuali', nome),
        path.join(__dirname, '..', 'docs', 'manuali', nome),
      ];
      const trovato = candidati.find(f => { try { return f && fs.existsSync(f); } catch { return false; } });
      if (!trovato) {
        dialog.showMessageBox(mainWindow || undefined, {
          type: 'warning',
          message: mt('manualMissing'),
          detail: candidati.join('\n'),
        });
        return;
      }
      shell.openPath(trovato);
    } catch (err) {
      console.warn('[MAIN] Impossibile aprire il manuale:', err);
    }
  };

  const showAboutDialog = () => {
    try {
      const version = app.getVersion();
      const name = app.getName();
      const credits = lng === 'en'
        ? `\n\nPiano samples: Salamander Grand Piano V3 — Alexander Holm,\nlicensed under CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/),\nsamples recompressed/reduced.`
        : `\n\nCampioni di pianoforte: Salamander Grand Piano V3 — Alexander Holm,\nlicenza CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/),\ncampioni ricompressi/ridotti.`;
      const detail = (lng === 'en'
        ? `Version ${version}\n\nA desktop app for harmonic analysis — Grand Staff editor with figured bass, Roman numerals and voice leading.\n\n© 2026 Harmony Tutor\nhttps://harmonytutor.it`
        : `Versione ${version}\n\nApp desktop per l'analisi armonica — editor su pentagramma con basso continuo, numerali romani e condotta delle voci.\n\n© 2026 Harmony Tutor\nhttps://harmonytutor.it`) + credits;
      dialog.showMessageBox(mainWindow || null, {
        type: 'info',
        title: lng === 'en' ? 'About Harmony Tutor' : 'Informazioni su Harmony Tutor',
        message: name,
        detail,
        buttons: ['OK'],
      });
    } catch (err) {
      console.warn('[MAIN] Failed to show about dialog:', err);
    }
  };
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: mt('preferences'),
          accelerator: 'CmdOrCtrl+,',
          click: () => { sendAction(MENU_ACTIONS.OPEN_PREFERENCES); }
        },
        { type: 'separator' },
        {
          label: mt('manageLicense'),
          click: () => { showLicenseActivationDialog(); }
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    {
      label: mt('file'),
      submenu: enableGrandStaff ? [
        {
          label: mt('file'),
          submenu: (recentFiles.length === 0) ? [ { label: mt('noRecent'), enabled: false } ] : recentFiles.map(fp => ({
            label: (() => {
              try {
                const exists = Boolean(fp && fs.existsSync(fp));
                return exists ? fp : `[MANCANTE] ${fp}`;
              } catch {
                return String(fp);
              }
            })(),
            click: () => {
              if (!mainWindow) return;
              try {
                if (!fp || typeof fp !== 'string') return;
                if (!fs.existsSync(fp)) {
                  removeRecentFile(fp);
                  sendError('recent-missing', `File recente non trovato: ${fp}`);
                  return;
                }

                const data = fs.readFileSync(fp, 'utf-8');
                touchRecentFile(fp);
                sendAction(MENU_ACTIONS.OPEN, { data, filePath: fp });
                setWindowTitleForPath(fp);
              } catch (err) {
                console.error('Errore apertura file recente:', err);
                try { removeRecentFile(fp); } catch { /* ignore */ }
                try { sendError('open-recent-failed', String(err && err.message ? err.message : err)); } catch { /* ignore */ }
              }
            }
          }))
        },
        {
          label: mt('newProject'),
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            if (mainWindow) {
              sendAction(MENU_ACTIONS.NEW);
              setWindowTitleForPath(null);
            }
          }
        },
        { type: 'separator' },
        {
          label: mt('open'),
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            if (!mainWindow) return;
            const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
              properties: ['openFile'],
              filters: PROJECT_FILTERS,
            });
            if (canceled || filePaths.length === 0) return;
            const filePath = filePaths[0];
            try {
              const data = fs.readFileSync(filePath, 'utf-8');
              sendAction(MENU_ACTIONS.OPEN, { data, filePath });
              setWindowTitleForPath(filePath);
            } catch (err) {
              console.error("Errore lettura file:", err);
              sendError('open-failed', err.message);
            }
          }
        },
        {
          label: mt('importMidi'),
          accelerator: 'CmdOrCtrl+I',
          click: async () => {
            if (!mainWindow) return;
            const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
              properties: ['openFile'],
              filters: [{ name: 'MIDI', extensions: ['mid', 'midi'] }]
            });
            if (canceled || filePaths.length === 0) return;
            const filePath = filePaths[0];
            try {
              const buf = fs.readFileSync(filePath);
              const base64 = Buffer.from(buf).toString('base64');
              sendAction(MENU_ACTIONS.IMPORT_MIDI, { base64, filePath });
            } catch (err) {
              console.error('Errore import MIDI:', err);
              sendError('import-midi-failed', err.message);
            }
          }
        },
        {
          label: mt('importXml'),
          // Import MIDI ha ⌘I: il MusicXML — la via d'ingresso principale per chi lavora
          // con altri programmi di notazione — non aveva scorciatoia. Per chi usa uno
          // screen reader il menù è la strada principale, e una voce senza scorciatoia
          // costa ogni volta la navigazione dell'intero menù.
          accelerator: 'CmdOrCtrl+Shift+I',
          click: async () => {
            if (!mainWindow) return;
            const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
              properties: ['openFile'],
              filters: [{ name: 'MusicXML', extensions: ['xml', 'musicxml'] }]
            });
            if (canceled || filePaths.length === 0) return;
            const filePath = filePaths[0];
            try {
              const xml = fs.readFileSync(filePath, 'utf-8');
              sendAction(MENU_ACTIONS.IMPORT_MUSICXML, { xml, filePath });
            } catch (err) {
              console.error('Errore import MusicXML:', err);
              sendError('import-musicxml-failed', err.message);
            }
          }
        },
        {
          label: mt('exportXml'),
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => { sendAction(MENU_ACTIONS.EXPORT_MUSICXML); }
        },
        {
          label: mt('exportPdf'),
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => { sendAction(MENU_ACTIONS.EXPORT_PDF); }
        },
        {
          label: mt('exportPng'),
          accelerator: 'CmdOrCtrl+Shift+G',
          click: () => { sendAction(MENU_ACTIONS.EXPORT_PNG); }
        },
        { type: 'separator' },
        {
          label: mt('print'),
          accelerator: 'CmdOrCtrl+P',
          click: () => { sendAction(MENU_ACTIONS.PRINT); }
        },
        { type: 'separator' },
        {
          label: mt('save'),
          accelerator: 'CmdOrCtrl+S',
          click: () => sendAction(MENU_ACTIONS.SAVE)
        },
        {
          label: mt('saveAs'),
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => sendAction(MENU_ACTIONS.SAVE_AS)
        },
        { type: 'separator' },
        {
          label: mt('closeProject'),
          accelerator: 'CmdOrCtrl+W',
          click: () => {
            if (mainWindow) {
              console.log('[MAIN] Menu: Chiudi progetto cliccato (File menu)');
              sendAction(MENU_ACTIONS.CLOSE_PROJECT);
              setWindowTitleForPath(null);
            }
          }
        }
      ] : [
        { role: isMac ? 'close' : 'quit' }
      ]
    },
    {
      label: mt('edit'),
      submenu: [
        {
          label: mt('undo'),
          accelerator: 'CmdOrCtrl+Z',
          click: () => { sendAction(MENU_ACTIONS.UNDO); }
        },
        {
          label: mt('redo'),
          accelerator: 'Shift+CmdOrCtrl+Z',
          click: () => { sendAction(MENU_ACTIONS.REDO); }
        },
        { type: 'separator' },
        {
          label: mt('cut'),
          accelerator: 'CmdOrCtrl+X',
          click: () => { sendAction(MENU_ACTIONS.EDIT_COMMAND, { command: 'cut' }); }
        },
        {
          label: mt('copy'),
          accelerator: 'CmdOrCtrl+C',
          click: () => { sendAction(MENU_ACTIONS.EDIT_COMMAND, { command: 'copy' }); }
        },
        {
          label: mt('paste'),
          accelerator: 'CmdOrCtrl+V',
          click: () => { sendAction(MENU_ACTIONS.EDIT_COMMAND, { command: 'paste' }); }
        },
        {
          label: mt('selectAll'),
          accelerator: 'CmdOrCtrl+A',
          click: () => { sendAction(MENU_ACTIONS.EDIT_COMMAND, { command: 'selectAll' }); }
        },
        { type: 'separator' },
        {
          label: mt('selectVoice'),
          type: 'checkbox',
          accelerator: 'Alt+S',
          checked: !!selectOnlyCurrentVoiceEnabled,
          click: (menuItem) => {
            selectOnlyCurrentVoiceEnabled = !!menuItem.checked;
            sendAction(MENU_ACTIONS.SET_SELECT_ONLY_VOICE, { enabled: selectOnlyCurrentVoiceEnabled });
          }
        },
        { type: 'separator' },
        {
          label: mt('titleFont'),
          submenu: [
            {
              label: mt('serif'),
              click: () => { sendAction(MENU_ACTIONS.SET_TITLE_FONT_FAMILY, { family: 'serif' }); }
            },
            {
              label: mt('sansSerif'),
              click: () => { sendAction(MENU_ACTIONS.SET_TITLE_FONT_FAMILY, { family: 'sans-serif' }); }
            },
            {
              label: mt('mono'),
              click: () => { sendAction(MENU_ACTIONS.SET_TITLE_FONT_FAMILY, { family: 'monospace' }); }
            },
            { type: 'separator' },
            {
              label: mt('titleIncrease'),
              accelerator: 'CmdOrCtrl+]',
              click: () => { sendAction(MENU_ACTIONS.INCREASE_TITLE_FONT); }
            },
            {
              label: mt('titleDecrease'),
              accelerator: 'CmdOrCtrl+[',
              click: () => { sendAction(MENU_ACTIONS.DECREASE_TITLE_FONT); }
            }
          ]
        }
      ]
    },
    {
      label: mt('view'),
      submenu: [
        {
          label: mt('preferences'),
          accelerator: 'CmdOrCtrl+,',
          click: () => { sendAction(MENU_ACTIONS.OPEN_PREFERENCES); }
        },
        {
          label: mt('manageLicense'),
          click: () => { showLicenseActivationDialog(); }
        },
        { type: 'separator' },
        ...(enableGuitar ? [
          {
            label: mt('scales'),
            click: () => { sendAction(MENU_ACTIONS.SET_APP_MODE, { mode: 'scales' }); }
          },
          {
            label: mt('chords'),
            click: () => { sendAction(MENU_ACTIONS.SET_APP_MODE, { mode: 'chords' }); }
          },
          {
            label: mt('intervals'),
            click: () => { sendAction(MENU_ACTIONS.SET_APP_MODE, { mode: 'intervals' }); }
          },
          {
            label: mt('editor'),
            click: () => { sendAction(MENU_ACTIONS.SET_APP_MODE, { mode: 'editor' }); }
          },
        ] : []),
        ...(enableGrandStaff ? [
          {
            label: mt('grandStaff'),
            click: () => { sendAction(MENU_ACTIONS.SET_APP_MODE, { mode: 'grandStaff' }); }
          },
          { type: 'separator' },
          {
            label: mt('engravingMode'),
            submenu: [
              {
                label: 'Enhanced',
                type: 'radio',
                checked: engravingMode === 'enhanced',
                click: () => {
                  engravingMode = 'enhanced';
                  sendAction(MENU_ACTIONS.SET_ENGRAVING_MODE, { mode: 'enhanced' });
                  try { createMenu(); } catch { /* ignore */ }
                }
              },
              {
                label: 'Legacy',
                type: 'radio',
                checked: engravingMode === 'legacy',
                click: () => {
                  engravingMode = 'legacy';
                  sendAction(MENU_ACTIONS.SET_ENGRAVING_MODE, { mode: 'legacy' });
                  try { createMenu(); } catch { /* ignore */ }
                }
              },
              { type: 'separator' },
              {
                label: mt('collisionEnhanced'),
                click: () => { sendAction(MENU_ACTIONS.RUN_OVERLAP_AUDIT, { mode: 'enhanced' }); }
              },
              {
                label: mt('collisionLegacy'),
                click: () => { sendAction(MENU_ACTIONS.RUN_OVERLAP_AUDIT, { mode: 'legacy' }); }
              }
            ]
          },
        ] : []),
        {
          label: mt('reorderToolbar'),
          click: () => { sendAction(MENU_ACTIONS.TOGGLE_TOOLBAR_CUSTOMIZE); }
        },
        ...(enableGrandStaff ? [
          {
            label: mt('transport'),
            type: 'checkbox',
            checked: !!showQuickInsertBarEnabled,
            click: (menuItem) => {
              showQuickInsertBarEnabled = !!menuItem.checked;
              sendAction(MENU_ACTIONS.SET_QUICK_INSERT_BAR, { enabled: showQuickInsertBarEnabled });
            }
          },
          { type: 'separator' },
          {
            label: mt('measureNumbers'),
            type: 'checkbox',
            checked: !!showMeasureNumbersEnabled,
            click: (menuItem) => {
              showMeasureNumbersEnabled = !!menuItem.checked;
              sendAction(MENU_ACTIONS.SET_SHOW_MEASURE_NUMBERS, { enabled: showMeasureNumbersEnabled });
            }
          },
          { type: 'separator' },
          // ── QUEL CHE SI VEDE È QUEL CHE SI ESPORTA ────────────────────────
          // Questi comandi stavano SOLO sulla barra degli strumenti: pulsanti
          // piccoli, raggiungibili col mouse. Ma decidono due cose grosse — che
          // analisi si legge sulla pagina e che cosa finisce nei file — e per chi
          // usa uno screen reader il menù di sistema È l'applicazione. Senza queste
          // voci, chi non vede poteva esportare solo la combinazione che si era
          // trovato addosso.
          {
            label: mt('analysisLayers'),
            submenu: [
              {
                label: mt('showRoman'),
                type: 'checkbox',
                accelerator: 'CmdOrCtrl+Alt+R',
                checked: !!showRomanEnabled,
                click: (menuItem) => {
                  showRomanEnabled = !!menuItem.checked;
                  sendAction(MENU_ACTIONS.SET_SHOW_ROMAN, { enabled: showRomanEnabled });
                }
              },
              {
                label: mt('showSymbols'),
                type: 'checkbox',
                accelerator: 'CmdOrCtrl+Alt+S',
                checked: !!showSymbolsEnabled,
                click: (menuItem) => {
                  showSymbolsEnabled = !!menuItem.checked;
                  sendAction(MENU_ACTIONS.SET_SHOW_SYMBOLS, { enabled: showSymbolsEnabled });
                }
              },
              {
                label: mt('showFiguredBass'),
                type: 'checkbox',
                accelerator: 'CmdOrCtrl+Alt+F',
                checked: !!showFiguredBassEnabled,
                click: (menuItem) => {
                  showFiguredBassEnabled = !!menuItem.checked;
                  sendAction(MENU_ACTIONS.SET_SHOW_FIGURED_BASS, { enabled: showFiguredBassEnabled });
                }
              },
            ]
          },
          {
            label: mt('staves'),
            submenu: [
              {
                label: mt('staffChoir'),
                type: 'checkbox',
                accelerator: 'CmdOrCtrl+Alt+C',
                checked: !!satbVisibleEnabled,
                click: (menuItem) => {
                  satbVisibleEnabled = !!menuItem.checked;
                  sendAction(MENU_ACTIONS.SET_SATB_VISIBLE, { enabled: satbVisibleEnabled });
                }
              },
              // Le tracce si chiamano col LORO nome — «Chitarra», «Basso» — perché
              // è così che chi ascolta il menù sa quale sta spegnendo. L'elenco
              // arriva dal renderer e il menù si ricostruisce quando cambia.
              ...(accTracksState.length ? [{ type: 'separator' }] : []),
              ...accTracksState.map((t, i) => ({
                label: t.name || `Traccia ${i + 1}`,
                type: 'checkbox',
                checked: t.visible !== false,
                click: (menuItem) => {
                  sendAction(MENU_ACTIONS.SET_TRACK_VISIBLE, { trackId: t.id, enabled: !!menuItem.checked });
                }
              })),
            ]
          },
          { label: mt('exportFollowsView'), enabled: false },
          {
            label: mt('harmonyDebug'),
            type: 'checkbox',
            checked: !!showHarmonyDebugEnabled,
            click: (menuItem) => {
              showHarmonyDebugEnabled = !!menuItem.checked;
              sendAction(MENU_ACTIONS.SET_SHOW_HARMONY_DEBUG, { enabled: showHarmonyDebugEnabled });
            }
          },
          {
            label: mt('voiceColors'),
            type: 'checkbox',
            accelerator: 'Control+C',
            checked: !!showVoiceColorsEnabled,
            click: (menuItem) => {
              showVoiceColorsEnabled = !!menuItem.checked;
              sendAction(MENU_ACTIONS.SET_SHOW_VOICE_COLORS, { enabled: showVoiceColorsEnabled });
            }
          },
        ] : []),
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    }
    ,
    {
      label: mt('tools'),
      submenu: [
        {
          label: mt('generateChorale'),
          accelerator: 'CmdOrCtrl+Shift+G',
          click: () => { sendAction(MENU_ACTIONS.GENERATE_FROM_ROMAN); }
        },
        { type: 'separator' },
        // SOGGETTO DELL'ANALISI. Esisteva solo come pulsante «ACC» nella toolbar: tre
        // lettere in mezzo a decine di controlli, senza voce di menù e senza scorciatoia.
        // Chi usa uno screen reader esplora dai MENÙ (e su macOS li cerca per nome dal
        // menù Aiuto): senza questa voce il comando era di fatto irraggiungibile — e
        // senza di esso un brano strumentale importato non viene analizzato affatto.
        {
          label: mt('analyzeChoir', 'Analizza il coro (SATB)'),
          accelerator: 'CmdOrCtrl+Alt+1',
          click: () => { sendAction(MENU_ACTIONS.SET_ANALYSIS_SUBJECT, { subject: 'satb' }); }
        },
        {
          label: mt('analyzeTrack', "Analizza la traccia d'accompagnamento"),
          accelerator: 'CmdOrCtrl+Alt+2',
          click: () => { sendAction(MENU_ACTIONS.SET_ANALYSIS_SUBJECT, { subject: 'acc' }); }
        },
        // PANNELLO DELLE VIOLAZIONI. Si apriva SOLO con un clic su un pulsante della
        // barra: per chi naviga con uno screen reader un comando così non esiste. Il
        // pannello è testo — VoiceOver lo legge benissimo — ma bisognava poterci
        // arrivare. Da qui, e con una scorciatoia.
        {
          label: mt('toggleViolationsPanel', 'Elenco delle violazioni'),
          accelerator: 'CmdOrCtrl+Alt+3',
          click: () => { sendAction(MENU_ACTIONS.TOGGLE_VIOLATIONS_PANEL); }
        },
        { type: 'separator' },
        {
          label: mt('toggleAnalysisLock', 'Blocca/Sblocca analisi\u2026'),
          click: () => { sendAction(MENU_ACTIONS.TOGGLE_ANALYSIS_LOCK); }
        },
      ]
    }
    ,
    {
      role: 'help',
      label: mt('help'),
      submenu: [
        {
          label: mt('about'),
          click: () => showAboutDialog(),
        },
        { type: 'separator' },
        {
          label: `Build: ${DEV_BUILD_TAG}${isDev ? ' (dev)' : ''}`,
          enabled: false,
        },
        { type: 'separator' },
        {
          label: mt('shortcuts'),
          click: () => showShortcutsDialog(),
        },
        {
          label: mt('manual'),
          click: () => apriManuale(),
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

ipcMain.on(IPC_CHANNELS.ADD_RECENT, (event, filePath) => {
  touchRecentFile(filePath);
});

ipcMain.on(IPC_CHANNELS.SET_MENU_STATE, (_event, state) => {
  try {
    if (!state || typeof state !== 'object') return;

    if (typeof state.selectOnlyCurrentVoiceEnabled === 'boolean') {
      selectOnlyCurrentVoiceEnabled = state.selectOnlyCurrentVoiceEnabled;
    }
    if (typeof state.showMeasureNumbersEnabled === 'boolean') {
      showMeasureNumbersEnabled = state.showMeasureNumbersEnabled;
    }
    if (typeof state.showHarmonyDebugEnabled === 'boolean') {
      showHarmonyDebugEnabled = state.showHarmonyDebugEnabled;
    }
    if (typeof state.showVoiceColorsEnabled === 'boolean') {
      showVoiceColorsEnabled = state.showVoiceColorsEnabled;
    }
    if (typeof state.showQuickInsertBarEnabled === 'boolean') {
      showQuickInsertBarEnabled = state.showQuickInsertBarEnabled;
    }
    if (typeof state.showRomanEnabled === 'boolean') showRomanEnabled = state.showRomanEnabled;
    if (typeof state.showSymbolsEnabled === 'boolean') showSymbolsEnabled = state.showSymbolsEnabled;
    if (typeof state.showFiguredBassEnabled === 'boolean') showFiguredBassEnabled = state.showFiguredBassEnabled;
    if (typeof state.satbVisibleEnabled === 'boolean') satbVisibleEnabled = state.satbVisibleEnabled;
    if (Array.isArray(state.accTracks)) {
      accTracksState = state.accTracks
        .filter(t => t && typeof t.id === 'string')
        .map(t => ({ id: t.id, name: typeof t.name === 'string' ? t.name : '', visible: t.visible !== false }));
    }

    if (state.engravingMode === 'legacy' || state.engravingMode === 'enhanced') {
      engravingMode = state.engravingMode;
    }

    if (typeof state.language === 'string' && state.language.length > 0) {
      currentLanguage = state.language;
    }

    createMenu();
  } catch (err) {
    console.warn('set-menu-state failed:', err);
  }
});

// ── License Activation Dialog (loop until activated or cancelled) ──
// Pass extraMessage to show a specific reason (e.g. trial expired).
// If called with no arguments (e.g. from the menu), shows a neutral message.
//
// IMPORTANT (Windows fix): when this dialog runs BEFORE createWindow() — i.e.
// at startup after trial expiry — closing the transient input BrowserWindow
// would otherwise trigger `window-all-closed`, which on Windows quits the app
// before the activation HTTP request can complete. `isActivationFlowActive`
// flag below tells the listener to skip the auto-quit during this flow.
let isActivationFlowActive = false;
// Limited mode: trial expired, no valid license, user chose "Continua (funzioni limitate)".
// Editor + export + playback + revoice stay ON; analysis and auto-realization are OFF.
// NEVER set for in-trial, licensed, or grace-period users.
let gateLimited = false;

async function showLicenseActivationDialog(extraMessage, allowLimited = false) {
  const { shell } = require('electron');
  isActivationFlowActive = true;
  try {
  while (true) {
    const msg = extraMessage
      ? `${extraMessage}\n\nInserisci la tua chiave di licenza per continuare.`
      : 'Inserisci la tua chiave di licenza per attivare Harmony Tutor.';

    const result = await dialog.showMessageBox({
      type: 'info',
      title: 'Attivazione Licenza — Harmony Tutor',
      message: msg,
      detail: 'Se non hai ancora una licenza, puoi acquistarla su harmonytutor.it',
      buttons: ['Inserisci Chiave', 'Acquista Licenza', allowLimited ? 'Continua (funzioni limitate)' : 'Chiudi'],
      defaultId: 0,
      cancelId: 2,
    });

    if (result.response === 1) {
      // Open purchase page
      shell.openExternal('https://harmonytutor.lemonsqueezy.com/checkout/buy/a5930998-3037-4c81-9990-2ebe269c7911');
      continue; // loop back to ask for key
    }

    if (result.response === 2) {
      // allowLimited: continue into the app in limited mode; otherwise quit.
      return allowLimited ? { limited: true } : null;
    }

    // Ask for the license key via a simple prompt window
    const key = await showKeyInputDialog();
    if (!key) continue; // user cancelled key input

    // Try to activate
    const activation = await activateLicense(key.trim());
    if (activation.success) {
      await dialog.showMessageBox({
        type: 'info',
        title: 'Licenza Attivata',
        message: 'Licenza attivata con successo!',
        detail: activation.data.customerName
          ? `Benvenuto, ${activation.data.customerName}!`
          : 'Harmony Tutor è ora sbloccato.',
        buttons: ['OK'],
      });
      return activation.data;
    }

    // Activation failed — show explicit error dialog before looping
    await dialog.showMessageBox({
      type: 'error',
      title: 'Attivazione Fallita',
      message: 'Impossibile attivare la licenza.',
      detail: activation.error || 'Errore sconosciuto. Riprova o contatta il supporto.',
      buttons: ['Riprova', 'Annulla'],
      defaultId: 0,
      cancelId: 1,
    }).then(r => {
      if (r.response === 1) extraMessage = '__cancel__';
    });
    if (extraMessage === '__cancel__') return allowLimited ? { limited: true } : null;
    extraMessage = null;
  }
  } finally {
    isActivationFlowActive = false;
  }
}

async function showKeyInputDialog() {
  return new Promise((resolve) => {
    const { ipcMain } = require('electron');

    const inputWin = new BrowserWindow({
      width: 480,
      height: 220,
      resizable: false,
      minimizable: false,
      maximizable: false,
      alwaysOnTop: true,
      title: 'Inserisci Chiave di Licenza',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'licenseInputPreload.js'),
      },
    });

    const html = `<!DOCTYPE html>
<html><head><style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 20px; background: #1e1e2f; color: #e0e0e0; margin: 0; }
  h3 { margin: 0 0 12px; font-size: 14px; }
  input { width: 100%; padding: 8px; font-size: 13px; border: 1px solid #555; border-radius: 4px; background: #2a2a3d; color: #fff; box-sizing: border-box; }
  .btns { margin-top: 14px; display: flex; gap: 8px; justify-content: flex-end; }
  button { padding: 6px 18px; border: none; border-radius: 4px; cursor: pointer; font-size: 13px; }
  .ok { background: #4f8cff; color: #fff; } .ok:hover { background: #3a7ae8; }
  .cancel { background: #555; color: #ccc; } .cancel:hover { background: #666; }
</style></head><body>
  <h3>Inserisci la chiave di licenza</h3>
  <input id="key" placeholder="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX" autofocus />
  <div class="btns">
    <button class="cancel" onclick="cancel()">Annulla</button>
    <button class="ok" onclick="submit()">Attiva</button>
  </div>
  <script>
    function submit() {
      const v = document.getElementById('key').value.trim();
      if (!v) return;
      document.getElementById('key').disabled = true;
      document.querySelector('.ok').disabled = true;
      window.licenseAPI.submitKey(v);
    }
    function cancel() {
      window.licenseAPI.cancelKey();
    }
    document.getElementById('key').addEventListener('keydown', e => {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') cancel();
    });
  </script>
</body></html>`;

    let resolved = false;
    function done(key) {
      if (resolved) return;
      resolved = true;
      ipcMain.removeAllListeners('license-key-submitted');
      ipcMain.removeAllListeners('license-key-cancelled');
      if (!inputWin.isDestroyed()) inputWin.destroy();
      resolve(key || null);
    }

    ipcMain.once('license-key-submitted', (_e, key) => done(key));
    ipcMain.once('license-key-cancelled', () => done(null));
    inputWin.on('closed', () => done(null));

    inputWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    inputWin.setMenuBarVisibility(false);
  });
}

function createWindow() {
  const isDev = String(process.env.NODE_ENV || '').toLowerCase() === 'development';
  const titleSuffix = isDev ? ` (dev:${DEV_BUILD_TAG})` : '';
  mainWindow = new BrowserWindow({
    title: `${app.name}${titleSuffix}`,
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Ensure the title is set even when no project is open.
  setWindowTitleForPath(null);

  // Dev diagnostics: forward renderer console/errors to the terminal.
  if (isDev) {
    try {
      mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
        try {
          const lvl = Number(level);
          const tag = lvl >= 3 ? 'error' : (lvl === 2 ? 'warn' : 'log');
          const out = `[renderer:${tag}] ${message} (${sourceId || 'unknown'}:${line || 0})`;
          if (tag === 'error') safeStdioWrite(process.stderr, out);
          else safeStdioWrite(process.stdout, out);
        } catch {
          // ignore
        }
      });
    } catch {
      // ignore
    }

    try {
      mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
        console.error('[renderer] did-fail-load', { errorCode, errorDescription, validatedURL });
      });
    } catch {
      // ignore
    }

    try {
      mainWindow.webContents.on('render-process-gone', (_event, details) => {
        console.error('[renderer] render-process-gone', details);
      });
    } catch {
      // ignore
    }
  }

  // Diagnostics: show an unmistakable startup proof when requested.
  // Enable with: ELECTRON_SHOW_BUILD_TAG_DIALOG=1 npm run electron:dev
  if (isDev && SHOW_BUILD_TAG_DIALOG) {
    try {
      dialog.showMessageBox({
        type: 'info',
        title: 'Harmony Tutor (dev build)',
        message: `Build tag: ${DEV_BUILD_TAG}`,
        detail: `Main entry: ${__filename}\nNODE_ENV: ${String(process.env.NODE_ENV || '')}`,
      });
    } catch {
      // ignore
    }
  }

  const devServerUrl = process.env.ELECTRON_START_URL || 'http://127.0.0.1:5173';

  if (isDev) {
    mainWindow.loadURL(devServerUrl);
    // Do not auto-open DevTools on every launch.
    // Enable explicitly with: ELECTRON_OPEN_DEVTOOLS=1 npm run electron:dev
    const shouldOpenDevTools = String(process.env.ELECTRON_OPEN_DEVTOOLS || '') === '1';
    if (shouldOpenDevTools) {
      try { mainWindow.webContents.openDevTools(); } catch { /* ignore */ }
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  createMenu();

  // If we were launched by a file association before the window existed,
  // open it once the renderer is ready.
  try {
    if (pendingOpenFilePath) {
      const fp = pendingOpenFilePath;
      pendingOpenFilePath = null;
      sendOpenToRenderer(fp);
    }
  } catch { /* ignore */ }

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

// macOS: open-file is emitted when user double-clicks an associated file.
app.on('open-file', (event, filePath) => {
  try {
    event.preventDefault();
  } catch { /* ignore */ }

  if (!looksLikeProjectPath(filePath)) return;

  if (mainWindow) {
    sendOpenToRenderer(filePath);
  } else {
    pendingOpenFilePath = filePath;
  }
});

// Windows/Linux: ensure single instance; second-instance provides argv with file paths.
const shouldLockSingleInstance = getAppFlavor() === 'united';
if (shouldLockSingleInstance) {
  const gotTheLock = app.requestSingleInstanceLock();
  if (!gotTheLock) {
    try { app.quit(); } catch { /* ignore */ }
  } else {
    app.on('second-instance', (event, argv) => {
      try {
        const fp = extractProjectPathFromArgv(argv);
        if (!fp) return;
        if (mainWindow) {
          try {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
          } catch { /* ignore */ }
          sendOpenToRenderer(fp);
        } else {
          pendingOpenFilePath = fp;
        }
      } catch { /* ignore */ }
    });
  }
}

ipcMain.handle(IPC_CHANNELS.SAVE_FILE_DIALOG, async (event, content) => {
  if (!mainWindow) return { success: false, error: 'Finestra non disponibile' };

  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    filters: PROJECT_FILTERS,
    defaultPath: `project.${PROJECT_EXT}`,
  });

  if (canceled || !filePath) return { success: false, canceled: true, error: 'Salvataggio annullato' };

  try {
    const outPath = ensureProjectExtension(filePath);
    fs.writeFileSync(outPath, content);
    setWindowTitleForPath(outPath);
    return { success: true, filePath: outPath };
  } catch (err) {
    console.error("Errore scrittura file:", err);
    try { sendError('save-failed', String(err && err.message ? err.message : err)); } catch { /* ignore */ }
    return { success: false, error: err.message };
  }
});

ipcMain.handle(IPC_CHANNELS.SAVE_FILE, async (event, content, targetPath) => {
  if (!mainWindow) return { success: false, error: 'Finestra non disponibile' };

  try {
    if (targetPath && typeof targetPath === 'string') {
      fs.writeFileSync(targetPath, content);
      setWindowTitleForPath(targetPath);
      return { success: true, filePath: targetPath };
    }

    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      filters: PROJECT_FILTERS,
      defaultPath: `project.${PROJECT_EXT}`,
    });
    if (canceled || !filePath) return { success: false, canceled: true, error: 'Salvataggio annullato' };

    const outPath = ensureProjectExtension(filePath);
    fs.writeFileSync(outPath, content);
    setWindowTitleForPath(outPath);
    return { success: true, filePath: outPath };
  } catch (err) {
    console.error('Errore salvataggio file:', err);
    try { sendError('save-failed', String(err && err.message ? err.message : err)); } catch { /* ignore */ }
    return { success: false, error: err.message };
  }
});

ipcMain.handle(IPC_CHANNELS.SAVE_BINARY_FILE, async (event, base64, targetPath, filters) => {
  if (!mainWindow) return { success: false, error: 'Finestra non disponibile' };
  try {
    let outPath = (targetPath && typeof targetPath === 'string') ? targetPath : null;
    if (!outPath) {
      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        filters: Array.isArray(filters) && filters.length
          ? filters
          : [{ name: 'MIDI', extensions: ['mid'] }]
      });
      if (canceled || !filePath) return { success: false, canceled: true, error: 'Salvataggio annullato' };
      outPath = filePath;
    }

    const buf = Buffer.from(String(base64 || ''), 'base64');
    fs.writeFileSync(outPath, buf);
    return { success: true, filePath: outPath };
  } catch (err) {
    console.error('Errore salvataggio binario:', err);
    try { sendError('save-binary-failed', String(err && err.message ? err.message : err)); } catch { /* ignore */ }
    return { success: false, error: err.message };
  }
});

ipcMain.handle(IPC_CHANNELS.EXPORT_PDF_FROM_HTML, async (_event, html, options) => {
  if (!mainWindow) return { success: false, error: 'Finestra non disponibile' };
  let win = null;
  try {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      filters: EXPORT_PDF_FILTERS,
      defaultPath: 'export.pdf',
    });
    if (canceled || !filePath) return { success: false, canceled: true, error: 'Salvataggio annullato' };

    win = await createHiddenExportWindow();
    await loadHtmlInWindow(win, html);

    const pageSize = (options && (options.pageSize === 'A4' || options.pageSize === 'Letter')) ? options.pageSize : 'A4';
    const landscape = !!(options && options.landscape);
    const marginsType = (options && (options.marginsType === 0 || options.marginsType === 1 || options.marginsType === 2)) ? options.marginsType : 0;

    // Direct SVG→PDF path: measure content, resize the hidden window to match
    // the print area, then call printToPDF. This preserves vector quality.
    const size = await win.webContents.executeJavaScript(
      '({ w: Math.ceil(Math.max(document.documentElement.scrollWidth, document.body.scrollWidth, 0)), h: Math.ceil(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, 0)) })'
    );

    const contentW = Math.max(1, Math.round(size && size.w ? size.w : 1280));
    const contentH = Math.max(1, Math.round(size && size.h ? size.h : 900));

    // Size the hidden window to fit the content fully so nothing is clipped.
    // The window must be large enough for the full content to render natively.
    try {
      await win.setContentSize(
        Math.max(1280, Math.min(3000, contentW + 40)),
        Math.max(900, Math.min(12000, contentH + 40))
      );
    } catch { /* ignore */ }

    // Small delay so the resized window re-lays out before printing.
    await sleep(200);

    const pdf = await win.webContents.printToPDF({
      pageSize,
      landscape,
      marginsType,
      printBackground: true,
      scaleFactor: Math.max(45, Math.min(100, (options && options.scaleFactor) ? options.scaleFactor : 100)),
      preferCSSPageSize: true,
    });

    fs.writeFileSync(filePath, pdf);
    return { success: true, filePath };
  } catch (err) {
    console.error('[MAIN] export pdf failed:', err);
    try { sendError('export-pdf-failed', String(err && err.message ? err.message : err)); } catch { /* ignore */ }
    return { success: false, error: String(err && err.message ? err.message : err) };
  } finally {
    try { if (win && !win.isDestroyed()) win.close(); } catch { /* ignore */ }
  }
});

ipcMain.handle(IPC_CHANNELS.EXPORT_PNG_FROM_HTML, async (_event, html, options) => {
  if (!mainWindow) return { success: false, error: 'Finestra non disponibile' };
  let win = null;
  try {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      filters: EXPORT_PNG_FILTERS,
      defaultPath: 'export.png',
    });
    if (canceled || !filePath) return { success: false, canceled: true, error: 'Salvataggio annullato' };

    win = await createHiddenExportWindow();
    await loadHtmlInWindow(win, html);

    const scaleFactor = sanitizeZoomFactor(options && options.scaleFactor, 1);
    try {
      await win.webContents.setZoomFactor(scaleFactor);
    } catch { /* ignore */ }

    const tileMaxHeightPx = (() => {
      const raw = options && options.tileMaxHeightPx;
      const n = Number(raw);
      if (!Number.isFinite(n)) return 8000;
      return Math.max(800, Math.min(12000, Math.round(n)));
    })();

    // Measure scroll size.
    const size = await win.webContents.executeJavaScript(
      '({ w: Math.ceil(Math.max(document.documentElement.scrollWidth, document.body.scrollWidth, 0)), h: Math.ceil(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, 0)) })'
    );

    const contentW = Math.max(1, Math.round(size && size.w ? size.w : 1280));
    const contentH = Math.max(1, Math.round(size && size.h ? size.h : 900));

    // Resize viewport for better captures.
    try {
      await win.setContentSize(Math.min(2200, contentW), Math.min(tileMaxHeightPx, Math.max(900, Math.min(2000, contentH))));
    } catch { /* ignore */ }

    const tiles = Math.max(1, Math.ceil(contentH / tileMaxHeightPx));
    const outFiles = [];

    for (let i = 0; i < tiles; i++) {
      const y = i * tileMaxHeightPx;
      const h = Math.min(tileMaxHeightPx, contentH - y);

      // Scroll so the requested segment is in the viewport.
      try {
        await win.webContents.executeJavaScript(`window.scrollTo(0, ${y});`);
      } catch { /* ignore */ }
      await sleep(80);

      const image = await win.webContents.capturePage({ x: 0, y: 0, width: contentW, height: h });
      const png = image.toPNG();

      const outPath = (tiles === 1) ? filePath : numberedPath(filePath, i + 1);
      fs.writeFileSync(outPath, png);
      outFiles.push(outPath);
    }

    return { success: true, filePath, files: outFiles };
  } catch (err) {
    console.error('[MAIN] export png failed:', err);
    try { sendError('export-png-failed', String(err && err.message ? err.message : err)); } catch { /* ignore */ }
    return { success: false, error: String(err && err.message ? err.message : err) };
  } finally {
    try { if (win && !win.isDestroyed()) win.close(); } catch { /* ignore */ }
  }
});

ipcMain.handle(IPC_CHANNELS.EXPORT_MUSICXML, async (_event, xml) => {
  if (!mainWindow) return { success: false, error: 'Finestra non disponibile' };
  try {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      filters: [{ name: 'MusicXML', extensions: ['musicxml', 'xml'] }],
      defaultPath: 'export.musicxml',
    });
    if (canceled || !filePath) return { success: false, canceled: true, error: 'Salvataggio annullato' };
    fs.writeFileSync(filePath, String(xml || ''), 'utf-8');
    return { success: true, filePath };
  } catch (err) {
    console.error('[MAIN] export musicxml failed:', err);
    try { sendError('export-musicxml-failed', String(err && err.message ? err.message : err)); } catch { /* ignore */ }
    return { success: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle(IPC_CHANNELS.GUITAR_LIBRARY_LOAD, async () => {
  const filePath = getGuitarLibraryPath();
  if (!filePath) return defaultGuitarLibrary();
  try {
    if (!fs.existsSync(filePath)) return defaultGuitarLibrary();
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    const base = defaultGuitarLibrary();
    return {
      ...base,
      ...((parsed && typeof parsed === 'object') ? parsed : {}),
    };
  } catch (err) {
    console.warn('[MAIN] Failed to load guitar library:', err);
    return defaultGuitarLibrary();
  }
});

ipcMain.handle(IPC_CHANNELS.GUITAR_LIBRARY_SAVE, async (_event, library) => {
  const filePath = getGuitarLibraryPath();
  if (!filePath) return { success: false, error: 'userData non disponibile' };
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const base = defaultGuitarLibrary();
    const next = {
      ...base,
      ...((library && typeof library === 'object') ? library : {}),
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(filePath, JSON.stringify(next, null, 2), 'utf-8');
    return { success: true };
  } catch (err) {
    console.error('[MAIN] Failed to save guitar library:', err);
    return { success: false, error: String(err && err.message ? err.message : err) };
  }
});

// ── Trial info IPC ──
ipcMain.handle(IPC_CHANNELS.GET_TRIAL_INFO, async () => {
  try {
    return getTrialInfo();
  } catch {
    return { installed: false };
  }
});

// ── License IPC ──
ipcMain.handle(IPC_CHANNELS.ACTIVATE_LICENSE, async (_event, licenseKey) => {
  try {
    const res = await activateLicense(licenseKey);
    if (res && res.success) gateLimited = false; // a valid license lifts limited mode (no restart)
    return res;
  } catch (err) {
    return { success: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle(IPC_CHANNELS.DEACTIVATE_LICENSE, async () => {
  try {
    return await deactivateLicense();
  } catch (err) {
    return { success: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle(IPC_CHANNELS.GET_LICENSE_INFO, async () => {
  try {
    return getLicenseInfo();
  } catch {
    return { licensed: false };
  }
});

// Feature gate for the renderer. `limited` is true ONLY after trial expiry with no valid
// license, when the user chose "Continua (funzioni limitate)". Off for dev/trial/licensed/grace.
ipcMain.handle(IPC_CHANNELS.GET_FEATURE_GATE, async () => {
  // QA hook: in dev only, `HT_FORCE_LIMITED=1` forces limited mode to test the UI (never in production).
  const forced = !app.isPackaged && process.env.HT_FORCE_LIMITED === '1';
  return { limited: gateLimited || forced };
});

// Show the activation dialog from within the app (limited-mode banner button). On success the
// license lifts limited mode; the renderer then refreshes the gate.
ipcMain.handle(IPC_CHANNELS.SHOW_ACTIVATION_DIALOG, async () => {
  const r = await showLicenseActivationDialog(null, false);
  if (r && !r.limited) { gateLimited = false; return { activated: true }; }
  return { activated: false };
});
app.commandLine.appendSwitch('disable-background-timer-throttling')

// ── Audio nello STESSO processo dell'app ──
// Di norma Chromium tiene il motore audio in un processo separato ("audio service").
// Su macOS quel processo ogni tanto muore — tipicamente quando cambia il dispositivo
// d'uscita o quando due istanze dell'app si contendono la scheda — e NON viene
// ricreato: l'app resta muta anche riaprendo la finestra, e l'unico rimedio era
// riavviare la sessione. Diagnosi verificata sul campo: l'app viva con i processi di
// grafica, rete e finestra, e quello audio sparito.
// Tenendo l'audio dentro il processo principale il punto di rottura sparisce.
app.commandLine.appendSwitch('disable-features', 'AudioServiceOutOfProcess')
app.whenReady().then(async () => {
  // ── Trial / License gate (skip in dev mode) ──
  const isDev = !app.isPackaged;
  const trial = isDev ? { status: 'licensed' } : checkTrial();

  let licenseStatus = null; // will be set if trial expired

  if (trial.status === 'expired') {
    // Trial expired — check if user has a valid license
    licenseStatus = await checkLicense();

    if (licenseStatus.status === 'grace-expired') {
      // LICENSED user offline too long: activate or quit. Never demote a paying user to limited mode.
      const activationResult = await showLicenseActivationDialog(
        'Il periodo di grazia offline è scaduto. Connettiti a internet o inserisci una nuova licenza.',
        false
      );
      if (!activationResult) {
        app.quit();
        return;
      }
      licenseStatus = { status: 'licensed', customerName: activationResult.customerName };
    } else if (licenseStatus.status === 'no-license' || licenseStatus.status === 'invalid') {
      // Trial expired, never licensed: offer activation OR continue in LIMITED mode (no forced quit).
      const activationResult = await showLicenseActivationDialog(
        'Il periodo di prova di 10 giorni è terminato.',
        true
      );
      if (activationResult && !activationResult.limited) {
        licenseStatus = { status: 'licensed', customerName: activationResult.customerName };
      } else {
        gateLimited = true; // editor + export + playback + revoice ON; analysis/realization OFF
      }
    }
    // grace-period or licensed — proceed
  }

  if (trial.status === 'clock-tamper') {
    await dialog.showMessageBox({
      type: 'error',
      title: 'Errore di Sistema',
      message: 'Rilevata una modifica all\'orologio di sistema.',
      detail: 'Ripristina la data e l\'ora corrette per continuare.',
      buttons: ['OK'],
    });
    app.quit();
    return;
  }

  // trial.status === 'active' or 'licensed' — proceed normally.
  if (trial.status === 'active' && typeof trial.daysRemaining === 'number') {
    safeStdioWrite(process.stdout, `[Trial] ${trial.daysRemaining} giorni rimanenti`);
  }

  loadRecentFiles();
  createWindow();

  // Show trial/license banner in title bar
  if (mainWindow) {
    if (gateLimited) {
      mainWindow.setTitle(mainWindow.getTitle() + ' — Funzioni limitate (prova terminata)');
    } else if (licenseStatus && licenseStatus.status === 'licensed') {
      const name = licenseStatus.customerName ? ` — ${licenseStatus.customerName}` : ' — Licensed';
      mainWindow.setTitle(mainWindow.getTitle() + name);
    } else if (licenseStatus && licenseStatus.status === 'grace-period') {
      mainWindow.setTitle(mainWindow.getTitle() + ` — Offline (${licenseStatus.daysRemaining}gg)`);
    } else if (trial.status === 'active') {
      const suffix = ` — Trial (${trial.daysRemaining} giorni rimanenti)`;
      mainWindow.setTitle(mainWindow.getTitle() + suffix);
    }
  }

  // If launched with a project path (Windows/Linux), open it.
  try {
    const fp = extractProjectPathFromArgv(process.argv);
    if (fp) {
      if (mainWindow) sendOpenToRenderer(fp);
      else pendingOpenFilePath = fp;
    }
  } catch { /* ignore */ }

  // ── Auto-update (production only) ──
  if (app.isPackaged) {
    autoUpdater.logger = require('electron-log');
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    /** Le novità per intero, in una finestra che SCORRE — al contrario del finestrino
     *  di sistema, che cresce e basta finché i pulsanti finiscono fuori schermo. */
    let novitaWindow = null;
    const mostraNovita = (versione, testo) => {
      try {
        if (novitaWindow && !novitaWindow.isDestroyed()) { novitaWindow.focus(); return; }
        const esc = (t) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const html = `<!DOCTYPE html><html lang="it"><head><meta charset="utf-8">
<title>Novità della versione ${esc(versione)}</title>
<style>
  :root { color-scheme: light dark; }
  html, body { margin: 0; height: 100%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; line-height: 1.55; }
  body { display: flex; flex-direction: column; background: #fafafa; color: #222; }
  @media (prefers-color-scheme: dark) { body { background: #1e1e1e; color: #ddd; } header, footer { background: #2a2a2a !important; border-color: #444 !important; } button { background: #3a3a3a !important; color: #ddd !important; border-color: #555 !important; } }
  header { padding: 12px 20px; background: #fff; border-bottom: 1px solid #e0e0e0; flex-shrink: 0; }
  header h1 { margin: 0; font-size: 15px; font-weight: 600; }
  main { flex: 1; overflow-y: auto; padding: 14px 20px 20px; white-space: pre-wrap; }
  footer { padding: 10px 20px; background: #fff; border-top: 1px solid #e0e0e0; text-align: right; flex-shrink: 0; }
  button { font-size: 13px; padding: 6px 16px; border-radius: 6px; border: 1px solid #ccc; background: #f5f5f5; cursor: pointer; }
</style></head><body>
<header><h1>Novità della versione ${esc(versione)}</h1></header>
<main>${esc(testo)}</main>
<footer><button onclick="window.close()" autofocus>Chiudi</button></footer>
</body></html>`;
        novitaWindow = new BrowserWindow({
          parent: mainWindow, modal: true, width: 720, height: 560,
          minWidth: 460, minHeight: 320, title: `Novità della versione ${versione}`,
          autoHideMenuBar: true,
          webPreferences: { nodeIntegration: false, contextIsolation: true },
        });
        novitaWindow.removeMenu();
        novitaWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
        novitaWindow.on('closed', () => { novitaWindow = null; });
      } catch (err) {
        console.warn('[MAIN] finestra novità non aperta:', err);
      }
    };

    autoUpdater.on('update-available', (info) => {
      safeStdioWrite(process.stdout, `[AutoUpdate] Update available: v${info.version}`);
      // Format release notes for display in the dialog.
      // electron-updater returns either a string (markdown/html) or an array of
      // { version, note } objects. Strip HTML tags and truncate for readability.
      const formatNotes = (rn) => {
        if (!rn) return '';
        let text = '';
        if (typeof rn === 'string') text = rn;
        else if (Array.isArray(rn)) text = rn.map(r => r?.note || '').filter(Boolean).join('\n\n');
        if (!text) return '';
        // Strip HTML tags and decode common entities
        text = text.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
        // Collapse excessive blank lines
        text = text.replace(/\n{3,}/g, '\n\n').trim();
        // Solo la versione che si sta installando. Il corpo della RELEASE su GitHub
        // contiene la sola sezione nuova (il CI la estrae), ma il canale
        // d'aggiornamento no: `releaseInfo.releaseNotesFile` in electron-builder.yml
        // ci infila RELEASE_NOTES.md PER INTERO, quindi qui arrivano anche tutte le
        // versioni passate. Si taglia alla seconda intestazione.
        const secondaSezione = text.indexOf('\n## ', text.indexOf('## ') + 1);
        if (secondaSezione > 0) text = text.slice(0, secondaSezione).trim();
        // Taglio di sicurezza. Il corpo della release contiene ORA la sola versione che
        // si sta installando (il CI estrae la sua sezione da RELEASE_NOTES.md), quindi
        // ci sta l'elenco completo — correzioni e import/export compresi. Prima il limite
        // era 1500 caratteri su un testo che conteneva TUTTE le versioni: si leggeva
        // l'inizio delle novità e il resto spariva.
        if (text.length > 6000) text = text.slice(0, 5997) + '...';
        return text;
      };
      const notes = formatNotes(info.releaseNotes);

      // QUANTO TESTO CI STA. Il finestrino di sistema NON scorre: cresce finché non
      // sfonda lo schermo, e i pulsanti finiscono sotto il bordo — cioè l'utente non
      // può nemmeno aggiornare. Si taglia quindi su misura dello schermo che c'è, e le
      // novità per intero si leggono nella finestra apposita (terzo pulsante).
      const righeCheCiStanno = () => {
        try {
          const { height } = screen.getPrimaryDisplay().workAreaSize;
          // ~18px per riga, meno lo spazio di titolo, messaggio, pulsanti e margini.
          return Math.max(6, Math.floor((height - 320) / 18));
        } catch { return 18; }
      };
      // Attenzione: contare gli A CAPO non basta — è l'errore che aveva questa
      // funzione. Le novità sono paragrafi lunghi che il dialogo manda a capo da
      // sé: una riga sola ne occupa cinque o sei sullo schermo, il conto diceva
      // «ci stanno» e la finestra debordava comunque, col pulsante fuori vista.
      // Qui si stima l'ingombro VERO, dividendo per la larghezza del dialogo.
      const CARATTERI_PER_RIGA = 60;
      const accorcia = (testo) => {
        const max = righeCheCiStanno();
        const righe = String(testo || '').split('\n');
        const tenute = [];
        let occupate = 0;
        for (const riga of righe) {
          const alta = Math.max(1, Math.ceil(riga.length / CARATTERI_PER_RIGA));
          if (occupate + alta > max) {
            return { testo: tenute.join('\n').trimEnd() + '\n…', tagliato: true };
          }
          tenute.push(riga);
          occupate += alta;
        }
        return { testo, tagliato: false };
      };

      const { testo: notesBrevi, tagliato } = accorcia(notes);
      const detail = notesBrevi
        ? `Novità in questa versione:\n\n${notesBrevi}\n\nVuoi scaricare e installare l'aggiornamento?`
        : 'Vuoi scaricare e installare l\'aggiornamento?';

      const bottoni = tagliato
        ? ['Aggiorna ora', 'Leggi tutte le novità…', 'Rimanda']
        : ['Aggiorna ora', 'Rimanda'];
      const iRimanda = tagliato ? 2 : 1;

      const chiedi = () => {
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'Aggiornamento disponibile',
          message: `È disponibile Harmony Tutor v${info.version}.`,
          detail,
          buttons: bottoni,
          defaultId: 0,
          cancelId: iRimanda,
        }).then(({ response }) => {
          if (response === 0) {
            // Notify renderer that download is starting
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('UPDATE_DOWNLOAD_PROGRESS', { percent: 0, status: 'downloading' });
            }
            autoUpdater.downloadUpdate();
            return;
          }
          // Le novità per intero, in una finestra che SCORRE; poi si torna a chiedere,
          // così la scelta non si perde per essere andati a leggere.
          if (tagliato && response === 1) {
            mostraNovita(info.version, notes);
            if (novitaWindow && !novitaWindow.isDestroyed()) {
              novitaWindow.once('closed', () => { try { chiedi(); } catch { /* ignore */ } });
            } else {
              chiedi();
            }
          }
        });
      };
      chiedi();
    });

    autoUpdater.on('download-progress', (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('UPDATE_DOWNLOAD_PROGRESS', {
          percent: Math.round(progress.percent),
          bytesPerSecond: progress.bytesPerSecond,
          transferred: progress.transferred,
          total: progress.total,
          status: 'downloading',
        });
      }
    });

    autoUpdater.on('update-downloaded', (info) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('UPDATE_DOWNLOAD_PROGRESS', { percent: 100, status: 'ready' });
      }
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Aggiornamento pronto',
        message: `Harmony Tutor v${info.version} è stato scaricato.`,
        detail: 'Riavviare ora per completare l\'installazione?',
        buttons: ['Riavvia ora', 'Alla prossima chiusura'],
        defaultId: 0,
        cancelId: 1,
      }).then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall();
      });
    });

    autoUpdater.on('error', (err) => {
      safeStdioWrite(process.stderr, `[AutoUpdate] Error: ${err.message}`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('UPDATE_DOWNLOAD_PROGRESS', { percent: 0, status: 'error', error: err.message });
      }
    });

    // Entitlement gate: a license can be frozen server-side (updatesEnabled=false),
    // in which case this install stops checking for updates. Default is enabled, so
    // this is a no-op for trial users and every license that isn't explicitly frozen.
    // We refresh the license first so a freeze flipped on the server takes effect at
    // the next online revalidation (≤7 days); failures fail-open (updates proceed).
    (async () => {
      try { await checkLicense(); } catch { /* ignore — fail open below */ }
      if (areUpdatesEnabled()) {
        autoUpdater.checkForUpdatesAndNotify();
      } else {
        safeStdioWrite(process.stdout, '[AutoUpdate] Skipped: updates disabled for this license.');
      }
    })();
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

/**
 * SCRIVI LE PREFERENZE SU DISCO PRIMA DI MORIRE.
 *
 * Le impostazioni dell'applicazione — disposizione della barra, opzioni dell'analisi,
 * lingua — stanno in `localStorage`, e Chromium lo tiene in MEMORIA: sul disco ci arriva
 * solo quando l'applicazione si chiude per bene, o quando lo si chiede.
 *
 * In sviluppo l'avvio manda SIGTERM a tutto il gruppo di processi per fermare Electron e
 * il server insieme: il processo muore prima di aver scritto, e alla riapertura tutte le
 * impostazioni della sessione sembrano non essere mai esistite. È il difetto per cui la
 * barra personalizzata «si azzerava» a ogni riavvio — e non era la barra: era tutto.
 *
 * Qui si forza la scrittura all'uscita, e ogni minuto: così anche una chiusura brutale
 * (o un blocco) costa al massimo l'ultimo minuto di impostazioni, non l'intera sessione.
 */
const scriviPreferenzeSuDisco = () => {
  try { session.defaultSession.flushStorageData(); } catch { /* niente sessione, niente da scrivere */ }
};
app.on('before-quit', scriviPreferenzeSuDisco);
app.on('window-all-closed', scriviPreferenzeSuDisco);

// SUI SEGNALI SI ASPETTA UN ISTANTE PRIMA DI USCIRE.
//
// `flushStorageData()` non scrive: METTE IN CODA la scrittura. Chiamarla e uscire subito
// non serve a niente — ed è esattamente ciò che succedeva, perché in sviluppo l'avvio
// ferma tutto con SIGTERM. Trecento millisecondi bastano a far atterrare il dato.
for (const segnale of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(segnale, () => {
    scriviPreferenzeSuDisco();
    setTimeout(() => app.quit(), 300);
  });
}

// E NON SI CONTA SULL'ULTIMO ISTANTE.
//
// Un'uscita ordinata non è garantita: in sviluppo il processo viene ucciso, e
// un'applicazione può sempre bloccarsi. Le impostazioni sono poche decine di byte:
// scriverle ogni cinque secondi non costa nulla e toglie di mezzo tutta la categoria di
// difetti «ho cambiato una cosa, ho riavviato, era sparita».
app.whenReady().then(() => { setInterval(scriviPreferenzeSuDisco, 5_000); });

app.on('window-all-closed', function () {
  // While the activation dialog runs BEFORE createWindow() (trial-expired path
  // at startup), the transient input BrowserWindow closes after submit. Without
  // this guard, on Windows app.quit() would fire and abort the activation HTTP
  // request, leaving the user with "nothing happens after clicking Attiva".
  if (isActivationFlowActive) return;
  if (process.platform !== 'darwin') app.quit();
});