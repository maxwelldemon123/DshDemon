import { app, BrowserWindow, ipcMain, protocol, screen } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, appendFile } from 'node:fs/promises';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, 'renderer', 'pet');
// 模型统一放在 E:\dshwork\models\live2d 下，small-demon 只负责渲染
const MODELS = 'E:/dshwork/models/live2d';
const MODEL_DIR = '大肥鱼-B站';
const MODEL_FILE = '大肥鱼.model3.json';

app.setName('DshDemon');
app.setPath('userData', path.join(app.getPath('appData'), 'small-demon'));
protocol.registerSchemesAsPrivileged([
  { scheme: 'pet', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let win = null;
const WIN_W = 520;
const WIN_H = 760;
// 实际创建后的 DIP 尺寸（Electron 可能按 DPI 取整），拖动时固定用它，避免漂移变大
let winSize = { width: WIN_W, height: WIN_H };

// 解析 pet:// 请求：/models/ 走模型根目录，其余走渲染页根目录。
// 注意：不按 host 区分，页面和模型都放在 pet://app 下，避免跨源被拦。
function resolveRequest(requestUrl) {
  const u = new URL(requestUrl);
  let rel = decodeURIComponent(u.pathname);
  if (rel.startsWith('/models/')) {
    return path.join(MODELS, rel.slice('/models/'.length));
  }
  if (rel === '/') rel = '/index.html';
  return path.join(ROOT, rel.replace(/^\//, ''));
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.moc3': 'application/octet-stream',
};

// 注意：主进程里不能随手 console.log/console.error ——
// 启动它的控制台管道关闭后会抛 EPIPE（未捕获异常 → 弹「A JavaScript error occurred」）。
// 需要排查时写文件，别写 stdout。
async function logLine(line) {
  try {
    await appendFile(path.join(here, 'pet-serve.log'), `${new Date().toISOString()} ${line}\n`);
  } catch { /* 日志失败不影响渲染 */ }
}

app.whenReady().then(() => {
  protocol.handle('pet', async (request) => {
    const file = resolveRequest(request.url);
    try {
      const buf = await readFile(file);
      const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      return new Response(buf, { headers: { 'Content-Type': type } });
    } catch (err) {
      logLine(`读取失败 ${file} ${err.code || err.message}`);
      return new Response('not found: ' + file, { status: 404 });
    }
  });

  const area = screen.getPrimaryDisplay().workArea;
  const height = WIN_H;
  win = new BrowserWindow({
    width: WIN_W,
    height,
    x: area.x + area.width - WIN_W - 80,
    y: area.y + area.height - height - 40,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  const petQuery = new URLSearchParams({
    base: `pet://app/models/${MODEL_DIR}/`,
    model: MODEL_FILE,
  });
  win.loadURL(`pet://app/index.html?${petQuery.toString()}`);
  win.webContents.on('did-fail-load', (e, code, desc) => logLine(`页面加载失败 ${code} ${desc}`));

  // 记住真实 DIP 尺寸：把它固定传给 setBounds，窗口就不会在拖动时变大
  const created = win.getBounds();
  winSize = { width: created.width, height: created.height };
  logLine(`窗口创建 ${created.width}x${created.height} @ ${created.x},${created.y}`);

  // 默认整窗穿透：只有光标落在模型/关闭键上时，渲染进程才把我们切回可交互。
  win.setIgnoreMouseEvents(true, { forward: true });
  win.webContents.on('render-process-gone', (e, d) => logLine(`[renderer gone] ${JSON.stringify(d)}`));

  // 穿透状态下 Chromium 收不到可靠的 mousemove，所以由主进程轮询系统光标位置喂给页面，
  // 页面用它做 alpha 命中检测，再回调 pet-hit 决定是否接收鼠标。
  const cursorTimer = setInterval(() => {
    if (!win || win.isDestroyed()) return;
    const p = screen.getCursorScreenPoint();
    const b = win.getBounds();
    const inside = p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
    win.webContents.send('pet-cursor', inside ? { x: p.x - b.x, y: p.y - b.y } : { x: -1, y: -1 });
  }, 33);
  app.on('before-quit', () => clearInterval(cursorTimer));
});

// 命中检测结果：true=光标在模型/UI 上，需要接收鼠标；false=穿透到桌面
let petInteractive = false;
ipcMain.on('pet-hit', (e, interactive) => {
  if (!win || petInteractive === !!interactive) return;
  petInteractive = !!interactive;
  win.setIgnoreMouseEvents(!petInteractive, { forward: true });
});

// 拖动：用固定尺寸的 setBounds，避免 setPosition 在 1.75 DPI 下每次漂移放大
ipcMain.handle('pet-bounds', () => (win ? win.getBounds() : null));
ipcMain.on('pet-move', (e, pos) => {
  if (!win || !pos) return;
  win.setBounds({
    x: Math.round(pos.x),
    y: Math.round(pos.y),
    width: winSize.width,
    height: winSize.height,
  });
});
ipcMain.on('pet-quit', () => app.quit());
app.on('window-all-closed', () => app.quit());

// 退出时顺手让 8792 的 API 服务也退出：否则端口一直开着，
// Demon 的 smallDemonRunning() 会误判「桌宠还在跑」。
let toldServer = false;
app.on('before-quit', () => {
  if (toldServer) return;
  toldServer = true;
  try {
    fetch('http://127.0.0.1:8792/exit', { method: 'POST' }).catch(() => {});
  } catch { /* 服务没开就算了 */ }
});
