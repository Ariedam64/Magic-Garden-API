// src/api/routes/weatherPrediction.js
//
// Hidden, unlinked page: a deterministic weather explorer / forecaster.
// Not referenced from the API root, the docs, or the OpenAPI spec — reachable
// only by knowing the URL (/weather-prediction). Shares the docs THEME.
//
//   GET /weather-prediction              -> themed HTML explorer
//   GET /weather-prediction/api/day      -> one UTC day (date + optional overrides)
//   GET /weather-prediction/api/window   -> events overlapping [start,end) ms (local-day view)
//   GET /weather-prediction/api/export   -> CSV/JSON download for a date range
//
// The engine (era) is selected automatically from the date; overrides (seed,
// drop-table weights) are optional. Dates before MODELED_FROM (2026-02-20) have
// no validated engine — they return nothing unless custom overrides are given.

import express from "express";
import {
  predictDay,
  predictRange,
  ERAS,
  MODELED_FROM,
  MAX_RANGE_DAYS,
} from "../../core/weather/schedule.js";

export const weatherPredictionRouter = express.Router();

// ---- helpers ---------------------------------------------------------------

function parseOverrides(q) {
  const o = {};
  if (q.seed != null && String(q.seed).length > 0) o.seed = String(q.seed);
  const hw = {};
  if (q.rain != null) hw.Rain = Number(q.rain);
  if (q.frost != null) hw.Frost = Number(q.frost);
  if (q.thunder != null) hw.Thunderstorm = Number(q.thunder);
  if (Object.keys(hw).length) o.hydroWeights = hw;
  const lw = {};
  if (q.dawn != null) lw.Dawn = Number(q.dawn);
  if (q.amber != null) lw.AmberMoon = Number(q.amber);
  if (Object.keys(lw).length) o.lunarWeights = lw;
  return o;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
function todayUtcKey() {
  return new Date().toISOString().slice(0, 10);
}
function isoUtc(ms) {
  return new Date(ms).toISOString();
}

// ---- JSON: one UTC day -----------------------------------------------------

weatherPredictionRouter.get("/api/day", (req, res) => {
  const date = DAY_RE.test(String(req.query.date || "")) ? String(req.query.date) : todayUtcKey();
  try {
    res.json(predictDay(date, parseOverrides(req.query)));
  } catch (err) {
    res.status(400).json({ error: err?.message || "bad request" });
  }
});

// ---- JSON: events overlapping an absolute [start,end) ms window ------------
// Used by the client to render "the viewer's local day" (which straddles two
// UTC schedule days). start/end are epoch ms.

weatherPredictionRouter.get("/api/window", (req, res) => {
  const start = Number(req.query.start);
  const end = Number(req.query.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return res.status(400).json({ error: "start/end (epoch ms) required, end > start" });
  }
  if (end - start > 8 * 86400000) {
    return res.status(400).json({ error: "window too large (max 8 days)" });
  }
  try {
    const fromKey = new Date(start).toISOString().slice(0, 10);
    const toKey = new Date(end - 1).toISOString().slice(0, 10);
    const { days, events } = predictRange(fromKey, toKey, parseOverrides(req.query));
    const inWindow = events.filter((e) => e.endedAt > start && e.startedAt < end);
    res.json({ start, end, days, events: inWindow });
  } catch (err) {
    res.status(400).json({ error: err?.message || "bad request" });
  }
});

// ---- Export: CSV / JSON for a date range -----------------------------------

function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

weatherPredictionRouter.get("/api/export", (req, res) => {
  const from = String(req.query.from || "");
  const to = String(req.query.to || "");
  const format = String(req.query.format || "csv").toLowerCase();
  if (!DAY_RE.test(from) || !DAY_RE.test(to)) {
    return res.status(400).json({ error: "from/to must be YYYY-MM-DD" });
  }
  let result;
  try {
    result = predictRange(from, to, parseOverrides(req.query));
  } catch (err) {
    return res.status(400).json({ error: err?.message || "bad request" });
  }

  const rows = result.events.map((e) => ({
    date: new Date(e.startedAt).toISOString().slice(0, 10),
    weather: e.display,
    started_at_utc: isoUtc(e.startedAt),
    ended_at_utc: isoUtc(e.endedAt),
    duration_min: e.durationMin,
    start_slot: e.startSlot,
  }));
  // attach the era/seed used per day for traceability
  const eraByDay = Object.fromEntries(result.days.map((d) => [d.dayKey, d]));
  for (const r of rows) {
    const d = eraByDay[r.date];
    r.era = d?.era || "";
    r.seed = d?.seed || "";
  }

  const fname = `weather_${from}_${to}`;
  if (format === "json") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fname}.json"`);
    return res.send(JSON.stringify({ from, to, days: result.days, events: rows }, null, 2));
  }
  // CSV (default)
  const cols = ["date", "weather", "started_at_utc", "ended_at_utc", "duration_min", "start_slot", "era", "seed"];
  const lines = [cols.join(",")];
  for (const r of rows) lines.push(cols.map((c) => csvEscape(r[c])).join(","));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${fname}.csv"`);
  res.send(lines.join("\n"));
});

// ---- HTML page -------------------------------------------------------------

const ERAS_PUBLIC = ERAS.map((e) => ({
  id: e.id,
  label: e.label,
  from: e.from,
  to: e.to,
  hydro: Object.fromEntries(e.groups.Hydro.dropTable.map((d) => [d.weatherId, d.weight])),
  lunar: Object.fromEntries(e.groups.Lunar.dropTable.map((d) => [d.weatherId, d.weight])),
}));

weatherPredictionRouter.get("/", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.send(PAGE_HTML);
});

const BOOT = JSON.stringify({ eras: ERAS_PUBLIC, modeledFrom: MODELED_FROM, maxRangeDays: MAX_RANGE_DAYS });

const PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>Weather Prediction · Magic Garden</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;600&display=swap" rel="stylesheet" />
<style>
  :root{
    --primary:#4fe3c1; --primary-strong:#21a88a; --accent:#f2b464; --accent-strong:#f08b4b;
    --bg:#0b0d14; --bg-alt:#0f1220; --surface:#151a2b; --surface-alt:#1c2340;
    --border:#2a3452; --border-light:#3a4568; --text:#f4f6ff; --muted:#a3acc7;
    color-scheme:dark;
  }
  *{box-sizing:border-box}
  body{
    margin:0; min-height:100vh; color:var(--text);
    font-family:'Space Grotesk',system-ui,-apple-system,'Segoe UI',sans-serif;
    background:
      radial-gradient(1200px 600px at 15% -10%, rgba(79,227,193,.15), transparent 60%),
      radial-gradient(900px 500px at 90% 0%, rgba(242,180,100,.12), transparent 55%),
      linear-gradient(180deg, var(--bg) 0%, var(--bg-alt) 100%);
    background-attachment:fixed;
  }
  a{color:var(--primary)}
  .wrap{max-width:1080px; margin:0 auto; padding:32px 20px 80px}
  header.top{display:flex; align-items:center; gap:14px; flex-wrap:wrap; margin-bottom:8px}
  .logo{font-weight:700; font-size:26px; letter-spacing:.3px}
  .logo .a{color:var(--primary)} .logo .b{color:var(--accent)}
  .sub{color:var(--muted); font-size:14px; margin:2px 0 26px}
  .chip{display:inline-flex; align-items:center; gap:6px; padding:4px 11px; border-radius:999px;
    font-size:12px; font-weight:600; border:1px solid var(--border-light); background:rgba(79,227,193,.10); color:var(--primary)}
  .chip.warn{background:rgba(248,113,113,.12); color:#f8a0a0; border-color:#7a3a4a}
  .chip.muted{background:rgba(163,172,199,.10); color:var(--muted)}
  .card{background:linear-gradient(140deg, rgba(28,35,64,.8), rgba(21,26,43,.9));
    border:1px solid var(--border); border-radius:18px; padding:22px; margin:18px 0;
    box-shadow:0 18px 40px -28px rgba(0,0,0,.9)}
  .card h2{margin:0 0 4px; font-size:18px}
  .card .hint{color:var(--muted); font-size:13px; margin:0 0 16px}
  .grid{display:grid; gap:14px}
  .controls{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
  label.fld{display:flex; flex-direction:column; gap:6px; font-size:12px; color:var(--muted); font-weight:600}
  input,select{font-family:inherit; font-size:14px; color:var(--text); background:rgba(15,18,32,.7);
    border:1px solid var(--border); border-radius:10px; padding:9px 11px; outline:none; transition:border-color .2s, box-shadow .2s}
  input:focus,select:focus{border-color:var(--primary); box-shadow:0 0 0 3px rgba(79,227,193,.15)}
  input[type=number]{font-family:'IBM Plex Mono',monospace}
  .row{display:flex; gap:10px; flex-wrap:wrap; align-items:center}
  button{font-family:inherit; font-weight:600; font-size:14px; cursor:pointer; color:var(--bg);
    background:linear-gradient(120deg,var(--primary),var(--primary-strong)); border:none; border-radius:10px; padding:10px 16px;
    transition:transform .1s, filter .2s}
  button:hover{filter:brightness(1.08)} button:active{transform:translateY(1px)}
  button.ghost{background:transparent; color:var(--text); border:1px solid var(--border-light)}
  button.amber{background:linear-gradient(120deg,var(--accent),var(--accent-strong))}
  .now-hero{display:flex; align-items:center; gap:20px; flex-wrap:wrap}
  .now-icon{font-size:54px; line-height:1}
  .now-main{flex:1; min-width:200px}
  .now-cond{font-size:26px; font-weight:700}
  .now-meta{color:var(--muted); font-size:14px; margin-top:3px}
  .timeline{display:flex; flex-direction:column; gap:0; margin-top:6px}
  .ev{display:grid; grid-template-columns:96px 26px 1fr auto; align-items:center; gap:12px;
    padding:9px 4px; border-bottom:1px solid rgba(42,52,82,.5)}
  .ev:last-child{border-bottom:none}
  .ev .t{font-family:'IBM Plex Mono',monospace; font-size:13px; color:var(--muted)}
  .ev .ic{font-size:18px; text-align:center}
  .ev .w{font-weight:600}
  .ev .d{color:var(--muted); font-size:12px; font-family:'IBM Plex Mono',monospace}
  .ev.past{opacity:.45}
  .ev.live{background:rgba(79,227,193,.08); border-radius:8px}
  .empty{color:var(--muted); font-style:italic; padding:10px 0}
  .legend{display:flex; gap:14px; flex-wrap:wrap; font-size:12px; color:var(--muted); margin-top:10px}
  .legend span{display:inline-flex; gap:5px; align-items:center}
  table.days{width:100%; border-collapse:collapse; font-size:13px}
  table.days th,table.days td{text-align:left; padding:7px 8px; border-bottom:1px solid rgba(42,52,82,.5)}
  table.days th{color:var(--muted); font-weight:600; font-size:12px}
  table.days td.mono{font-family:'IBM Plex Mono',monospace; color:var(--muted)}
  .seg{display:inline-flex; border:1px solid var(--border-light); border-radius:10px; overflow:hidden}
  .seg button{background:transparent; color:var(--muted); border:none; border-radius:0; padding:8px 14px}
  .seg button.on{background:rgba(79,227,193,.16); color:var(--primary)}
  .small{font-size:12px; color:var(--muted)}
  .wgrid{grid-template-columns:repeat(auto-fit,minmax(110px,1fr))}
  details summary{cursor:pointer; color:var(--muted); font-size:13px}
  code{font-family:'IBM Plex Mono',monospace; color:#b68ae1}
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div class="logo"><span class="a">Weather</span> <span class="b">Prediction</span></div>
    <span class="chip muted" id="tzChip">local time</span>
  </header>
  <p class="sub">Deterministic Magic Garden weather, computed locally from the daily UTC seed. The engine (era) switches automatically with the selected date.</p>

  <!-- TODAY (local) -->
  <section class="card">
    <h2>Today <span class="small" id="todayDate"></span></h2>
    <p class="hint">Your local day. Engine: <span id="todayEra" class="chip">—</span></p>
    <div class="now-hero">
      <div class="now-icon" id="nowIcon">·</div>
      <div class="now-main">
        <div class="now-cond" id="nowCond">—</div>
        <div class="now-meta" id="nowMeta"></div>
      </div>
      <button class="ghost" id="refreshNow">↻ Refresh</button>
    </div>
    <div class="timeline" id="todayTimeline"></div>
    <div class="legend" id="legend"></div>
  </section>

  <!-- EXPLORER -->
  <section class="card">
    <h2>Explorer</h2>
    <p class="hint">Pick any date, override the seed or the drop-table weights, and inspect the resulting day. Times shown in both your local zone and UTC.</p>
    <div class="grid controls">
      <label class="fld">Date (UTC day)
        <input type="date" id="exDate" />
      </label>
      <label class="fld">Seed override <span class="small">(blank = date)</span>
        <input type="text" id="exSeed" placeholder="(date)" />
      </label>
    </div>
    <div class="row" style="margin-top:12px">
      <span class="chip" id="exEra">—</span>
      <label class="row small" style="gap:6px"><input type="checkbox" id="exCustom" style="width:auto"/> custom weights</label>
      <button class="ghost" id="exReset" type="button">Load era weights</button>
    </div>
    <div class="grid wgrid" id="weightFields" style="margin-top:12px; opacity:.5; pointer-events:none">
      <label class="fld">🌧 Rain<input type="number" id="wRain" min="0" step="1" /></label>
      <label class="fld">❄️ Snow/Frost<input type="number" id="wFrost" min="0" step="1" /></label>
      <label class="fld">⛈ Thunder<input type="number" id="wThunder" min="0" step="1" /></label>
      <label class="fld">🌅 Dawn<input type="number" id="wDawn" min="0" step="1" /></label>
      <label class="fld">🌙 Amber Moon<input type="number" id="wAmber" min="0" step="1" /></label>
    </div>
    <div class="row" style="margin-top:14px">
      <button id="exRun">Predict day</button>
    </div>
    <div class="timeline" id="exTimeline" style="margin-top:14px"></div>
  </section>

  <!-- EXPORT -->
  <section class="card">
    <h2>Export</h2>
    <p class="hint">Download a deterministic forecast for a date range. Uses the Explorer's current seed/weights when "apply overrides" is on. Engine switches per day automatically; days before <code id="modeledFrom"></code> are skipped unless overridden.</p>
    <div class="grid controls">
      <label class="fld">From<input type="date" id="exFrom" /></label>
      <label class="fld">To<input type="date" id="exTo" /></label>
    </div>
    <div class="row" style="margin-top:14px">
      <div class="seg" id="fmtSeg">
        <button class="on" data-fmt="csv">CSV</button>
        <button data-fmt="json">JSON</button>
      </div>
      <label class="row small" style="gap:6px"><input type="checkbox" id="expApply" style="width:auto"/> apply Explorer overrides</label>
      <button class="amber" id="expGo">Download</button>
    </div>
    <p class="small" id="expNote" style="margin-top:10px"></p>
  </section>

  <p class="small" style="text-align:center; margin-top:30px; opacity:.6">Hidden tool · not indexed · deterministic engine</p>
</div>

<script>
const BOOT = ${BOOT};
const ICONS = { 'Rain':'🌧', 'Snow':'❄️', 'Thunderstorm':'⛈', 'Dawn':'🌅', 'Amber Moon':'🌙', 'Clear':'☀️' };
const COLORS = { 'Rain':'#60a5fa', 'Snow':'#bcd4ff', 'Thunderstorm':'#b68ae1', 'Dawn':'#f2b464', 'Amber Moon':'#f08b4b', 'Clear':'#4fe3c1' };
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2,'0');
const fmtLocal = (ms) => new Date(ms).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
const fmtUtc = (ms) => { const d=new Date(ms); return pad(d.getUTCHours())+':'+pad(d.getUTCMinutes()); };
const ico = (w) => ICONS[w] || '·';
function dayKeyLocal(d){ return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
function eraChip(el, src, modeled){
  if(!modeled){ el.className='chip warn'; el.textContent='unmodeled — sandbox only'; return; }
  el.className='chip'; el.textContent = src ? ('engine: '+src) : 'engine';
}

// Build a continuous timeline (Clear gaps included) for a window [start,end).
function fillClear(events, start, end){
  const out=[]; let cursor=start;
  const sorted=[...events].sort((a,b)=>a.startedAt-b.startedAt);
  for(const e of sorted){
    const s=Math.max(e.startedAt,start), en=Math.min(e.endedAt,end);
    if(s>cursor) out.push({display:'Clear', startedAt:cursor, endedAt:s, durationMin:Math.round((s-cursor)/60000), clear:true});
    out.push({display:e.display, startedAt:s, endedAt:en, durationMin:Math.round((en-s)/60000)});
    cursor=en;
  }
  if(cursor<end) out.push({display:'Clear', startedAt:cursor, endedAt:end, durationMin:Math.round((end-cursor)/60000), clear:true});
  return out;
}
function renderTimeline(container, items, {showUtc=false, now=Date.now()}={}){
  container.innerHTML='';
  if(!items.length){ container.innerHTML='<div class="empty">No weather in this window.</div>'; return; }
  for(const it of items){
    const div=document.createElement('div');
    const isLive = now>=it.startedAt && now<it.endedAt;
    div.className='ev'+(it.endedAt<=now?' past':'')+(isLive?' live':'');
    const t = fmtLocal(it.startedAt) + (showUtc ? ' <span class="small">('+fmtUtc(it.startedAt)+'Z)</span>' : '');
    div.innerHTML =
      '<div class="t">'+t+'</div>'+
      '<div class="ic" style="color:'+(COLORS[it.display]||'#fff')+'">'+ico(it.display)+'</div>'+
      '<div class="w">'+it.display+(isLive?' <span class="chip" style="padding:1px 7px">now</span>':'')+'</div>'+
      '<div class="d">'+it.durationMin+'m</div>';
    container.appendChild(div);
  }
}

async function getJSON(url){ const r=await fetch(url); if(!r.ok) throw new Error((await r.json()).error||r.statusText); return r.json(); }

// ---- Today (local day) ----
async function loadToday(){
  const now=new Date();
  const startLocal=new Date(now.getFullYear(),now.getMonth(),now.getDate(),0,0,0,0);
  const endLocal=new Date(startLocal.getTime()+86400000);
  $('todayDate').textContent='· '+dayKeyLocal(startLocal);
  $('tzChip').textContent=Intl.DateTimeFormat().resolvedOptions().timeZone+' (UTC'+(-now.getTimezoneOffset()/60>=0?'+':'')+(-now.getTimezoneOffset()/60)+')';
  try{
    const data=await getJSON('/weather-prediction/api/window?start='+startLocal.getTime()+'&end='+endLocal.getTime());
    const modeled = data.days.some(d=>d.modeled);
    eraChip($('todayEra'), data.days.map(d=>d.source).filter(Boolean).join(' / ')||null, modeled);
    const tnow=Date.now();
    const items=fillClear(data.events, startLocal.getTime(), endLocal.getTime());
    // hero = current condition
    const cur=items.find(it=>tnow>=it.startedAt && tnow<it.endedAt);
    const next=data.events.filter(e=>e.startedAt>tnow).sort((a,b)=>a.startedAt-b.startedAt)[0];
    $('nowIcon').textContent=ico(cur?cur.display:'Clear');
    $('nowIcon').style.color=COLORS[cur?cur.display:'Clear'];
    $('nowCond').textContent=cur?cur.display:'Clear Skies';
    $('nowMeta').innerHTML = next ? ('Next: '+ico(next.display)+' '+next.display+' at '+fmtLocal(next.startedAt)+' (in '+Math.max(0,Math.round((next.startedAt-tnow)/60000))+' min)') : 'No further changes today.';
    renderTimeline($('todayTimeline'), items, {now:tnow});
  }catch(e){ $('nowCond').textContent='—'; $('todayTimeline').innerHTML='<div class="empty">'+e.message+'</div>'; }
  $('legend').innerHTML=Object.keys(ICONS).map(k=>'<span><span style="color:'+COLORS[k]+'">'+ICONS[k]+'</span> '+k+'</span>').join('');
}

// ---- Explorer ----
function eraForDate(key){
  for(const e of BOOT.eras){ if(key>=e.from && (e.to===null || key<=e.to)) return e; }
  return null;
}
function loadEraWeights(key){
  const e=eraForDate(key);
  const h=e?e.hydro:{Rain:50,Frost:30,Thunderstorm:20};
  const l=e?e.lunar:{Dawn:67,AmberMoon:33};
  $('wRain').value=h.Rain; $('wFrost').value=h.Frost; $('wThunder').value=h.Thunderstorm;
  $('wDawn').value=l.Dawn; $('wAmber').value=l.AmberMoon;
  $('exEra').className='chip'+(e?'':' warn');
  $('exEra').textContent = e ? ('engine: '+e.id+' · '+e.label) : ('unmodeled (before '+BOOT.modeledFrom+')');
}
function customOn(){ return $('exCustom').checked; }
function setCustomUI(){
  const on=customOn();
  $('weightFields').style.opacity=on?'1':'.5';
  $('weightFields').style.pointerEvents=on?'auto':'none';
}
function overrideQuery(){
  const p=new URLSearchParams();
  const seed=$('exSeed').value.trim(); if(seed) p.set('seed',seed);
  if(customOn()){
    p.set('rain',$('wRain').value); p.set('frost',$('wFrost').value); p.set('thunder',$('wThunder').value);
    p.set('dawn',$('wDawn').value); p.set('amber',$('wAmber').value);
  }
  return p;
}
async function runExplorer(){
  const date=$('exDate').value; if(!date) return;
  const p=overrideQuery(); p.set('date',date);
  try{
    const data=await getJSON('/weather-prediction/api/day?'+p.toString());
    eraChip($('exEra'), data.source, data.modeled);
    if(!data.modeled){ $('exTimeline').innerHTML='<div class="empty">No engine for '+date+'. Enable “custom weights” to sandbox it.</div>'; return; }
    const base=Date.parse(date+'T00:00:00Z');
    const items=fillClear(data.events, base, base+86400000);
    renderTimeline($('exTimeline'), items, {showUtc:true, now:Date.now()});
  }catch(e){ $('exTimeline').innerHTML='<div class="empty">'+e.message+'</div>'; }
}

// ---- Export ----
let exportFmt='csv';
function exportNote(){
  const from=$('exFrom').value,to=$('exTo').value;
  if(!from||!to){ $('expNote').textContent=''; return; }
  const days=Math.round((Date.parse(to)-Date.parse(from))/86400000)+1;
  $('expNote').textContent=days>0?(days+' day(s) · '+exportFmt.toUpperCase()+(days>BOOT.maxRangeDays?' · exceeds '+BOOT.maxRangeDays+'-day cap':'')):'“to” must be on/after “from”.';
}
function doExport(){
  const from=$('exFrom').value,to=$('exTo').value; if(!from||!to) return;
  const p=$('expApply').checked?overrideQuery():new URLSearchParams();
  p.set('from',from); p.set('to',to); p.set('format',exportFmt);
  window.location.href='/weather-prediction/api/export?'+p.toString();
}

// ---- wire up ----
function init(){
  $('modeledFrom').textContent=BOOT.modeledFrom;
  const today=new Date().toISOString().slice(0,10);
  $('exDate').value=today;
  $('exFrom').value=today; $('exTo').value=today;
  loadEraWeights(today);
  setCustomUI(); exportNote();

  $('refreshNow').onclick=loadToday;
  $('exDate').addEventListener('change',()=>{ if(!customOn()) loadEraWeights($('exDate').value); else $('exEra').textContent=(eraForDate($('exDate').value)?'engine: '+eraForDate($('exDate').value).id:'unmodeled'); });
  $('exReset').onclick=()=>loadEraWeights($('exDate').value);
  $('exCustom').addEventListener('change',setCustomUI);
  $('exRun').onclick=runExplorer;
  $('fmtSeg').querySelectorAll('button').forEach(b=>b.onclick=()=>{ exportFmt=b.dataset.fmt; $('fmtSeg').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b)); exportNote(); });
  $('exFrom').addEventListener('change',exportNote); $('exTo').addEventListener('change',exportNote);
  $('expGo').onclick=doExport;

  loadToday();
  runExplorer();
}
init();
</script>
</body>
</html>`;
