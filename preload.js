const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rewind', {
  open: (address) => ipcRenderer.send('browser:address', address),
  back: () => ipcRenderer.send('browser:back'),
  forward: () => ipcRenderer.send('browser:forward'),
  onState(callback) {
    ipcRenderer.on('browser:state', (_event, state) => callback(state));
    ipcRenderer.send('browser:ready');
  },
});
