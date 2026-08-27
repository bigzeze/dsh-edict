/**
 * dsh-edict — 军机处 kanban dashboard (imperial 奏折 theme).
 *
 * A single self-contained HTML page served by the plugin's webServer route.
 * The board is designed to "never look empty":
 *   - 候旨厅 #welcome  : when nothing is active, a hero that guides the user to
 *                        issue an edict (with one-click example chips). Static
 *                        container — toggled, never rebuilt by the 3s poll.
 *   - semantic columns : an idle column shows that stage's duty, not a bare "—".
 *   - 近期旨意 #recent : an always-on strip of the latest done/blocked/cancelled.
 *   - stats header hides entirely on a fresh install and mutes zero values.
 * One-click issue uses the same-origin postMessage channel ({type:"issue"});
 * standalone page falls back to clipboard. All API paths are absolute (/edict/…).
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
  .pulse i{ width:8px; height:8px; border-radius:50%; background:var(--jade); animation:pulse 2s infinite; }
  @keyframes pulse{ 70%{ box-shadow:0 0 0 7px rgba(127,181,138,0);} 100%{ box-shadow:0 0 0 0 rgba(127,181,138,0);} }
  .stats{ display:flex; gap:10px; margin-top:12px; flex-wrap:wrap; }
  .stat{ background:var(--ink-2); border:1px solid var(--line-soft); border-radius:10px; padding:7px 14px;
         display:flex; align-items:baseline; gap:8px; min-width:96px; }
  .stat b{ font-size:19px; color:var(--gold-bright); font-family:ui-monospace,monospace; }
  .stat span{ font-size:11px; color:var(--ink-mut); }
  .stat.red b{ color:var(--vermilion-bright); } .stat.green b{ color:var(--jade); }
  .stat.zero b{ color:var(--ink-faint); }
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

  /* 候旨厅 welcome hero (static; visibility toggled only) */
  .welcome{ padding:26px 22px 6px; display:none; }
  .whero{ max-width:860px; margin:0 auto; text-align:center; background:linear-gradient(180deg,var(--ink-2),var(--ink-1));
          border:1px solid var(--line); border-radius:16px; padding:30px 26px 26px; position:relative; overflow:hidden; }
  .whero::before{ content:""; position:absolute; inset:0; background:radial-gradient(420px 160px at 50% -40px, rgba(201,168,106,.14), transparent 70%); pointer-events:none; }
  .wseal{ width:58px; height:58px; margin:0 auto 12px; border-radius:14px; display:grid; place-items:center; font-size:30px;
          background:linear-gradient(145deg,var(--vermilion),#7d3328); color:#f4e4d4; border:1px solid #8d4134;
          box-shadow:0 6px 22px rgba(176,74,58,.4); }
  .whero h2{ margin:0 0 6px; font-size:21px; color:var(--gold-bright); letter-spacing:.12em; }
  .whero .wsub{ font-size:13px; color:var(--ink-mut); margin-bottom:20px; }
  .wguide{ display:flex; gap:10px; justify-content:center; flex-wrap:wrap; margin-bottom:18px; }
  .wguide .g{ background:var(--ink-3); border:1px solid var(--line-soft); border-radius:10px; padding:9px 14px;
              font-size:12px; color:var(--ink-fg); max-width:230px; text-align:left; line-height:1.6; }
  .wguide .g b{ color:var(--gold); display:block; margin-bottom:2px; }
  .wchips{ display:flex; gap:9px; justify-content:center; flex-wrap:wrap; }
  .wchip{ background:transparent; border:1px dashed var(--gold-dim); color:var(--gold-bright); border-radius:20px;
          padding:7px 16px; font-size:12.5px; cursor:pointer; font-family:inherit; transition:all .15s; }
  .wchip:hover{ background:rgba(201,168,106,.12); border-style:solid; border-color:var(--gold); }
  .wnote{ margin-top:16px; font-size:11.5px; color:var(--gold); min-height:16px; }
  .nomatch{ padding:8px 22px 0; color:var(--ink-faint); font-size:12.5px; display:none; }

  .board{ display:flex; gap:10px; padding:16px 22px; overflow-x:auto; align-items:flex-start; }
  .board.idle .col{ opacity:.72; }
  .board.idle .col .ctop{ border-top-style:dashed; }
  .col{ min-width:218px; flex:1; background:linear-gradient(180deg,var(--ink-1),var(--ink-0));
        border:1px solid var(--line-soft); border-radius:12px; padding:10px; }
  .col .ctop{ border-top:2px solid var(--line); margin:-10px -10px 9px; height:2px; border-radius:2px; }
  .col.intake .ctop{ border-color:#7a6aa8; } .col.planning .ctop{ border-color:#6a86c0; }
  .col.review .ctop{ border-color:var(--gold); } .col.dispatching .ctop{ border-color:#5aa8a0; }
  .col.doing .ctop{ border-color:var(--jade); } .col.final_review .ctop{ border-color:#a88ac4; }
  .col h2{ font-size:12.5px; margin:0 0 9px; display:flex; gap:7px; align-items:center; font-weight:600;
           color:var(--ink-mut); letter-spacing:.05em; }
  .col h2 .idx{ color:var(--gold-dim); font-family:ui-monospace,monospace; font-size:10px; }
  .col h2 .n{ margin-left:auto; background:var(--ink-3); border-radius:10px; padding:0 8px; font-size:11px; color:var(--gold); }
  .stagehint{ border:1px dashed var(--line-soft); border-radius:8px; padding:10px; text-align:center; }
  .stagehint p{ margin:0 0 5px; font-size:11.5px; color:var(--ink-faint); line-height:1.55; }
  .stagehint span{ font-size:10px; color:var(--ink-faint); letter-spacing:.2em; opacity:.7; }
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

  /* 近期旨意 recent strip */
  .recent{ padding:4px 22px 26px; }
  .recent .rhead{ display:flex; align-items:center; gap:12px; margin-bottom:10px; }
  .recent .rhead h3{ font-size:13px; margin:0; color:var(--gold-dim); letter-spacing:.1em; font-weight:600; }
  .recent .rhead .line{ flex:1; height:1px; background:var(--line-soft); }
  .rrow{ display:flex; gap:11px; align-items:center; background:var(--ink-1); border:1px solid var(--line-soft);
         border-radius:9px; padding:9px 14px; margin-bottom:7px; cursor:pointer; font-size:12.5px; }
  .rrow:hover{ border-color:var(--gold-dim); }
  .rrow .ricon{ font-size:14px; }
  .rrow .rtitle{ color:var(--ink-fg); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:46%; }
  .rrow .rsum{ color:var(--ink-mut); flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-size:11.5px; }
  .rrow .rmeta{ color:var(--ink-faint); font-size:10.5px; font-family:ui-monospace,monospace; white-space:nowrap; margin-left:auto; }

  /* drawer */
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

  /* memorials */
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
  @media (max-width:720px){
    .stat{ min-width:72px; } .wguide .g{ max-width:100%; }
    .rrow .rtitle{ max-width:40%; } .rrow .rsum{ display:none; }
  }
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
<section class="welcome" id="welcome">
  <div class="whero">
    <div class="wseal">⚔</div>
    <h2>军机处候旨</h2>
    <div class="wsub">眼下没有在办旨意。交代一桩够复杂的差事，三省六部即刻当值。</div>
    <div class="wguide">
      <div class="g"><b>① 直接陈述</b>在会话里说出复杂需求，太子自会分拣立旨</div>
      <div class="g"><b>② 斜杠下旨</b>输入 /edict &lt;需求&gt; 即刻建档走流程</div>
      <div class="g"><b>③ 一键示例</b>点下方示例旨意，直接送入当前会话</div>
    </div>
    <div class="wchips" id="wchips"></div>
    <div class="wnote" id="wnote"></div>
  </div>
</section>
<div class="nomatch" id="nomatch"></div>
<div class="board" id="board"></div>
<section class="recent" id="recent" style="display:none">
  <div class="rhead"><h3>🕯 近期旨意</h3><div class="line"></div>
    <button class="tab" onclick="switchView('memorials')">奏折阁全部 →</button></div>
  <div id="recentList"></div>
</section>
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
  ["intake","🤴","太子分拣","判闲聊与旨意，立旨建档"],
  ["planning","📜","中书规划","拆子任务、明验收、定回滚"],
  ["review","🔍","门下审议","四维审查：可行·完整·风险·资源，准奏或封驳"],
  ["dispatching","📮","尚书派发","按职责派发六部，并行推进"],
  ["doing","⚔️","六部执行","兵刑工户礼吏，六部并行承办"],
  ["final_review","📤","回奏审定","汇总六部成果，写奏折回奏"]
];
const EXAMPLE_EDICTS = [
  ["调研多 Agent 框架","调研主流多 Agent 协作框架，对比优缺点，给出选型建议并出一份报告"],
  ["做个待办应用","做一个带登录的待办应用，包含前端、后端和部署文档"],
  ["依赖安全审计","审查这个项目的依赖有没有安全漏洞，列出风险并给出修复方案"],
  ["编写项目文档","为我的项目编写中英文 README 和 API 接口文档"]
];
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmt = iso => iso ? new Date(iso).toLocaleString("zh-CN",{hour12:false,month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"}) : "";
const relTime = iso => {
  const m = Math.round((Date.now()-new Date(iso).getTime())/60000);
  if (m < 1) return "刚刚"; if (m < 60) return m+" 分钟前";
  const h = Math.round(m/60); if (h < 24) return h+" 小时前"; return Math.round(h/24)+" 天前";
};
let DATA = { tasks: [] }, view = "board", query = "", curId = null;

/* 候旨厅：静态内容，只构建一次，轮询只切显隐（不会丢焦点） */
function buildWelcome(){
  document.getElementById("wchips").innerHTML = EXAMPLE_EDICTS.map(function(c){
    return '<button class="wchip" title="'+esc(c[1])+'" data-t="'+esc(c[1])+'" onclick="issueEdict(this.dataset.t)">⚔ '+esc(c[0])+'</button>';
  }).join("");
}
function hb(t){
  if (t.status==="blocked") return "🛑";
  if (["done","cancelled"].includes(t.status)) return "";
  const s = (Date.now()-new Date(t.updatedAt).getTime())/1000;
  if (s<60) return "🟢"; if (s<300) return "🟡"; return "🔴";
}
function renderStats(){
  const ts = DATA.tasks;
  if (!ts.length){ document.getElementById("stats").innerHTML = ""; return; }
  const active = ts.filter(t=>!["done","cancelled","blocked"].includes(t.status)).length;
  const blocked = ts.filter(t=>t.status==="blocked").length;
  const today = new Date().toISOString().slice(0,10);
  const doneToday = ts.filter(t=>t.memorial && t.memorial.at.slice(0,10)===today).length;
  const fengbo = ts.filter(t=>!["done","cancelled"].includes(t.status)).reduce((n,t)=>n+(t.round||0),0);
  const totalDone = ts.filter(t=>t.memorial).length;
  const asg = ts.flatMap(t=>t.assignments||[]);
  const asgDone = asg.filter(a=>a.status==="done").length;
  const asgFail = asg.filter(a=>a.status==="failed").length;
  const stat = (k,v,cls,suffix) => '<div class="stat '+(cls||"")+'"><b>'+v+'</b><span>'+k+(suffix||"")+'</span></div>';
  document.getElementById("stats").innerHTML =
    stat("累计接旨", ts.length, "") +
    stat("累计完工", totalDone, totalDone?"green":"zero") +
    stat("在办", active, active?"":"zero") +
    stat("叫停", blocked, blocked?"red":"zero") +
    stat("今日完工", doneToday, doneToday?"green":"zero") +
    stat("封驳", fengbo, fengbo?"":"zero", fengbo?" 次":"") +
    stat("部务", asg.length? asgDone+"/"+asg.length : "—", asgFail?"red":(asg.length?"":"zero"), asgFail?" ❋"+asgFail+"败":"");
}
function matchQ(t){
  if (!query) return true;
  const q = query.toLowerCase();
  return (t.title+" "+t.id+" "+(t.current||"")).toLowerCase().includes(q);
}
function ministryRow(t){
  if (!t.assignments || !t.assignments.length) return "";
  const mos = t.assignments.map(a =>
    '<div class="mo '+a.status+'" title="'+esc(a.ministry)+"："+a.status+'">'+(a.emoji||"●")+'</div>').join("");
  const done = t.assignments.filter(a=>a.status==="done").length;
  const pct = Math.round(done/t.assignments.length*100);
  return '<div class="ministries">'+mos+'</div><div class="bar"><i style="width:'+pct+'%"></i></div>';
}
function cardHtml(t){
  const dot = hb(t);
  const when = ["done","cancelled"].includes(t.status) ? "" : relTime(t.updatedAt);
  return '<div class="card" onclick="openDrawer(\\''+t.id+'\\')">'+
    '<div class="tid"><span>'+t.id+'</span><span>'+dot+(dot?" ":"")+when+'</span></div>'+
    '<div class="title">'+esc(t.title)+'</div>'+
    '<div class="cur">'+esc(t.current||"")+'</div>'+
    ministryRow(t)+
    '<div class="badges">'+
      (t.round?'<span class="badge gold">封驳 '+t.round+' 次</span>':"")+
      (t.assignments.some(a=>a.status==="failed")?'<span class="badge red">部务失败</span>':"")+
      (t.goalId?'<span class="badge gold">🎯 联动</span>':"")+
      (t.pendingControl?'<span class="badge red">待处理干预</span>':"")+
    '</div></div>';
}
function renderBoard(){
  const alerts = DATA.tasks.filter(t=>t.status==="blocked" && matchQ(t));
  document.getElementById("alerts").innerHTML = alerts.length
    ? alerts.map(t=>'<div class="alert" onclick="openDrawer(\\''+t.id+'\\')">🛑 <b>'+esc(t.title)+'</b>'+
        '<span class="tid">'+t.id+'</span><span style="margin-left:auto;color:var(--ink-mut)">已叫停 · 点击处置</span></div>').join("")
    : "";
  const activeCount = DATA.tasks.filter(t=>!["done","cancelled","blocked"].includes(t.status)).length;
  const board = document.getElementById("board");
  board.classList.toggle("idle", activeCount===0 && !query);
  const totalMatched = DATA.tasks.filter(t=>!["done","cancelled"].includes(t.status) && matchQ(t)).length;
  const nm = document.getElementById("nomatch");
  nm.style.display = (query && totalMatched===0) ? "block" : "none";
  nm.textContent = query ? "🔍 没有匹配「"+query+"」的在办旨意。" : "";
  board.innerHTML = COLS.map(function(c,i){
    const key=c[0],icon=c[1],label=c[2],hint=c[3];
    const tasks = DATA.tasks.filter(t=>t.status===key && matchQ(t));
    const body = tasks.length
      ? tasks.map(cardHtml).join("")
      : (query ? "" : '<div class="stagehint"><p>'+hint+'</p><span>候 旨</span></div>');
    return '<div class="col '+key+'"><div class="ctop"></div><h2><span class="idx">'+String(i+1).padStart(2,"0")+'</span> '+
      icon+' '+label+'<span class="n">'+tasks.length+'</span></h2>'+body+'</div>';
  }).join("");
}
function renderRecent(){
  const el = document.getElementById("recent");
  if (!DATA.tasks.length){ el.style.display = "none"; return; }
  const rows = DATA.tasks
    .filter(t=>["done","blocked","cancelled"].includes(t.status) && matchQ(t))
    .sort((a,b)=> new Date(b.updatedAt)-new Date(a.updatedAt))
    .slice(0,6);
  el.style.display = (view==="board" && rows.length) ? "block" : "none";
  const icon = { done:"📜", blocked:"🛑", cancelled:"❌" };
  const sumOf = t => t.status==="done" ? ((t.memorial && t.memorial.summary) || "已回奏归档")
                  : t.status==="blocked" ? (t.current || "已叫停，等候处置")
                  : "已取消";
  document.getElementById("recentList").innerHTML = rows.map(t=>'<div class="rrow" onclick="openDrawer(\\''+t.id+'\\')">'+
    '<span class="ricon">'+icon[t.status]+'</span>'+
    '<span class="rtitle">'+esc(t.title)+'</span>'+
    '<span class="rsum">'+esc(sumOf(t))+'</span>'+
    '<span class="rmeta">'+t.id+' · '+relTime(t.updatedAt)+'</span></div>').join("");
}
const STAGE_LABELS=[["intake","🤴 太子分拣"],["planning","📜 中书规划"],["review","🔍 门下审议"],
  ["dispatching","📮 尚书派发"],["doing","⚔️ 六部执行"],["final_review","📤 回奏"],["done","✅ 完成"]];
function renderMemorials(){
  const mems = DATA.tasks.filter(t=>t.memorial);
  const el = document.getElementById("memorials");
  if (!mems.length){ el.innerHTML='<div class="stagehint" style="max-width:420px;margin:40px auto"><p>奏折阁暂无归档</p><span>旨意完成回奏后自动入阁</span></div>'; return; }
  el.innerHTML = mems.map(t=>{
    const hit = new Set((t.flow||[]).map(e=>e.to));
    const stages = STAGE_LABELS.map(function(s){return '<span class="stage '+(hit.has(s[0])?"hit":"")+'">'+(hit.has(s[0])?"✓ ":"")+s[1]+'</span>';}).join("");
    const outs = (t.memorial.outputs||[]).length ? '<div class="outs">'+t.memorial.outputs.map(o=>"📎 "+esc(o)).join("　")+'</div>' : "";
    return '<div class="mem"><h3>'+esc(t.title)+'</h3>'+
      '<div class="tid">'+t.id+' · 归档于 '+fmt(t.memorial.at)+(t.round?' · 历经 '+t.round+' 次封驳':"")+'</div>'+
      '<div class="sum">'+esc(t.memorial.summary)+'</div>'+outs+'<div class="stages">'+stages+'</div></div>';
  }).join("");
}
function renderWelcome(){
  const active = DATA.tasks.filter(t=>!["done","cancelled","blocked"].includes(t.status)).length;
  const show = view==="board" && active===0 && !query;
  document.getElementById("welcome").style.display = show ? "block" : "none";
}
function render(){
  renderStats();
  if (view==="board"){ renderBoard(); renderRecent(); renderWelcome(); }
  else renderMemorials();
}
function switchView(v){
  view=v;
  document.getElementById("tabBoard").classList.toggle("active",v==="board");
  document.getElementById("tabMem").classList.toggle("active",v==="memorials");
  document.getElementById("board").style.display = v==="board"?"flex":"none";
  document.getElementById("alerts").style.display = v==="board"?"flex":"none";
  document.getElementById("welcome").style.display = "none";
  document.getElementById("nomatch").style.display = "none";
  document.getElementById("recent").style.display = "none";
  document.getElementById("memorials").style.display = v==="memorials"?"block":"none";
  render();
}
function onSearch(){ query = document.getElementById("search").value.trim(); render(); }

function openDrawer(id){
  const t = DATA.tasks.find(x=>x.id===id); if(!t) return;
  curId = id;
  document.getElementById("dTitle").textContent = t.title;
  document.getElementById("dTid").textContent = t.id+" · "+t.status+" · 更新于 "+fmt(t.updatedAt);
  const asg = (t.assignments||[]).map(a=>'<div class="row">'+
    '<span style="color:'+(a.status==="done"?"var(--jade)":a.status==="failed"?"var(--vermilion-bright)":"var(--gold)")+'">'+
    (a.status==="done"?"✓":a.status==="failed"?"✗":"◔")+'</span> '+
    '<b>'+esc(a.ministry)+'</b> <span class="mut">'+esc(a.task)+'</span>'+
    (a.result?'<div class="mut" style="padding-left:1.4em">↳ '+esc(a.result)+'</div>':"")+'</div>').join("");
  const chk = (t.checklist||[]).map(c=>'<div class="row">'+
    '<span style="color:'+(c.state==="done"?"var(--jade)":c.state==="doing"?"var(--gold)":"var(--ink-faint)")+'">'+
    (c.state==="done"?"✅":c.state==="doing"?"🔄":"⬜")+'</span> '+esc(c.text)+'</div>').join("");
  const flow = (t.flow||[]).map(e=>'<div class="ev"><div class="t">'+fmt(e.at)+' · '+esc(e.stage||"")+'</div>'+
    '<div class="r">'+esc(e.fromName||"—")+' → <b>'+esc(e.toName)+'</b></div><div class="rm">'+esc(e.remark)+'</div></div>').join("");
  const mem = t.memorial ? '<h4>📜 奏折</h4><div class="row">'+esc(t.memorial.summary)+'</div>' : "";
  document.getElementById("dBody").innerHTML =
    (t.detail?'<h4>旨意</h4><div class="row" style="color:var(--ink-mut)">'+esc(t.detail)+'</div>':"") +
    (asg?'<h4>📮 六部分派</h4>'+asg:"") +
    (chk?'<h4>🔄 当前进展</h4>'+chk:"") + mem +
    '<h4>📜 流转链</h4><div class="flow">'+flow+'</div>';
  const active = !["done","cancelled"].includes(t.status);
  document.getElementById("dBtns").innerHTML =
    (t.status!=="blocked"&&active?'<button class="btn danger" onclick="ctrl(\\'hold\\')">🛑 叫停</button>':"") +
    (t.status==="blocked"?'<button class="btn ok" onclick="ctrl(\\'resume\\')">▶️ 恢复</button>'+
      '<button class="btn danger" onclick="ctrl(\\'cancel\\')">❌ 取消</button>':"") +
    '<button class="btn" onclick="closeDrawer()">关闭</button>';
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
/* 一键下旨：送入父窗口会话；独立页面降级剪贴板 */
function issueEdict(text){
  text = String(text||"").slice(0,200);
  const note = document.getElementById("wnote");
  const sayCopied = function(){ note.textContent = "已复制旨意，请在会话输入 /edict 后粘贴。"; };
  const sayManual = function(){ note.textContent = "请在会话中输入 /edict 并口述需求。"; };
  function legacyCopy(){
    try { const ta=document.createElement("textarea"); ta.value=text; ta.style.position="fixed"; ta.style.opacity="0";
          document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); sayCopied(); }
    catch(e){ sayManual(); }
  }
  try {
    if (window.parent && window.parent!==window){
      window.parent.postMessage({source:"edict",type:"issue",text:text},window.location.origin);
      note.textContent = "已送往会话，Agent 即当接旨…";
    } else if (navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(sayCopied, legacyCopy);
    } else { legacyCopy(); }
  } catch(e){ sayManual(); }
  setTimeout(function(){ note.textContent=""; }, 4000);
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
buildWelcome();
refresh();
setInterval(refresh, 3000);
</script>
</body>
</html>`;
