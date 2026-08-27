const $ = id => document.getElementById(id);
const status = $('status');
const progress = $('progress');
let latestResult = null;

window.tester.onProgress(message => { progress.textContent = message; });

(async () => {
  const s = await window.tester.getSettings();
  $('url').value = s.url || '';
  $('cookieName').value = s.cookieName || '';
  $('cookieValue').value = s.cookieValue || '';
  const r = await window.tester.latest();
  if (r) show(r);
})();

$('save').onclick = async () => {
  if (!$('url').value.trim()) {
    status.className = 'fail';
    status.textContent = 'Enter a homepage URL.';
    return false;
  }
  await window.tester.saveSettings({
    url: $('url').value.trim(),
    cookieName: $('cookieName').value.trim(),
    cookieValue: $('cookieValue').value,
  });
  progress.textContent = 'Settings saved.';
  return true;
};

$('run').onclick = async () => {
  status.textContent = '';
  progress.textContent = 'Starting visible homepage test...';
  $('run').disabled = true;
  $('openFolder').disabled = true;
  try {
    const saved = await $('save').onclick();
    if (!saved) return;
    show(await window.tester.runTest());
  } catch (e) {
    status.className = 'fail';
    status.textContent = `Error: ${e.message}`;
  } finally {
    $('run').disabled = false;
  }
};

$('openFolder').onclick = async () => {
  if (latestResult?.resultsFolder) await window.tester.openFolder(latestResult.resultsFolder);
};

function show(r) {
  latestResult = r;
  $('openFolder').disabled = !r.resultsFolder;
  status.className = r.status === 'PASS' ? 'pass' : 'fail';
  const shots = (r.screenshots || []).map(s => `• ${s.device}: ${s.viewport.width}×${s.viewport.height}`).join('\n');
  status.textContent = `${r.status}\n${r.url}\nHTTP: ${r.httpStatus ?? 'n/a'}\nTitle: ${r.title || '(empty)'}\n\nScreenshots saved:\n${shots || 'None'}\n\n${r.failures?.length ? r.failures.join('\n') : 'Homepage loaded successfully on all device sizes.'}`;
}
