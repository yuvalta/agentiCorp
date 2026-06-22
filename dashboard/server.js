// Local CEO dashboard — a sleek, modern dark control room. Zero-dependency
// HTTP server. Three views: the live factory pipeline (polls /api/state and
// animates without reloads), the Ideas board (score/approve/reject SaaS ideas
// from the research agent), and the agent permission matrix. Gate decisions
// still run through the approval CLI; idea greenlighting is a CEO action and
// writes straight to the ideas store, mirroring how cli.js records approvals.

import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setIdeaStatus } from '../lib/ideasStore.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT ? Number(process.env.PORT) : 4317;
// Mount prefix when served behind a reverse-proxy subpath (e.g. "/agenticorp").
// Empty for local root serving. nginx preserves the full URI; we strip it here
// and inject it into every link/fetch so routing works under the subpath.
const BASE = (process.env.BASE_PATH || '').replace(/\/$/, '');
const IDEAS_FILE = resolve(ROOT, 'workspace', 'ideas.json');
const TRENDREPORT_FILE = resolve(ROOT, 'workspace', 'TrendReport.md');
const CEO_ACTIONS_FILE = resolve(ROOT, 'dashboard', 'ceo_actions.json');
const PENDING_FILE = resolve(ROOT, 'dashboard', 'pending_approvals.json');
const KICKOFF_GATE = 'PROJECT_KICKOFF';

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
    ideas: (await loadJSON(IDEAS_FILE, { ideas: [] })).ideas,
    deploy: await loadJSON(resolve(ROOT, 'workspace', 'Deploy_Plan.json'), null),
    stateAgents: STATE_AGENTS,
  };
}

// ── Favicon: gradient "A" mark so the tab is identifiable ────────────────────
const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#818cf8"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs>
<rect width="32" height="32" rx="8" fill="#0a0b0f"/>
<path d="M16 6 L25.5 26 H20.6 L18.9 22.1 H13.1 L11.4 26 H6.5 Z M16 11.6 L13.9 18 H18.1 Z" fill="url(#g)"/></svg>`;

// ── Shared shell (head + chrome) ─────────────────────────────────────────────
const STYLE = /* css */ `
:root{
  --bg:#0a0b0f; --surface:#14161d; --surface2:#1b1e27; --line:rgba(255,255,255,.07);
  --line2:rgba(255,255,255,.12); --ink:#e6e8ef; --mut:#8b90a0; --dim:#5b6071;
  --indigo:#818cf8; --cyan:#22d3ee; --green:#34d399; --amber:#fbbf24; --red:#f87171; --violet:#a78bfa;
  --shadow:0 1px 2px rgba(0,0,0,.4),0 8px 24px rgba(0,0,0,.35);
}
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{
  background:
    radial-gradient(1100px 600px at 85% -10%, rgba(129,140,248,.10), transparent 60%),
    radial-gradient(900px 500px at 0% 0%, rgba(34,211,238,.06), transparent 55%),
    var(--bg);
  color:var(--ink); font:15px/1.5 'Inter',system-ui,-apple-system,sans-serif;
  -webkit-font-smoothing:antialiased; overflow-x:hidden;
}
a{color:inherit;text-decoration:none}
.mono{font-family:'JetBrains Mono',ui-monospace,'SF Mono',monospace}

header{display:flex;align-items:center;gap:16px;padding:14px 28px;
  border-bottom:1px solid var(--line);background:rgba(10,11,15,.7);backdrop-filter:blur(12px);
  position:sticky;top:0;z-index:40}
.brand{display:flex;align-items:center;gap:12px}
.mark{width:34px;height:34px;border-radius:9px;display:grid;place-items:center;
  background:linear-gradient(135deg,#818cf8,#22d3ee);color:#0a0b0f;font-weight:800;font-size:18px;
  box-shadow:0 0 0 1px rgba(255,255,255,.08),0 6px 18px rgba(129,140,248,.35)}
.brand h1{font-size:15px;font-weight:700;margin:0;letter-spacing:-.2px}
.brand .tag{font-size:12px;color:var(--mut);margin-top:1px}
nav{margin-left:auto;display:flex;gap:4px;padding:4px;border:1px solid var(--line);border-radius:11px;background:var(--surface)}
nav a{font-size:13px;font-weight:500;color:var(--mut);padding:7px 14px;border-radius:8px;transition:.15s}
nav a:hover{color:var(--ink);background:var(--surface2)}
nav a.on{color:#0a0b0f;background:linear-gradient(135deg,#818cf8,#22d3ee);font-weight:600}

main{max-width:1200px;margin:0 auto;padding:30px 28px 60px}
.eyebrow{font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);margin:0 0 14px}

.card{border:1px solid var(--line);background:var(--surface);border-radius:16px;box-shadow:var(--shadow)}
.empty{color:var(--mut);font-size:14px}

@media(max-width:760px){nav .lbl{display:none}main{padding:22px 16px 50px}}
`;

function shell({ title, active, body, script = '' }) {
  const tab = (href, label, key) =>
    `<a class="${active === key ? 'on' : ''}" href="${BASE}${href}"><span class="lbl">${label}</span></a>`;
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<link rel="icon" href="${BASE}/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>${STYLE}</style></head><body>
<script>window.BASE=${JSON.stringify(BASE)};</script>
<header>
  <div class="brand">
    <div class="mark">A</div>
    <div><h1>AgentiCorp</h1><div class="tag">autonomous micro-SaaS factory</div></div>
  </div>
  <nav>${tab('/', 'Factory', 'factory')}${tab('/ideas', 'Ideas', 'ideas')}${tab('/permissions', 'Permissions', 'perms')}</nav>
</header>
<main>${body}</main>
${script}</body></html>`;
}

// ── Factory view ─────────────────────────────────────────────────────────────
const FACTORY_BODY = /* html */ `
<style>
.statusbar{display:flex;align-items:center;gap:16px;padding:16px 20px;margin-bottom:26px;border-radius:14px}
.dot{width:9px;height:9px;border-radius:50%;background:var(--mut)}
.dot.run{background:var(--amber);box-shadow:0 0 12px var(--amber);animation:pulse 1.4s infinite}
.dot.gate{background:var(--red);box-shadow:0 0 12px var(--red);animation:pulse 1s infinite}
.dot.ship{background:var(--green);box-shadow:0 0 12px var(--green)}
.dot.idle{background:var(--cyan)}
@keyframes pulse{50%{opacity:.35}}
.statusbar .state{font-size:18px;font-weight:700;letter-spacing:-.2px}
.statusbar .phase{font-size:13px;color:var(--mut)}
.statusbar .spacer{margin-left:auto}
.pendpill{font-size:13px;font-weight:600;color:var(--amber);border:1px solid rgba(251,191,36,.3);
  background:rgba(251,191,36,.08);padding:6px 12px;border-radius:999px}

.flow{display:flex;flex-wrap:wrap;align-items:stretch;gap:0;margin-top:4px}
.flow .seg{display:flex;align-items:center}
.link{width:26px;height:2px;background:linear-gradient(90deg,var(--line2),var(--line));align-self:center;margin:0 2px}
.link.lit{background:linear-gradient(90deg,var(--indigo),var(--cyan))}

.node{position:relative;width:118px;margin:7px 0;padding:13px 10px;border-radius:14px;text-align:center;
  border:1px solid var(--line);background:var(--surface);transition:.2s}
.node .ic{font-size:24px;line-height:1}
.node .nm{font-size:11px;font-weight:600;color:var(--ink);margin-top:7px;letter-spacing:.02em}
.node .st{font-size:10.5px;color:var(--dim);margin-top:3px;text-transform:uppercase;letter-spacing:.08em}
.node .led{position:absolute;top:9px;right:9px;width:7px;height:7px;border-radius:50%;background:var(--dim)}
.node.run{border-color:rgba(251,191,36,.45);background:linear-gradient(180deg,rgba(251,191,36,.10),var(--surface))}
.node.run .led{background:var(--amber);box-shadow:0 0 10px var(--amber);animation:pulse 1s infinite}
.node.run .st{color:var(--amber)}
.node.run .ic{animation:bob 1.6s ease-in-out infinite}
@keyframes bob{50%{transform:translateY(-3px)}}
.node.done{border-color:rgba(52,211,153,.3)}
.node.done .led{background:var(--green);box-shadow:0 0 8px var(--green)}
.node.done .st{color:var(--green)}

.gate{width:104px;margin:7px 0;padding:13px 8px;border-radius:14px;text-align:center;
  border:1px solid rgba(167,139,250,.28);background:linear-gradient(180deg,rgba(167,139,250,.08),var(--surface))}
.gate .glabel{font-size:11px;font-weight:700;color:var(--violet);letter-spacing:.04em}
.gate .gsub{font-size:10px;color:var(--dim);margin-top:4px;text-transform:uppercase;letter-spacing:.1em}
.gate .gled{width:9px;height:9px;border-radius:50%;background:var(--dim);margin:8px auto 0}
.gate.wait{border-color:rgba(248,113,113,.5)}
.gate.wait .gled{background:var(--red);box-shadow:0 0 10px var(--red);animation:pulse 1s infinite}
.gate.wait .gsub{color:var(--red)}
.gate.open .gled{background:var(--green);box-shadow:0 0 10px var(--green)}
.gate.open .gsub{color:var(--green)}

.dock{width:118px;margin:7px 0;padding:13px 10px;border-radius:14px;text-align:center;
  border:1px solid var(--line);background:var(--surface)}
.dock.live{border-color:rgba(52,211,153,.5);background:linear-gradient(180deg,rgba(52,211,153,.12),var(--surface));
  box-shadow:0 0 30px rgba(52,211,153,.18)}
.dock .ic{font-size:24px}.dock .nm{font-size:11px;font-weight:600;color:var(--green);margin-top:7px}

.cols{display:grid;grid-template-columns:1.35fr 1fr;gap:18px;margin-top:30px}
@media(max-width:840px){.cols{grid-template-columns:1fr}}
.panel{padding:0;overflow:hidden}
.panel h2{font-size:13px;font-weight:600;margin:0;padding:14px 18px;border-bottom:1px solid var(--line);color:var(--ink);display:flex;align-items:center;gap:8px}
.panel .pb{padding:16px 18px}
.report{white-space:pre-wrap;font-size:13px;line-height:1.55;color:#c5cad8;max-height:320px;overflow:auto}
.domains{display:flex;flex-wrap:wrap;gap:7px;margin-top:14px}
.domains span{font-size:12px;color:var(--green);border:1px solid rgba(52,211,153,.28);background:rgba(52,211,153,.07);padding:4px 10px;border-radius:999px}
.pq{list-style:none;margin:0;padding:0}
.pq li{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--line);font-size:13px}
.pq li:last-child{border-bottom:0}
.pq .id{color:var(--cyan);font-weight:600}.pq .cat{color:var(--amber)}.pq .who{color:var(--mut);margin-left:auto}
.hint{color:var(--mut);font-size:12.5px;margin-top:14px}
.hint code{color:var(--green);background:var(--surface2);padding:2px 7px;border-radius:6px;font-family:'JetBrains Mono',monospace;font-size:12px}
</style>

<p class="eyebrow">Live pipeline</p>
<div class="statusbar card">
  <span id="dot" class="dot idle"></span>
  <span id="state" class="state">IDLE</span>
  <span id="phase" class="phase"></span>
  <span class="spacer"></span>
  <span id="pend" class="pendpill" hidden></span>
</div>

<div id="flow" class="flow"></div>

<div class="cols">
  <div class="panel card"><h2>💡 Current idea</h2><div class="pb">
    <div id="report" class="report empty">No idea yet — run the research agent.</div>
    <div id="domains" class="domains"></div>
  </div></div>
  <div class="panel card"><h2>⛳ Pending approvals</h2><div class="pb">
    <ul id="pq" class="pq"></ul>
    <div class="hint">Approve a gate: <code>npm run approve -- PROJECT_KICKOFF</code></div>
  </div></div>
</div>`;

const FACTORY_SCRIPT = /* html */ `<script>
const PIPELINE=[
  {id:'agent-research',icon:'🔎',short:'Research'},
  {gate:'KICKOFF_GATE',label:'Kickoff'},
  {id:'agent-architect',icon:'📐',short:'Architect'},
  {id:'agent-designer',icon:'🎨',short:'Design'},
  {id:'agent-product',icon:'📋',short:'Product'},
  {id:'agent-developer',icon:'💻',short:'Dev'},
  {id:'agent-qa',icon:'🧪',short:'QA'},
  {id:'agent-finance',icon:'💰',short:'Finance'},
  {id:'agent-marketing',icon:'📣',short:'Marketing'},
  {gate:'FINANCE_GATE',label:'Finance'},
  {gate:'DEPLOY_GATE',label:'Deploy'},
  {id:'agent-ops',icon:'🚀',short:'Ops'},
  {final:true,icon:'📦',short:'Shipped'},
];
const AGENT_STATE={'agent-research':'DISCOVERY','agent-architect':'BLUEPRINTING','agent-designer':'BLUEPRINTING','agent-product':'TRIAGE','agent-developer':'CONSTRUCTION','agent-qa':'CONSTRUCTION','agent-finance':'AUDIT','agent-marketing':'AUDIT','agent-ops':'DELIVERY'};
const ORDER=['IDLE','DISCOVERY','KICKOFF_GATE','BLUEPRINTING','TRIAGE','CONSTRUCTION','AUDIT','FINANCE_GATE','DEPLOY_GATE','DELIVERY','DEPLOYED'];
const idx=s=>{const k=ORDER.indexOf(s);return k<0?0:k};

function build(){
  const flow=document.getElementById('flow');
  PIPELINE.forEach((n,i)=>{
    if(i>0){const l=document.createElement('div');l.className='seg';l.innerHTML='<div class="link"></div>';flow.appendChild(l);}
    const seg=document.createElement('div');seg.className='seg';
    if(n.gate) seg.innerHTML='<div class="gate" data-gate="'+n.gate+'"><div class="glabel">'+n.label+'</div><div class="gsub">gate</div><div class="gled"></div></div>';
    else if(n.final) seg.innerHTML='<div class="dock" data-final="1"><div class="ic">📦</div><div class="nm">Shipped</div></div>';
    else seg.innerHTML='<div class="node" data-agent="'+n.id+'"><div class="led"></div><div class="ic">'+n.icon+'</div><div class="nm">'+n.short+'</div><div class="st">idle</div></div>';
    flow.appendChild(seg);
  });
}
function render(d){
  const st=d.engine.state||'IDLE';
  const approvals=(d.actions||[]).filter(a=>String(a.decision).toUpperCase()==='APPROVE').map(a=>a.gate);
  const curIdx=idx(st), isGate=st.endsWith('_GATE');
  const cls=st==='DEPLOYED'?'ship':isGate?'gate':st==='IDLE'?'idle':'run';
  document.getElementById('dot').className='dot '+cls;
  document.getElementById('state').textContent=st;
  document.getElementById('phase').textContent=isGate?'awaiting CEO ▸ '+st.replace('_GATE',''):(st==='DEPLOYED'?'product shipped':st==='IDLE'?'ready':'building…');

  document.querySelectorAll('.node').forEach(m=>{
    const ms=AGENT_STATE[m.dataset.agent];m.classList.remove('run','done');
    const st2=m.querySelector('.st');
    if(ms===st){m.classList.add('run');st2.textContent='running';}
    else if(idx(ms)<curIdx||st==='DEPLOYED'){m.classList.add('done');st2.textContent='done';}
    else st2.textContent='idle';
  });
  // light links up to current progress
  const segs=[...document.querySelectorAll('.flow .link')];
  segs.forEach((l,i)=>l.classList.toggle('lit', i < curIdx*1.3));
  document.querySelectorAll('.gate').forEach(t=>{
    const g=t.dataset.gate;t.classList.remove('open','wait');
    if(approvals.includes(g))t.classList.add('open');else if(st===g)t.classList.add('wait');
  });
  const dock=document.querySelector('.dock');if(dock)dock.classList.toggle('live',st==='DEPLOYED');

  const rep=document.getElementById('report');
  if(d.idea){rep.textContent=d.idea;rep.classList.remove('empty');}
  const dom=document.getElementById('domains');dom.innerHTML='';
  if(d.deploy&&d.deploy.domainRecommendations)d.deploy.domainRecommendations.forEach(x=>{const s=document.createElement('span');s.textContent=x.domain;dom.appendChild(s);});

  const open=(d.pending||[]).filter(a=>a.status==='PENDING');
  const pend=document.getElementById('pend');
  if(open.length){pend.hidden=false;pend.textContent='⛳ '+open.length+' pending';}else pend.hidden=true;
  const pq=document.getElementById('pq');pq.innerHTML='';
  if(!open.length)pq.innerHTML='<li class="empty">None — running free until next gate.</li>';
  else open.forEach(a=>{const li=document.createElement('li');li.innerHTML='<span class="id">#'+a.id+'</span><span class="cat">'+a.category+'</span><span class="who">'+a.agent+'</span>';pq.appendChild(li);});
}
async function poll(){try{const r=await fetch(window.BASE+'/api/state',{cache:'no-store'});render(await r.json());}catch(e){}}
build();poll();setInterval(poll,2000);
</script>`;

const FACTORY_PAGE = shell({ title: 'AgentiCorp · Factory', active: 'factory', body: FACTORY_BODY, script: FACTORY_SCRIPT });

// ── Ideas view ───────────────────────────────────────────────────────────────
const IDEAS_BODY = /* html */ `
<style>
.ihead{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:18px}
.ihead .lead{font-size:13px;color:var(--mut);max-width:560px}
.sort{display:flex;gap:4px;padding:4px;border:1px solid var(--line);border-radius:10px;background:var(--surface)}
.sort button{font:500 12.5px 'Inter',sans-serif;color:var(--mut);background:none;border:0;padding:6px 12px;border-radius:7px;cursor:pointer;transition:.15s}
.sort button.on{color:#0a0b0f;background:linear-gradient(135deg,#818cf8,#22d3ee);font-weight:600}
.sort button:not(.on):hover{color:var(--ink)}

.igrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:16px}
.idea{padding:18px;display:flex;flex-direction:column;gap:0;transition:.2s}
.idea:hover{border-color:var(--line2)}
.idea .top{display:flex;align-items:flex-start;gap:14px}
.score{flex:none;width:52px;height:52px;border-radius:13px;display:grid;place-items:center;font-weight:800;font-size:19px;
  border:1px solid var(--line2)}
.score.hi{color:var(--green);background:rgba(52,211,153,.10);border-color:rgba(52,211,153,.35)}
.score.md{color:var(--amber);background:rgba(251,191,36,.10);border-color:rgba(251,191,36,.35)}
.score.lo{color:var(--red);background:rgba(248,113,113,.10);border-color:rgba(248,113,113,.35)}
.idea h3{font-size:16px;font-weight:700;margin:0 0 4px;letter-spacing:-.2px}
.idea .meta{font-size:12px;color:var(--dim);font-family:'JetBrains Mono',monospace}
.badge{font-size:11px;font-weight:600;padding:3px 9px;border-radius:999px;border:1px solid var(--line2);text-transform:capitalize}
.badge.new{color:var(--cyan);border-color:rgba(34,211,238,.35);background:rgba(34,211,238,.08)}
.badge.approved{color:var(--green);border-color:rgba(52,211,153,.35);background:rgba(52,211,153,.08)}
.badge.rejected{color:var(--red);border-color:rgba(248,113,113,.35);background:rgba(248,113,113,.08)}
.badge.in-pipeline{color:var(--amber);border-color:rgba(251,191,36,.35);background:rgba(251,191,36,.08)}
.badge.shipped{color:var(--green);border-color:rgba(52,211,153,.35);background:rgba(52,211,153,.08)}

.idea .problem{font-size:13.5px;color:#c5cad8;line-height:1.5;margin:14px 0 0}
.idea .facts{display:flex;flex-wrap:wrap;gap:6px;margin-top:13px}
.fact{font-size:11.5px;color:var(--mut);border:1px solid var(--line);background:var(--surface2);padding:4px 9px;border-radius:7px}
.fact b{color:var(--ink);font-weight:600}
.idea .conf{margin-left:auto}

.idea .acts{display:flex;align-items:center;gap:8px;margin-top:16px;padding-top:14px;border-top:1px solid var(--line)}
.btn{font:600 12.5px 'Inter',sans-serif;padding:8px 14px;border-radius:9px;border:1px solid var(--line2);background:var(--surface2);color:var(--ink);cursor:pointer;transition:.15s}
.btn:hover{border-color:var(--line2);background:#23262f}
.btn.go{border:0;color:#0a0b0f;background:linear-gradient(135deg,#34d399,#22d3ee)}
.btn.no{color:var(--red);border-color:rgba(248,113,113,.3)}
.btn.no:hover{background:rgba(248,113,113,.1)}
.btn.ghost{margin-left:auto;color:var(--mut);background:none;border-color:var(--line)}
.btn.ghost:hover{color:var(--ink)}
.btn[disabled]{opacity:.4;cursor:default}

.detail{margin-top:14px;padding-top:14px;border-top:1px solid var(--line);white-space:pre-wrap;
  font:13px/1.55 'JetBrains Mono',monospace;color:#aeb4c4;max-height:0;overflow:hidden;transition:max-height .25s}
.idea.open .detail{max-height:520px;overflow:auto}
.emptybox{grid-column:1/-1;padding:50px;text-align:center}
.emptybox .big{font-size:15px;color:var(--ink);font-weight:600}
.emptybox code{color:var(--green);background:var(--surface2);padding:2px 8px;border-radius:6px;font-family:'JetBrains Mono',monospace}
</style>

<div class="ihead">
  <div>
    <p class="eyebrow" style="margin-bottom:8px">Idea board</p>
    <div class="lead">Every opportunity the research agent surfaces. Greenlight one to send it into the factory, or reject to discard.</div>
  </div>
  <div class="sort">
    <button data-sort="score" class="on">Top score</button>
    <button data-sort="new">Newest</button>
  </div>
</div>
<div id="igrid" class="igrid"></div>`;

const IDEAS_SCRIPT = /* html */ `<script>
let SORT='score', ENGINE='IDLE';
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const tier=n=>n>=70?'hi':n>=45?'md':'lo';
const STATUS_LABEL={'new':'new','approved':'approved','rejected':'rejected','in-pipeline':'in pipeline','shipped':'shipped'};

function card(it){
  const s=it.status||'new', t=tier(it.score||0);
  const facts=[
    it.model?'<span class="fact"><b>'+esc(it.model)+'</b></span>':'',
    it.priceRange?'<span class="fact">'+esc(it.priceRange)+'</span>':'',
    it.marketSize?'<span class="fact">market: <b>'+esc(it.marketSize)+'</b></span>':'',
    '<span class="fact conf">confidence: <b>'+esc(it.confidence||'—')+'</b></span>',
  ].join('');
  const niche=(it.niche||[]).map(n=>'• '+n).join('\\n');
  const detail=esc((it.report||'')||((it.audience?'Audience: '+it.audience+'\\n\\n':'')+niche));
  const decided=(s==='approved'||s==='rejected'||s==='in-pipeline'||s==='shipped');
  const acts=decided
    ? (s==='rejected'?'<span class="badge rejected">rejected</span>':'<a class="btn go" href="'+window.BASE+'/">View in factory →</a>')
    : '<button class="btn go" data-act="approve" data-id="'+it.id+'">Approve ▸ pipeline</button><button class="btn no" data-act="reject" data-id="'+it.id+'">Reject</button>';
  return '<div class="idea card" data-card="'+it.id+'">'
    +'<div class="top"><div class="score '+t+'">'+(it.score||0)+'</div>'
    +'<div style="flex:1"><div style="display:flex;align-items:center;gap:10px"><h3 style="flex:1">'+esc(it.title)+'</h3><span class="badge '+s+'">'+(STATUS_LABEL[s]||s)+'</span></div>'
    +'<div class="meta">'+esc(it.id)+' · '+new Date(it.createdAt).toLocaleDateString()+'</div></div></div>'
    +'<p class="problem">'+esc(it.problem)+'</p>'
    +'<div class="facts">'+facts+'</div>'
    +'<div class="acts">'+acts+'<button class="btn ghost" data-toggle="'+it.id+'">Details</button></div>'
    +'<div class="detail">'+detail+'</div></div>';
}
function sortIdeas(a){return [...a].sort((x,y)=> SORT==='score' ? (y.score||0)-(x.score||0) : new Date(y.createdAt)-new Date(x.createdAt));}
function paint(ideas){
  const g=document.getElementById('igrid');
  if(!ideas||!ideas.length){g.innerHTML='<div class="card emptybox"><div class="big">No ideas yet.</div><div style="color:var(--mut);margin-top:8px">Run <code>npm run research</code> to surface one.</div></div>';return;}
  g.innerHTML=sortIdeas(ideas).map(card).join('');
}
async function load(){try{const r=await fetch(window.BASE+'/api/state',{cache:'no-store'});const d=await r.json();ENGINE=d.engine.state;paint(d.ideas);}catch(e){}}
async function decide(id,status){
  await fetch(window.BASE+'/api/ideas/decision',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,status})});
  load();
}
document.addEventListener('click',e=>{
  const s=e.target.closest('[data-sort]'); if(s){SORT=s.dataset.sort;document.querySelectorAll('.sort button').forEach(b=>b.classList.toggle('on',b===s));load();return;}
  const t=e.target.closest('[data-toggle]'); if(t){document.querySelector('[data-card="'+t.dataset.toggle+'"]').classList.toggle('open');return;}
  const a=e.target.closest('[data-act]'); if(a){a.disabled=true;decide(a.dataset.id, a.dataset.act==='approve'?'approved':'rejected');}
});
load();setInterval(load,4000);
</script>`;

const IDEAS_PAGE = shell({ title: 'AgentiCorp · Ideas', active: 'ideas', body: IDEAS_BODY, script: IDEAS_SCRIPT });

// ── Permissions view ─────────────────────────────────────────────────────────
function permsPage(data) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cards = Object.entries(data.config.agents).map(([id, a]) => {
    const p = a.permissions ?? {};
    const b = (v) => v === true ? '<span class="yes">allow</span>' : v === false ? '<span class="no">deny</span>' : `<span class="frz">${esc(v)}</span>`;
    const frozen = (p.frozenActions ?? []).map((f) => `<span class="chip">${esc(f)}</span>`).join('') || '<span class="muted">none</span>';
    return `<div class="pcard card"><div class="ph"><h3>${esc(id)}</h3><p class="role">${esc(a.role)}</p></div>
<div class="lbl">Skills</div><div class="chips">${(a.skills ?? []).map((s) => `<span class="chip sk">${esc(s)}</span>`).join('')}</div>
<div class="lbl">Permissions</div><table>
<tr><td>workspace write</td><td>${b(p.workspaceWrite)}</td></tr>
<tr><td>network</td><td><code>${esc(p.network ?? 'n/a')}</code></td></tr>
<tr><td>execute payments</td><td>${b(p.executePayments)}</td></tr>
<tr><td>deploy</td><td>${b(p.deploy)}</td></tr>
<tr><td>approve gates</td><td>${b(p.canApproveGates)}</td></tr>
${p.canBlockPipeline ? '<tr><td>block pipeline</td><td><span class="yes">yes</span></td></tr>' : ''}
</table><div class="lbl">Frozen ▸ needs CEO</div><div class="chips">${frozen}</div>
${p.note ? `<p class="note">${esc(p.note)}</p>` : ''}</div>`;
  }).join('');
  const body = `<style>
.intro{padding:16px 20px;margin-bottom:22px;color:var(--mut);font-size:13.5px;line-height:1.55}
.intro b{color:var(--violet)}
.pgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:16px}
.pcard{padding:0;overflow:hidden}
.ph{padding:15px 16px;border-bottom:1px solid var(--line)}
.pcard h3{font-size:14px;font-weight:700;color:var(--cyan);margin:0}.role{color:var(--mut);font-size:12.5px;margin:4px 0 0}
.lbl{font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--dim);margin:16px 16px 8px}
.chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 16px}
.chip{font-size:12px;padding:4px 9px;border:1px solid var(--line);background:var(--surface2);color:var(--cyan);border-radius:7px;font-family:'JetBrains Mono',monospace}
.chip.sk{color:var(--green);border-color:rgba(52,211,153,.25);background:rgba(52,211,153,.06)}
table{border-collapse:collapse;width:calc(100% - 32px);margin:2px 16px 0}
td{border-bottom:1px solid var(--line);padding:8px 2px;font-size:13px;color:var(--ink)}
td:last-child{text-align:right}
.yes{color:var(--green);font-weight:600;font-size:12px}.no{color:var(--red);font-weight:600;font-size:12px}.frz{color:var(--amber);font-size:12px}
.muted{color:var(--mut)}code{color:var(--cyan);font-family:'JetBrains Mono',monospace;font-size:12.5px}
.note{color:var(--mut);font-size:12.5px;margin:12px 16px 16px;border-top:1px solid var(--line);padding-top:12px}
.pcard table+.lbl{margin-top:16px}.pcard .chips:last-of-type{padding-bottom:16px}
</style>
<p class="eyebrow">Governance</p>
<div class="intro card"><b>The Golden Rule</b> — no agent executes payments, registers domains, or deploys to live infra without explicit CEO approval. Frozen actions route to the approval queue.</div>
<div class="pgrid">${cards}</div>`;
  return shell({ title: 'AgentiCorp · Permissions', active: 'perms', body });
}

// ── Server ───────────────────────────────────────────────────────────────────

// Greenlight an idea into the factory: mark it in-pipeline, activate its
// report as the pipeline's TrendReport, and record the KICKOFF gate approval
// (mirrors cli.js). The KICKOFF gate carries no money/domain/deploy risk, so
// the Golden Rule still funnels FINANCE + DEPLOY through the approval CLI.
async function approveIdea(id) {
  const store = await loadJSON(IDEAS_FILE, { ideas: [] });
  const idea = store.ideas.find((i) => i.id === id);
  if (!idea) throw new Error(`unknown idea ${id}`);

  // The approved idea becomes the active TrendReport the pipeline builds.
  if (idea.report) await writeFile(TRENDREPORT_FILE, idea.report);
  await writeFile(IDEAS_FILE, JSON.stringify(setIdeaStatus(store, id, 'in-pipeline'), null, 2));

  // Record the gate approval, just like `npm run approve -- PROJECT_KICKOFF`.
  const actions = await loadJSON(CEO_ACTIONS_FILE, { approvals: [] });
  actions.approvals.push({ gate: KICKOFF_GATE, decision: 'APPROVE', decidedAt: new Date().toISOString(), idea: id });
  await writeFile(CEO_ACTIONS_FILE, JSON.stringify(actions, null, 2));

  // Resolve any pending kickoff entries so the queue clears.
  const pend = await loadJSON(PENDING_FILE, { pending: [] });
  for (const a of pend.pending) {
    if (a.status === 'PENDING' && (a.action === KICKOFF_GATE || a.detail?.gate === KICKOFF_GATE)) {
      a.status = 'APPROVED';
      a.decidedAt = new Date().toISOString();
    }
  }
  await writeFile(PENDING_FILE, JSON.stringify(pend, null, 2));
}

function readBody(req) {
  return new Promise((res) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => res(b));
  });
}

createServer(async (req, res) => {
  // Strip the mount prefix so route matching is subpath-agnostic. nginx passes
  // the full URI (e.g. /agenticorp/ideas); locally BASE is "" and this is a no-op.
  let url = req.url || '/';
  if (BASE && (url === BASE || url.startsWith(BASE + '/'))) url = url.slice(BASE.length) || '/';

  if (url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (url === '/favicon.svg') {
    res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'max-age=86400' });
    res.end(FAVICON);
    return;
  }

  // CEO greenlights/rejects an idea from the Ideas board (the CEO is the
  // authority, same as cli.js). A reject just flips status. An approve also
  // fires the kickoff gate: it makes the chosen idea the active TrendReport
  // and records a PROJECT_KICKOFF approval — exactly like
  // `npm run approve -- PROJECT_KICKOFF`, so the engine advances on next run.
  if (url === '/api/ideas/decision' && req.method === 'POST') {
    try {
      const { id, status } = JSON.parse(await readBody(req));
      if (status === 'approved') await approveIdea(id);
      else {
        const store = await loadJSON(IDEAS_FILE, { ideas: [] });
        await writeFile(IDEAS_FILE, JSON.stringify(setIdeaStatus(store, id, status), null, 2));
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  if (url === '/api/state') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(await snapshot()));
    return;
  }
  if (url.startsWith('/ideas')) {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(IDEAS_PAGE);
    return;
  }
  if (url.startsWith('/permissions')) {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(permsPage(await snapshot()));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(FACTORY_PAGE);
}).listen(PORT, () => {
  console.log(`CEO dashboard on http://localhost:${PORT}`);
});
