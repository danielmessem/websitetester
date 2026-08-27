const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const DEVICES = [
  { name: 'Desktop', file: 'desktop.png', viewport: { width: 1440, height: 900 } },
  { name: 'Tablet', file: 'tablet.png', viewport: { width: 768, height: 1024 } },
  { name: 'Mobile', file: 'mobile.png', viewport: { width: 390, height: 844 } },
];

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function findExecutable(root) {
  if (!root || !fs.existsSync(root)) return null;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.toLowerCase() === 'chrome.exe') return full;
    }
  }
  return null;
}

function bundledBrowserPath() {
  const roots = [
    process.env.WEBSITE_TESTER_BROWSER_DIR,
    process.resourcesPath ? path.join(process.resourcesPath, 'browsers') : null,
    path.join(__dirname, 'browsers'),
  ].filter(Boolean);
  for (const root of roots) {
    const found = findExecutable(root);
    if (found) return found;
  }
  throw new Error('Bundled Chromium was not found. Reinstall Website Check.');
}

async function launchBrowser({ headless = false, progress = () => {} } = {}) {
  const executablePath = bundledBrowserPath();
  progress(`Using bundled Chromium: ${executablePath}`);
  return chromium.launch({ headless, executablePath, slowMo: headless ? 0 : 150 });
}

async function runHomepageTest({ settings, resultsDir, screenshotsDir = resultsDir, progress = () => {}, headless = false, pauseMs = 900 }) {
  if (!settings?.url) throw new Error('Set the homepage URL first.');
  let homepage;
  try { homepage = new URL(settings.url); }
  catch { throw new Error('Homepage URL is not valid. Include https://'); }

  const start = new Date();
  const stamp = start.toISOString().replace(/[:.]/g, '-');
  const resultDir = path.join(resultsDir, stamp);
  const screenshotRunDir = path.join(screenshotsDir, stamp);
  fs.mkdirSync(resultDir, { recursive: true });
  fs.mkdirSync(screenshotRunDir, { recursive: true });

  const screenshots = [];
  const failures = [];
  let httpStatus = null;
  let title = '';
  let finalUrl = '';

  progress(headless ? 'Opening test browser...' : 'Opening visible browser...');
  const browser = await launchBrowser({ headless, progress });
  const context = await browser.newContext({ viewport: DEVICES[0].viewport });

  if (settings.cookieName) {
    await context.addCookies([{
      name: settings.cookieName,
      value: settings.cookieValue ?? '',
      url: homepage.origin,
    }]);
    progress(`Cookie set: ${settings.cookieName}`);
  }

  const page = await context.newPage();
  try {
    for (const device of DEVICES) {
      progress(`${device.name}: resizing browser to ${device.viewport.width}×${device.viewport.height}`);
      await page.setViewportSize(device.viewport);
      await page.bringToFront();
      progress(`${device.name}: loading homepage...`);
      const response = await page.goto(settings.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      if (pauseMs) await wait(pauseMs);

      httpStatus = response?.status() ?? null;
      finalUrl = page.url();
      title = (await page.title()).trim();
      if (!response || httpStatus >= 400) failures.push(`${device.name}: homepage returned HTTP ${httpStatus ?? 'no response'}`);
      if (!title) failures.push(`${device.name}: page title is empty`);

      const screenshotPath = path.join(screenshotRunDir, device.file);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      screenshots.push({ device: device.name, viewport: device.viewport, path: screenshotPath });
      progress(`${device.name}: screenshot saved.`);
      if (pauseMs) await wait(pauseMs);
    }
  } finally {
    progress('Homepage test complete. Closing browser...');
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
    resultsFolder: resultDir,
    screenshotsFolder: screenshotRunDir,
  };
  fs.writeFileSync(path.join(resultDir, 'result.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(resultsDir, 'latest.json'), JSON.stringify(result, null, 2));
  progress(`${result.status}: homepage loaded on ${DEVICES.length} device sizes.`);
  return result;
}

module.exports = { DEVICES, runHomepageTest, bundledBrowserPath };
