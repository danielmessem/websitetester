const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { runHomepageTest, DEVICES } = require('./test-engine');

(async () => {
  const cookieName = 'qa_cookie';
  const cookieValue = 'enabled';
  let seenCookie = false;
  const server = http.createServer((req, res) => {
    if ((req.headers.cookie || '').includes(`${cookieName}=${cookieValue}`)) seenCookie = true;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><html><head><title>Website Tester Smoke Test</title></head><body><h1>Smoke test page</h1><p>ok</p></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'website-tester-'));
  try {
    const result = await runHomepageTest({
      settings: { url: `http://127.0.0.1:${port}/`, cookieName, cookieValue },
      resultsDir,
      headless: true,
      pauseMs: 0,
      progress: message => console.log(`[smoke] ${message}`),
    });
    assert.equal(result.status, 'PASS');
    assert.equal(result.httpStatus, 200);
    assert.equal(result.title, 'Website Tester Smoke Test');
    assert.equal(result.screenshots.length, DEVICES.length);
    assert.ok(seenCookie, 'Configured cookie was not sent to the homepage');
    for (const shot of result.screenshots) {
      assert.ok(fs.existsSync(shot.path), `Missing screenshot: ${shot.device}`);
      assert.ok(fs.statSync(shot.path).size > 1000, `Screenshot too small: ${shot.device}`);
    }
    console.log('SMOKE TEST PASSED');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error('SMOKE TEST FAILED');
  console.error(error);
  process.exit(1);
});
