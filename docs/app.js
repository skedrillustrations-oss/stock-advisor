/* Stock Advisor trial website. Plain JavaScript, no build step.
   Prices and picks come from data/*.json, refreshed every evening by the GitHub Action.
   Everything you do (pretend buys, quiz answers, settings) is saved only in this browser. */
(() => {
"use strict";
const CFG = window.APP_CONFIG || {};
const $app = document.getElementById("app");
const $nav = document.getElementById("nav");
const DISCLAIMER = "For education and practice only. Not financial advice. Past results do not guarantee future returns. Prices come from free sources and can be delayed or wrong.";

/* ---------------------------------------------------------------- state */
const KEY = "stockAdvisor.v1";
const defaults = () => ({
  onboarded: false, profile: "Careful", quiz: [], riskLimit: 35, maxPct: 10,
  wallet: { ...(CFG.startWallet || { EGP: 100000, AED: 25000 }) },
  markets: { EGX: true, ADX: true, DFM: true },
  holdings: [], closed: [], skipped: [], watch: [], seenAlerts: 0,
});
let S;
try { S = Object.assign(defaults(), JSON.parse(localStorage.getItem(KEY) || "{}")); } catch { S = defaults(); }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} };

/* ----------------------------------------------------------------- data */
const D = { picks: null, report: null, alerts: null, log: null, detail: {} };
async function getJSON(path) {
  try { const r = await fetch(path + "?v=" + Date.now().toString().slice(0, -5)); return r.ok ? await r.json() : null; }
  catch { return null; }
}
const stocks = () => (D.picks?.stocks || []);
const bySym = (s) => stocks().find((x) => x.symbol === s);
const inMarkets = (s) => S.markets[s.market] !== false;

/* -------------------------------------------------------------- helpers */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n, d = 0) => n == null || isNaN(n) ? "–" : Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const money = (cur, n, d = 0) => `${cur} ${fmt(n, d)}`;
const pct = (n, d = 1) => n == null || isNaN(n) ? "–" : `${n > 0 ? "+" : ""}${fmt(n, d)}%`;
const cls = (n) => (n > 0 ? "up" : n < 0 ? "down" : "");
const priceD = (p) => (p >= 100 ? 2 : p >= 1 ? 2 : 3);
const short = (d) => d ? new Date(d + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "";
const longDate = (d) => d ? new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";
const tierBadge = (t) => `<span class="badge b-${t || "None"}">${t ? t + " chance" : "No signal"}</span>`;
const today = () => new Date().toISOString().slice(0, 10);
function toast(msg) { const t = document.getElementById("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 2600); }

const ICON = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  wallet: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M7 6V4h10v2"/>',
  chart: '<path d="M4 20h16M7 16V9M12 16V5M17 16v-4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  spark: '<path d="M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  warn: '<path d="M12 3l10 18H2zM12 10v5M12 18v.5"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8M14 7h7v7"/>',
};
const ic = (n, s = 22, fill = false) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="${fill ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;

/* --------------------------------------------------------------- charts */
function lineChart(values, { w = 600, h = 200, target, stop, color = "#34d27b", fillArea = true, dates } = {}) {
  const v = values.filter((x) => x != null);
  if (v.length < 2) return "";
  let lo = Math.min(...v, stop ?? Infinity), hi = Math.max(...v, target ?? -Infinity);
  const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
  const X = (i) => (i / (v.length - 1)) * w, Y = (p) => h - ((p - lo) / (hi - lo)) * h;
  const pts = v.map((p, i) => `${X(i).toFixed(1)},${Y(p).toFixed(1)}`).join(" ");
  let s = `<svg viewBox="0 0 ${w} ${h + (dates ? 18 : 0)}" width="100%" preserveAspectRatio="none" role="img" aria-label="price chart">`;
  if (fillArea) s += `<polygon points="0,${h} ${pts} ${w},${h}" fill="${color}" opacity=".08"/>`;
  const dash = (p, c, label) => `<line x1="0" x2="${w}" y1="${Y(p)}" y2="${Y(p)}" stroke="${c}" stroke-dasharray="5 6" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`;
  if (target) s += dash(target, "#34d27b");
  if (stop) s += dash(stop, "#ff7a6b");
  s += `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>`;
  s += `<circle cx="${X(v.length - 1)}" cy="${Y(v[v.length - 1])}" r="4" fill="${color}"/>`;
  if (dates) s += `<text x="0" y="${h + 14}" font-size="11" fill="#6f8a7a">${esc(dates[0])}</text><text x="${w}" y="${h + 14}" font-size="11" fill="#6f8a7a" text-anchor="end">${esc(dates[1])}</text>`;
  return s + "</svg>";
}
const spark = (v, up) => lineChart(v, { w: 120, h: 36, color: up ? "#34d27b" : "#ff7a6b", fillArea: false });

function ring(score, tier) {
  const r = 34, c = 2 * Math.PI * r, f = (score || 0) / 100;
  const col = tier === "High" ? "#34d27b" : tier === "Good" ? "#f2b544" : "#8a9a90";
  return `<svg width="86" height="86" viewBox="0 0 86 86" aria-label="score ${score} of 100"><circle cx="43" cy="43" r="${r}" stroke="#12291d" stroke-width="8" fill="none"/>
  <circle cx="43" cy="43" r="${r}" stroke="${col}" stroke-width="8" fill="none" stroke-linecap="round" stroke-dasharray="${c * f} ${c}" transform="rotate(-90 43 43)"/>
  <text x="43" y="50" text-anchor="middle" font-size="22" font-weight="700" fill="#e8f3ec">${score ?? "–"}</text></svg>`;
}

function gauge(value, limit) {
  const cx = 150, cy = 140, r = 110;
  const pt = (v, rr = r) => { const a = Math.PI * (1 - v / 100); return [cx + rr * Math.cos(a), cy - rr * Math.sin(a)]; };
  const arc = (a, b, col) => { const [x1, y1] = pt(a), [x2, y2] = pt(b); return `<path d="M${x1} ${y1} A${r} ${r} 0 0 1 ${x2} ${y2}" stroke="${col}" stroke-width="18" fill="none"/>`; };
  const [nx, ny] = pt(value, 80), [lx1, ly1] = pt(limit, 96), [lx2, ly2] = pt(limit, 128), [tx, ty] = pt(limit, 142);
  return `<svg viewBox="0 0 300 175" width="100%" style="max-width:340px;display:block;margin:auto" role="img" aria-label="risk ${value} of 100, limit ${limit}">
  ${arc(0, 25, "#34d27b")}${arc(25.5, 50, "#9ad04f")}${arc(50.5, 75, "#f2b544")}${arc(75.5, 100, "#ff7a6b")}
  <line x1="${lx1}" y1="${ly1}" x2="${lx2}" y2="${ly2}" stroke="#e8f3ec" stroke-width="2" stroke-dasharray="3 3"/>
  <text x="${tx}" y="${ty}" font-size="11" fill="#9fb8a9" text-anchor="middle">Your limit</text>
  <line x1="${cx}" y1="${cy}" x2="${nx}" y2="${ny}" stroke="#e8f3ec" stroke-width="4" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="9" fill="#e8f3ec"/>
  <text x="30" y="168" font-size="12" fill="#34d27b">Low</text><text x="270" y="168" font-size="12" fill="#ff7a6b" text-anchor="end">High</text></svg>`;
}

function hbar(label, value, color = "#34d27b", suffix = "%") {
  return `<div class="row" style="margin:8px 0"><span style="width:76px" class="small">${esc(label)}</span>
  <div class="bar" style="flex:1"><i style="width:${Math.max(0, Math.min(100, value || 0))}%;background:${color}"></i></div>
  <span class="small" style="width:46px;text-align:right">${value == null ? "–" : fmt(value) + suffix}</span></div>`;
}

/* ------------------------------------------------------- portfolio math */
const PROFILE_PCT = { Careful: { High: 8, Good: 4 }, Balanced: { High: 12, Good: 6 }, Bold: { High: 15, Good: 8 } };
function cash(cur) {
  const spent = S.holdings.filter((h) => h.currency === cur).reduce((a, h) => a + h.amount + h.fee, 0);
  const profit = S.closed.filter((h) => h.currency === cur).reduce((a, h) => a + (h.profit || 0), 0);
  return S.wallet[cur] - spent + profit;
}
function holdingValue(h) { const st = bySym(h.symbol); return h.shares * (st?.close ?? h.price); }
function walletValue(cur) {
  return cash(cur) + S.holdings.filter((h) => h.currency === cur).reduce((a, h) => a + holdingValue(h), 0);
}
function suggested(st) {
  if (!st || !st.tier || st.tier === "Weak") return 0;
  const p = Math.min(PROFILE_PCT[S.profile][st.tier], S.maxPct);
  const amt = walletValue(st.currency) * p / 100;
  const step = st.currency === "EGP" ? 500 : 100;
  return Math.max(0, Math.min(Math.floor(cash(st.currency) / step) * step, Math.round(amt / step) * step));
}
function portfolioRisk() {
  const rate = CFG.aedToEgp || 13.3, conv = (cur, n) => (cur === "AED" ? n * rate : n);
  const total = conv("EGP", walletValue("EGP")) + conv("AED", walletValue("AED"));
  if (total <= 0) return 0;
  const inv = S.holdings.reduce((a, h) => a + conv(h.currency, holdingValue(h)), 0);
  if (inv <= 0) return 0;
  const avg = S.holdings.reduce((a, h) => a + conv(h.currency, holdingValue(h)) * (bySym(h.symbol)?.risk ?? 50), 0) / inv;
  // How jumpy your stocks are, softened by how much of your money is still safe in cash.
  return Math.round(Math.min(100, avg * Math.sqrt(inv / total) * 1.6));
}
function holdingStatus(h) {
  const st = bySym(h.symbol); const p = st?.close ?? h.price;
  if (p >= h.target) return { kind: "target", text: "Target reached: time to sell", cls: "up" };
  if (p <= h.stop) return { kind: "stop", text: "Safety exit reached: time to sell", cls: "down" };
  if ((p - h.stop) / (h.target - h.stop) < 0.2) return { kind: "near", text: "Close to safety exit", cls: "down" };
  return null;
}

/* ------------------------------------------------------------------ nav */
const TABS = [["home", "Home", "home"], ["picks", "Picks", "star"], ["mystocks", "My stocks", "wallet"], ["report", "Report", "chart"], ["me", "Me", "user"]];
function renderNav(route) {
  const active = { stock: "picks", explore: "picks", history: "mystocks", alerts: "home" }[route] || route;
  $nav.innerHTML = `<div class="brand"><img src="icon.svg" width="30" height="30" alt="">${esc(CFG.appName || "Stock Advisor")}</div>` +
    TABS.map(([r, l, i]) => `<a href="#/${r}" class="${active === r ? "active" : ""}">${ic(i)}<span>${l}</span></a>`).join("") +
    `<a href="#/explore" class="${route === "explore" ? "active" : ""} desk-only" style="${matchMedia("(max-width:859px)").matches ? "display:none" : ""}">${ic("search")}<span>Explore</span></a>` +
    `<a href="#/alerts" class="${route === "alerts" ? "active" : ""}" style="${matchMedia("(max-width:859px)").matches ? "display:none" : ""}">${ic("bell")}<span>Alerts</span></a>`;
}
const header = (title, { back, right = "", sub = "" } = {}) =>
  `<div class="between" style="margin-bottom:14px"><div class="row">${back ? `<button class="icon-btn" data-back aria-label="Back">${ic("back", 20)}</button>` : ""}<div><h1>${title}</h1>${sub ? `<div class="faint">${sub}</div>` : ""}</div></div>${right}</div>`;
const footer = () => `<p class="disclaimer">${DISCLAIMER}</p>`;

/* ------------------------------------------------------------- screens */
function waiting() {
  return `${header("Getting ready")}<div class="card empty">${ic("clock", 40)}<h2 style="margin:12px 0 6px">Waiting for the first evening update</h2>
  <p>No price data yet. Once the daily job has run (see the setup guide, step 3), today's picks will appear here.</p></div>${footer()}`;
}

function welcome() {
  const f = (i, t, d) => `<div class="row" style="align-items:flex-start;margin-top:16px"><span class="icon-btn" style="border-radius:12px;color:var(--green)">${ic(i, 20)}</span><div><b>${t}</b><div class="muted small">${d}</div></div></div>`;
  return `<div style="max-width:520px;margin:20px auto 0">
  <div class="row"><img src="icon.svg" width="48" height="48" alt=""><b style="font-family:var(--head);font-size:22px">${esc(CFG.appName || "Stock Advisor")}</b></div>
  <h1 style="font-size:38px;margin:28px 0 14px">Invest calmly.<br>We do the homework.</h1>
  <p class="muted" style="font-size:17px">We study five years of the Egyptian and UAE markets every evening, and tell you in plain words which stocks look promising and how much is safe to put in.</p>
  ${f("shield", "Practice first, no real money", "Start with a pretend wallet and see how the advice performs.")}
  ${f("chart", "An honest scorecard", "See every prediction that worked and every one that failed.")}
  ${f("chat", "Explained like a friend would", "No jargon. Every tip says why, and what could go wrong.")}
  <div style="margin-top:34px"><a class="btn primary" href="#/quiz">Get started</a></div>
  <p class="disclaimer">${DISCLAIMER}</p></div>`;
}

const QUIZ = [
  { q: "Imagine you put in EGP 10,000 and a month later it is worth EGP 9,000. What would you do?", sub: "There is no wrong answer. This helps us suggest amounts that let you sleep at night.",
    a: ["I would sell everything. I can't afford to lose.", "I would feel worried, but wait and see.", "I would keep calm. Ups and downs are normal.", "I would buy more while it is cheaper."] },
  { q: "How long could you leave this money untouched?", a: ["Less than 6 months", "6 to 12 months", "1 to 3 years", "More than 3 years"] },
  { q: "What matters most to you?", a: ["Never losing money", "Small, steady gains", "A balance of safety and growth", "The biggest possible gains"] },
  { q: "How much do you know about stocks?", a: ["Nothing at all", "A little", "Some, I have read about it", "A lot, I have invested before"] },
  { q: "If this money disappeared, how would your life change?", a: ["Badly, I need it", "Quite a lot", "A little", "Not really"] },
];
function profileFrom(ans) { const t = ans.reduce((a, b) => a + (b ?? 0), 0); return t <= 5 ? "Careful" : t <= 10 ? "Balanced" : "Bold"; }
const PROFILE_WORDS = { Careful: "We will keep most of your money safe and suggest small amounts per stock.", Balanced: "We will mix safety and growth, with medium amounts per stock.", Bold: "We will suggest larger amounts on the strongest chances. Losses can be bigger too." };
function quiz(params) {
  const i = Math.min(Number(params[0] || 0), QUIZ.length - 1), Q = QUIZ[i], sel = S.quiz[i];
  const so = S.quiz.filter((x) => x != null).length ? profileFrom(S.quiz) : null;
  return `<div style="max-width:560px;margin:0 auto">
  <div class="row"><button class="icon-btn" data-back aria-label="Back">${ic("back", 20)}</button><div class="progress"><i style="width:${((i + 1) / QUIZ.length) * 100}%"></i></div><span class="muted small">${i + 1} of ${QUIZ.length}</span></div>
  <div class="label" style="color:var(--green)">Getting to know you</div><h1>${esc(Q.q)}</h1>${Q.sub ? `<p class="muted">${Q.sub}</p>` : ""}
  ${Q.a.map((t, k) => `<button class="option ${sel === k ? "on" : ""}" data-quiz="${i}:${k}"><span class="radio"></span>${esc(t)}</button>`).join("")}
  ${so ? `<div class="card" style="margin-top:18px">So far you look like a <b>${so}</b> investor. ${PROFILE_WORDS[so]}</div>` : ""}
  <div style="margin-top:18px"><button class="btn primary" data-quiz-next="${i}" ${sel == null ? "disabled" : ""}>${i === QUIZ.length - 1 ? "Finish" : "Next"}</button></div></div>`;
}

function pickCard(st, compact = false) {
  const amt = suggested(st);
  if (compact) return `<a class="card pick row" href="#/stock/${st.symbol}"><div class="ticker">${esc(st.symbol.slice(0, 6))}</div>
    <div style="flex:1;min-width:0"><b>${esc(st.name)}</b><div class="faint">${st.market} · ${amt ? "Suggested " + money(st.currency, amt) : "Watch only"}</div></div>
    <div style="text-align:right">${tierBadge(st.tier).replace(" chance", "")}<div class="faint">${st.score} / 100</div></div></a>`;
  return `<a class="card pick" href="#/stock/${st.symbol}"><div class="row"><div class="ticker">${esc(st.symbol.slice(0, 6))}</div>
    <div style="flex:1;min-width:0"><b>${esc(st.name)}</b><div class="faint">${esc(st.marketName)} · ${esc(st.sector)}</div></div>
    <div class="score t-${st.tier}">${st.score}</div></div>
    <div class="bar" style="margin:12px 0"><i style="width:${st.score}%;background:${st.tier === "High" ? "var(--green)" : st.tier === "Good" ? "var(--amber)" : "var(--grey)"}"></i></div>
    <div class="muted small">${esc(st.why)}</div>
    <div class="between small" style="margin-top:10px"><span>${amt ? `Suggested <b>${money(st.currency, amt)}</b>` : "<span class='muted'>Watch only</span>"}</span>
    <span class="muted">Aim ${pct(st.targetPct, 0)} in ~8 weeks</span></div></a>`;
}

function home() {
  if (!D.picks) return waiting();
  const m = D.picks.meta, h = new Date().getHours();
  const best = stocks().filter((s) => inMarkets(s) && (s.tier === "High" || s.tier === "Good")).slice(0, 3);
  const eg = walletValue("EGP"), ae = walletValue("AED");
  const egChg = (eg / S.wallet.EGP - 1) * 100, aeChg = (ae / S.wallet.AED - 1) * 100;
  const sellNow = S.holdings.filter((x) => { const s = holdingStatus(x); return s && s.kind !== "near"; });
  const closed = D.report?.live?.closed ?? 0, rate = D.report?.live?.hit_rate ?? D.report?.backtest?.hit_rate;
  const series = (bySym(S.holdings[0]?.symbol) || stocks()[0])?.spark || [];
  const newAlerts = (D.alerts?.events || []).length - (S.seenAlerts || 0);
  let words = sellNow.length ? `${sellNow.length} of your stocks need attention: it's time to sell.` :
    m.counts.High ? `${m.counts.High} High chance pick${m.counts.High > 1 ? "s are" : " is"} waiting for you today.` : "No High chance picks today. Waiting is also a decision.";
  return `${header(`<span class="muted" style="font:500 15px Inter">Good ${h < 12 ? "morning" : h < 18 ? "afternoon" : "evening"}</span><br>Your money today`, { right: `<a class="icon-btn" href="#/alerts" aria-label="Alerts" style="position:relative;color:var(--text)">${ic("bell", 20)}${newAlerts > 0 ? '<i style="position:absolute;top:8px;right:9px;width:8px;height:8px;border-radius:50%;background:var(--green)"></i>' : ""}</a>` })}
  <div class="cols"><div>
  <div class="card"><div class="muted small">Pretend wallet value</div>
    <div class="big">${money("EGP", eg)}</div>
    <div class="row small" style="margin:6px 0 10px;flex-wrap:wrap"><span class="badge" style="background:#123d27;color:var(--green);text-transform:none;font-size:13px">${pct(egChg)} since start</span><span class="muted">plus ${money("AED", ae)} (${pct(aeChg)})</span></div>
    ${series.length ? lineChart(series, { h: 70 }) : ""}
    <div class="grid three" style="grid-template-columns:repeat(3,1fr);margin-top:10px">
      <div><b>${money("EGP", cash("EGP"))}</b><div class="faint">Cash kept safe</div></div>
      <div><b>${S.holdings.length}</b><div class="faint">Stocks held</div></div>
      <div><b>${rate != null ? rate + "%" : "–"}</b><div class="faint">App hit rate${closed ? "" : " (past 5 yrs)"}</div></div></div></div>
  <div class="card row" style="margin-top:12px;align-items:flex-start"><span class="sparkle">${ic("spark", 20)}</span><div>${words}</div></div>
  </div><div>
  <div class="section-title"><h2>Today's best chances</h2><a href="#/picks">See all</a></div>
  <div class="stack">${best.length ? best.map((s) => pickCard(s, true)).join("") : `<div class="card muted">No High or Good chances in your markets today.</div>`}</div>
  ${sellNow.length ? `<div class="section-title"><h2>Time to sell</h2></div>${sellNow.map((x) => `<a class="card pick between" href="#/mystocks"><b>${esc(x.name)}</b><span class="${holdingStatus(x).cls} small">${holdingStatus(x).text}</span></a>`).join("")}` : ""}
  <p class="faint" style="margin-top:14px">Prices from ${short(stocks()[0]?.date)} · updated ${longDate(m.updated)} · ${m.checked} stocks checked</p>
  </div></div>${footer()}`;
}

let picksTier = "High", picksMarket = "all";
function picks() {
  if (!D.picks) return waiting();
  const m = D.picks.meta;
  const pool = stocks().filter(inMarkets).filter((s) => picksMarket === "all" || s.market === picksMarket);
  const list = pool.filter((s) => s.tier === picksTier);
  const n = (t) => pool.filter((s) => s.tier === t).length;
  return `${header("Today's picks", { sub: `Updated ${longDate(m.updated)} · ${m.checked} stocks checked`, right: `<a class="icon-btn" href="#/explore" aria-label="Explore any stock" style="color:var(--text)">${ic("search", 20)}</a>` })}
  <div class="seg">${["High", "Good", "Weak"].map((t) => `<button class="${picksTier === t ? "on" : ""}" data-tier="${t}">${t} · ${n(t)}</button>`).join("")}</div>
  <div class="chips" style="margin:12px 0">${[["all", "All markets"], ["EGX", "Egypt"], ["ADX", "Abu Dhabi"], ["DFM", "Dubai"]].map(([k, l]) => `<button class="chip ${picksMarket === k ? "on" : ""}" data-pmarket="${k}">${l}</button>`).join("")}</div>
  ${picksTier === "Weak" ? `<div class="notice" style="margin-bottom:12px">Weak chances are for watching only. We don't suggest putting money in these.</div>` : ""}
  <div class="grid two">${list.length ? list.map((s) => pickCard(s)).join("") : `<div class="card muted">No ${picksTier} chance stocks today${picksMarket !== "all" ? " in this market" : ""}.</div>`}</div>${footer()}`;
}

let range = "1Y";
async function stock(params) {
  const st = bySym(params[0]);
  if (!st) return `${header("Stock not found", { back: true })}${footer()}`;
  if (!D.detail[st.symbol]) D.detail[st.symbol] = await getJSON(`data/stocks/${st.symbol}.json`);
  const dt = D.detail[st.symbol] || {};
  const daily = (dt.daily || []).map((x) => x[1]), weekly = (dt.weekly || []).map((x) => x[1]);
  const series = { "1M": daily.slice(-22), "6M": daily.slice(-126), "1Y": daily, "5Y": weekly }[range] || daily;
  const amt = suggested(st), d = priceD(st.close), ph = st.pastSetups || {};
  const held = S.holdings.find((h) => h.symbol === st.symbol), watched = S.watch.includes(st.symbol);
  const years = Object.entries(dt.yearly || {});
  const maxAbs = Math.max(1, ...years.map(([, v]) => Math.abs(v || 0)));
  return `<div class="between" style="margin-bottom:12px"><button class="icon-btn" data-back aria-label="Back">${ic("back", 20)}</button>
    <button class="icon-btn" data-watch="${st.symbol}" aria-label="Watch" style="color:${watched ? "var(--green)" : "inherit"}">${ic("bookmark", 18, watched)}</button></div>
  <div class="faint">${esc(st.symbol)} · ${esc(st.marketName)} exchange · ${esc(st.sector)}</div>
  <h1 style="margin:4px 0">${esc(st.name)}</h1>
  <div class="row" style="align-items:baseline"><span class="big">${money(st.currency, st.close, d)}</span><span class="${cls(st.chg1d)}">${pct(st.chg1d)} on ${short(st.date)}</span></div>
  <div class="cols" style="margin-top:14px"><div>
  <div class="card">${lineChart(series, { h: 180, target: st.tier ? st.target : null, stop: st.tier ? st.stop : null })}
    ${st.tier ? `<div class="between small" style="margin-top:6px"><span class="up">Target ${fmt(st.target, d)}</span><span class="down">Safety exit ${fmt(st.stop, d)}</span></div>` : ""}
    <div class="seg dark" style="margin-top:10px">${["1M", "6M", "1Y", "5Y"].map((r) => `<button class="${range === r ? "on" : ""}" data-range="${r}">${r}</button>`).join("")}</div></div>
  <div class="card row" style="align-items:center">${ring(st.score, st.tier)}<div>${tierBadge(st.tier)}
    <div class="small" style="margin-top:6px">${ph.total ? `In the past 5 years, when this stock looked like this, it reached its target before the safety exit <b>${ph.wins} times out of ${ph.total}</b>.` : st.tier ? "Not enough past setups like this one to compare." : "Score below 45: no signal today."}</div></div></div>
  <div class="card"><div class="row"><span class="sparkle">${ic("spark", 18)}</span><h3>In plain words</h3></div>
    <p>${esc(st.why)}</p><b>What could go wrong</b><p class="muted" style="margin-bottom:0">${esc(st.whatCouldGoWrong)}</p></div>
  ${years.length ? `<div class="card"><h3>The last ${years.length} years, year by year</h3>
    <svg viewBox="0 0 ${years.length * 70} 150" width="100%" style="margin-top:10px">${years.map(([y, v], i) => { const hgt = Math.abs(v || 0) / maxAbs * 90; const pos = (v || 0) >= 0; return `<rect x="${i * 70 + 12}" y="${pos ? 110 - hgt : 110}" width="46" height="${Math.max(2, hgt)}" rx="5" fill="${pos ? "#34d27b" : "#ff7a6b"}"/><text x="${i * 70 + 35}" y="${pos ? 104 - hgt : 124 + hgt}" font-size="11" fill="#e8f3ec" text-anchor="middle">${pct(v, 0)}</text><text x="${i * 70 + 35}" y="146" font-size="11" fill="#9fb8a9" text-anchor="middle">${y}</text>`; }).join("")}</svg>
    <div class="grid two" style="grid-template-columns:1fr 1fr;margin-top:8px">
      <div class="card" style="background:var(--bg)"><div class="faint">If you had put in ${st.currency} 1,000 at the start</div><b class="mid">${money(st.currency, (dt.growth5y || 0) * 1000)}</b><div class="faint">now (dividends included)</div></div>
      <div class="card" style="background:var(--bg)"><div class="faint">Dividends paid</div><b class="mid">${dt.dividendYears ? `${dt.dividendYears} of ${dt.years} yrs` : "None found"}</b></div>
      <div class="card" style="background:var(--bg)"><div class="faint">Biggest fall</div><b class="mid down">${pct(dt.biggestFall, 0)}</b></div>
      <div class="card" style="background:var(--bg)"><div class="faint">How jumpy</div><b class="mid">${st.risk < 30 ? "Low" : st.risk < 60 ? "Medium" : "High"}</b></div></div></div>` : ""}
  </div><div>
  ${st.tier ? `<div class="card"><h3 style="margin-bottom:6px">The plan</h3>
    <div class="kv"><span>Buy around</span><b>${money(st.currency, st.close, d)}</b></div>
    <div class="kv"><span>Take profit at</span><b class="up">${money(st.currency, st.target, d)} (${pct(st.targetPct)})</b></div>
    <div class="kv"><span>Safety exit at</span><b class="down">${money(st.currency, st.stop, d)} (−${fmt(st.stopPct, 1)}%)</b></div>
    <div class="kv"><span>Expected time</span><b>up to 8 weeks</b></div></div>` : ""}
  <div class="card"><h3 style="margin-bottom:6px">Signals we checked</h3>${st.checks.map((c) => `<div class="check"><b class="${c.ok === "yes" ? "up" : c.ok === "no" ? "down" : ""}" style="${c.ok === "warn" ? "color:var(--amber)" : ""}">${c.ok === "yes" ? "✓" : c.ok === "no" ? "✕" : "!"}</b><span>${esc(c.text)}</span></div>`).join("")}</div>
  ${held ? `<div class="card"><div class="muted small">You hold (pretend)</div><b class="mid">${held.shares} shares</b><div class="faint">bought ${short(held.date)} at ${fmt(held.price, d)}</div></div>` :
    amt ? `<div class="card"><div class="muted small">Suggested for you (${S.profile})</div><div class="mid">${money(st.currency, amt)}</div>
    <div class="faint">${fmt(amt / walletValue(st.currency) * 100, 0)}% of your wallet · most you could lose ≈ ${money(st.currency, amt * st.stopPct / 100)}</div></div>` : ""}
  <div style="margin-top:12px">${held ? `<a class="btn ghost" href="#/mystocks">See in My stocks</a>` : `<button class="btn primary" data-buy="${st.symbol}">Pretend buy</button>
    ${st.tier && st.tier !== "Weak" ? `<button class="btn ghost" data-skip="${st.symbol}">Skip this one</button>` : ""}`}</div>
  </div></div>${footer()}`;
}

function buySheet(sym) {
  const st = bySym(sym); if (!st) return;
  const sug = suggested(st) || (st.currency === "EGP" ? 2000 : 500);
  const step = st.currency === "EGP" ? 2000 : 500;
  const opts = [Math.max(step / 2, sug - step), sug, sug + step];
  const root = document.getElementById("sheet-root");
  const draw = (amt) => {
    const fee = amt * (CFG.feePct ?? 0.3) / 100, shares = Math.floor(amt / st.close), cost = shares * st.close;
    const gain = cost * st.targetPct / 100 - 2 * fee, loss = cost * st.stopPct / 100 + 2 * fee, cashLeft = cash(st.currency);
    return `<div class="sheet-backdrop" data-close-sheet><div class="sheet" role="dialog" aria-label="Pretend buy">
    <div class="between"><h2>Pretend buy ${esc(st.symbol)}</h2><button class="icon-btn" data-close-sheet aria-label="Close">${ic("close", 18)}</button></div>
    <p class="muted small" style="margin:14px 0 6px">How much do you want to put in?</p>
    <label class="amount"><span class="muted">${st.currency}</span><input id="amt" inputmode="numeric" value="${fmt(amt)}" aria-label="Amount"></label>
    <div class="grid three" style="grid-template-columns:repeat(3,1fr);margin:10px 0">${opts.map((o) => `<button class="chip ${o === amt ? "on" : ""}" data-amt="${o}" style="border-radius:12px;padding:10px 4px">${fmt(o)}${o === sug && suggested(st) ? "<br><small>suggested</small>" : ""}</button>`).join("")}</div>
    <div class="card" style="background:var(--bg)">
      <div class="kv"><span>Shares you get</span><b>${fmt(shares)} shares</b></div>
      <div class="kv"><span>Broker fees (buy + sell)</span><b>${money(st.currency, 2 * fee)}</b></div>
      ${st.tier ? `<div class="kv"><span>If target is reached</span><b class="up">+${money(st.currency, gain)}</b></div>
      <div class="kv"><span>If safety exit is hit</span><b class="down">−${money(st.currency, loss)}</b></div>` : ""}
      <div class="kv"><span>Pretend cash left after</span><b>${money(st.currency, cashLeft - cost - fee)}</b></div></div>
    ${!st.tier || st.tier === "Weak" ? `<div class="notice" style="margin-top:12px">This stock has no buy signal today. You can still practise, but the app does not suggest it.</div>` : ""}
    <button class="btn primary" style="margin-top:14px" id="confirm-buy" ${shares < 1 || cost + fee > cashLeft ? "disabled" : ""}>${cost + fee > cashLeft ? "Not enough pretend cash" : "Confirm pretend buy"}</button>
    <p class="faint" style="text-align:center">Test mode: no real money is used. This is saved in this browser only.</p></div></div>`;
  };
  let amt = sug;
  const paint = () => {
    root.innerHTML = draw(amt);
    const inp = root.querySelector("#amt");
    inp.addEventListener("change", () => { amt = Math.max(0, Number(inp.value.replace(/[^\d.]/g, "")) || 0); paint(); });
    root.querySelectorAll("[data-amt]").forEach((b) => b.onclick = () => { amt = Number(b.dataset.amt); paint(); });
    root.querySelectorAll("[data-close-sheet]").forEach((b) => b.onclick = (e) => { if (e.target === b) root.innerHTML = ""; });
    root.querySelector("#confirm-buy").onclick = () => {
      const shares = Math.floor(amt / st.close), cost = shares * st.close, fee = cost * (CFG.feePct ?? 0.3) / 100;
      S.holdings.push({ id: Date.now(), symbol: st.symbol, name: st.name, market: st.market, currency: st.currency, shares, price: st.close,
        amount: cost, fee, date: today(), target: st.tier ? st.target : st.close * 1.08, stop: st.tier ? st.stop : st.close * 0.94, tier: st.tier, score: st.score });
      save(); root.innerHTML = ""; toast(`Pretend bought ${shares} ${st.symbol} shares`); location.hash = "#/mystocks";
    };
  };
  paint();
}

function sellHolding(id) {
  const i = S.holdings.findIndex((h) => h.id === id); if (i < 0) return;
  const h = S.holdings[i], p = bySym(h.symbol)?.close ?? h.price;
  const proceeds = h.shares * p, fee = proceeds * (CFG.feePct ?? 0.3) / 100;
  const pl = proceeds - fee - h.amount - h.fee;
  const status = holdingStatus(h);
  S.closed.unshift({ ...h, exitDate: today(), exitPrice: p, profit: pl, ret: (p / h.price - 1) * 100,
    reason: status?.kind === "target" ? "at target" : status?.kind === "stop" ? "at safety exit" : "by you" });
  S.holdings.splice(i, 1); save(); toast(`Pretend sold ${h.symbol}: ${pl >= 0 ? "+" : "−"}${money(h.currency, Math.abs(pl))}`); render();
}

function mystocks() {
  if (!D.picks) return waiting();
  const block = (cur) => {
    const hs = S.holdings.filter((h) => h.currency === cur);
    const inv = hs.reduce((a, h) => a + h.amount, 0), val = hs.reduce((a, h) => a + holdingValue(h), 0);
    const realised = S.closed.filter((h) => h.currency === cur).reduce((a, h) => a + h.profit, 0);
    const total = walletValue(cur), c = cash(cur);
    const sectors = {}; hs.forEach((h) => { const s = bySym(h.symbol)?.sector || "Other"; sectors[s] = (sectors[s] || 0) + holdingValue(h); });
    const parts = [["Cash", c, "#c9d6ce"], ...Object.entries(sectors).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v], i) => [k, v, ["#34d27b", "#1f9e5a", "#f2b544"][i]])];
    return `<div class="card"><div class="between muted small"><span>Invested (pretend) in ${cur}</span><span>Profit so far</span></div>
      <div class="between"><span class="mid">${money(cur, inv)}</span><span class="mid ${cls(val - inv + realised)}">${val - inv + realised >= 0 ? "+" : "−"}${money(cur, Math.abs(val - inv + realised))}</span></div>
      <div style="display:flex;height:8px;border-radius:9px;overflow:hidden;margin:12px 0 6px;gap:2px">${parts.map(([, v, col]) => `<i style="flex:${Math.max(v, 0)};background:${col}"></i>`).join("")}</div>
      <div class="chips small muted">${parts.map(([k, v]) => `<span>${esc(k)} ${fmt(total ? v / total * 100 : 0)}%</span>`).join("")}</div></div>`;
  };
  const card = (h) => {
    const st = bySym(h.symbol), p = st?.close ?? h.price, val = h.shares * p, ch = (p / h.price - 1) * 100, s = holdingStatus(h);
    const pos = Math.max(0, Math.min(100, (p - h.stop) / (h.target - h.stop) * 100)), d = priceD(p);
    return `<div class="card" style="${s && s.kind !== "near" ? "border-color:" + (s.kind === "target" ? "var(--green)" : "var(--coral)") : ""}">
      <div class="between"><a href="#/stock/${h.symbol}" style="color:inherit;text-decoration:none"><b>${esc(h.name)}</b></a><b>${money(h.currency, val)}</b></div>
      <div class="between faint"><span>${h.shares} shares · bought ${short(h.date)} at ${fmt(h.price, d)} · ${h.market}</span><span class="${cls(ch)}">${pct(ch)}</span></div>
      <div style="position:relative;margin:14px 0 6px"><div class="bar" style="background:linear-gradient(90deg,#5a1f19,#12291d 35%,#12291d 65%,#1f7a4a)"></div>
      <i style="position:absolute;top:-5px;left:calc(${pos}% - 8px);width:16px;height:16px;border-radius:50%;background:#fff;border:3px solid var(--bg)"></i></div>
      <div class="between small"><span class="${s?.kind === "near" || s?.kind === "stop" ? "down" : "faint"}">${s?.kind === "near" ? "Close to safety exit" : `Safety exit ${fmt(h.stop, d)}`}</span><span class="faint">Target ${fmt(h.target, d)}</span></div>
      ${s && s.kind !== "near" ? `<div class="notice" style="margin-top:10px;border-color:${s.kind === "target" ? "var(--green)" : "var(--coral)"}">${s.text}</div>` : ""}
      <button class="btn ghost" style="margin-top:12px;padding:10px" data-sell="${h.id}">Pretend sell now at ${fmt(p, d)}</button></div>`;
  };
  const curs = ["EGP", "AED"].filter((c) => S.holdings.some((h) => h.currency === c) || S.closed.some((h) => h.currency === c));
  return `${header("My stocks", { right: `<a href="#/history">History</a>` })}
  ${S.holdings.length || S.closed.length ? `<div class="grid two">${(curs.length ? curs : ["EGP"]).map(block).join("")}</div>
  <div class="grid two" style="margin-top:12px">${S.holdings.map(card).join("")}</div>
  ${!S.holdings.length ? `<div class="card muted" style="margin-top:12px">You don't hold any pretend stocks right now.</div>` : ""}` :
  `<div class="card empty">${ic("wallet", 40)}<h2 style="margin:10px 0">No pretend stocks yet</h2><p>Open a High chance pick and press Pretend buy to start practising.</p><a class="btn primary" href="#/picks" style="max-width:280px;margin:auto">See today's picks</a></div>`}
  ${footer()}`;
}

let histTab = "all";
function historyPage() {
  const app = (D.log?.signals || []).filter((s) => s.result !== "open").map((s) => ({ kind: "app", name: s.name, tier: s.tier, date: s.date, exit: s.exit_date, ret: (s.ret || 0) * 100, result: s.result, line: `App pick ${short(s.date)} · closed ${short(s.exit_date)}` }));
  const mine = S.closed.map((h) => ({ kind: "bought", name: h.name, tier: h.tier, date: h.date, exit: h.exitDate, ret: h.ret, result: h.ret > 0 ? "win" : "loss", line: `Bought ${short(h.date)} · sold ${short(h.exitDate)} ${h.reason}` }))
    .concat(S.holdings.map((h) => { const p = bySym(h.symbol)?.close ?? h.price; return { kind: "bought", name: h.name, tier: h.tier, date: h.date, ret: (p / h.price - 1) * 100, result: "open", line: `Bought ${short(h.date)} · still open` }; }));
  const skipped = S.skipped.map((k) => { const p = bySym(k.symbol)?.close ?? k.price; const r = (p / k.price - 1) * 100; return { kind: "skipped", name: k.name, tier: k.tier, date: k.date, ret: r, result: "skip", line: `You skipped ${short(k.date)} · ${r >= 0 ? "would have made" : "would have lost"} so far` }; });
  let all = [...mine, ...skipped, ...app].sort((a, b) => (b.exit || b.date).localeCompare(a.exit || a.date));
  const f = { all: () => true, bought: (x) => x.kind === "bought", skipped: (x) => x.kind === "skipped", right: (x) => x.kind === "app" && x.result === "win", wrong: (x) => x.kind === "app" && x.result === "loss" }[histTab];
  const list = all.filter(f); let month = "";
  const rows = list.map((x) => { const m = new Date((x.exit || x.date) + "T12:00:00").toLocaleDateString("en-GB", { month: "long", year: "numeric" }).toUpperCase();
    const head = m !== month ? `<div class="label">${month = m}</div>` : "";
    const dot = x.result === "win" ? `<span class="dot win">${ic("check", 16)}</span>` : x.result === "loss" ? `<span class="dot loss">${ic("close", 16)}</span>` : `<span class="dot open">${ic("clock", 16)}</span>`;
    return `${head}<div class="list-item">${dot}<div style="flex:1;min-width:0"><b>${esc(x.name)}</b> ${x.tier ? tierBadge(x.tier).replace(" chance", "") : ""}<div class="faint">${x.line}</div></div><b class="${cls(x.ret)}">${pct(x.ret)}</b></div>`; }).join("");
  return `${header("History", { back: true })}
  <div class="chips">${[["all", `All ${all.length}`], ["bought", "I bought"], ["skipped", "I skipped"], ["right", "App was right"], ["wrong", "App was wrong"]].map(([k, l]) => `<button class="chip ${histTab === k ? "on" : ""}" data-hist="${k}">${l}</button>`).join("")}</div>
  <div class="card" style="margin-top:12px">${rows || `<div class="empty">Nothing here yet. Finished app picks appear here automatically once they reach their target or safety exit.</div>`}</div>
  <button class="btn ghost" style="margin-top:14px" onclick="window.print()">Export history (PDF)</button>${footer()}`;
}

let repTab = "backtest";
function report() {
  const R = D.report; if (!R) return waiting();
  const r = R[repTab], live = repTab === "live";
  const sub = live ? (r.started ? `Live picks since ${short(r.started)} · ${r.closed} finished, ${r.open} still open` : "Live tracking starts after the first evening update")
    : `Simulated on past prices since ${short(r.from)} · ${fmt(r.closed)} finished predictions`;
  const t = r.by_tier, mk = r.by_market;
  const good = t.High.rate != null && t.Good.rate != null && t.High.rate >= t.Good.rate;
  const gradeCol = /^A|^B/.test(r.grade) ? "var(--green)" : r.grade === "C" ? "var(--amber)" : r.grade === "–" ? "var(--surface2)" : "var(--coral)";
  const best = Object.entries(mk).filter(([, v]) => v.rate != null).sort((a, b) => b[1].rate - a[1].rate);
  const names = { EGX: "Egypt", ADX: "Abu Dhabi", DFM: "Dubai" };
  const plain = r.closed ? `${best.length ? `${names[best[0][0]]} picks did best (${best[0][1].rate}% right)` : ""}${best.length > 1 ? ` and ${names[best[best.length - 1][0]]} did worst (${best[best.length - 1][1].rate}%)` : ""}. ` +
    `On average a winning pick made ${pct(r.avg_win)} and a losing one ${pct(r.avg_loss)}. ` + (good ? "Higher chance levels won more often, as they should." : "Higher chance levels did not win more often yet, so the scoring rules still need tuning.") : "Not enough finished predictions yet.";
  return `${header("How accurate is the app?", { sub: `Updated every evening · ${sub}` })}
  <div class="seg dark"><button class="${!live ? "on" : ""}" data-rep="backtest">Past 5 years (test run)</button><button class="${live ? "on" : ""}" data-rep="live">Live since start</button></div>
  ${!live ? `<p class="faint">The test run replays today's rules over old prices. It shows whether the rules would have worked, but the live record below is the honest proof.</p>` : ""}
  <div class="cols" style="margin-top:12px"><div>
  <div class="card row"><div style="width:76px;height:76px;border-radius:16px;background:${gradeCol};color:var(--on-green);display:flex;align-items:center;justify-content:center;font:700 34px var(--head);flex:none">${esc(r.grade)}</div>
    <div><h3>Report card</h3><div class="muted small">${esc(r.words)} ${R.ready.every((x) => x.ok) ? "Ready for real money." : "Not ready for real money yet."}</div></div></div>
  <div class="card"><h3>Hit rate by chance level</h3>${hbar("High", t.High.rate)}${hbar("Good", t.Good.rate, "#f2b544")}${hbar("Weak", t.Weak.rate, "#8a9a90")}
    <div class="faint">${good ? "Good sign: higher levels win more often, as they should." : "Higher levels should win more often. If they don't, the rules need adjusting."} "Right" means the target was reached before the safety exit.</div></div>
  <div class="card"><h3>App picks compared with the market</h3><p class="faint">Average result of each High or Good pick, versus buying any watched stock and holding for the same 8 weeks.</p>
    ${hbar("App picks", Math.max(0, (r.avg_pick ?? 0) * 5), "#34d27b", "").replace(/>[^<]*<\/span><\/div>$/, `>${pct(r.avg_pick)}</span></div>`)}
    ${hbar("Market", Math.max(0, (R.marketAvg ?? 0) * 5), "#8a9a90", "").replace(/>[^<]*<\/span><\/div>$/, `>${pct(R.marketAvg)}</span></div>`)}</div>
  <div class="grid two" style="grid-template-columns:1fr 1fr;margin-top:12px">
    <div class="card"><div class="faint">Average win</div><b class="mid up">${pct(r.avg_win)}</b></div>
    <div class="card"><div class="faint">Average miss</div><b class="mid down">${pct(r.avg_loss)}</b></div></div>
  </div><div>
  <div class="card"><h3>When we said "${r.calibration[2].label} score", was it right?</h3><p class="faint">How often each score range reached its target</p>
    ${r.calibration.map((c, i) => hbar(c.label, c.rate, i === 3 ? "#f2b544" : "#c9d6ce")).join("")}</div>
  <div class="card"><h3>By market</h3>${hbar("Egypt", mk.EGX.rate)}${hbar("Abu Dhabi", mk.ADX.rate)}${hbar("Dubai", mk.DFM.rate)}</div>
  <div class="card"><div class="row"><span class="sparkle">${ic("spark", 18)}</span><h3>In plain words</h3></div><p style="margin-bottom:0">${esc(plain)}</p></div>
  <div class="card"><h3>Ready for real money?</h3>${R.ready.map((x) => `<div class="check"><b class="${x.ok ? "up" : "muted"}">${x.ok ? "✓" : "○"}</b><span>${esc(x.text)}</span></div>`).join("")}
    <p class="faint" style="margin-bottom:0">These are counted from live picks only.</p></div>
  <a class="btn ghost" href="#/history" style="margin-top:12px" data-hist-wrong>See every failed prediction</a>
  </div></div>${footer()}`;
}

function alerts() {
  const ev = D.alerts?.events || [];
  S.seenAlerts = ev.length; save();
  const on = !!CFG.brevoFormUrl;
  const icon = (t) => t === "buy" ? `<span class="dot win">${ic("star", 16)}</span>` : t === "target" ? `<span class="dot win">${ic("check", 16)}</span>` : t === "stop" ? `<span class="dot loss">${ic("warn", 16)}</span>` : `<span class="dot open">${ic("chart", 16)}</span>`;
  let last = "";
  const rows = ev.slice(0, 60).map((e) => { const d = e.date === today() ? "TODAY" : new Date(e.date + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" }).toUpperCase();
    return `${d !== last ? `<div class="label">${last = d}</div>` : ""}<div class="card row" style="align-items:flex-start;${e.type === "stop" ? "border-color:#5a1f19" : ""}">${icon(e.type)}<div><b>${esc(e.title)}</b><div class="muted small">${esc(e.text)}</div></div></div>`; }).join("");
  return `${header("Alerts", { back: true })}
  <div class="cols"><div>
  <div class="card"><h2>Get buy alerts by email</h2>
    <p class="muted small">We email you when a new High chance pick appears, and when a High or Good pick reaches its target or safety exit. At most one email per evening, and only when there is news.</p>
    ${on ? `<form id="signup" action="${esc(CFG.brevoFormUrl)}" method="POST" target="signup-frame">
      <input class="input" type="email" name="EMAIL" required placeholder="you@example.com" autocomplete="email" aria-label="Email address">
      <input type="text" name="email_address_check" value="" hidden tabindex="-1" autocomplete="off"><input type="hidden" name="locale" value="en">
      <label class="row small muted" style="margin:10px 0;align-items:flex-start"><input type="checkbox" required style="margin-top:4px"> I understand these are practice alerts, not financial advice.</label>
      <button class="btn primary" type="submit">Send me alerts</button></form>
      <p class="faint" style="margin-bottom:0">You may get a confirmation email first. Click the link inside it to start receiving alerts.</p>`
    : `<div class="notice">Email alerts are not switched on yet. The site owner needs to finish step 4 of the setup guide.</div>`}</div>
  </div><div>${rows ? rows : `<div class="card empty">No alerts yet. They appear here after each evening update.</div>`}</div></div>${footer()}`;
}

let exMarket = "all", exQuery = "";
function explore() {
  if (!D.picks) return waiting();
  const q = exQuery.trim().toLowerCase();
  const list = stocks().filter((s) => (exMarket === "all" || s.market === exMarket) && (!q || s.name.toLowerCase().includes(q) || s.symbol.toLowerCase().includes(q)));
  return `${header("Explore any stock", { back: true })}
  <label class="row card" style="padding:10px 14px">${ic("search", 18)}<input id="exq" class="input" style="border:0;padding:4px;background:transparent" placeholder="Search by name or code" value="${esc(exQuery)}" aria-label="Search"></label>
  <div class="chips" style="margin:12px 0">${[["all", "All"], ["EGX", "Egypt"], ["ADX", "Abu Dhabi"], ["DFM", "Dubai"]].map(([k, l]) => `<button class="chip ${exMarket === k ? "on" : ""}" data-exm="${k}">${l}</button>`).join("")}</div>
  <div class="card" id="exlist">${list.map((s) => `<a class="list-item pick" href="#/stock/${s.symbol}"><div class="ticker">${esc(s.symbol.slice(0, 6))}</div>
    <div style="flex:1;min-width:0"><b>${esc(s.name)}</b><div class="faint">${esc(s.marketName)} · ${esc(s.sector)} · ${money(s.currency, s.close, priceD(s.close))} <span class="${cls(s.chg1d)}">${pct(s.chg1d)}</span></div></div>
    <div style="width:90px" class="desk">${spark(s.spark.slice(-60), s.spark.at(-1) >= s.spark.at(-60))}</div>
    <div style="text-align:right;min-width:70px">${s.tier ? tierBadge(s.tier).replace(" chance", "") : '<span class="faint">–</span>'}<div class="faint">${s.score ?? "–"}</div></div></a>`).join("") || `<div class="empty">No stocks match.</div>`}</div>
  ${D.picks.meta.failed?.length ? `<p class="faint">No prices today for: ${esc(D.picks.meta.failed.join(", "))}.</p>` : ""}${footer()}`;
}

function me() {
  const risk = D.picks ? portfolioRisk() : 0, lim = S.riskLimit;
  const level = risk < 25 ? "Low" : risk < 50 ? "Medium" : risk < 75 ? "High" : "Very high";
  return `${header("Me")}
  <div class="cols"><div>
  <div class="label">My risk meter</div>
  <div class="card">${gauge(risk, lim)}
    <h2 style="text-align:center;margin-top:6px">${level} risk · ${risk} of 100</h2>
    <p class="muted small" style="text-align:center">This is how risky your pretend stocks are right now, counting cash as safe. Your limit is ${lim}, so ${risk < lim - 5 ? "you have room for another pick" : risk <= lim ? "you are close to your limit" : "you are above your limit: consider selling or skipping new picks"}.</p>
    <b>How much risk am I willing to take?</b>
    <input type="range" min="10" max="90" step="5" value="${lim}" id="risklim" aria-label="Risk limit">
    <div class="between faint"><span>Low: keep it safe</span><span>High: chase bigger gains</span></div>
    <div class="seg" style="margin-top:12px">${["Careful", "Balanced", "Bold"].map((p) => `<button class="${S.profile === p ? "on" : ""}" data-profile="${p}">${p}</button>`).join("")}</div>
    <p class="faint" style="margin-bottom:0">${PROFILE_WORDS[S.profile]} <a href="#/quiz">Retake the quiz</a></p></div>
  </div><div>
  <div class="label">Pretend wallet</div>
  <div class="card"><div class="kv"><span>Starting money (EGP)</span><input class="input" style="width:140px;padding:6px 10px;text-align:right" data-wallet="EGP" value="${S.wallet.EGP}" inputmode="numeric"></div>
    <div class="kv"><span>Starting money (AED)</span><input class="input" style="width:140px;padding:6px 10px;text-align:right" data-wallet="AED" value="${S.wallet.AED}" inputmode="numeric"></div>
    <div class="kv"><span>Most in one stock</span><select class="input" style="width:100px;padding:6px 10px" id="maxpct">${[5, 8, 10, 15, 20].map((v) => `<option ${S.maxPct === v ? "selected" : ""} value="${v}">${v}%</option>`).join("")}</select></div></div>
  <div class="label">What I want to see</div>
  <div class="card">${[["EGX", "Egypt"], ["ADX", "Abu Dhabi"], ["DFM", "Dubai"]].map(([k, l]) => `<label class="kv"><span>${l}</span><input type="checkbox" class="toggle" data-mkt="${k}" ${S.markets[k] !== false ? "checked" : ""}></label>`).join("")}</div>
  <div class="label">Alerts</div>
  <div class="card"><a class="between" href="#/alerts" style="color:inherit;text-decoration:none"><span>Email alerts and recent alerts</span>${ic("bell", 18)}</a></div>
  <div class="label">Your data</div>
  <div class="card"><p class="muted small" style="margin-top:0">Your pretend buys and settings are saved only in this browser on this device.</p>
    <button class="btn ghost" id="export">Download my data</button><button class="btn ghost" id="reset" style="color:var(--coral)">Start over (erase everything)</button></div>
  </div></div>${footer()}`;
}

/* --------------------------------------------------------------- router */
const ROUTES = { welcome, quiz, home, picks, stock, mystocks, history: historyPage, report, alerts, explore, me };
let lastRoute = "";
async function render() {
  const [route, ...params] = (location.hash.replace(/^#\/?/, "") || (S.onboarded ? "home" : "welcome")).split("/");
  const fn = ROUTES[route] || home;
  const full = route === "welcome" || route === "quiz";
  $nav.hidden = full; document.getElementById("banner").hidden = route === "welcome" || route === "quiz";
  if (!full) renderNav(route);
  const html = await fn(params.map(decodeURIComponent));
  $app.innerHTML = html;
  if (route !== lastRoute) window.scrollTo(0, 0);
  lastRoute = route;
  bind();
}
function bind() {
  const on = (sel, ev, f) => $app.querySelectorAll(sel).forEach((el) => el.addEventListener(ev, (e) => f(el, e)));
  on("[data-back]", "click", () => (window.history.length > 1 ? window.history.back() : (location.hash = "#/home")));
  on("[data-quiz]", "click", (el) => { const [i, k] = el.dataset.quiz.split(":").map(Number); S.quiz[i] = k; save(); render(); });
  on("[data-quiz-next]", "click", (el) => {
    const i = Number(el.dataset.quizNext);
    if (i < QUIZ.length - 1) location.hash = `#/quiz/${i + 1}`;
    else { S.profile = profileFrom(S.quiz); S.riskLimit = { Careful: 35, Balanced: 55, Bold: 75 }[S.profile]; S.onboarded = true; save(); toast(`You are a ${S.profile} investor`); location.hash = "#/home"; }
  });
  on("[data-tier]", "click", (el) => { picksTier = el.dataset.tier; render(); });
  on("[data-pmarket]", "click", (el) => { picksMarket = el.dataset.pmarket; render(); });
  on("[data-range]", "click", (el) => { range = el.dataset.range; render(); });
  on("[data-buy]", "click", (el) => buySheet(el.dataset.buy));
  on("[data-skip]", "click", (el) => { const st = bySym(el.dataset.skip); S.skipped.unshift({ symbol: st.symbol, name: st.name, tier: st.tier, price: st.close, date: today() }); save(); toast("Skipped. We will show how it would have gone in History."); window.history.back(); });
  on("[data-watch]", "click", (el) => { const s = el.dataset.watch; S.watch = S.watch.includes(s) ? S.watch.filter((x) => x !== s) : [...S.watch, s]; save(); render(); });
  on("[data-sell]", "click", (el) => sellHolding(Number(el.dataset.sell)));
  on("[data-hist]", "click", (el) => { histTab = el.dataset.hist; render(); });
  on("[data-hist-wrong]", "click", () => { histTab = "wrong"; });
  on("[data-rep]", "click", (el) => { repTab = el.dataset.rep; render(); });
  on("[data-exm]", "click", (el) => { exMarket = el.dataset.exm; render(); });
  on("#exq", "input", (el) => { exQuery = el.value; const pos = el.selectionStart; render().then(() => { const n = document.getElementById("exq"); n.focus(); n.setSelectionRange(pos, pos); }); });
  on("[data-profile]", "click", (el) => { S.profile = el.dataset.profile; save(); render(); });
  on("#risklim", "change", (el) => { S.riskLimit = Number(el.value); save(); render(); });
  on("#maxpct", "change", (el) => { S.maxPct = Number(el.value); save(); });
  on("[data-wallet]", "change", (el) => { const v = Number(el.value.replace(/[^\d]/g, "")); if (v > 0) { S.wallet[el.dataset.wallet] = v; save(); toast("Starting money updated"); } });
  on("[data-mkt]", "change", (el) => { S.markets[el.dataset.mkt] = el.checked; save(); });
  on("#reset", "click", () => { if (confirm("Erase all your pretend buys and settings in this browser?")) { localStorage.removeItem(KEY); S = defaults(); location.hash = "#/welcome"; render(); } });
  on("#export", "click", () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 2)], { type: "application/json" })); a.download = "stock-advisor-my-data.json"; a.click(); });
  on("#signup", "submit", (el) => { setTimeout(() => { el.reset(); toast("Thanks! Check your inbox to confirm."); }, 300); });
}

async function boot() {
  [D.picks, D.report, D.alerts, D.log] = await Promise.all(["data/picks.json", "data/report.json", "data/alerts.json", "data/signals_log.json"].map(getJSON));
  if (D.picks?.meta?.sample) document.getElementById("sample-banner").hidden = false;
  window.addEventListener("hashchange", render);
  render();
}
boot();
})();
