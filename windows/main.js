const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

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
function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function launchVisibleBrowser() {
  try { return await chromium.launch({ headless: false, channel: 'msedge', slowMo: 150 }); }
  catch (edgeError) {
    progress('Microsoft Edge unavailable, trying Google Chrome.');
    try { return await chromium.launch({ headless: false, channel: 'chrome', slowMo: 150 }); }
    catch { throw new Error(`Could not start Microsoft Edge or Google Chrome. ${edgeError.message}`); }
  }
}

const DEVICES = [
  { name: 'Desktop', file: 'desktop.png', viewport: { width: 1440, height: 900 } },
  { name: 'Tablet', file: 'tablet.png', viewport: { width: 768, height: 1024 } },
  { name: 'Mobile', file: 'mobile.png', viewport: { width: 390, height: 844 } },
];

async function runTest() {
  const settings = loadSettings();
  if (!settings.url) throw new Error('Set the homepage URL first.');
  let homepage;
  try { homepage = new URL(settings.url); }
  catch { throw new Error('Homepage URL is not valid. Include https://'); }

  const start = new Date();
  const dir = path.join(resultsDir, start.toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  const screenshots = [];
  const failures = [];
  let httpStatus = null;
  let title = '';
  let finalUrl = '';

  progress('Opening visible browser...');
  const browser = await launchVisibleBrowser();
  const context = await browser.newContext({ viewport: DEVICES[0].viewport });

  if (settings.cookieName && settings.cookieValue) {
    await context.addCookies([{
      name: settings.cookieName,
      value: settings.cookieValue,
      url: homepage.origin,
    }]);
    progress(`Cookie set: ${settings.cookieName}`);
  }

  const page = await context.newPage();

  try {
    for (let i = 0; i < DEVICES.length; i++) {
      const device = DEVICES[i];
      progress(`${device.name}: resizing browser to ${device.viewport.width}×${device.viewport.height}`);
      await page.setViewportSize(device.viewport);
      await page.bringToFront();

      progress(`${device.name}: loading homepage...`);
      const response = await page.goto(settings.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await wait(1200);

      httpStatus = response?.status() ?? null;
      finalUrl = page.url();
      title = (await page.title()).trim();
      if (!response || httpStatus >= 400) failures.push(`${device.name}: homepage returned HTTP ${httpStatus ?? 'no response'}`);
      if (!title) failures.push(`${device.name}: page title is empty`);

      const screenshotPath = path.join(dir, device.file);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      screenshots.push({ device: device.name, viewport: device.viewport, path: screenshotPath });
      progress(`${device.name}: screenshot saved.`);
      await wait(900);
    }
  } finally {
    progress('Homepage test complete. Closing browser...');
    await wait(700);
    await browser.close().catch(() => {});
  }

  const result = {
    started: start.toISOString(),
    finished: new Date().toISOString(),
    url: settings.url,
    finalUrl,
    title,
    httpStatus,
    status: failures.length ? 'FAIL' : 'PASS',
    cookieName: settings.cookieName || '',
    screenshots,
    failures,
    resultsFolder: dir,
  };

  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(resultsDir, 'latest.json'), JSON.stringify(result, null, 2));
  progress(`${result.status}: homepage loaded on ${DEVICES.length} device sizes.`);
  return result;
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
