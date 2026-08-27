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
  try { return JSON.parse(fs.readFileSync(settingsFile, 'utf8')); }
  catch { return { url: '', schedule: '06:00', cookieName: '', cookieValue: '' }; }
}
function saveSettings(s) { fs.writeFileSync(settingsFile, JSON.stringify(s, null, 2)); }
function progress(message) {
  console.log(`[website-tester] ${message}`);
  if (win && !win.isDestroyed()) win.webContents.send('test:progress', message);
}
function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function launchVisibleBrowser() {
  try { return await chromium.launch({ headless: false, channel: 'msedge', slowMo: 100 }); }
  catch (edgeError) {
    progress('Microsoft Edge was not available; trying Google Chrome.');
    try { return await chromium.launch({ headless: false, channel: 'chrome', slowMo: 100 }); }
    catch { throw new Error(`Could not start Microsoft Edge or Google Chrome. ${edgeError.message}`); }
  }
}

async function runTest() {
  const settings = loadSettings();
  if (!settings.url) throw new Error('Set the homepage URL first.');
  let homepage;
  try { homepage = new URL(settings.url); }
  catch { throw new Error('Homepage URL is not valid. Include https://'); }

  const start = new Date();
  const dir = path.join(resultsDir, start.toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  const failures = [];
  const checked = [];
  const failedRequests = [];

  progress('Opening visible browser...');
  const browser = await launchVisibleBrowser();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  if (settings.cookieName && settings.cookieValue) {
    await context.addCookies([{
      name: settings.cookieName,
      value: settings.cookieValue,
      url: homepage.origin,
    }]);
    progress(`Cookie set: ${settings.cookieName}`);
  }

  const page = await context.newPage();
  page.on('requestfailed', r => failedRequests.push({ url: r.url(), error: r.failure()?.errorText || 'failed' }));

  try {
    progress(`Opening homepage: ${settings.url}`);
    await page.bringToFront();
    const response = await page.goto(settings.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await wait(1000);

    const screenshot = path.join(dir, 'homepage.png');
    await page.screenshot({ path: screenshot, fullPage: true });
    progress('Homepage screenshot captured.');
    if (!response || response.status() >= 400) failures.push(`Homepage returned HTTP ${response?.status() ?? 'no response'}`);

    const candidates = await page.locator('a[href]').evaluateAll(els => els.map((a, i) => {
      const r = a.getBoundingClientRect();
      const imageAlt = a.querySelector('img')?.getAttribute('alt') || '';
      const text = (a.innerText || a.getAttribute('aria-label') || imageAlt || a.getAttribute('title') || '').trim();
      return {
        i,
        href: a.href,
        text: text.slice(0, 250),
        area: Math.round(r.width * r.height),
        visible: r.width > 0 && r.height > 0,
      };
    }).filter(x => x.visible && x.href && /^https?:/i.test(x.href)));

    const unique = new Map();
    for (const c of candidates) if (!unique.has(c.href)) unique.set(c.href, c);
    const links = [...unique.values()];
    progress(`Found ${links.length} unique visible homepage links/banners.`);

    let number = 0;
    for (const item of links) {
      number += 1;
      progress(`Checking ${number}/${links.length}: ${item.text || item.href}`);
      const check = await checkDestination(page, item);
      checked.push(check);
      if (!check.valid || !check.related) failures.push(`${item.text || item.href}: ${check.reason}`);
      await wait(500);
    }
  } finally {
    progress('Tests complete. Closing browser.');
    await browser.close().catch(() => {});
  }

  const result = {
    started: start.toISOString(),
    finished: new Date().toISOString(),
    url: settings.url,
    status: failures.length ? 'FAIL' : 'PASS',
    homepageScreenshot: path.join(dir, 'homepage.png'),
    cookieName: settings.cookieName || '',
    checked,
    failedRequests,
    failures,
  };
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(resultsDir, 'latest.json'), JSON.stringify(result, null, 2));
  progress(`${result.status}: ${checked.length} links checked, ${failures.length} issue(s).`);
  return result;
}

async function checkDestination(page, item) {
  try {
    await page.bringToFront();
    const response = await page.goto(item.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    const finalUrl = page.url();
    const title = (await page.title()).trim();
    const body = ((await page.locator('body').innerText().catch(() => '')) || '').slice(0, 8000);
    const status = response?.status() ?? 0;
    const valid = status >= 200 && status < 400 && !/404|not found|page unavailable|server error/i.test(`${title} ${body.slice(0, 1000)}`);

    const stopWords = new Set(['https','http','www','com','html','shop','more','click','here','learn','view','read']);
    const tokens = `${item.text} ${new URL(item.href).pathname}`.toLowerCase().split(/[^a-z0-9]+/)
      .filter(x => x.length > 3 && !stopWords.has(x));
    const haystack = `${title} ${finalUrl} ${body}`.toLowerCase();
    const matches = [...new Set(tokens)].filter(t => haystack.includes(t));
    const related = tokens.length === 0 ? true : matches.length > 0;
    const reason = !valid ? `Invalid destination (HTTP ${status})` : !related ? 'Destination does not appear related to the link/banner' : '';

    return { ...item, destination: finalUrl, status, title, valid, related, matchedTerms: matches, reason };
  } catch (e) {
    return { ...item, destination: null, status: 0, title: '', valid: false, related: false, matchedTerms: [], reason: e.message };
  }
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
ipcMain.handle('results:latest', () => { try { return JSON.parse(fs.readFileSync(path.join(resultsDir, 'latest.json'), 'utf8')); } catch { return null; } });
ipcMain.handle('results:open', (_, file) => shell.openPath(file));
app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
