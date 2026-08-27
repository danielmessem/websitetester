const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const DEVICES = [
  { name: 'Desktop', file: 'desktop.png', viewport: { width: 1440, height: 900 } },
  { name: 'Tablet', file: 'tablet.png', viewport: { width: 768, height: 1024 } },
  { name: 'Mobile', file: 'mobile.png', viewport: { width: 390, height: 844 } },
];

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function launchBrowser({ headless = false, progress = () => {} } = {}) {
  if (headless) return chromium.launch({ headless: true });
  try { return await chromium.launch({ headless: false, channel: 'msedge', slowMo: 150 }); }
  catch (edgeError) {
    progress('Microsoft Edge unavailable, trying Google Chrome.');
    try { return await chromium.launch({ headless: false, channel: 'chrome', slowMo: 150 }); }
    catch { throw new Error(`Could not start Microsoft Edge or Google Chrome. ${edgeError.message}`); }
  }
}

async function runHomepageTest({ settings, resultsDir, progress = () => {}, headless = false, pauseMs = 900 }) {
  if (!settings?.url) throw new Error('Set the homepage URL first.');
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

      const screenshotPath = path.join(dir, device.file);
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
    resultsFolder: dir,
  };
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(resultsDir, 'latest.json'), JSON.stringify(result, null, 2));
  progress(`${result.status}: homepage loaded on ${DEVICES.length} device sizes.`);
  return result;
}

module.exports = { DEVICES, runHomepageTest };
