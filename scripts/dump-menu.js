'use strict';
/**
 * STAMPA IL MENÙ DELL'APPLICAZIONE senza aprire l'applicazione.
 *
 *   npm run menu:dump              → tutti i menù
 *   npm run menu:dump -- Vista     → solo quelli il cui nome contiene «Vista»
 *   APP_FLAVOR=grandstaff npm run menu:dump
 *
 * PERCHÉ ESISTE. Il menù si costruisce nel processo PRINCIPALE, che parte una volta
 * sola: `npm run electron:dev` non sorveglia `electron/main.js`, e ricaricare la
 * finestra (⌘R) ricarica solo la pagina. Quindi una voce nuova può essere scritta
 * giusta e non comparire, e non c'è modo di distinguere «il codice è sbagliato» da
 * «sto guardando un processo vecchio» — se non chiedendolo al codice.
 *
 * COME. `main.js` viene eseguito in un contenitore con Electron finto: `buildFromTemplate`
 * non costruisce niente, si limita a tenersi il modello, e noi lo stampiamo. Niente
 * finestre, niente app da chiudere.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'electron', 'main.js');
const filtro = (process.argv[2] || '').toLowerCase();

let template = null;
const noop = () => {};

const electron = {
  app: {
    getVersion: () => '0.0.0-dump', getName: () => 'Harmony Tutor', getPath: () => '/tmp',
    getAppPath: () => ROOT, setPath: noop, getLocale: () => 'it', addRecentDocument: noop,
    setAsDefaultProtocolClient: noop, dock: { setMenu: noop },
    // La promessa non si risolve MAI: così `main.js` definisce tutto senza aprire finestre.
    whenReady: () => new Promise(() => {}),
    on: noop, once: noop, setName: noop, requestSingleInstanceLock: () => true,
    quit: noop, isPackaged: false, setAboutPanelOptions: noop,
    commandLine: { appendSwitch: noop }, disableHardwareAcceleration: noop,
  },
  BrowserWindow: Object.assign(
    class { loadURL() {} on() {} },
    { getAllWindows: () => [], getFocusedWindow: () => null },
  ),
  Menu: {
    buildFromTemplate: (t) => { template = t; return { items: [] }; },
    setApplicationMenu: noop,
  },
  MenuItem: class {},
  ipcMain: { on: noop, handle: noop },
  dialog: {}, shell: {}, nativeTheme: { on: noop },
  protocol: { registerSchemesAsPrivileged: noop, handle: noop },
  session: { defaultSession: { webRequest: { onHeadersReceived: noop } } },
};

const caricaOriginale = Module._load;
Module._load = function (richiesta) {
  if (richiesta === 'electron') return electron;
  if (richiesta === 'electron-updater') return { autoUpdater: { on: noop, checkForUpdatesAndNotify: noop } };
  try { return caricaOriginale.apply(this, arguments); } catch { return {}; }
};

// `createMenu` è una funzione interna di main.js: si esporta appendendo una riga alla
// SORGENTE IN MEMORIA — il file su disco non si tocca.
const sorgente = fs.readFileSync(FILE, 'utf8')
  + '\n;globalThis.__createMenu = typeof createMenu === "function" ? createMenu : null;';

const modulo = new Module(FILE, null);
modulo.filename = FILE;
modulo.paths = Module._nodeModulePaths(path.dirname(FILE));
const involucro = vm.runInThisContext(Module.wrap(sorgente), { filename: FILE });
try {
  involucro.call(modulo.exports, modulo.exports, modulo.require.bind(modulo), modulo, FILE, path.dirname(FILE));
} catch (err) {
  console.error('main.js si è interrotto durante il caricamento:', err.message);
}

if (typeof globalThis.__createMenu !== 'function') {
  console.error('createMenu non trovata: il menù non si può ispezionare.');
  process.exit(1);
}
globalThis.__createMenu();
if (!template) {
  console.error('createMenu non ha costruito nessun modello.');
  process.exit(1);
}

const stampa = (voci, livello) => {
  for (const v of voci || []) {
    if (v.type === 'separator') { console.log('  '.repeat(livello) + '─────'); continue; }
    const scorciatoia = v.accelerator ? `   [${v.accelerator}]` : '';
    const spunta = v.type === 'checkbox' ? `   ${v.checked ? '☑' : '☐'}` : '';
    console.log('  '.repeat(livello) + (v.label || '(senza etichetta)') + scorciatoia + spunta);
    if (v.submenu) stampa(v.submenu, livello + 1);
  }
};

let trovati = 0;
for (const menu of template) {
  const nome = String(menu.label || '');
  if (filtro && !nome.toLowerCase().includes(filtro)) continue;
  trovati++;
  console.log(`\n${nome}`);
  stampa(menu.submenu, 1);
}
if (!trovati) console.error(`Nessun menù corrisponde a «${process.argv[2]}».`);
