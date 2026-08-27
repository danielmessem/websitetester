const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const dataDir = path.join(app.getPath('userData'), 'data');
fs.mkdirSync(dataDir, { recursive: true });
const settingsFile = path.join(dataDir, 'settings.json');
const resultsDir = path.join(dataDir, 'results');
fs.mkdirSync(resultsDir, { recursive: true });

function loadSettings() {
  try { return JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch { return { url: '', schedule: '06:00' }; }
}
function saveSettings(s) { fs.writeFileSync(settingsFile, JSON.stringify(s, null, 2)); }
function slug(s) { return s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase(); }

async function runTest() {
  const settings = loadSettings();
  if (!settings.url) throw new Error('Set the homepage URL first.');
  const start = new Date();
  const dir = path.join(resultsDir, `${start.toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const failures = [];
  const checked = [];
  const requests = [];
  page.on('requestfailed', r => requests.push({ url: r.url(), error: r.failure()?.errorText || 'failed' }));
  try {
    const response = await page.goto(settings.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(dir, 'homepage.png'), fullPage: true });
    if (!response || response.status() >= 400) failures.push(`Homepage returned HTTP ${response?.status() ?? 'no response'}`);

    const candidates = await page.locator('a[href]').evaluateAll(els => els.map((a, i) => {
      const r = a.getBoundingClientRect(); const text = (a.innerText || a.getAttribute('aria-label') || '').trim();
      return { i, href: a.href, text: text.slice(0, 250), area: Math.round(r.width * r.height), visible: r.width > 0 && r.height > 0 };
    }).filter(x => x.visible && x.href && /^https?:/i.test(x.href)));

    const unique = new Map();
    for (const c of candidates) if (!unique.has(c.href)) unique.set(c.href, c);
    for (const item of unique.values()) {
      const check = await checkDestination(browser, item, settings.url);
      checked.push(check);
      if (!check.valid || !check.related) failures.push(`${item.text || item.href}: ${check.reason}`);
    }
  } finally { await browser.close(); }
  const result = { started: start.toISOString(), finished: new Date().toISOString(), url: settings.url, status: failures.length ? 'FAIL' : 'PASS', homepageScreenshot: path.join(dir, 'homepage.png'), checked, failedRequests: requests, failures };
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(resultsDir, 'latest.json'), JSON.stringify(result, null, 2));
  return result;
}

async function checkDestination(browser, item, homepage) {
  const p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    const response = await p.goto(item.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await p.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    const title = (await p.title()).trim();
    const body = ((await p.locator('body').innerText().catch(() => '')) || '').slice(0, 5000);
    const status = response?.status() ?? 0;
    const valid = status >= 200 && status < 400 && !/error|not found|page unavailable/i.test(title);
    const tokens = `${item.text} ${item.href}`.toLowerCase().split(/[^a-z0-9]+/).filter(x => x.length > 3);
    const haystack = `${title} ${p.url()} ${body}`.toLowerCase();
    const matches = tokens.filter(t => haystack.includes(t));
    const related = !item.text || matches.length > 0 || new URL(item.href).hostname === new URL(homepage).hostname;
    const reason = !valid ? `Invalid destination (HTTP ${status})` : !related ? 'Destination could not be related to link text/URL' : '';
    await p.close();
    return { ...item, destination: p.url(), status, title, valid, related, reason };
  } catch (e) {
    await p.close();
    return { ...item, destination: null, status: 0, title: '', valid: false, related: false, reason: e.message };
  }
}

let win;
function createWindow() {
  win = new BrowserWindow({ width: 900, height: 700, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}
ipcMain.handle('settings:get', () => loadSettings());
ipcMain.handle('settings:save', (_, s) => { saveSettings(s); return loadSettings(); });
ipcMain.handle('test:run', () => runTest());
ipcMain.handle('results:latest', () => { try { return JSON.parse(fs.readFileSync(path.join(resultsDir, 'latest.json'), 'utf8')); } catch { return null; } });
ipcMain.handle('results:open', (_, file) => shell.openPath(file));
app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
