/**
 * dsh-edict — 军机处 kanban dashboard (imperial 奏折 theme).
 *
 * A single self-contained HTML page served by the plugin's webServer route.
 * Layout: a stats header (在办/叫停/今日完工/封驳/部务), the six-stage pipeline
 * board, a vermilion alert strip for 叫停 tasks, a search box, a right-side
 * detail drawer, and the 📜 奏折阁 archive tab. All API paths are absolute
 * (/edict/…) because the page is itself served under /edict/. Polling pauses
 * while the tab is hidden.
 */
export const DASHBOARD_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>⚔️ 军机处 · 三省六部</title>
<style>
  :root{
    color-scheme: dark;
    --ink-0:#100e0a; --ink-1:#17130d; --ink-2:#1e1912; --ink-3:#2a2218;
    --line:#3a2f1e; --line-soft:#2c2418;
    --gold:#c9a86a; --gold-dim:#8a744c; --gold-bright:#e4c98a;
    --vermilion:#b04a3a; --vermilion-bright:#d06a52;
    --jade:#7fb58a; --jade-dim:#4e7a58;
    --ink-fg:#e8dfce; --ink-mut:#a89a80; --ink-faint:#6f6350;
  }
  *{ box-sizing:border-box; }
  body{ margin:0; font-family:"Songti SC","Noto Serif CJK SC",-apple-system,"PingFang SC","Noto Sans CJK SC",serif;
         background:radial-gradient(1200px 600px at 70% -10%, #201a10 0%, var(--ink-0) 55%); color:var(--ink-fg); }
  header{ padding:14px 22px 10px; border-bottom:1px solid var(--line-soft);
          background:linear-gradient(180deg, rgba(201,168,106,.06), transparent); }
  .htop{ display:flex; align-items:center; gap:14px; flex-wrap:wrap; }
  .seal{ display:flex; align-items:center; gap:10px; }
  .sealmark{ width:34px; height:34px; border-radius:8px; display:grid; place-items:center; font-size:18px;
             background:linear-gradient(145deg,var(--vermilion),#7d3328); color:#f4e4d4;
             box-shadow:0 2px 10px rgba(176,74,58,.35); border:1px solid #8d4134; }
  .seal h1{ font-size:17px; margin:0; font-weight:700; letter-spacing:.08em; color:var(--gold-bright); }
  .seal .sub{ font-size:11px; color:var(--ink-faint); letter-spacing:.2em; }
  .spacer{ flex:1; }
  .pulse{ display:flex; align-items:center; gap:6px; font-size:11px; color:var(--ink-mut); }
  .pulse i{ width:8px; height:8px; border-radius:50%; background:var(--jade);
            animation:pulse 2s infinite; }
  @keyframes pulse{ 70%{ box-shadow:0 0 0 7px rgba(127,181,138,0);} 100%{ box-shadow:0 0 0 0 rgba(127,181,138,0);} }
  .stats{ display:flex; gap:10px; margin-top:12px; flex-wrap:wrap; }
  .stat{ background:var(--ink-2); border:1px solid var(--line-soft); border-radius:10px; padding:7px 14px;
         display:flex; align-items:baseline; gap:8px; min-width:96px; }
  .stat b{ font-size:19px; color:var(--gold-bright); font-family:ui-monospace,monospace; }
  .stat span{ font-size:11px; color:var(--ink-mut); }
  .stat.red b{ color:var(--vermilion-bright); } .stat.green b{ color:var(--jade); }
  .hcontrols{ display:flex; gap:8px; align-items:center; margin-top:12px; flex-wrap:wrap; }
  .tabs{ display:flex; gap:4px; background:var(--ink-1); border:1px solid var(--line-soft); border-radius:9px; padding:3px; }
  .tab{ background:transparent; border:none; color:var(--ink-mut); border-radius:7px; padding:5px 15px;
        font-size:13px; cursor:pointer; font-family:inherit; }
  .tab.active{ color:var(--gold-bright); background:var(--ink-3); }
  .search{ background:var(--ink-1); border:1px solid var(--line-soft); border-radius:9px; color:var(--ink-fg);
           padding:6px 12px; font-size:12px; width:190px; outline:none; font-family:inherit; }
  .search:focus{ border-color:var(--gold-dim); }
  .meta{ font-size:11px; color:var(--ink-faint); margin-left:auto; }

  .alerts{ padding:10px 22px 0; display:flex; flex-direction:column; gap:8px; }
  .alert{ background:linear-gradient(90deg, rgba(176,74,58,.16), rgba(176,74,58,.04));
          border:1px solid #5d2e26; border-left:3px solid var(--vermilion); border-radius:8px;
          padding:8px 14px; font-size:12.5px; cursor:pointer; display:flex; gap:10px; align-items:center; }
  .alert:hover{ border-color:var(--vermilion-bright); }
  .alert .tid{ color:var(--ink-faint); font-family:ui-monospace,monospace; font-size:11px; }

  .board{ display:flex; gap:10px; padding:16px 22px; overflow-x:auto; align-items:flex-start; }
  .col{ min-width:218px; flex:1; background:linear-gradient(180deg,var(--ink-1),var(--ink-0));
        border:1px solid var(--line-soft); border-radius:12px; padding:10px; }
  .col h2{ font-size:12.5px; margin:0 0 9px; display:flex; gap:7px; align-items:center; font-weight:600;
           color:var(--ink-mut); letter-spacing:.05em; }
  .col h2 .idx{ color:var(--gold-dim); font-family:ui-monospace,monospace; font-size:10px; }
  .col h2 .n{ margin-left:auto; background:var(--ink-3); border-radius:10px; padding:0 8px; font-size:11px; color:var(--gold); }
  .col.intake{ border-top:2px solid #7a6aa8; } .col.planning{ border-top:2px solid #6a86c0; }
  .col.review{ border-top:2px solid var(--gold); } .col.dispatching{ border-top:2px solid #5aa8a0; }
  .col.doing{ border-top:2px solid var(--jade); } .col.final_review{ border-top:2px solid #a88ac4; }
  .card{ background:var(--ink-2); border:1px solid var(--line-soft); border-radius:9px; padding:10px 11px;
         margin-bottom:9px; cursor:pointer; transition:border-color .15s, transform .1s; }
  .card:hover{ border-color:var(--gold-dim); transform:translateY(-1px); }
  .card .tid{ font-size:10px; color:var(--ink-faint); font-family:ui-monospace,monospace; display:flex; justify-content:space-between; }
  .card .title{ font-size:13.5px; margin:4px 0; line-height:1.4; color:var(--ink-fg); font-weight:600; }
  .card .cur{ font-size:11px; color:var(--ink-mut); line-height:1.45;
              display:-webkit-box; -webkit-line-clamp:1; -webkit-box-orient:vertical; overflow:hidden; }
  .ministries{ display:flex; gap:3px; margin:7px 0 2px; flex-wrap:wrap; }
  .mo{ width:22px; height:22px; border-radius:6px; display:grid; place-items:center; font-size:12px;
       background:var(--ink-3); border:1px solid var(--line-soft); }
  .mo.done{ background:rgba(127,181,138,.15); border-color:var(--jade-dim); }
  .mo.doing{ background:rgba(201,168,106,.18); border-color:var(--gold-dim); animation:work 1.6s infinite; }
  .mo.failed{ background:rgba(208,106,82,.2); border-color:var(--vermilion); }
  @keyframes work{ 50%{ box-shadow:0 0 0 3px rgba(201,168,106,.12);} }
  .bar{ height:4px; background:var(--ink-3); border-radius:3px; overflow:hidden; margin-top:7px; }
  .bar i{ display:block; height:100%; background:linear-gradient(90deg,var(--gold-dim),var(--jade)); border-radius:3px; transition:width .3s; }
  .badges{ display:flex; gap:5px; flex-wrap:wrap; margin-top:7px; }
  .badge{ font-size:10px; padding:1px 7px; border-radius:9px; border:1px solid var(--line); color:var(--ink-mut); }
  .badge.gold{ color:var(--gold); border-color:var(--gold-dim); background:rgba(201,168,106,.08); }
  .badge.red{ color:var(--vermilion-bright); border-color:#5d2e26; background:rgba(176,74,58,.1); }
  .empty{ color:var(--ink-faint); font-size:11px; text-align:center; padding:16px 0; }

  .drawer-mask{ position:fixed; inset:0; background:rgba(0,0,0,.5); opacity:0; pointer-events:none; transition:opacity .2s; z-index:20; }
  .drawer-mask.open{ opacity:1; pointer-events:auto; }
  .drawer{ position:fixed; top:0; right:0; width:min(460px,94vw); height:100vh; z-index:21;
           background:var(--ink-1); border-left:1px solid var(--line); box-shadow:-12px 0 40px rgba(0,0,0,.5);
           transform:translateX(100%); transition:transform .25s ease; display:flex; flex-direction:column; }
  .drawer.open{ transform:translateX(0); }
  .drawer .dhead{ padding:16px 20px; border-bottom:1px solid var(--line-soft); display:flex; gap:10px; align-items:flex-start; }
  .drawer .dhead h3{ margin:0; font-size:16px; color:var(--gold-bright); }
  .drawer .dhead .tid{ font-size:11px; color:var(--ink-faint); font-family:ui-monospace,monospace; margin-top:3px; }
  .drawer .dbody{ flex:1; overflow:auto; padding:16px 20px; }
  .drawer .x{ margin-left:auto; background:var(--ink-3); border:1px solid var(--line); color:var(--ink-mut);
              border-radius:7px; padding:4px 11px; cursor:pointer; font-family:inherit; }
  .drawer h4{ font-size:11px; color:var(--gold-dim); margin:18px 0 7px; letter-spacing:.15em; font-weight:600; }
  .row{ font-size:12.5px; line-height:1.7; color:var(--ink-fg); }
  .row .mut{ color:var(--ink-mut); }
  .flow{ border-left:2px solid var(--line); margin-left:6px; padding-left:15px; }
  .flow .ev{ position:relative; margin-bottom:11px; font-size:12px; }
  .flow .ev::before{ content:""; position:absolute; left:-21px; top:4px; width:9px; height:9px; border-radius:50%;
                     background:var(--gold-dim); border:2px solid var(--ink-1); }
  .flow .ev .t{ color:var(--ink-faint); font-size:10px; font-family:ui-monospace,monospace; }
  .flow .ev .r{ color:var(--ink-fg); } .flow .ev .rm{ color:var(--ink-mut); }
  .dbtns{ display:flex; gap:8px; padding:12px 20px; border-top:1px solid var(--line-soft); }
  button.btn{ background:var(--ink-3); color:var(--ink-fg); border:1px solid var(--line);
              border-radius:8px; padding:7px 14px; font-size:13px; cursor:pointer; font-family:inherit; }
  button.btn:hover{ border-color:var(--gold-dim); }
  button.btn.danger{ color:var(--vermilion-bright); border-color:#5d2e26; }
  button.btn.ok{ color:var(--jade); border-color:var(--jade-dim); }
  .ctrlnote{ font-size:11px; color:var(--gold); padding:0 20px 12px; }

  .memorials{ padding:18px 22px; max-width:920px; margin:0 auto; }
  .mem{ background:linear-gradient(180deg,var(--ink-2),var(--ink-1)); border:1px solid var(--line-soft);
        border-radius:12px; padding:16px 20px; margin-bottom:14px; border-left:3px solid var(--gold-dim); }
  .mem h3{ margin:0 0 3px; font-size:15.5px; color:var(--gold-bright); }
  .mem .tid{ font-size:11px; color:var(--ink-faint); font-family:ui-monospace,monospace; }
  .mem .sum{ font-size:13px; color:var(--ink-fg); line-height:1.7; margin:10px 0; white-space:pre-wrap; }
  .mem .outs{ font-size:12px; color:#8ab4d8; word-break:break-all; line-height:1.8; }
  .stages{ display:flex; gap:5px; flex-wrap:wrap; margin-top:12px; }
  .stage{ font-size:10px; padding:2px 9px; border-radius:9px; background:var(--ink-3);
          border:1px solid var(--line-soft); color:var(--ink-faint); }
  .stage.hit{ color:var(--jade); border-color:var(--jade-dim); background:rgba(127,181,138,.08); }
  ::-webkit-scrollbar{ height:9px; width:9px; } ::-webkit-scrollbar-thumb{ background:var(--ink-3); border-radius:6px; }
</style>
</head>
<body>
<header>
  <div class="htop">
    <div class="seal">
      <div class="sealmark">⚔</div>
      <div><h1>军机处</h1><div class="sub">三 省 六 部 · 旨 意 调 度</div></div>
    </div>
    <div class="spacer"></div>
    <div class="pulse"><i></i><span>实时</span></div>
  </div>
  <div class="stats" id="stats"></div>
  <div class="hcontrols">
    <div class="tabs">
      <button class="tab active" id="tabBoard" onclick="switchView('board')">📋 旨意看板</button>
      <button class="tab" id="tabMem" onclick="switchView('memorials')">📜 奏折阁</button>
    </div>
    <input class="search" id="search" placeholder="搜索旨意标题 / 编号…" oninput="onSearch()"/>
    <span class="meta" id="meta"></span>
  </div>
</header>
<div class="alerts" id="alerts"></div>
<div class="board" id="board"></div>
<div class="memorials" id="memorials" style="display:none"></div>
<div class="drawer-mask" id="mask" onclick="closeDrawer()"></div>
<div class="drawer" id="drawer">
  <div class="dhead"><div><h3 id="dTitle"></h3><div class="tid" id="dTid"></div></div>
    <button class="x" onclick="closeDrawer()">✕</button></div>
  <div class="dbody" id="dBody"></div>
  <div class="ctrlnote" id="dNote"></div>
  <div class="dbtns" id="dBtns"></div>
</div>
<script>
const COLS = [
  ["intake","🤴","太子分拣"],["planning","📜","中书规划"],["review","🔍","门下审议"],
  ["dispatching","📮","尚书派发"],["doing","⚔️","六部执行"],["final_review","📤","回奏审定"]
];
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmt = iso => iso ? new Date(iso).toLocaleString("zh-CN",{hour12:false,month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"}) : "";
const ageMin = iso => Math.round((Date.now()-new Date(iso).getTime())/60000);
let DATA = { tasks: [] }, view = "board", query = "", curId = null;

function hb(t){
  if (t.status==="blocked") return "🛑";
  if (["done","cancelled"].includes(t.status)) return "";
  const s = (Date.now()-new Date(t.updatedAt).getTime())/1000;
  if (s<60) return "🟢"; if (s<300) return "🟡"; return "🔴";
}
function renderStats(){
  const ts = DATA.tasks;
  const active = ts.filter(t=>!["done","cancelled","blocked"].includes(t.status)).length;
  const blocked = ts.filter(t=>t.status==="blocked").length;
  const today = new Date().toISOString().slice(0,10);
  const doneToday = ts.filter(t=>t.memorial && t.memorial.at.slice(0,10)===today).length;
  const fengbo = ts.filter(t=>!["done","cancelled"].includes(t.status)).reduce((n,t)=>n+(t.round||0),0);
  const asg = ts.flatMap(t=>t.assignments||[]);
  const asgDone = asg.filter(a=>a.status==="done").length;
  const asgFail = asg.filter(a=>a.status==="failed").length;
  const stat = (k,v,c,suffix) => \`<div class="stat \${c}"><b>\${v}</b><span>\${k}\${suffix||""}</span></div>\`;
  document.getElementById("stats").innerHTML =
    stat("在办", active, "") +
    stat("叫停", blocked, blocked?"red":"") +
    stat("今日完工", doneToday, "green") +
    stat("封驳", fengbo, fengbo?"":"", fengbo?" 次":"") +
    stat("部务", asg.length? asgDone+"/"+asg.length : "—", asgFail?"red":"", asgFail?" ❋"+asgFail+"败":"");
}
function matchQ(t){
  if (!query) return true;
  const q = query.toLowerCase();
  return (t.title+" "+t.id+" "+(t.current||"")).toLowerCase().includes(q);
}
function ministryRow(t){
  if (!t.assignments || !t.assignments.length) return "";
  const mos = t.assignments.map(a =>
    \`<div class="mo \${a.status}" title="\${esc(a.ministry)}：\${a.status}">\${a.emoji||"●"}</div>\`).join("");
  const done = t.assignments.filter(a=>a.status==="done").length;
  const pct = Math.round(done/t.assignments.length*100);
  return \`<div class="ministries">\${mos}</div><div class="bar"><i style="width:\${pct}%"></i></div>\`;
}
function cardHtml(t){
  const dot = hb(t);
  const when = ["done","cancelled"].includes(t.status) ? "" : ageMin(t.updatedAt)+" 分钟前";
  return \`<div class="card" onclick="openDrawer('\${t.id}')">
    <div class="tid"><span>\${t.id}</span><span>\${dot}\${dot?" ":""}\${when}</span></div>
    <div class="title">\${esc(t.title)}</div>
    <div class="cur">\${esc(t.current||"")}</div>
    \${ministryRow(t)}
    <div class="badges">
      \${t.round?\`<span class="badge gold">封驳 \${t.round} 次</span>\`:""}
      \${t.assignments.some(a=>a.status==="failed")?\`<span class="badge red">部务失败</span>\`:""}
      \${t.goalId?\`<span class="badge gold">🎯 联动</span>\`:""}
      \${t.pendingControl?\`<span class="badge red">待处理干预</span>\`:""}
    </div></div>\`;
}
function renderBoard(){
  const alerts = DATA.tasks.filter(t=>t.status==="blocked" && matchQ(t));
  document.getElementById("alerts").innerHTML = alerts.length
    ? alerts.map(t=>\`<div class="alert" onclick="openDrawer('\${t.id}')">🛑 <b>\${esc(t.title)}</b>
        <span class="tid">\${t.id}</span><span style="margin-left:auto;color:var(--ink-mut)">已叫停 · 点击处置</span></div>\`).join("")
    : "";
  document.getElementById("board").innerHTML = COLS.map(([key,icon,label],i)=>{
    const tasks = DATA.tasks.filter(t=>t.status===key && matchQ(t));
    return \`<div class="col \${key}"><h2><span class="idx">\${String(i+1).padStart(2,"0")}</span>
      \${icon} \${label}<span class="n">\${tasks.length}</span></h2>
      \${tasks.length? tasks.map(cardHtml).join("") : '<div class="empty">—</div>'}</div>\`;
  }).join("");
}
const STAGE_LABELS=[["intake","🤴 太子分拣"],["planning","📜 中书规划"],["review","🔍 门下审议"],
  ["dispatching","📮 尚书派发"],["doing","⚔️ 六部执行"],["final_review","📤 回奏"],["done","✅ 完成"]];
function renderMemorials(){
  const mems = DATA.tasks.filter(t=>t.memorial);
  const el = document.getElementById("memorials");
  if (!mems.length){ el.innerHTML='<div class="empty">奏折阁暂无归档——旨意完成回奏后自动入阁。</div>'; return; }
  el.innerHTML = mems.map(t=>{
    const hit = new Set((t.flow||[]).map(e=>e.to));
    const stages = STAGE_LABELS.map(([k,l])=>\`<span class="stage \${hit.has(k)?"hit":""}">\${hit.has(k)?"✓ ":""}\${l}</span>\`).join("");
    const outs = (t.memorial.outputs||[]).length ? \`<div class="outs">\${t.memorial.outputs.map(o=>"📎 "+esc(o)).join("　")}</div>\` : "";
    return \`<div class="mem"><h3>\${esc(t.title)}</h3>
      <div class="tid">\${t.id} · 归档于 \${fmt(t.memorial.at)}\${t.round?\` · 历经 \${t.round} 次封驳\`:""}</div>
      <div class="sum">\${esc(t.memorial.summary)}</div>\${outs}<div class="stages">\${stages}</div></div>\`;
  }).join("");
}
function render(){ renderStats(); if (view==="board") renderBoard(); else renderMemorials(); }
function switchView(v){
  view=v;
  document.getElementById("tabBoard").classList.toggle("active",v==="board");
  document.getElementById("tabMem").classList.toggle("active",v==="memorials");
  document.getElementById("board").style.display = v==="board"?"flex":"none";
  document.getElementById("alerts").style.display = v==="board"?"flex":"none";
  document.getElementById("memorials").style.display = v==="memorials"?"block":"none";
  render();
}
function onSearch(){ query = document.getElementById("search").value.trim(); render(); }

function openDrawer(id){
  const t = DATA.tasks.find(x=>x.id===id); if(!t) return;
  curId = id;
  document.getElementById("dTitle").textContent = t.title;
  document.getElementById("dTid").textContent = \`\${t.id} · \${t.status} · 更新于 \${fmt(t.updatedAt)}\`;
  const asg = (t.assignments||[]).map(a=>\`<div class="row">
    <span style="color:\${a.status==="done"?"var(--jade)":a.status==="failed"?"var(--vermilion-bright)":"var(--gold)"}">
    \${a.status==="done"?"✓":a.status==="failed"?"✗":"◔"}</span>
    <b>\${esc(a.ministry)}</b> <span class="mut">\${esc(a.task)}</span>
    \${a.result?\`<div class="mut" style="padding-left:1.4em">↳ \${esc(a.result)}</div>\`:""}</div>\`).join("");
  const chk = (t.checklist||[]).map(c=>\`<div class="row">
    <span style="color:\${c.state==="done"?"var(--jade)":c.state==="doing"?"var(--gold)":"var(--ink-faint)"}">
    \${c.state==="done"?"✅":c.state==="doing"?"🔄":"⬜"}</span> \${esc(c.text)}</div>\`).join("");
  const flow = (t.flow||[]).map(e=>\`<div class="ev"><div class="t">\${fmt(e.at)} · \${esc(e.stage||"")}</div>
    <div class="r">\${esc(e.fromName||"—")} → <b>\${esc(e.toName)}</b></div><div class="rm">\${esc(e.remark)}</div></div>\`).join("");
  const mem = t.memorial ? \`<h4>📜 奏折</h4><div class="row">\${esc(t.memorial.summary)}</div>\` : "";
  document.getElementById("dBody").innerHTML =
    (t.detail?\`<h4>旨意</h4><div class="row" style="color:var(--ink-mut)">\${esc(t.detail)}</div>\`:"") +
    (asg?\`<h4>📮 六部分派</h4>\${asg}\`:"") +
    (chk?\`<h4>🔄 当前进展</h4>\${chk}\`:"") + mem +
    \`<h4>📜 流转链</h4><div class="flow">\${flow}</div>\`;
  const active = !["done","cancelled"].includes(t.status);
  document.getElementById("dBtns").innerHTML =
    (t.status!=="blocked"&&active?\`<button class="btn danger" onclick="ctrl('hold')">🛑 叫停</button>\`:"") +
    (t.status==="blocked"?\`<button class="btn ok" onclick="ctrl('resume')">▶️ 恢复</button>
      <button class="btn danger" onclick="ctrl('cancel')">❌ 取消</button>\`:"") +
    \`<button class="btn" onclick="closeDrawer()">关闭</button>\`;
  document.getElementById("dNote").textContent = "";
  document.getElementById("mask").classList.add("open");
  document.getElementById("drawer").classList.add("open");
}
function closeDrawer(){
  document.getElementById("mask").classList.remove("open");
  document.getElementById("drawer").classList.remove("open");
  curId = null;
}
async function ctrl(action){
  const id = curId; if(!id) return;
  const note = action==="hold" ? (prompt("叫停缘由（可留空）：")||"") : "";
  try {
    await fetch("/edict/api/control",{method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({id,action,note})});
  } catch {}
  try {
    if (window.parent && window.parent!==window)
      window.parent.postMessage({source:"edict",type:"control",id,action,note},window.location.origin);
  } catch {}
  document.getElementById("dNote").textContent = "已发往会话，Agent 将立即处置…";
  setTimeout(()=>{ closeDrawer(); refresh(); }, 1000);
}
async function refresh(){
  if (document.hidden) return;
  try {
    const r = await fetch("/edict/api/board");
    DATA = await r.json();
    document.getElementById("meta").textContent = "共 "+DATA.tasks.length+" 道旨意 · 更新于 "+fmt(DATA.now);
    render();
  } catch { document.getElementById("meta").textContent = "连接失败，重试中…"; }
}
document.addEventListener("visibilitychange", ()=>{ if(!document.hidden) refresh(); });
refresh();
setInterval(refresh, 3000);
</script>
</body>
</html>`;
