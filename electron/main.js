const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
let recentFiles = [];
let selectOnlyCurrentVoiceEnabled = false;
let showMeasureNumbersEnabled = true;

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

function setWindowTitleForPath(filePath) {
  try {
    if (!mainWindow) return;
    const base = filePath && typeof filePath === 'string' ? path.basename(filePath) : app.name;
    mainWindow.setTitle(`${base} — ${app.name}`);
  } catch (err) {
    console.warn('Impossibile impostare il titolo della finestra:', err);
  }
}

function createMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Recent',
          submenu: (recentFiles.length === 0) ? [ { label: 'Nessun file recente', enabled: false } ] : recentFiles.map(fp => ({
            label: fp,
            click: () => {
              if (!mainWindow) return;
              try {
                const data = fs.readFileSync(fp, 'utf-8');
                touchRecentFile(fp);
                mainWindow.webContents.send('menu-action', 'open', { data, filePath: fp });
                setWindowTitleForPath(fp);
              } catch (err) {
                console.error('Errore apertura file recente:', err);
              }
            }
          }))
        },
        {
          label: 'Nuovo Progetto',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('menu-action', 'new');
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
              filters: [{ name: 'Harmony Project', extensions: ['json'] }]
            });
            if (canceled || filePaths.length === 0) return;
            const filePath = filePaths[0];
            try {
              const data = fs.readFileSync(filePath, 'utf-8');
              mainWindow.webContents.send('menu-action', 'open', { data, filePath });
              setWindowTitleForPath(filePath);
            } catch (err) {
              console.error("Errore lettura file:", err);
              mainWindow.webContents.send('menu-error', 'open-failed', err.message);
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Stampa',
          accelerator: 'CmdOrCtrl+P',
          click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'print'); }
        },
        { type: 'separator' },
        {
          label: 'Salva',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow && mainWindow.webContents.send('menu-action', 'save')
        },
        {
          label: 'Salva con nome...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => mainWindow && mainWindow.webContents.send('menu-action', 'save-as')
        },
        { type: 'separator' },
        {
          label: 'Chiudi progetto',
          accelerator: 'CmdOrCtrl+W',
          click: () => {
            if (mainWindow) {
              console.log('[MAIN] Menu: Chiudi progetto cliccato (File menu)');
              mainWindow.webContents.send('menu-action', 'close-project');
              setWindowTitleForPath(null);
            }
          }
        }
      ]
    },
    {
      label: 'Modifica',
      submenu: [
        {
          label: 'Annulla',
          accelerator: 'CmdOrCtrl+Z',
          click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'undo'); }
        },
        {
          label: 'Ripeti',
          accelerator: 'Shift+CmdOrCtrl+Z',
          click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'redo'); }
        },
        { type: 'separator' },
        {
          label: 'Taglia',
          accelerator: 'CmdOrCtrl+X',
          click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'edit-command', { command: 'cut' }); }
        },
        {
          label: 'Copia',
          accelerator: 'CmdOrCtrl+C',
          click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'edit-command', { command: 'copy' }); }
        },
        {
          label: 'Incolla',
          accelerator: 'CmdOrCtrl+V',
          click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'edit-command', { command: 'paste' }); }
        },
        {
          label: 'Seleziona tutto',
          accelerator: 'CmdOrCtrl+A',
          click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'edit-command', { command: 'selectAll' }); }
        },
        { type: 'separator' },
        {
          label: 'Seleziona solo voce corrente (rettangolo)',
          type: 'checkbox',
          accelerator: 'Alt+S',
          checked: !!selectOnlyCurrentVoiceEnabled,
          click: (menuItem) => {
            selectOnlyCurrentVoiceEnabled = !!menuItem.checked;
            if (mainWindow) {
              mainWindow.webContents.send('menu-action', 'set-select-only-voice', { enabled: selectOnlyCurrentVoiceEnabled });
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Titolo',
          submenu: [
            {
              label: 'Serif',
              click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'set-title-font-family', { family: 'serif' }); }
            },
            {
              label: 'Sans-serif',
              click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'set-title-font-family', { family: 'sans-serif' }); }
            },
            {
              label: 'Monospace',
              click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'set-title-font-family', { family: 'monospace' }); }
            },
            { type: 'separator' },
            {
              label: 'Aumenta dimensione titolo',
              accelerator: 'CmdOrCtrl+]',
              click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'increase-title-font'); }
            },
            {
              label: 'Diminuisci dimensione titolo',
              accelerator: 'CmdOrCtrl+[',
              click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'decrease-title-font'); }
            }
          ]
        }
      ]
    },
    {
      label: 'Vista',
      submenu: [
        {
          label: 'Riordina toolbar (drag)…',
          click: () => { if (mainWindow) mainWindow.webContents.send('menu-action', 'toggle-toolbar-customize'); }
        },
        { type: 'separator' },
        {
          label: 'Numeri misure',
          type: 'checkbox',
          checked: !!showMeasureNumbersEnabled,
          click: (menuItem) => {
            showMeasureNumbersEnabled = !!menuItem.checked;
            if (mainWindow) mainWindow.webContents.send('menu-action', 'set-show-measure-numbers', { enabled: showMeasureNumbersEnabled });
          }
        },
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
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

ipcMain.on('add-recent', (event, filePath) => {
  touchRecentFile(filePath);
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  const isDev = true; // Forza la modalità di sviluppo per ora

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  createMenu();

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

ipcMain.handle('save-file-dialog', async (event, content) => {
  if (!mainWindow) return { success: false, error: 'Finestra non disponibile' };

  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    filters: [{ name: 'Harmony Project', extensions: ['json'] }]
  });

  if (canceled || !filePath) return { success: false, error: 'Salvataggio annullato' };

  try {
    fs.writeFileSync(filePath, content);
    setWindowTitleForPath(filePath);
    return { success: true, filePath };
  } catch (err) {
    console.error("Errore scrittura file:", err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('save-file', async (event, content, targetPath) => {
  if (!mainWindow) return { success: false, error: 'Finestra non disponibile' };

  try {
    if (targetPath && typeof targetPath === 'string') {
      fs.writeFileSync(targetPath, content);
      setWindowTitleForPath(targetPath);
      return { success: true, filePath: targetPath };
    }

    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      filters: [{ name: 'Harmony Project', extensions: ['json'] }]
    });
    if (canceled || !filePath) return { success: false, error: 'Salvataggio annullato' };

    fs.writeFileSync(filePath, content);
    setWindowTitleForPath(filePath);
    return { success: true, filePath };
  } catch (err) {
    console.error('Errore salvataggio file:', err);
    return { success: false, error: err.message };
  }
});

app.whenReady().then(() => {
  loadRecentFiles();
  createWindow();
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});