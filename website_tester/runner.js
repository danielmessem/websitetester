const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const CONFIG = '/data/options.json';
const RESULTS = '/config/results';
fs.mkdirSync(RESULTS, { recursive: true });

function cfg(name, fallback = '') {
  try {
    const data = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
    return data[name] ?? fallback;
  } catch {
    return fallback;
  }
}

const WEBSITE_URL = String(cfg('website_url', 'https://example.com')).trim();
const SCHEDULE = String(cfg('schedule', '06:00')).trim();
const TIMEZONE = String(cfg('timezone', 'Africa/Johannesburg')).trim();
const SCREENSHOT_MODE = ['all', 'failures', 'none'].includes(cfg('screenshot_mode', 'failures'))
  ? cfg('screenshot_mode', 'failures') : 'failures';
const TIMEOUT_MINUTES = Math.max(1, Number(cfg('timeout_minutes', 30)) || 30);

function log(message) {
  console.log(`[website-tester] ${message}`);
}

function isoNow() {
  return new Date().toISOString();
}

async function runTest() {
  const startedAt = isoNow();
  const stamp = startedAt.replace(/[:.]/g, '-');
  const runDir = path.join(RESULTS, stamp);
  fs.mkdirSync(runDir, { recursive: true });

  const result = {
    started_at: startedAt,
    ended_at: null,
    status: 'FAIL',
    website_url: WEBSITE_URL,
    timezone: TIMEZONE,
    http_status: null,
    final_url: null,
    page_title: null,
    h1_count: 0,
    visible_links: 0,
    visible_images: 0,
    broken_images: 0,
    console_errors: 0,
    failed_requests: 0,
    load_time_ms: null,
    screenshot: null,
    failure_reasons: [],
  };

  const consoleErrors = [];
  const failedRequests = [];
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    userAgent: 'WebsiteTester/0.1 HomeAssistant Playwright',
  });

  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('requestfailed', req => failedRequests.push({
    method: req.method(),
    url: req.url(),
    error: req.failure()?.errorText || 'unknown',
  }));

  const startedMs = Date.now();

  try {
    const response = await page.goto(WEBSITE_URL, {
      waitUntil: 'domcontentloaded',
      timeout: TIMEOUT_MINUTES * 60 * 1000,
    });

    result.http_status = response?.status() ?? null;
    result.final_url = page.url();
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    result.page_title = (await page.title()).trim();
    result.h1_count = await page.locator('h1:visible').count();
    result.visible_links = await page.locator('a[href]:visible').count();

    const images = await page.locator('img:visible').evaluateAll(imgs => imgs.map(img => ({
      src: img.currentSrc || img.src,
      width: img.naturalWidth,
      height: img.naturalHeight,
    })));
    result.visible_images = images.length;
    result.broken_images = images.filter(image => image.width === 0 || image.height === 0).length;

    result.load_time_ms = Date.now() - startedMs;
    result.console_errors = consoleErrors.length;
    result.failed_requests = failedRequests.length;

    if (!response) result.failure_reasons.push('No HTTP response');
    else if (response.status() >= 400) result.failure_reasons.push(`HTTP ${response.status()}`);
    if (!result.page_title) result.failure_reasons.push('Page title is empty');
    if (result.h1_count === 0) result.failure_reasons.push('No visible H1 found');
    if (result.visible_links === 0) result.failure_reasons.push('No visible links found');
    if (result.broken_images > 0) result.failure_reasons.push(`${result.broken_images} broken visible image(s)`);
    if (result.console_errors > 0) result.failure_reasons.push(`${result.console_errors} console error(s)`);
    if (result.failed_requests > 0) result.failure_reasons.push(`${result.failed_requests} failed network request(s)`);

    result.status = result.failure_reasons.length === 0 ? 'PASS' : 'FAIL';

    if (SCREENSHOT_MODE === 'all' || (SCREENSHOT_MODE === 'failures' && result.status === 'FAIL')) {
      result.screenshot = path.join(runDir, 'page.png');
      await page.screenshot({ path: result.screenshot, fullPage: true });
    }
  } catch (error) {
    result.failure_reasons.push(String(error).replace(/\s+/g, ' ').slice(0, 1000));
    if (SCREENSHOT_MODE !== 'none') {
      result.screenshot = path.join(runDir, 'page.png');
      await page.screenshot({ path: result.screenshot, fullPage: true }).catch(() => {});
    }
  } finally {
    result.ended_at = isoNow();
    await browser.close().catch(() => {});
  }

  const serializable = {
    ...result,
    screenshot: result.screenshot ? path.relative(runDir, result.screenshot) : null,
    console_errors: consoleErrors.slice(0, 50),
    failed_requests: failedRequests.slice(0, 50),
  };

  fs.writeFileSync(path.join(runDir, 'result.json'), JSON.stringify(serializable, null, 2));
  fs.writeFileSync(path.join(RESULTS, 'latest.json'), JSON.stringify(serializable, null, 2));

  log(`${result.status}: ${WEBSITE_URL} (${result.load_time_ms ?? 'n/a'} ms)`);
  if (result.failure_reasons.length) log(`Failures: ${result.failure_reasons.join(' | ')}`);

  return result.status === 'PASS';
}

function delayUntilNextRun() {
  const now = new Date();
  const [hourText, minuteText] = SCHEDULE.split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 60 * 60 * 1000;

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map(p => [p.type, p.value]));
  const localNow = new Date(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`);
  const target = new Date(localNow);
  target.setHours(hour, minute, 0, 0);
  if (target <= localNow) target.setDate(target.getDate() + 1);
  return Math.max(1000, target - localNow);
}

async function main() {
  log(`Configured URL: ${WEBSITE_URL}`);
  log(`Schedule: ${SCHEDULE} (${TIMEZONE})`);
  log('Send "run" on stdin for an immediate test.');

  let timer;
  const scheduleNext = () => {
    const delay = delayUntilNextRun();
    log(`Next run in ${Math.round(delay / 1000)} seconds`);
    clearTimeout(timer);
    timer = setTimeout(async () => {
      await runTest().catch(error => log(`Unhandled test error: ${error.message}`));
      scheduleNext();
    }, delay);
  };

  scheduleNext();

  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', async chunk => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const command = line.trim().toLowerCase();
      if (['run', 'test', 'check'].includes(command)) await runTest().catch(error => log(`Unhandled test error: ${error.message}`));
      if (command === 'status') {
        const latest = path.join(RESULTS, 'latest.json');
        console.log(fs.existsSync(latest) ? fs.readFileSync(latest, 'utf8') : JSON.stringify({ status: 'NO_RUN' }));
      }
    }
  });

  await new Promise(() => {});
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
