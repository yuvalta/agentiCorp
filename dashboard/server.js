// Local CEO dashboard — a 16-bit pixel "factory floor". Zero-dependency HTTP
// server. The home page is a self-updating pixel scene: agents are machines on
// a conveyor, artifacts ride the belt between them, gates are checkpoint towers
// with red/green lamps. The page polls /api/state and animates without reloads.
// Gate decisions are still made via the approval CLI (off the network surface).

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT ? Number(process.env.PORT) : 4317;

const STATE_AGENTS = {
  DISCOVERY: ['agent-research'],
  BLUEPRINTING: ['agent-architect', 'agent-designer'],
  TRIAGE: ['agent-product'],
  CONSTRUCTION: ['agent-developer', 'agent-qa'],
  AUDIT: ['agent-finance', 'agent-marketing'],
  DELIVERY: ['agent-ops'],
};

async function loadJSON(p, fb) {
  try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fb; }
}
async function loadText(p) {
  try { return await readFile(p, 'utf8'); } catch { return null; }
}

async function snapshot() {
  return {
    engine: await loadJSON(resolve(ROOT, 'workspace', '.engine_state.json'), { state: 'IDLE', history: [] }),
    pending: (await loadJSON(resolve(ROOT, 'dashboard', 'pending_approvals.json'), { pending: [] })).pending,
    actions: (await loadJSON(resolve(ROOT, 'dashboard', 'ceo_actions.json'), { approvals: [] })).approvals,
    config: await loadJSON(resolve(ROOT, 'config', 'agents.json'), { agents: {} }),
    idea: await loadText(resolve(ROOT, 'workspace', 'TrendReport.md')),
    deploy: await loadJSON(resolve(ROOT, 'workspace', 'Deploy_Plan.json'), null),
    stateAgents: STATE_AGENTS,
  };
}

const PAGE = /* html */ `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AGENTICORP // FACTORY FLOOR</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap" rel="stylesheet">
<style>
:root{
  --bg:#0a0e1a; --bg2:#101830; --steel:#27324d; --steel2:#1a2238;
  --ink:#d8e2ff; --mut:#7187b8; --green:#39ff7a; --amber:#ffb83d; --red:#ff4d5e;
  --cyan:#34e3ff; --pink:#ff5fd2; --belt:#161e36; --belt2:#202a47;
  --px:4px;
}
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{
  background:
    radial-gradient(900px 500px at 78% -8%, #1b2b4d 0, transparent 60%),
    repeating-linear-gradient(0deg,#0a0e1a 0,#0a0e1a 2px,#0b1020 3px),
    var(--bg);
  color:var(--ink); font-family:'VT323',ui-monospace,monospace; font-size:20px;
  image-rendering:pixelated; -webkit-font-smoothing:none; overflow-x:hidden;
}
/* CRT scanline + grain overlay */
body::after{content:"";position:fixed;inset:0;pointer-events:none;z-index:50;
  background:repeating-linear-gradient(0deg,rgba(0,0,0,.18) 0,rgba(0,0,0,.18) 1px,transparent 2px,transparent 4px);
  mix-blend-mode:multiply;opacity:.5}
body::before{content:"";position:fixed;inset:0;pointer-events:none;z-index:49;opacity:.05;
  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>")}

h1,h2,h3,.title,.lamp-label,nav a,.tower b{font-family:'Press Start 2P',monospace}

header{display:flex;align-items:center;gap:18px;padding:18px 26px;border-bottom:var(--px) solid var(--steel);
  background:linear-gradient(180deg,#0d1426,#0a0e1a);position:sticky;top:0;z-index:30}
.logo{width:42px;height:42px;background:var(--green);color:#06210f;display:grid;place-items:center;
  font-family:'Press Start 2P';font-size:18px;box-shadow:inset -4px -4px 0 #16a64a, inset 4px 4px 0 #7dffae;}
header h1{font-size:15px;margin:0;letter-spacing:1px;color:var(--ink);text-shadow:3px 3px 0 #000}
.sub{font-size:18px;color:var(--mut)}
nav{margin-left:auto;display:flex;gap:10px}
nav a{font-size:9px;color:var(--mut);text-decoration:none;padding:10px 12px;border:var(--px) solid var(--steel);background:var(--bg2)}
nav a.on,nav a:hover{color:#06210f;background:var(--green);border-color:var(--green)}

main{max-width:1180px;margin:0 auto;padding:22px}

/* status bar */
.statusbar{display:flex;gap:14px;align-items:center;flex-wrap:wrap;border:var(--px) solid var(--steel);
  background:var(--bg2);padding:12px 16px;margin-bottom:20px}
.statusbar .big{font-family:'Press Start 2P';font-size:13px}
.statusbar .big.run{color:var(--amber)} .statusbar .big.gate{color:var(--red)} .statusbar .big.ship{color:var(--green)} .statusbar .big.idle{color:var(--cyan)}
.blink{animation:blink 1s steps(2,end) infinite}
@keyframes blink{50%{opacity:.25}}
.spacer{margin-left:auto}
.pendpill{font-size:16px;color:var(--amber);border:var(--px) solid var(--steel);padding:4px 10px;background:#1a1407}

/* FACTORY FLOOR grid */
.floor-label{font-family:'Press Start 2P';font-size:10px;color:var(--mut);margin:0 0 12px}
.floor{display:flex;flex-wrap:wrap;gap:0;align-items:stretch}
.cell{display:flex;align-items:center}
.connector{width:30px;height:6px;align-self:center;background:
  repeating-linear-gradient(90deg,var(--steel) 0 6px,transparent 6px 12px);animation:dash 0.6s linear infinite}
@keyframes dash{to{background-position:12px 0}}

/* MACHINE (agent) */
.machine{width:150px;margin:8px 0;background:linear-gradient(180deg,#1d2742,#141c30);
  border:var(--px) solid var(--steel);position:relative;padding:10px 8px 12px;text-align:center}
.machine .roof{position:absolute;top:-10px;left:8px;right:8px;height:10px;background:var(--steel);
  box-shadow:inset 0 -3px 0 #111a2e}
.machine .lamp{position:absolute;top:6px;right:8px;width:14px;height:14px;border:3px solid #000;background:#37415f}
.machine.run .lamp{background:var(--amber);box-shadow:0 0 12px var(--amber);animation:blink .7s steps(2) infinite}
.machine.done .lamp{background:var(--green);box-shadow:0 0 12px var(--green)}
.machine.block .lamp{background:var(--red);box-shadow:0 0 14px var(--red);animation:blink .4s steps(2) infinite}
.machine .icon{font-size:34px;line-height:1;margin:6px 0 8px;filter:drop-shadow(2px 2px 0 #000)}
.machine.run .icon{animation:bob .5s steps(2) infinite}
@keyframes bob{50%{transform:translateY(-4px)}}
.machine .name{font-family:'Press Start 2P';font-size:8px;color:var(--ink);line-height:1.5;min-height:26px}
.machine .stat{font-size:15px;margin-top:6px;color:var(--mut)}
.machine.run .stat{color:var(--amber)} .machine.done .stat{color:var(--green)} .machine.block .stat{color:var(--red)}
/* smoke when running */
.machine .smoke{position:absolute;top:-22px;left:14px;width:8px;height:8px;border-radius:50%;background:#566;opacity:0}
.machine.run .smoke{background:#566;animation:smoke 1.4s ease-out infinite}
@keyframes smoke{0%{opacity:.7;transform:translateY(0) scale(.6)}100%{opacity:0;transform:translateY(-26px) scale(1.6)}}

/* GATE tower */
.tower{width:118px;margin:8px 0;background:linear-gradient(180deg,#241830,#180f22);
  border:var(--px) solid #4a2b55;text-align:center;padding:10px 6px 12px;position:relative}
.tower .biglamp{width:26px;height:26px;border:4px solid #000;margin:4px auto 8px;background:#3a2030}
.tower.open .biglamp{background:var(--green);box-shadow:0 0 16px var(--green)}
.tower.wait .biglamp{background:var(--red);box-shadow:0 0 16px var(--red);animation:blink .5s steps(2) infinite}
.tower b{font-size:8px;color:var(--pink);display:block;line-height:1.5}
.tower .g{font-size:14px;color:var(--mut);margin-top:6px}
.tower.wait .g{color:var(--red)}

/* SHIP dock */
.dock{width:130px;margin:8px 0;border:var(--px) solid #1f5a45;background:linear-gradient(180deg,#0f2a20,#0a1a14);text-align:center;padding:12px 8px}
.dock.live{box-shadow:0 0 22px rgba(57,255,122,.4)}
.dock .icon{font-size:34px}.dock .name{font-family:'Press Start 2P';font-size:8px;color:var(--green);margin-top:8px}

/* panels */
.cols{display:grid;grid-template-columns:1.3fr 1fr;gap:18px;margin-top:26px}
@media(max-width:840px){.cols{grid-template-columns:1fr}}
.panel{border:var(--px) solid var(--steel);background:var(--bg2);padding:0}
.panel h2{font-size:10px;margin:0;padding:12px 14px;border-bottom:var(--px) solid var(--steel);color:var(--cyan);background:#0d1426}
.panel .body{padding:14px}
.idea{white-space:pre-wrap;font-size:17px;color:#b9c8ee;max-height:300px;overflow:auto;line-height:1.35}
.dom{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.dom span{font-size:16px;color:var(--green);border:var(--px) solid #1f5a45;background:#0f2a20;padding:4px 10px}
.pq{list-style:none;margin:0;padding:0}
.pq li{display:flex;gap:10px;padding:8px 0;border-bottom:2px solid var(--steel2);font-size:17px}
.pq .id{color:var(--cyan)} .pq .cat{color:var(--amber)} .pq .who{color:var(--mut);margin-left:auto}
.empty{color:var(--mut);font-size:17px}
.hint{color:var(--mut);font-size:16px;margin-top:14px}
.hint code{color:var(--green)}
.flash{animation:flash 1s ease-out}
@keyframes flash{0%{background:#16304a}100%{background:var(--bg2)}}
</style></head>
<body>
<header>
  <div class="logo">A</div>
  <div><h1>AGENTICORP</h1><div class="sub">// autonomous micro-SaaS factory floor</div></div>
  <nav><a class="on" href="/">FACTORY</a><a href="/permissions">PERMISSIONS</a></nav>
</header>
<main>
  <div class="statusbar">
    <span class="sub">ENGINE</span>
    <span id="state" class="big idle">IDLE</span>
    <span id="phase" class="sub"></span>
    <span class="spacer"></span>
    <span id="pend" class="pendpill" hidden></span>
  </div>

  <p class="floor-label">▣ ASSEMBLY LINE</p>
  <div id="floor" class="floor"></div>

  <div class="cols">
    <div class="panel"><h2>💡 CURRENT IDEA</h2><div class="body">
      <div id="idea" class="idea empty">no idea yet — run the research machine</div>
      <div id="domains" class="dom"></div>
    </div></div>
    <div class="panel"><h2>⛳ PENDING APPROVALS</h2><div class="body">
      <ul id="pq" class="pq"></ul>
      <div class="hint">approve a gate: <code>npm run approve -- PROJECT_KICKOFF</code></div>
    </div></div>
  </div>
</main>

<script>
const PIPELINE=[
  {id:'agent-research',icon:'🔎',short:'RESEARCH'},
  {gate:'KICKOFF_GATE',label:'KICKOFF'},
  {id:'agent-architect',icon:'📐',short:'ARCHITECT'},
  {id:'agent-designer',icon:'🎨',short:'DESIGN'},
  {id:'agent-product',icon:'📋',short:'PRODUCT'},
  {id:'agent-developer',icon:'💻',short:'DEV'},
  {id:'agent-qa',icon:'🧪',short:'QA'},
  {id:'agent-finance',icon:'💰',short:'FINANCE'},
  {id:'agent-marketing',icon:'📣',short:'MKTG'},
  {gate:'FINANCE_GATE',label:'FINANCE'},
  {gate:'DEPLOY_GATE',label:'DEPLOY'},
  {id:'agent-ops',icon:'🚀',short:'OPS'},
  {final:true,icon:'📦',short:'SHIP'},
];
const AGENT_STATE={'agent-research':'DISCOVERY','agent-architect':'BLUEPRINTING','agent-designer':'BLUEPRINTING','agent-product':'TRIAGE','agent-developer':'CONSTRUCTION','agent-qa':'CONSTRUCTION','agent-finance':'AUDIT','agent-marketing':'AUDIT','agent-ops':'DELIVERY'};
const ORDER=['IDLE','DISCOVERY','KICKOFF_GATE','BLUEPRINTING','TRIAGE','CONSTRUCTION','AUDIT','FINANCE_GATE','DEPLOY_GATE','DELIVERY','DEPLOYED'];
let prevSig='';

function build(){
  const floor=document.getElementById('floor');
  PIPELINE.forEach((n,i)=>{
    if(i>0){const c=document.createElement('div');c.className='cell';c.innerHTML='<div class="connector"></div>';floor.appendChild(c);}
    const cell=document.createElement('div');cell.className='cell';
    if(n.gate){
      cell.innerHTML='<div class="tower" data-gate="'+n.gate+'"><div class="biglamp"></div><b>'+n.label+'</b><div class="g">GATE</div></div>';
    }else if(n.final){
      cell.innerHTML='<div class="dock" data-final="1"><div class="icon">📦</div><div class="name">SHIPPED</div></div>';
    }else{
      cell.innerHTML='<div class="machine" data-agent="'+n.id+'"><div class="roof"></div><div class="smoke"></div><div class="lamp"></div>'+
        '<div class="icon">'+n.icon+'</div><div class="name">'+n.short+'</div><div class="stat">idle</div></div>';
    }
    floor.appendChild(cell);
  });
}

function idx(s){const k=ORDER.indexOf(s);return k<0?0:k;}

function render(d){
  const st=d.engine.state||'IDLE';
  const hist=d.engine.history||[];
  const approvals=(d.actions||[]).filter(a=>String(a.decision).toUpperCase()==='APPROVE').map(a=>a.gate);
  const curIdx=idx(st);
  const isGate=st.endsWith('_GATE');

  const se=document.getElementById('state');
  se.textContent=st;
  se.className='big '+(st==='DEPLOYED'?'ship':isGate?'gate':st==='IDLE'?'idle':'run');
  document.getElementById('phase').textContent = isGate?'· awaiting CEO ▸ '+st.replace('_GATE',''):(st==='DEPLOYED'?'· product shipped':st==='IDLE'?'· ready':'· building…');

  // machines
  document.querySelectorAll('.machine').forEach(m=>{
    const id=m.dataset.agent, mstate=AGENT_STATE[id];
    m.classList.remove('run','done','block');
    const stat=m.querySelector('.stat');
    if(mstate===st){
      // qa can block; show block if a QA failure is pending — approximate by FROZEN pending from agent
      m.classList.add('run');stat.textContent='RUNNING';
    }else if(idx(mstate)<curIdx || st==='DEPLOYED'){
      m.classList.add('done');stat.textContent='DONE';
    }else{stat.textContent='idle';}
  });
  // gates
  document.querySelectorAll('.tower').forEach(t=>{
    const g=t.dataset.gate;t.classList.remove('open','wait');
    if(approvals.includes(g)) t.classList.add('open');
    else if(st===g) t.classList.add('wait');
  });
  // dock
  const dock=document.querySelector('.dock');if(dock)dock.classList.toggle('live',st==='DEPLOYED');

  // idea
  const idea=document.getElementById('idea');
  if(d.idea){idea.textContent=d.idea;idea.classList.remove('empty');}
  // domains
  const dom=document.getElementById('domains');dom.innerHTML='';
  if(d.deploy&&d.deploy.domainRecommendations){d.deploy.domainRecommendations.forEach(x=>{const s=document.createElement('span');s.textContent=x.domain;dom.appendChild(s);});}

  // pending
  const open=(d.pending||[]).filter(a=>a.status==='PENDING');
  const pend=document.getElementById('pend');
  if(open.length){pend.hidden=false;pend.textContent='⛳ '+open.length+' PENDING';pend.classList.add('blink');}else{pend.hidden=true;}
  const pq=document.getElementById('pq');pq.innerHTML='';
  if(!open.length){pq.innerHTML='<li class="empty">none — running free until next gate</li>';}
  else open.forEach(a=>{const li=document.createElement('li');
    li.innerHTML='<span class="id">#'+a.id+'</span><span class="cat">'+a.category+'</span><span class="who">'+a.agent+'</span>';pq.appendChild(li);});

  // flash on change
  const sig=st+'|'+hist.length+'|'+approvals.join(',')+'|'+(d.idea?d.idea.length:0);
  if(prevSig&&sig!==prevSig){document.querySelector('.statusbar').classList.remove('flash');void document.querySelector('.statusbar').offsetWidth;document.querySelector('.statusbar').classList.add('flash');}
  prevSig=sig;
}

async function poll(){
  try{const r=await fetch('/api/state',{cache:'no-store'});render(await r.json());}catch(e){}
}
build();poll();setInterval(poll,2000);
</script>
</body></html>`;

function permsPage(data) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cards = Object.entries(data.config.agents).map(([id, a]) => {
    const p = a.permissions ?? {};
    const b = (v) => v === true ? '<span class="yes">ALLOW</span>' : v === false ? '<span class="no">DENY</span>' : `<span class="frz">${esc(v)}</span>`;
    const frozen = (p.frozenActions ?? []).map((f) => `<span class="chip">${esc(f)}</span>`).join('') || '<span class="mut">none</span>';
    return `<div class="pcard"><h3>${esc(id)}</h3><p class="role">${esc(a.role)}</p>
<div class="lbl">SKILLS</div><div class="chips">${(a.skills ?? []).map((s) => `<span class="chip sk">${esc(s)}</span>`).join('')}</div>
<div class="lbl">PERMISSIONS</div><table>
<tr><td>workspace write</td><td>${b(p.workspaceWrite)}</td></tr>
<tr><td>network</td><td><code>${esc(p.network ?? 'n/a')}</code></td></tr>
<tr><td>execute payments</td><td>${b(p.executePayments)}</td></tr>
<tr><td>deploy</td><td>${b(p.deploy)}</td></tr>
<tr><td>approve gates</td><td>${b(p.canApproveGates)}</td></tr>
${p.canBlockPipeline ? '<tr><td>block pipeline</td><td><span class="yes">YES</span></td></tr>' : ''}
</table><div class="lbl">FROZEN ▸ NEEDS CEO</div><div class="chips">${frozen}</div>
${p.note ? `<p class="note">${esc(p.note)}</p>` : ''}</div>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>AGENTICORP // PERMISSIONS</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap" rel="stylesheet">
<style>
:root{--bg:#0a0e1a;--bg2:#101830;--steel:#27324d;--ink:#d8e2ff;--mut:#7187b8;--green:#39ff7a;--red:#ff4d5e;--cyan:#34e3ff;--amber:#ffb83d;--px:4px}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:'VT323',monospace;font-size:19px;image-rendering:pixelated}
body::after{content:"";position:fixed;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg,rgba(0,0,0,.18) 0,rgba(0,0,0,.18) 1px,transparent 2px,transparent 4px);opacity:.5;mix-blend-mode:multiply}
h1,h3,.lbl,nav a{font-family:'Press Start 2P'}
header{display:flex;align-items:center;gap:18px;padding:18px 26px;border-bottom:var(--px) solid var(--steel);background:#0d1426;position:sticky;top:0}
.logo{width:42px;height:42px;background:var(--green);color:#06210f;display:grid;place-items:center;font-family:'Press Start 2P';font-size:18px;box-shadow:inset -4px -4px 0 #16a64a,inset 4px 4px 0 #7dffae}
header h1{font-size:14px;margin:0}nav{margin-left:auto;display:flex;gap:10px}
nav a{font-size:9px;color:var(--mut);text-decoration:none;padding:10px 12px;border:var(--px) solid var(--steel);background:var(--bg2)}
nav a.on{color:#06210f;background:var(--green);border-color:var(--green)}
main{max-width:1180px;margin:0 auto;padding:24px}
.intro{border:var(--px) solid var(--steel);background:var(--bg2);padding:14px 16px;margin-bottom:20px;color:var(--mut);font-size:18px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}
.pcard{border:var(--px) solid var(--steel);background:linear-gradient(180deg,#141c30,#101830);padding:14px}
.pcard h3{font-size:10px;color:var(--cyan);margin:0 0 6px}.role{color:var(--mut);font-size:16px;margin:0 0 10px}
.lbl{font-size:8px;color:var(--amber);margin:14px 0 7px;letter-spacing:1px}
.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{font-size:14px;padding:3px 8px;border:var(--px) solid var(--steel);background:#0d1426;color:var(--cyan)}
.chip.sk{color:var(--green);border-color:#1f5a45;background:#0f2a20}
table{border-collapse:collapse;width:100%;margin-top:2px}td{border-bottom:2px solid #1a2238;padding:6px 4px;font-size:16px;color:var(--ink)}
.yes{color:var(--green);font-family:'Press Start 2P';font-size:8px}.no{color:var(--red);font-family:'Press Start 2P';font-size:8px}.frz{color:var(--amber)}
.mut{color:var(--mut)}code{color:var(--cyan)}.note{color:var(--mut);font-size:15px;margin-top:10px;border-top:2px solid #1a2238;padding-top:8px}
</style></head><body>
<header><div class="logo">A</div><h1>PERMISSION MATRIX</h1>
<nav><a href="/">FACTORY</a><a class="on" href="/permissions">PERMISSIONS</a></nav></header>
<main><div class="intro">▸ THE GOLDEN RULE — no agent executes payments, registers domains, or deploys to live infra without explicit CEO approval. Frozen actions route to the approval queue.</div>
<div class="grid">${cards}</div></main></body></html>`;
}

createServer(async (req, res) => {
  const data = await snapshot();
  if (req.url === '/api/state') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(data));
    return;
  }
  if (req.url?.startsWith('/permissions')) {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(permsPage(data));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(PAGE);
}).listen(PORT, () => {
  console.log(`CEO dashboard on http://localhost:${PORT}`);
});
