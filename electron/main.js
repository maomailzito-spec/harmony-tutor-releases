const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { checkTrial, getTrialInfo } = require('./licensing/trialManager');

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
let showQuickInsertBarEnabled = true;
let engravingMode = 'enhanced';

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
  const showShortcutsDialog = () => {
    try {
      if (!mainWindow) return;
      const detail = [
        `MENU (${app.name})`,
        '• Cmd/Ctrl+N  Nuovo progetto',
        '• Cmd/Ctrl+O  Apri…',
        '• Cmd/Ctrl+I  Importa MIDI…',
        '• Cmd/Ctrl+Shift+E  Esporta MIDI…',
        '• Cmd/Ctrl+Shift+P  Esporta PDF…',
        '• Cmd/Ctrl+Shift+G  Esporta PNG…',
        '• Cmd/Ctrl+P  Stampa',
        '• Cmd/Ctrl+S  Salva',
        '• Cmd/Ctrl+Shift+S  Salva con nome…',
        '• Cmd/Ctrl+W  Chiudi progetto',
        '• Cmd/Ctrl+Z  Annulla   |   Shift+Cmd/Ctrl+Z  Ripeti',
        '• Cmd/Ctrl+X  Taglia   |   Cmd/Ctrl+C  Copia   |   Cmd/Ctrl+V  Incolla   |   Cmd/Ctrl+A  Seleziona tutto',
        '• Alt/Option+S  Seleziona solo voce corrente (rettangolo)',
        '• Ctrl/Control+C  Colori voci (BTAS)',
        '• Cmd/Ctrl+]  Aumenta dimensione titolo   |   Cmd/Ctrl+[  Diminuisci dimensione titolo',
        '',
        'GRAND STAFF (Editor)',
        '• Alt/Option+L  Cicla layout righi (grandstaff ↔ SATB antiche ↔ treble-only)',
        '• Alt/Option+T  Mostra/nascondi toolbar',
        '• Space  Play/stop',
        '• ArrowLeft/ArrowRight  Sposta playhead (Shift = passo più fine)',
        '• Enter  Torna a inizio (senza suonare)',
        '• K  Toggle metronomo',
        '• V  Cicla voce selezionata (B→T→A→S)',
        '• T  Toggle legatura (note selezionate)',
        '• 1..7  Durate (semibreve…semibiscroma)',
        '• R  Toggle inserimento nota/pausa',
        '• .  Toggle punto (accetta anche ">" su alcune tastiere)',
        '• b / n / #  Accidentali (bemolle / bequadro / diesis)',
        '• ArrowUp/ArrowDown  Trasponi (1 semitono)   |   Shift+ArrowUp/Down  (1 ottava)',
        '• Backspace/Delete  Cancella selezione',
        '• Cmd/Ctrl+C  Copia note selezionate   |   Cmd/Ctrl+V  Incolla',
        '',
        'ALTRE VISTE',
        '• Scale: Cmd/Ctrl+Z undo; Backspace/Delete rimuovi box; Arrow + numeri per muovere/selezionare shape',
        '• Accordi: ArrowLeft/Right voicing prev/next; ArrowUp/Down cambia set corde (se presente)',
        '• Intervalli: Cmd/Ctrl+Z undo',
        '',
        'MARCATURA ORNAMENTALE (nota selezionata)',
        '⌥P — Nota di passaggio',
        '⌥A — Appoggiatura',
        '⌥V — Nota di volta',
        '⌥N — Anticipazione',
        '⌥S — Nota di sfuggita',
        '⌥R — Ritardo (sospensione)',
        '',
        'FUNZIONI SENZA SCORCIATOIA DEDICATA (principali)',
        '• Vista: Scale / Accordi / Intervalli / Editor / Grand Staff (dal menu)',
        '• Riordina toolbar (drag)…',
        '• Numeri misure (toggle dal menu)',
        '• Debug harmony labels (pcs) (toggle dal menu)',
      ].join('\n');

      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Scorciatoie',
        message: 'Scorciatoie da tastiera e funzioni rapide',
        detail,
        buttons: ['OK'],
        defaultId: 0,
      });
    } catch (err) {
      console.warn('[MAIN] Failed to show shortcuts dialog:', err);
    }
  };
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Preferenze…',
          accelerator: 'CmdOrCtrl+,',
          click: () => { sendAction(MENU_ACTIONS.OPEN_PREFERENCES); }
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    {
      label: 'File',
      submenu: enableGrandStaff ? [
        {
          label: 'Recent',
          submenu: (recentFiles.length === 0) ? [ { label: 'Nessun file recente', enabled: false } ] : recentFiles.map(fp => ({
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
          label: 'Nuovo Progetto',
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
          label: 'Apri...',
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
          label: 'Importa MIDI...',
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
          label: 'Importa MusicXML...',
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
          label: 'Esporta MIDI...',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => { sendAction(MENU_ACTIONS.EXPORT_MIDI); }
        },
        {
          label: 'Esporta MusicXML…',
          click: () => { sendAction(MENU_ACTIONS.EXPORT_MUSICXML); }
        },
        {
          label: 'Esporta PDF…',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => { sendAction(MENU_ACTIONS.EXPORT_PDF); }
        },
        {
          label: 'Esporta PNG…',
          accelerator: 'CmdOrCtrl+Shift+G',
          click: () => { sendAction(MENU_ACTIONS.EXPORT_PNG); }
        },
        { type: 'separator' },
        {
          label: 'Stampa',
          accelerator: 'CmdOrCtrl+P',
          click: () => { sendAction(MENU_ACTIONS.PRINT); }
        },
        { type: 'separator' },
        {
          label: 'Salva',
          accelerator: 'CmdOrCtrl+S',
          click: () => sendAction(MENU_ACTIONS.SAVE)
        },
        {
          label: 'Salva con nome...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => sendAction(MENU_ACTIONS.SAVE_AS)
        },
        { type: 'separator' },
        {
          label: 'Chiudi progetto',
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
      label: 'Modifica',
      submenu: [
        {
          label: 'Annulla',
          accelerator: 'CmdOrCtrl+Z',
          click: () => { sendAction(MENU_ACTIONS.UNDO); }
        },
        {
          label: 'Ripeti',
          accelerator: 'Shift+CmdOrCtrl+Z',
          click: () => { sendAction(MENU_ACTIONS.REDO); }
        },
        { type: 'separator' },
        {
          label: 'Taglia',
          accelerator: 'CmdOrCtrl+X',
          click: () => { sendAction(MENU_ACTIONS.EDIT_COMMAND, { command: 'cut' }); }
        },
        {
          label: 'Copia',
          accelerator: 'CmdOrCtrl+C',
          click: () => { sendAction(MENU_ACTIONS.EDIT_COMMAND, { command: 'copy' }); }
        },
        {
          label: 'Incolla',
          accelerator: 'CmdOrCtrl+V',
          click: () => { sendAction(MENU_ACTIONS.EDIT_COMMAND, { command: 'paste' }); }
        },
        {
          label: 'Seleziona tutto',
          accelerator: 'CmdOrCtrl+A',
          click: () => { sendAction(MENU_ACTIONS.EDIT_COMMAND, { command: 'selectAll' }); }
        },
        { type: 'separator' },
        {
          label: 'Seleziona solo voce corrente (rettangolo)',
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
          label: 'Titolo',
          submenu: [
            {
              label: 'Serif',
              click: () => { sendAction(MENU_ACTIONS.SET_TITLE_FONT_FAMILY, { family: 'serif' }); }
            },
            {
              label: 'Sans-serif',
              click: () => { sendAction(MENU_ACTIONS.SET_TITLE_FONT_FAMILY, { family: 'sans-serif' }); }
            },
            {
              label: 'Monospace',
              click: () => { sendAction(MENU_ACTIONS.SET_TITLE_FONT_FAMILY, { family: 'monospace' }); }
            },
            { type: 'separator' },
            {
              label: 'Aumenta dimensione titolo',
              accelerator: 'CmdOrCtrl+]',
              click: () => { sendAction(MENU_ACTIONS.INCREASE_TITLE_FONT); }
            },
            {
              label: 'Diminuisci dimensione titolo',
              accelerator: 'CmdOrCtrl+[',
              click: () => { sendAction(MENU_ACTIONS.DECREASE_TITLE_FONT); }
            }
          ]
        }
      ]
    },
    {
      label: 'Vista',
      submenu: [
        {
          label: 'Preferenze…',
          accelerator: 'CmdOrCtrl+,',
          click: () => { sendAction(MENU_ACTIONS.OPEN_PREFERENCES); }
        },
        { type: 'separator' },
        ...(enableGuitar ? [
          {
            label: 'Scale',
            click: () => { sendAction(MENU_ACTIONS.SET_APP_MODE, { mode: 'scales' }); }
          },
          {
            label: 'Accordi',
            click: () => { sendAction(MENU_ACTIONS.SET_APP_MODE, { mode: 'chords' }); }
          },
          {
            label: 'Intervalli',
            click: () => { sendAction(MENU_ACTIONS.SET_APP_MODE, { mode: 'intervals' }); }
          },
          {
            label: 'Editor',
            click: () => { sendAction(MENU_ACTIONS.SET_APP_MODE, { mode: 'editor' }); }
          },
        ] : []),
        ...(enableGrandStaff ? [
          {
            label: 'Grand Staff',
            click: () => { sendAction(MENU_ACTIONS.SET_APP_MODE, { mode: 'grandStaff' }); }
          },
          { type: 'separator' },
          {
            label: 'Modalità incisione',
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
                label: 'Verifica collisioni (Enhanced)…',
                click: () => { sendAction(MENU_ACTIONS.RUN_OVERLAP_AUDIT, { mode: 'enhanced' }); }
              },
              {
                label: 'Verifica collisioni (Legacy)…',
                click: () => { sendAction(MENU_ACTIONS.RUN_OVERLAP_AUDIT, { mode: 'legacy' }); }
              }
            ]
          },
        ] : []),
        {
          label: 'Riordina toolbar (drag)…',
          click: () => { sendAction(MENU_ACTIONS.TOGGLE_TOOLBAR_CUSTOMIZE); }
        },
        ...(enableGrandStaff ? [
          {
            label: 'Transport (toolbar chiusa)',
            type: 'checkbox',
            checked: !!showQuickInsertBarEnabled,
            click: (menuItem) => {
              showQuickInsertBarEnabled = !!menuItem.checked;
              sendAction(MENU_ACTIONS.SET_QUICK_INSERT_BAR, { enabled: showQuickInsertBarEnabled });
            }
          },
          { type: 'separator' },
          {
            label: 'Numeri misure',
            type: 'checkbox',
            checked: !!showMeasureNumbersEnabled,
            click: (menuItem) => {
              showMeasureNumbersEnabled = !!menuItem.checked;
              sendAction(MENU_ACTIONS.SET_SHOW_MEASURE_NUMBERS, { enabled: showMeasureNumbersEnabled });
            }
          },
          {
            label: 'Debug harmony labels (pcs)',
            type: 'checkbox',
            checked: !!showHarmonyDebugEnabled,
            click: (menuItem) => {
              showHarmonyDebugEnabled = !!menuItem.checked;
              sendAction(MENU_ACTIONS.SET_SHOW_HARMONY_DEBUG, { enabled: showHarmonyDebugEnabled });
            }
          },
          {
            label: 'Colori voci (BTAS)',
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
      label: 'Strumenti',
      submenu: [
        {
          label: 'Genera corale da Roman Numerals…',
          accelerator: 'CmdOrCtrl+Shift+G',
          click: () => { sendAction(MENU_ACTIONS.GENERATE_FROM_ROMAN); }
        },
      ]
    }
    ,
    {
      role: 'help',
      label: 'Aiuto',
      submenu: [
        {
          label: `Build: ${DEV_BUILD_TAG}${isDev ? ' (dev)' : ''}`,
          enabled: false,
        },
        { type: 'separator' },
        {
          label: 'Scorciatoie…',
          click: () => showShortcutsDialog(),
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

    if (state.engravingMode === 'legacy' || state.engravingMode === 'enhanced') {
      engravingMode = state.engravingMode;
    }

    createMenu();
  } catch (err) {
    console.warn('set-menu-state failed:', err);
  }
});

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

app.whenReady().then(async () => {
  // ── Trial / License gate ──
  const trial = checkTrial();

  if (trial.status === 'expired') {
    await dialog.showMessageBox({
      type: 'warning',
      title: 'Trial Scaduto',
      message: 'Il periodo di prova di 10 giorni è terminato.',
      detail: 'Per continuare a usare Harmony Tutor, acquista una licenza su harmonytutor.com.',
      buttons: ['Acquista Licenza', 'Chiudi'],
      defaultId: 0,
    }).then((result) => {
      if (result.response === 0) {
        require('electron').shell.openExternal('https://harmonytutor.com/buy');
      }
    });
    app.quit();
    return;
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

  // Show trial banner in title bar
  if (trial.status === 'active' && mainWindow) {
    const suffix = ` — Trial (${trial.daysRemaining} giorni rimanenti)`;
    const currentTitle = mainWindow.getTitle();
    mainWindow.setTitle(currentTitle + suffix);
  }

  // If launched with a project path (Windows/Linux), open it.
  try {
    const fp = extractProjectPathFromArgv(process.argv);
    if (fp) {
      if (mainWindow) sendOpenToRenderer(fp);
      else pendingOpenFilePath = fp;
    }
  } catch { /* ignore */ }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});