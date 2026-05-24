const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const { checkTrial, getTrialInfo } = require('./licensing/trialManager');
const { activateLicense, checkLicense, deactivateLicense, getLicenseInfo } = require('./licensing/licenseManager');

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
      exportMidi: 'Esporta MIDI...', exportXml: 'Esporta MusicXML…',
      exportPdf: 'Esporta PDF…', exportPng: 'Esporta PNG…',
      print: 'Stampa', save: 'Salva', saveAs: 'Salva con nome...',
      closeProject: 'Chiudi progetto', undo: 'Annulla', redo: 'Ripeti',
      cut: 'Taglia', copy: 'Copia', paste: 'Incolla', selectAll: 'Seleziona tutto',
      selectVoice: 'Seleziona solo voce corrente (rettangolo)',
      titleFont: 'Titolo', serif: 'Serif', sansSerif: 'Sans-serif', mono: 'Monospace',
      titleIncrease: 'Aumenta dimensione titolo', titleDecrease: 'Diminuisci dimensione titolo',
      scales: 'Scale', chords: 'Accordi', intervals: 'Intervalli', editor: 'Editor',
      grandStaff: 'Grand Staff', engravingMode: 'Modalità incisione',
      reorderToolbar: 'Riordina toolbar (drag)…', transport: 'Transport (toolbar chiusa)',
      measureNumbers: 'Numeri misure', harmonyDebug: 'Debug harmony labels (pcs)',
      voiceColors: 'Colori voci (BTAS)',
      generateChorale: 'Genera corale da Roman Numerals…',
      shortcuts: 'Scorciatoie…', noRecent: 'Nessun file recente',
      collisionEnhanced: 'Verifica collisioni (Enhanced)…', collisionLegacy: 'Verifica collisioni (Legacy)…',
      manageLicense: 'Gestisci Licenza…',
      about: 'Informazioni su Harmony Tutor…',
    },
    en: {
      file: 'File', edit: 'Edit', view: 'View', tools: 'Tools', help: 'Help',
      preferences: 'Preferences…', newProject: 'New Project', open: 'Open...',
      importMidi: 'Import MIDI...', importXml: 'Import MusicXML...',
      exportMidi: 'Export MIDI...', exportXml: 'Export MusicXML…',
      exportPdf: 'Export PDF…', exportPng: 'Export PNG…',
      print: 'Print', save: 'Save', saveAs: 'Save As...',
      closeProject: 'Close project', undo: 'Undo', redo: 'Redo',
      cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select All',
      selectVoice: 'Select only current voice (marquee)',
      titleFont: 'Title', serif: 'Serif', sansSerif: 'Sans-serif', mono: 'Monospace',
      titleIncrease: 'Increase title size', titleDecrease: 'Decrease title size',
      scales: 'Scales', chords: 'Chords', intervals: 'Intervals', editor: 'Editor',
      grandStaff: 'Grand Staff', engravingMode: 'Engraving mode',
      reorderToolbar: 'Reorder toolbar (drag)…', transport: 'Transport (closed toolbar)',
      measureNumbers: 'Measure numbers', harmonyDebug: 'Debug harmony labels (pcs)',
      voiceColors: 'Voice colors (BTAS)',
      generateChorale: 'Generate chorale from Roman Numerals…',
      shortcuts: 'Shortcuts…', noRecent: 'No recent files',
      collisionEnhanced: 'Check collisions (Enhanced)…', collisionLegacy: 'Check collisions (Legacy)…',
      manageLicense: 'Manage License…',
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
      const sections = [
        { title: `MENU (${app.name})`, items: [
          'Cmd/Ctrl+N — Nuovo progetto',
          'Cmd/Ctrl+O — Apri…',
          'Cmd/Ctrl+I — Importa MIDI…',
          'Cmd/Ctrl+Shift+E — Esporta MIDI…',
          'Cmd/Ctrl+Shift+P — Esporta PDF…',
          'Cmd/Ctrl+Shift+G — Esporta PNG…',
          'Cmd/Ctrl+P — Stampa',
          'Cmd/Ctrl+S — Salva',
          'Cmd/Ctrl+Shift+S — Salva con nome…',
          'Cmd/Ctrl+W — Chiudi progetto',
          'Cmd/Ctrl+Z — Annulla   |   Shift+Cmd/Ctrl+Z — Ripeti',
          'Cmd/Ctrl+X — Taglia   |   Cmd/Ctrl+C — Copia   |   Cmd/Ctrl+V — Incolla   |   Cmd/Ctrl+A — Seleziona tutto',
          'Alt/Option+S — Seleziona solo voce corrente (rettangolo)',
          'Ctrl/Control+C — Colori voci (BTAS)',
          'Cmd/Ctrl+] — Aumenta dimensione titolo   |   Cmd/Ctrl+[ — Diminuisci dimensione titolo',
        ]},
        { title: 'GRAND STAFF (Editor)', items: [
          'Alt/Option+L — Cicla layout righi (grandstaff ↔ SATB antiche ↔ treble-only)',
          'Alt/Option+T — Mostra/nascondi toolbar',
          'Space — Play/stop',
          'ArrowLeft/ArrowRight — Sposta playhead (Shift = passo più fine)',
          'Enter — Torna a inizio (senza suonare)',
          'K — Toggle metronomo',
          'V — Cicla voce selezionata (B→T→A→S)',
          'T — Toggle legatura (note selezionate)',
          '1..7 — Durate (semibreve…semibiscroma)',
          'R — Toggle inserimento nota/pausa',
          '. — Toggle punto (accetta anche ">" su alcune tastiere)',
          'b / n / # — Accidentali (bemolle / bequadro / diesis)',
          'ArrowUp/ArrowDown — Trasponi (1 semitono)   |   Shift+ArrowUp/Down — (1 ottava)',
          'Backspace/Delete — Cancella selezione',
          'Cmd/Ctrl+C — Copia note selezionate   |   Cmd/Ctrl+V — Incolla',
        ]},
        { title: 'ALTRE VISTE', items: [
          'Scale: Cmd/Ctrl+Z undo; Backspace/Delete rimuovi box; Arrow + numeri per muovere/selezionare shape',
          'Accordi: ArrowLeft/Right voicing prev/next; ArrowUp/Down cambia set corde (se presente)',
          'Intervalli: Cmd/Ctrl+Z undo',
        ]},
        { title: 'MARCATURA ORNAMENTALE (nota selezionata)', items: [
          '⌥P — Nota di passaggio',
          '⌥A — Appoggiatura',
          '⌥V — Nota di volta',
          '⌥N — Anticipazione',
          '⌥S — Nota di sfuggita',
          '⌥R — Ritardo (sospensione)',
        ]},
        { title: 'FUNZIONI SENZA SCORCIATOIA DEDICATA (principali)', items: [
          'Vista: Scale / Accordi / Intervalli / Editor / Grand Staff (dal menu)',
          'Riordina toolbar (drag)…',
          'Numeri misure (toggle dal menu)',
          'Debug harmony labels (pcs) (toggle dal menu)',
        ]},
      ];
      const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const sectionsHtml = sections.map(sec =>
        `<section><h2>${escapeHtml(sec.title)}</h2><ul>${sec.items.map(it => `<li>${escapeHtml(it)}</li>`).join('')}</ul></section>`
      ).join('');
      const html = `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="utf-8">
<title>Scorciatoie da tastiera</title>
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
<header><h1>⌨️ Scorciatoie da tastiera e funzioni rapide</h1></header>
<main>${sectionsHtml}</main>
<footer><button id="closeBtn" autofocus>Chiudi (Esc)</button></footer>
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
        title: 'Scorciatoie',
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
  const showAboutDialog = () => {
    try {
      const version = app.getVersion();
      const name = app.getName();
      const detail = lng === 'en'
        ? `Version ${version}\n\nA desktop app for harmonic analysis — Grand Staff editor with figured bass, Roman numerals and voice leading.\n\n© 2026 Harmony Tutor\nhttps://harmonytutor.it`
        : `Versione ${version}\n\nApp desktop per l'analisi armonica — editor su pentagramma con basso continuo, numerali romani e condotta delle voci.\n\n© 2026 Harmony Tutor\nhttps://harmonytutor.it`;
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
          label: mt('exportMidi'),
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => { sendAction(MENU_ACTIONS.EXPORT_MIDI); }
        },
        {
          label: mt('exportXml'),
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

async function showLicenseActivationDialog(extraMessage) {
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
      buttons: ['Inserisci Chiave', 'Acquista Licenza', 'Chiudi'],
      defaultId: 0,
      cancelId: 2,
    });

    if (result.response === 1) {
      // Open purchase page
      shell.openExternal('https://harmonytutor.lemonsqueezy.com/checkout/buy/a5930998-3037-4c81-9990-2ebe269c7911');
      continue; // loop back to ask for key
    }

    if (result.response === 2) {
      return null; // user wants to quit
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
    if (extraMessage === '__cancel__') return null;
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
    return await activateLicense(licenseKey);
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
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.whenReady().then(async () => {
  // ── Trial / License gate (skip in dev mode) ──
  const isDev = !app.isPackaged;
  const trial = isDev ? { status: 'licensed' } : checkTrial();

  let licenseStatus = null; // will be set if trial expired

  if (trial.status === 'expired') {
    // Trial expired — check if user has a valid license
    licenseStatus = await checkLicense();

    if (licenseStatus.status === 'no-license' || licenseStatus.status === 'invalid' || licenseStatus.status === 'grace-expired') {
      // Show activation dialog
      const activationResult = await showLicenseActivationDialog(
        licenseStatus.status === 'grace-expired'
          ? 'Il periodo di grazia offline è scaduto. Connettiti a internet o inserisci una nuova licenza.'
          : 'Il periodo di prova di 10 giorni è terminato.'
      );
      if (!activationResult) {
        app.quit();
        return;
      }
      licenseStatus = { status: 'licensed', customerName: activationResult.customerName };
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
    if (licenseStatus && licenseStatus.status === 'licensed') {
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
        // Truncate if very long
        if (text.length > 1500) text = text.slice(0, 1497) + '...';
        return text;
      };
      const notes = formatNotes(info.releaseNotes);
      const detail = notes
        ? `Novità in questa versione:\n\n${notes}\n\nVuoi scaricare e installare l'aggiornamento?`
        : 'Vuoi scaricare e installare l\'aggiornamento?';
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Aggiornamento disponibile',
        message: `È disponibile Harmony Tutor v${info.version}.`,
        detail,
        buttons: ['Aggiorna ora', 'Rimanda'],
        defaultId: 0,
        cancelId: 1,
      }).then(({ response }) => {
        if (response === 0) {
          // Notify renderer that download is starting
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('UPDATE_DOWNLOAD_PROGRESS', { percent: 0, status: 'downloading' });
          }
          autoUpdater.downloadUpdate();
        }
      });
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

    autoUpdater.checkForUpdatesAndNotify();
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  // While the activation dialog runs BEFORE createWindow() (trial-expired path
  // at startup), the transient input BrowserWindow closes after submit. Without
  // this guard, on Windows app.quit() would fire and abort the activation HTTP
  // request, leaving the user with "nothing happens after clicking Attiva".
  if (isActivationFlowActive) return;
  if (process.platform !== 'darwin') app.quit();
});