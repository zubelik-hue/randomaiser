// Рандомайзер для мероприятий. Без зависимостей: node server.js
// Гости: /        Ведущий: /host?key=КЛЮЧ
const http = require('http');
const crypto = require('crypto');
const os = require('os');

const PORT = process.env.PORT || 3000;
const HOST_KEY = process.env.HOST_KEY || crypto.randomBytes(3).toString('hex');

const guests = new Map();   // id -> Set(res)
const hosts = new Set();    // res
const winners = new Set();  // id уже выигравших
let drawing = false;

const send = (res, ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
const stats = () => ({ online: guests.size, eligible: [...guests.keys()].filter(id => !winners.has(id)).length, winners: winners.size });
const toHosts = () => hosts.forEach(r => send(r, 'stats', stats()));
const toAll = (ev, d) => guests.forEach(set => set.forEach(r => send(r, ev, d)));

function sse(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 2000\n\n');
}

setInterval(() => { // не даём прокси закрыть соединения
  guests.forEach(set => set.forEach(r => r.write(': ping\n\n')));
  hosts.forEach(r => r.write(': ping\n\n'));
}, 15000);

function draw() {
  if (drawing) return { ok: false, error: 'Розыгрыш уже идёт' };
  const pool = [...guests.keys()].filter(id => !winners.has(id));
  if (!pool.length) return { ok: false, error: 'Нет участников' };
  drawing = true;
  toAll('spin', {});
  hosts.forEach(r => send(r, 'spin', {}));
  setTimeout(() => {
    const live = pool.filter(id => guests.has(id));
    const list = live.length ? live : [...guests.keys()].filter(id => !winners.has(id));
    drawing = false;
    if (!list.length) { hosts.forEach(r => send(r, 'nowinner', {})); return; }
    const win = list[crypto.randomInt(list.length)];
    winners.add(win);
    guests.forEach((set, id) => set.forEach(r => send(r, id === win ? 'win' : 'lose', {})));
    hosts.forEach(r => send(r, 'winner', { n: winners.size }));
    toHosts();
  }, 3000);
  return { ok: true };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const isHost = url.searchParams.get('key') === HOST_KEY;

  if (p === '/ping') { res.writeHead(204); return res.end(); }
  if (p === '/' ) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(GUEST_HTML); }
  if (p === '/host') {
    if (!isHost) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Нужен правильный ключ: /host?key=...'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(HOST_HTML);
  }
  if (p === '/events') {
    const id = (url.searchParams.get('id') || '').replace(/[^a-z0-9]/gi, '').slice(0, 32);
    if (!id) { res.writeHead(400); return res.end(); }
    sse(req, res);
    if (!guests.has(id)) guests.set(id, new Set());
    guests.get(id).add(res);
    send(res, 'hello', { won: winners.has(id) });
    toHosts();
    req.on('close', () => { const s = guests.get(id); if (s) { s.delete(res); if (!s.size) guests.delete(id); } toHosts(); });
    return;
  }
  if (p === '/host-events' && isHost) {
    sse(req, res); hosts.add(res); send(res, 'stats', stats());
    req.on('close', () => hosts.delete(res));
    return;
  }
  if (p === '/draw' && req.method === 'POST' && isHost) {
    res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(draw()));
  }
  if (p === '/reset' && req.method === 'POST' && isHost) {
    winners.clear(); toAll('reset', {}); toHosts();
    res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true}');
  }
  res.writeHead(404); res.end();
});

server.listen(PORT, () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log(`\nРандомайзер запущен на порту ${PORT}`);
  console.log(`Ключ ведущего: ${HOST_KEY}`);
  ips.forEach(ip => console.log(`  Ведущий: http://${ip}:${PORT}/host?key=${HOST_KEY}`));
  console.log('');
});

const BASE_CSS = `
*{box-sizing:border-box}html,body{height:100%}
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#1b1035;color:#fff;
display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px;transition:background .3s}
h1{font-size:clamp(34px,10vw,64px);line-height:1.05;margin:0 0 12px}
p{font-size:18px;opacity:.85;margin:0 0 24px;max-width:28em}
button{font:700 20px/1 inherit;border:0;border-radius:999px;padding:22px 40px;cursor:pointer;min-height:56px}
button:focus-visible{outline:3px solid #fff;outline-offset:4px}
`;

const GUEST_HTML = `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Розыгрыш</title>
<style>${BASE_CSS}
#go{background:#ffcc33;color:#1b1035;font-size:24px;padding:26px 48px}
.dot{width:14px;height:14px;border-radius:50%;background:#5f5;display:inline-block;margin-right:8px;animation:p 1.4s infinite}
.off .dot{background:#f55}
@keyframes p{50%{opacity:.3}}
body.spin{animation:fl .25s infinite alternate}
@keyframes fl{from{background:#1b1035}to{background:#3b2370}}
body.win{background:radial-gradient(circle,#ffd84a,#ff7a00);color:#2a0e00}
body.win h1{font-size:clamp(48px,16vw,110px)}
body.lose{background:#24283b}
@media(prefers-reduced-motion:reduce){body.spin{animation:none;background:#3b2370}.dot{animation:none}}
</style></head><body>
<div id="v"><h1>Розыгрыш</h1><p>Нажмите кнопку, чтобы участвовать. Не закрывайте страницу и не блокируйте экран.</p><button id="go">Участвую!</button></div>
<script>{
const v=document.getElementById('v');
let id;try{id=localStorage.getItem('gid')}catch(e){}
if(!id){id=Math.random().toString(36).slice(2)+Date.now().toString(36);try{localStorage.setItem('gid',id)}catch(e){}}
let ctx,wake,joined=false;
const vib=p=>{try{navigator.vibrate&&navigator.vibrate(p)}catch(e){}};
function beep(){if(!ctx)return;const t=ctx.currentTime;[523,659,784,1047].forEach((f,i)=>{const o=ctx.createOscillator(),g=ctx.createGain();o.frequency.value=f;o.connect(g);g.connect(ctx.destination);g.gain.setValueAtTime(.25,t+i*.15);g.gain.exponentialRampToValueAtTime(.001,t+i*.15+.4);o.start(t+i*.15);o.stop(t+i*.15+.45)})}
async function keepAwake(){try{wake=await navigator.wakeLock.request('screen')}catch(e){}}
document.addEventListener('visibilitychange',()=>{if(joined&&document.visibilityState==='visible')keepAwake()});
function show(cls,h,p){document.body.className=cls;v.innerHTML='';const a=document.createElement('h1');a.textContent=h;v.append(a);if(p){const b=document.createElement('p');b.innerHTML=p;v.append(b)}}
function waiting(){show('','Вы в игре','<span class="dot"></span>Ждём, когда ведущий нажмёт кнопку…')}
document.getElementById('go').onclick=()=>{
  joined=true;
  try{ctx=new (window.AudioContext||window.webkitAudioContext)();ctx.resume()}catch(e){}
  vib(60);keepAwake();waiting();
  setInterval(()=>fetch('/ping').catch(()=>{}),240000);
  const es=new EventSource('/events?id='+encodeURIComponent(id));
  es.addEventListener('hello',e=>{const d=JSON.parse(e.data);if(d.won)show('win','Вы победили!','Подойдите к ведущему');else waiting()});
  es.addEventListener('spin',()=>{show('spin','Крутим…','');vib([40,80,40,80,40])});
  es.addEventListener('win',()=>{show('win','Вы победили!','Подойдите к ведущему');vib([400,150,400,150,800]);beep()});
  es.addEventListener('lose',()=>{show('lose','Не в этот раз','Оставайтесь на странице — будут ещё розыгрыши');setTimeout(()=>{if(document.body.className==='lose')waiting()},6000)});
  es.addEventListener('reset',waiting);
  es.onerror=()=>{if(document.body.className==='')document.body.classList.add('off')};
  es.onopen=()=>document.body.classList.remove('off');
};
}</script></body></html>`;

const HOST_HTML = `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Ведущий</title>
<style>${BASE_CSS}
.wrap{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:56px;align-items:center;max-width:1700px;width:100%}
.qr{background:#fff;border-radius:28px;padding:24px;display:inline-block}
.qr canvas,.qr img{display:block;width:min(78vh,55vw);height:auto}
.url{font-size:20px;opacity:.7;margin-top:10px;word-break:break-all}
.n{font-size:clamp(56px,10vw,110px);font-weight:800;line-height:1}
#draw{background:#ffcc33;color:#1b1035;font-size:clamp(24px,4vw,34px);padding:34px 64px;box-shadow:0 10px 0 #b88a00}
#draw:active{transform:translateY(6px);box-shadow:0 4px 0 #b88a00}
#draw:disabled{opacity:.5;cursor:default}
.side{display:flex;flex-direction:column;align-items:center;text-align:center}
.ttl{font-size:clamp(40px,5vw,72px);color:#ffcc33;margin:0 0 28px}
.sub{font-size:20px;opacity:.85;margin:8px 0 0}
#draw{margin:28px 0 16px}
#reset{margin-top:14px;background:transparent;color:#fff;border:2px solid #fff6;font-size:18px;padding:14px 28px;min-height:44px}
#msg{min-height:28px;font-size:20px}
@media(max-width:760px){.wrap{grid-template-columns:1fr;gap:24px}.qr canvas,.qr img{width:min(80vw,60vh)}}
</style></head><body>
<div class="wrap">
  <div><div class="qr" id="qr"></div></div>
  <div class="side">
    <h1 class="ttl">Тест на удачу</h1>
    <div class="n" id="n">0</div>
    <div class="sub">гостей на странице · <span id="el">0</span> могут выиграть</div>
    <button id="draw">Выбрать победителя</button>
    <div id="msg"></div>
    <button id="reset">Сбросить победителей</button>
  </div>
</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<script>{
const key=new URLSearchParams(location.search).get('key');
const guestUrl=location.origin+'/';
try{new QRCode(document.getElementById('qr'),{text:guestUrl,width:1024,height:1024,correctLevel:QRCode.CorrectLevel.M})}catch(e){document.getElementById('qr').textContent='QR не загрузился. Адрес для гостей: '+guestUrl}
const $=i=>document.getElementById(i),btn=$('draw'),msg=$('msg');
setInterval(()=>fetch('/ping').catch(()=>{}),240000);
const es=new EventSource('/host-events?key='+encodeURIComponent(key));
es.addEventListener('stats',e=>{const d=JSON.parse(e.data);$('n').textContent=d.online;$('el').textContent=d.eligible});
es.addEventListener('spin',()=>{msg.textContent='Крутим…';btn.disabled=true});
es.addEventListener('winner',e=>{const d=JSON.parse(e.data);msg.textContent='Победитель №'+d.n+' выбран — у него вибрирует телефон!';btn.disabled=false});
es.addEventListener('nowinner',()=>{msg.textContent='Все участники вышли';btn.disabled=false});
btn.onclick=async()=>{btn.disabled=true;const r=await fetch('/draw?key='+encodeURIComponent(key),{method:'POST'}).then(r=>r.json()).catch(()=>({ok:false,error:'Нет связи с сервером'}));if(!r.ok){msg.textContent=r.error;btn.disabled=false}};
$('reset').onclick=async()=>{await fetch('/reset?key='+encodeURIComponent(key),{method:'POST'});msg.textContent='Можно разыгрывать заново среди всех'};
}</script></body></html>`;
