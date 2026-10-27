// small demon 的 Live2D 渲染入口
// 与 Demon 的 localpet 同一套栈（pixi + pixi-live2d-display/cubism4），
// 区别是：参数不靠「写一次」，而是每帧在 ticker 的低优先级回调里重新写入，
// 这样表情/口型不会被 idle 动作顶掉。
import * as PIXI from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display/cubism4';

window.PIXI = PIXI;

const query = new URLSearchParams(location.search);
const modelBase = query.get('base') || '';
const modelFile = query.get('model') || '';

const app = new PIXI.Application({
  backgroundAlpha: 0,
  antialias: true,
  // 关键：按系统 DPR 渲染。写死 1 时画布只有 CSS 尺寸，被系统放大 1.75 倍 → 糊。
  resolution: window.devicePixelRatio || 1,
  autoDensity: true,
  resizeTo: window,
});
document.body.appendChild(app.view);
app.ticker.maxFPS = 30;

// 8192² 纹理画到桌面尺寸约 9:1，没有 mipmap 就是双线性硬缩 → 线条发虚、抖动。
function enableMipmaps(target) {
  // pixi-live2d-display：PIXI 纹理挂在 Live2DModel.textures 上（不在 internalModel 上）
  const internal = target && target.internalModel;
  const textures = (target && target.textures) || (internal && internal.textures) || [];
  let done = 0;
  for (const item of textures) {
    const bt = item && item.baseTexture ? item.baseTexture : item;
    if (!bt || typeof bt.update !== 'function') continue;
    if (bt.mipmap === PIXI.MIPMAP_MODES.ON) { done++; continue; }
    bt.mipmap = PIXI.MIPMAP_MODES.ON;
    bt.update();
    done++;
  }
  return done;
}

let model = null;
let fpsValue = 0;
let frameCounter = 0;
setInterval(() => { fpsValue = frameCounter; frameCounter = 0; }, 1000);
app.ticker.add(() => { frameCounter++; });

// 需要「每帧按住」的参数：id -> 目标值
const held = new Map();
// 写过参数的表情参数 id（切换/清除时要显式写 0，否则会残留）
const touchedParams = new Set();
const expressionCache = new Map();

function core() {
  return model && model.internalModel ? model.internalModel.coreModel : null;
}

async function loadExpression(name) {
  if (expressionCache.has(name)) return expressionCache.get(name);
  const url = `${modelBase}${name}.exp3.json`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`expression not found: ${name} (${response.status})`);
  const data = await response.json();
  expressionCache.set(name, data);
  return data;
}

function applyHeld() {
  const c = core();
  if (!c) return;
  for (const [id, value] of held) {
    try { c.setParameterValueById(id, value); } catch { /* 模型没有该参数 */ }
  }
}

function resetExpressionParams() {
  const c = core();
  if (!c) return;
  // 口型单独管理；基线表情（水印消除）常驻，不能被切表情清掉
  for (const id of touchedParams) {
    if (id === 'ParamMouthOpenY' || baselineParams.has(id)) continue;
    held.delete(id);
    try { c.setParameterValueById(id, 0); } catch { /* 忽略 */ }
  }
  touchedParams.clear();
}

// 基线表情：开机就按住，永久叠加。这个模型允许多个 exp3 叠加使用，
// 比如「13 水印消除」+「04 脸红」同时生效。
const BASELINE_EXPRESSIONS = ['EXP/13 水印消除'];
const baselineParams = new Set();

async function applyBaselineExpressions() {
  for (const name of BASELINE_EXPRESSIONS) {
    let data;
    try {
      data = await loadExpression(name);
    } catch (err) {
      console.warn(`基线表情缺失 ${name}: ${err.message}`);
      continue;
    }
    for (const p of data.Parameters || []) {
      if (typeof p.Id !== 'string') continue;
      held.set(p.Id, p.Blend === 'Multiply' ? 1 : (Number(p.Value) || 0));
      baselineParams.add(p.Id);
    }
  }
  applyHeld();
  return Array.from(baselineParams);
}

async function setExpression(name) {
  if (!model) return;
  resetExpressionParams();
  if (!name) return;
  let data;
  try {
    data = await loadExpression(name);
  } catch (err) {
    console.warn(err.message);
    return;
  }
  const list = data.Parameters || [];
  for (const p of list) {
    if (typeof p.Id !== 'string') continue;
    const base = Number(p.Value) || 0;
    // Blend=Add 时文件里的值是「加多少」，这里按绝对写入处理
    held.set(p.Id, p.Blend === 'Multiply' ? 1 : base);
    touchedParams.add(p.Id);
  }
  applyHeld();
}

function setMouth(value) {
  held.set('ParamMouthOpenY', Math.max(0, Math.min(1, Number(value) || 0)));
}

let naturalW = 0;
let naturalH = 0;
let fitScale = 1;
let currentMode = 'full';

// full：整只塞进窗口；half：放大到上半身（头顶贴窗口上沿）
function layout(mode = currentMode) {
  if (!model || !naturalW || !naturalH) return;
  currentMode = mode === 'half' ? 'half' : 'full';
  const iw = window.innerWidth;
  const ih = window.innerHeight;
  fitScale = Math.min(iw / naturalW, ih / naturalH) * 0.98;
  if (currentMode === 'half') {
    const s = fitScale * 1.85;
    model.scale.set(s);
    model.x = (iw - naturalW * s) / 2;
    model.y = -naturalH * s * 0.04;
  } else {
    model.scale.set(fitScale);
    model.x = (iw - naturalW * fitScale) / 2;
    model.y = ih - naturalH * fitScale;
  }
}

// 兼容旧接口：传绝对缩放
function setScale(value) {
  if (model) model.scale.set(value);
}

// ---- 命中检测：只有光标落在模型（或其上的按钮）时，窗口才接收鼠标 ----
// 否则整窗穿透，鼠标点到的是后面的窗口/桌面。
// 穿透状态下页面收不到 mousemove，因此光标位置由主进程轮询后推过来。
let pointer = { x: -1, y: -1 };
let interactive = null;
const hitPixel = new Uint8Array(4);

if (window.smallDemon && window.smallDemon.onCursor) {
  window.smallDemon.onCursor((pos) => { pointer.x = pos.x; pointer.y = pos.y; });
}
// 可交互时也能收到真实事件，作为补充
window.addEventListener('pointermove', (e) => { pointer.x = e.clientX; pointer.y = e.clientY; });

function probeHit() {
  if (!model || !window.smallDemon) return;
  if (window.__petDragging) return;          // 拖动中不要来回切
  if (pointer.x < 0 || pointer.y < 0) return;

  // 1) DOM 上盖着东西（比如关闭键）→ 必须可交互
  const el = document.elementFromPoint(pointer.x, pointer.y);
  let hit = !!(el && el !== app.view);

  // 2) 否则读画布该像素的 alpha：模型是镂空的，透明处应穿透
  if (!hit) {
    const res = app.renderer.resolution;
    const px = Math.floor(pointer.x * res);
    const py = Math.floor(app.view.height - pointer.y * res - 1);
    const gl = app.renderer.gl;
    if (px >= 0 && py >= 0 && px < app.view.width && py < app.view.height) {
      try {
        gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, hitPixel);
        hit = hitPixel[3] > (interactive ? 6 : 12);   // 一点迟滞，避免边缘抖动
      } catch {
        hit = false;
      }
    }
  }

  if (hit !== interactive) {
    interactive = hit;
    window.smallDemon.hitTest(hit);
  }
}

(async () => {
  try {
    if (!modelBase || !modelFile) throw new Error('缺少 base / model 参数');
    model = await Live2DModel.from(modelBase + modelFile, { autoInteract: false });
    app.stage.addChild(model);

    naturalW = model.width;
    naturalH = model.height;
    layout('full');
    window.addEventListener('resize', () => layout());

    const mipmapped = enableMipmaps(model);

    // 低优先级：在模型自身 update 之后再写参数
    app.ticker.add(applyHeld, null, PIXI.UPDATE_PRIORITY.LOW);

    // 命中检测放在渲染之后（UTILITY 比 LOW 更晚），此时读 1 像素 alpha 才是本帧内容。
    app.ticker.add(probeHit, null, PIXI.UPDATE_PRIORITY.UTILITY);

    // 基线表情（水印消除）常驻叠加
    const baseline = await applyBaselineExpressions();

    window.pet = {
      ready: true,
      fps: () => fpsValue,
      setExpression: (name) => { setExpression(name).catch((e) => console.warn(e.message)); },
      clearExpression: () => setExpression(''),
      setMouth,
      setScale,
      setMode: (mode) => layout(mode),
      modelInfo: () => ({ width: model.width, height: model.height }),
      heldParams: () => Array.from(held.keys()),
      baselineParams: () => baseline.slice(),
      hitState: () => ({ interactive, pointer }),
      debug: () => ({
        naturalW, naturalH, fitScale, mode: currentMode,
        scale: model.scale.x, x: model.x, y: model.y,
        iw: window.innerWidth, ih: window.innerHeight, dpr: devicePixelRatio,
        mipmapped,
        baseline,
        canvas: `${app.view.width}x${app.view.height}`,
        rendererResolution: app.renderer.resolution,
        interactive,
      }),
    };
    document.title = 'small-demon';
  } catch (error) {
    console.error(error);
    document.title = 'small-demon-error';
    const pre = document.createElement('pre');
    pre.style.cssText = 'color:#f66;font:12px sans-serif;white-space:pre-wrap;margin:8px';
    pre.textContent = String(error && error.message ? error.message : error);
    document.body.appendChild(pre);
  }
})();
