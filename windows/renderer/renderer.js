const $ = id => document.getElementById(id);
const status = $('status');
const progress = $('progress');

window.tester.onProgress(message => { progress.textContent = message; });

(async () => {
  const s = await window.tester.getSettings();
  $('url').value = s.url || '';
  $('schedule').value = s.schedule || '06:00';
  $('cookieName').value = s.cookieName || '';
  $('cookieValue').value = s.cookieValue || '';
  const r = await window.tester.latest();
  if (r) show(r);
})();

$('save').onclick = async () => {
  if (!$('url').value.trim()) return status.textContent = 'Enter a homepage URL.';
  await window.tester.saveSettings({
    url: $('url').value.trim(),
    schedule: $('schedule').value,
    cookieName: $('cookieName').value.trim(),
    cookieValue: $('cookieValue').value,
  });
  progress.textContent = 'Settings saved.';
};

$('run').onclick = async () => {
  status.textContent = '';
  progress.textContent = 'Starting tests...';
  $('run').disabled = true;
  try {
    await $('save').onclick();
    show(await window.tester.runTest());
  } catch (e) {
    status.className = 'fail';
    status.textContent = `Error: ${e.message}`;
  } finally {
    $('run').disabled = false;
  }
};

function show(r) {
  status.className = r.status === 'PASS' ? 'pass' : 'fail';
  status.textContent = `${r.status}\n${r.url}\n\nLinks checked: ${r.checked.length}\nFailures: ${r.failures.length}\n\n${r.failures.slice(0, 20).join('\n') || 'No issues found.'}`;
}
