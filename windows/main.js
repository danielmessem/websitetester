const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { runHomepageTest } = require('./test-engine');

const dataDir = path.join(app.getPath('userData'), 'data');
const settingsFile = path.join(dataDir, 'settings.json');
const resultsDir = path.join(dataDir, 'results');
fs.mkdirSync(resultsDir, { recursive: true });

function loadSettings() {
  try { return JSON.parse(fs.readFileSync(settingsFile, 'utf8')); }
  catch { return { url: '', cookieName: '', cookieValue: '' }; }
}
function saveSettings(s) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify(s, null, 2));
}
function progress(message) {
  console.log(`[website-tester] ${message}`);
  if (win && !win.isDestroyed()) win.webContents.send('test:progress', message);
}

async function runTest() {
  return runHomepageTest({ settings: loadSettings(), resultsDir, progress, headless: false, pauseMs: 900 });
}

let win;
function createWindow() {
  win = new BrowserWindow({
    width: 900,
    height: 760,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

ipcMain.handle('settings:get', () => loadSettings());
ipcMain.handle('settings:save', (_, s) => { saveSettings(s); return loadSettings(); });
ipcMain.handle('test:run', () => runTest());
ipcMain.handle('results:latest', () => {
  try { return JSON.parse(fs.readFileSync(path.join(resultsDir, 'latest.json'), 'utf8')); }
  catch { return null; }
});
ipcMain.handle('results:open-folder', (_, folder) => shell.openPath(folder));

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
