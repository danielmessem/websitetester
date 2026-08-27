const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { runHomepageTest } = require('./test-engine');

const rootDir = 'D:\\WebsiteTester';
const dataDir = path.join(rootDir, 'data');
const settingsFile = path.join(dataDir, 'settings.json');
const resultsDir = path.join(rootDir, 'results');
const screenshotsDir = path.join(rootDir, 'screenshots');

app.setPath('userData', dataDir);
for (const dir of [rootDir, dataDir, resultsDir, screenshotsDir]) fs.mkdirSync(dir, { recursive: true });

function loadSettings() {
  try { return JSON.parse(fs.readFileSync(settingsFile, 'utf8')); }
  catch { return { url: '', cookieName: '', cookieValue: '' }; }
}
function saveSettings(s) {
  fs.writeFileSync(settingsFile, JSON.stringify(s, null, 2));
}
function progress(message) {
  console.log(`[website-check] ${message}`);
  if (win && !win.isDestroyed()) win.webContents.send('test:progress', message);
}

async function runTest() {
  return runHomepageTest({
    settings: loadSettings(),
    resultsDir,
    screenshotsDir,
    progress,
    headless: false,
    pauseMs: 900,
  });
}

let win;
function createWindow() {
  win = new BrowserWindow({
    width: 900,
    height: 760,
    title: 'Website Check',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
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
ipcMain.handle('results:open-folder', (_, folder) => shell.openPath(folder || screenshotsDir));

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
