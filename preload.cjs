const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('smallDemon', {
  // 命中检测：true = 光标在模型/按钮上，窗口接收鼠标；false = 整窗穿透到桌面
  hitTest: (interactive) => ipcRenderer.send('pet-hit', !!interactive),
  // 主进程每 ~30ms 轮询一次系统光标位置（穿透状态下事件转发不可靠）
  onCursor: (cb) => ipcRenderer.on('pet-cursor', (event, pos) => cb(pos)),
  // 拖动：取当前窗口位置；移动时由主进程用固定尺寸 setBounds
  getBounds: () => ipcRenderer.invoke('pet-bounds'),
  moveTo: (x, y) => ipcRenderer.send('pet-move', { x, y }),
  quit: () => ipcRenderer.send('pet-quit'),
});
