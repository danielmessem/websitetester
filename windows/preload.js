const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('tester', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: s => ipcRenderer.invoke('settings:save', s),
  runTest: () => ipcRenderer.invoke('test:run'),
  latest: () => ipcRenderer.invoke('results:latest'),
  open: file => ipcRenderer.invoke('results:open', file),
  onProgress: callback => ipcRenderer.on('test:progress', (_, message) => callback(message)),
});
