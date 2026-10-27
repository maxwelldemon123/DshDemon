const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('smallDemon', {
  drag: (dx, dy) => ipcRenderer.send('pet-drag', { dx, dy }),
  quit: () => ipcRenderer.send('pet-quit'),
});
