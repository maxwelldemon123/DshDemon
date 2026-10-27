// ESM（package.json 是 "type":"module"），所以用 import 而不是 require
import http from 'node:http';

const PORT = Number(process.env.SMALL_DEMON_PORT || 8792);
let clients = [];

function push(obj) {
  const data = `data: ${JSON.stringify(obj)}\n\n`;
  clients = clients.filter((res) => {
    try { res.write(data); return true; } catch { return false; }
  });
}

function body(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
  });
}

http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const json = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };

  if (req.url === '/health') return json({ ok: true, app: 'dshdemon', clients: clients.length });
  if (req.url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('data: {"type":"hello"}\n\n');
    clients.push(res);
    req.on('close', () => { clients = clients.filter((c) => c !== res); });
    return;
  }
  if (req.url === '/expression') {
    const b = await body(req);
    push({ type: 'expression', name: String(b.name || '') });
    return json({ ok: true });
  }
  if (req.url === '/mouth') {
    const b = await body(req);
    push({ type: 'mouth', value: Number(b.value) || 0 });
    return json({ ok: true });
  }
  if (req.url === '/mode') {
    const b = await body(req);
    push({ type: 'mode', mode: b.mode === 'half' ? 'half' : 'full' });
    return json({ ok: true, mode: b.mode === 'half' ? 'half' : 'full' });
  }
  if (req.url === '/show' || req.url === '/hide') {
    push({ type: req.url.slice(1) });
    return json({ ok: true });
  }
  if (req.url === '/quit') {
    // 通知窗口退出，然后本服务也退出（否则端口还在，Demon 会以为桌宠还活着）
    push({ type: 'quit' });
    setTimeout(() => process.exit(0), 500);
    return json({ ok: true });
  }
  if (req.url === '/exit') {
    // Electron 侧退出时收尾（不需要再推 SSE）
    json({ ok: true });
    setTimeout(() => process.exit(0), 50);
    return;
  }
  res.writeHead(404); res.end('not found');
}).listen(PORT, '127.0.0.1', () => console.log(`[DshDemon] api ${PORT}`));
