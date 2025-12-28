const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

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
          label: 'Nuovo Progetto',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow && mainWindow.webContents.send('menu-action', 'new')
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
            } catch (err) {
              console.error("Errore lettura file:", err);
              mainWindow.webContents.send('menu-error', 'open-failed', err.message);
            }
          }
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
        }
      ]
    },
    {
      label: 'Modifica',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'Vista',
      submenu: [
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // Disabilita la sandbox per caricare il preload locale
      preload: path.join(__dirname, 'preload.js')
    }
  });

  const isDev = true; // Forza la modalità di sviluppo per ora

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools(); // Apre la console per debug
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
    return { success: true, filePath };
  } catch (err) {
    console.error("Errore scrittura file:", err);
    return { success: false, error: err.message };
  }
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});