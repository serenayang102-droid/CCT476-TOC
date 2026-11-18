(() => {
"use strict";
const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ---------------- theme colours for canvas ---------------- */
const C = {};
function readColors(){
  const s = getComputedStyle(document.documentElement);
  for (const k of ["paper","panel","ink","muted","line","signal","signal-text","on-signal"]) C[k.replace("-","_")] = s.getPropertyValue("--" + k).trim();
}
readColors();

/* ---------------- flow-line engine ----------------
   Each station fills a capacity budget at its rate (units per hour of sim time).
   When the budget reaches 1, it has input, and the next queue has room, one unit moves on.
   Station 0 is fed by an endless line. Optional rope: station 0 releases only while WIP < rope. */
class Line {
  constructor(o){ this.n = o.caps.length; this.caps = o.caps.slice(); this.maxQ = o.maxQ; this.speed = o.speed; this.rope = o.rope ?? null; this.moveDur = o.moveDur ?? .5; this.reset(); }
  reset(){ this.q = new Array(this.n).fill(0); this.b = new Array(this.n).fill(0); this.movers = []; this.exits = []; this.served = 0; }
  mq(i){ return Array.isArray(this.maxQ) ? this.maxQ[i] : this.maxQ; }
  incoming(i){ let c = 0; for (const m of this.movers) if (m.seg === i - 1) c++; return c; }
  wip(){ let s = 0; for (let i = 1; i < this.n; i++) s += this.q[i]; for (const m of this.movers) if (m.seg < this.n - 1) s++; return s; }
  step(dt){
    const h = dt * this.speed / 60;
    for (let i = this.n - 1; i >= 0; i--){
      this.b[i] = Math.min(1, this.b[i] + this.caps[i] * h);
      if (this.b[i] < 1) continue;
      if (i > 0 && this.q[i] <= 0) continue;
      if (i < this.n - 1 && this.q[i + 1] + this.incoming(i + 1) >= this.mq(i + 1)) continue;
      if (i === 0 && this.rope != null && this.wip() >= this.rope) continue;
      if (i > 0) this.q[i]--;
      this.b[i] -= 1;
      this.movers.push({ seg: i, t: 0 });
    }
    const keep = [];
    for (const m of this.movers){
      m.t += dt / this.moveDur;
      if (m.t >= 1){ if (m.seg < this.n - 1) this.q[m.seg + 1]++; else { this.served++; this.exits.push({ t: 0 }); } }
      else keep.push(m);
    }
    this.movers = keep;
    for (const e of this.exits) e.t += dt / .9;
    this.exits = this.exits.filter(e => e.t < 1);
  }
  warm(sec){ for (let k = 0; k < sec * 30; k++) this.step(1 / 30); }
}

/* ---------------- canvas renderer ---------------- */
function rr(ctx, x, y, w, h, r){ ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function dot(ctx, x, y, r, col, a){ ctx.globalAlpha = a; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
const ease = t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
function qPos(lay, i, k){
  const anchor = lay.xs[i] - lay.bw / 2 - 10;
  const limit = i === 0 ? lay.left : lay.xs[i - 1] + lay.bw / 2 + 10;
  const per = Math.max(1, Math.floor(Math.max(lay.sp, anchor - limit) / lay.sp));
  const row = Math.floor(k / per), col = k % per;
  const off = row === 0 ? 0 : (row % 2 ? -1 : 1) * Math.ceil(row / 2);
  return [anchor - col * lay.sp - lay.sp / 2, lay.cy + off * lay.sp];
}

const scenes = [];
const vis = new IntersectionObserver(es => { for (const e of es){ const s = scenes.find(x => x.cv === e.target); if (s) s.visible = e.isIntersecting; } });
function makeScene(cv, line, opts){
  const sc = { cv, line, opts, visible: true, ctx: null, W: 0, H: 0, lay: null };
  sc.fit = () => {
    const r = cv.getBoundingClientRect(); const d = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.max(1, Math.round(r.width * d)); cv.height = Math.max(1, Math.round(r.height * d));
    sc.ctx = cv.getContext("2d"); sc.ctx.setTransform(d, 0, 0, d, 0, 0); sc.W = r.width; sc.H = r.height; sc.lay = opts.layout(sc.W, sc.H);
  };
  sc.fit(); scenes.push(sc); vis.observe(cv); return sc;
}
function render(sc, t){
  const { ctx, W, H, lay, line: L, opts: o } = sc; if (!ctx || !lay) return;
  ctx.clearRect(0, 0, W, H);
  const cI = o.constraint();
  ctx.save(); ctx.strokeStyle = C.line; ctx.lineWidth = 2; ctx.setLineDash([3, 7]);
  ctx.beginPath(); ctx.moveTo(lay.left, lay.cy); ctx.lineTo(lay.right, lay.cy); ctx.stroke(); ctx.restore();
  for (let k = 0; k < (o.door || 0); k++){ const [x, y] = qPos(lay, 0, k); dot(ctx, x, y + (RM ? 0 : Math.sin(t * 2.2 + k * 1.3) * .9), lay.r, C.muted, .55); }
  for (let i = 1; i < L.n; i++){
    const isC = i === cI;
    for (let k = 0; k < L.q[i]; k++){ const [x, y] = qPos(lay, i, k); dot(ctx, x, y, lay.r, isC ? C.signal : C.ink, isC ? 1 : .8); }
  }
  const cnt = {};
  for (const m of L.movers){
    const sx = lay.xs[m.seg] + lay.bw / 2; let ex, ey;
    if (m.seg < L.n - 1){ const j = (cnt[m.seg] = (cnt[m.seg] || 0) + 1) - 1; [ex, ey] = qPos(lay, m.seg + 1, L.q[m.seg + 1] + j); }
    else { ex = sx + 30; ey = lay.cy; }
    const e = ease(Math.min(1, m.t));
    dot(ctx, sx + (ex - sx) * e, lay.cy + (ey - lay.cy) * e - Math.sin(Math.PI * e) * 7, lay.r, m.seg + 1 === cI ? C.signal : C.ink, .92);
  }
  const ox = lay.xs[L.n - 1] + lay.bw / 2 + 30;
  for (const e of L.exits) dot(ctx, ox + (lay.right - ox) * e.t, lay.cy, lay.r, C.ink, .9 * (1 - e.t));
  for (let i = 0; i < L.n; i++){
    const x = lay.xs[i] - lay.bw / 2, y = lay.cy - lay.bh / 2, isC = i === cI;
    ctx.save();
    if (isC){ ctx.shadowColor = C.signal; ctx.shadowBlur = RM ? 14 : 16 + Math.sin(t * 3) * 7; }
    rr(ctx, x, y, lay.bw, lay.bh, 9); ctx.fillStyle = isC ? C.signal : C.panel; ctx.fill(); ctx.restore();
    ctx.lineWidth = 1.5; ctx.strokeStyle = isC ? C.signal : C.ink; rr(ctx, x, y, lay.bw, lay.bh, 9); ctx.stroke();
    const busy = L.b[i] < 1;
    ctx.globalAlpha = busy ? .95 : .28; ctx.fillStyle = isC ? C.on_signal : C.ink;
    ctx.fillRect(x + 9, y + lay.bh - 11, (lay.bw - 18) * Math.min(1, L.b[i]), 3.5); ctx.globalAlpha = 1;
    if (o.inside){ ctx.fillStyle = isC ? C.on_signal : C.ink; ctx.font = `600 ${lay.fs}px "IBM Plex Mono", ui-monospace, monospace`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(o.inside[i], lay.xs[i], lay.cy - 4); }
  }
  if (o.after) o.after(ctx, sc, cI);
}

/* ---------------- hero line ---------------- */
const heroNames = ["Receive", "Cut", "Weld", "Ship"], heroCaps = [60, 48, 16, 60];
const heroLine = new Line({ caps: heroCaps, maxQ: [0, 5, 18, 5], speed: 6, moveDur: .45 });
heroLine.warm(14);
const hero = makeScene($("#heroCanvas"), heroLine, {
  door: 7, constraint: () => 2, animate: !RM,
  layout(W, H){ const m = W < 560; return { xs: (m ? [.11, .35, .64, .9] : [.12, .37, .63, .88]).map(f => f * W), bw: m ? 44 : 74, bh: m ? 36 : 48, cy: H * .44, left: 8, right: W - 8, sp: m ? 9 : 12.5, r: m ? 3.2 : 4.4, fs: 10 }; },
  after(ctx, sc, cI){
    const { lay } = sc; const m = sc.W < 560;
    for (let i = 0; i < 4; i++){
      const x = lay.xs[i], yb = lay.cy + lay.bh / 2;
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillStyle = i === cI ? C.signal_text : C.ink;
      ctx.font = `800 ${m ? 16 : 22}px "Big Shoulders Display","Arial Narrow",sans-serif`;
      ctx.fillText(heroNames[i].toUpperCase(), x, yb + 14);
      ctx.fillStyle = i === cI ? C.signal_text : C.muted;
      ctx.font = `500 ${m ? 9.5 : 11}px "IBM Plex Mono",monospace`;
      ctx.fillText(heroCaps[i] + " / hr", x, yb + (m ? 34 : 42));
    }
    const x = lay.xs[cI], y = lay.cy - lay.bh / 2 - 12;
    ctx.fillStyle = C.signal_text; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    ctx.font = `600 ${m ? 9 : 10.5}px "IBM Plex Mono",monospace`;
    ctx.fillText("CONSTRAINT ▼", x, y);
  }
});

/* ---------------- restaurant simulator ---------------- */
const NAMES = ["host stand", "kitchen", "cashier"], SHORT = ["Host stand", "Kitchen", "Cashier"];
const COST = { chef: 4200, host: 3400, term: 45 };
const BASE = { hosts: 2, chefs: 3, terms: 1, exploit: false, rope: false };
let S, identified, done;
function resetState(){ S = { ...BASE }; identified = false; done = new Set(); }
resetState();
const caps = () => [S.hosts * 25, S.chefs * 14, Math.round(S.terms * 18 * (S.exploit ? 4 / 3 : 1))];
const conOf = c => { let m = 0; for (let i = 1; i < c.length; i++) if (c[i] < c[m]) m = i; return m; };
const cost = () => (S.hosts - BASE.hosts) * COST.host + (S.chefs - BASE.chefs) * COST.chef + (S.terms - BASE.terms) * COST.term;
const money = v => "$" + v.toLocaleString("en-US");
const tiles = $$(".st");
const simLine = new Line({ caps: caps(), maxQ: 10, speed: 3, moveDur: .45 });
simLine.warm(6);
const simCv = $("#simCanvas");
const sim = makeScene(simCv, simLine, {
  door: 6, inside: ["HOST", "KITCHEN", "CASHIER"], animate: true,
  constraint: () => identified ? conOf(simLine.caps) : -1,
  layout(W, H){
    const cr = simCv.getBoundingClientRect(); const m = W < 560;
    const xs = tiles.map(t => { const r = t.getBoundingClientRect(); return r.left + r.width / 2 - cr.left; });
    return { xs, bw: m ? 56 : 86, bh: m ? 34 : 44, cy: H / 2, left: 4, right: W - 4, sp: m ? 8.5 : 12, r: m ? 3 : 4.4, fs: m ? 7.5 : 10 };
  }
});

const logEl = $("#log");
function say(html){ logEl.innerHTML = html; }
function mark(n){ done.add(n); }
function updateUI(){
  const c = caps(), thr = Math.min(...c), ci = conOf(c);
  simLine.caps = c; simLine.rope = S.rope ? 3 : null;
  for (let i = 0; i < 3; i++){
    $("#cap" + i).textContent = c[i] + " guests / hr";
    const u = Math.round(thr / c[i] * 100);
    $("#ubar" + i).style.width = u + "%";
    $("#use" + i).textContent = "busy " + u + "%";
    tiles[i].classList.toggle("is-c", identified && i === ci);
  }
  $("#staff0").textContent = S.hosts + " hosts";
  $("#staff1").textContent = S.chefs + " chefs";
  $("#staff2").textContent = S.terms === 1 ? "1 register" : S.terms + " terminals";
  $("#thr").textContent = thr;
  const d = thr - 18, dEl = $("#thrDelta");
  dEl.textContent = d > 0 ? "+" + d + " vs start" : "start"; dEl.classList.toggle("up", d > 0);
  const cn = $("#conName"); cn.textContent = identified ? SHORT[ci] : "?"; cn.classList.toggle("c", identified);
  $("#cost").textContent = money(cost());
  $("#aExploit").setAttribute("aria-pressed", S.exploit); $("#aExploit").disabled = S.exploit;
  $("#aRope").setAttribute("aria-pressed", S.rope);
  $("#aChef").disabled = S.chefs >= 5; $("#aHost").disabled = S.hosts >= 3; $("#aTerm").disabled = S.terms >= 3;
  for (const ch of $$(".chip")) ch.classList.toggle("done", done.has(+ch.dataset.s));
}
function change(fn, kind){
  const c0 = caps(), thr0 = Math.min(...c0), ci0 = conOf(c0), cost0 = cost();
  fn();
  const c1 = caps(), thr1 = Math.min(...c1), ci1 = conOf(c1), spent = cost() - cost0;
  let msg = "";
  if (kind === "exploit"){
    mark(2);
    msg = `<b>Step 2 · Exploit.</b> The cashier now spends every minute on payments. Throughput went from ${thr0} to ${thr1} guests/hr for $0.`;
  } else if (kind === "rope"){
    if (S.rope){ mark(3); msg = `<b>Step 3 · Subordinate.</b> Throughput holds at ${thr1}, but the host now seats guests only as fast as the ${NAMES[ci1]} clears them. Watch the line inside shrink: less waiting, same output.`; }
    else msg = `The host is seating guests as fast as possible again. Throughput is still ${thr1}, and the line inside starts to grow.`;
  } else {
    const where = kind === "chef" ? "kitchen" : kind === "host" ? "host stand" : "cashier";
    const station = kind === "chef" ? 1 : kind === "host" ? 0 : 2;
    if (thr1 === thr0){
      msg = `<b>Nothing changed.</b> You added ${where} capacity for ${money(spent)}/month, and throughput is still ${thr1} guests/hr. The ${NAMES[ci1]} still sets the pace, so money spent anywhere else buys nothing.`;
    } else {
      if (station === ci0) mark(4);
      msg = `<b>Step 4 · Elevate.</b> Throughput rose from ${thr0} to ${thr1} guests/hr for ${money(spent)}/month.`;
      if (ci1 !== ci0){
        mark(5);
        msg += ` <b>The constraint moved to the ${NAMES[ci1]}.</b> That's Step 5: go back to Step 1 and start again.`;
        if (!identified){ identified = true; mark(1); }
      } else msg += ` The ${NAMES[ci1]} is still the constraint.`;
    }
  }
  updateUI(); say(msg);
}
tiles.forEach((t, i) => t.addEventListener("click", () => {
  const ci = conOf(caps());
  if (i === ci){
    const first = !identified; identified = true; mark(1); updateUI();
    say(first
      ? `<b>Step 1 · Identify. Correct.</b> The ${NAMES[ci]} is busy 100% of the time while the other stations wait, and its line keeps growing. Now try spending money on staff, or use Steps 2 to 4.`
      : `Yes, the ${NAMES[ci]} is the constraint right now.`);
  } else {
    t.classList.remove("no"); void t.offsetWidth; t.classList.add("no");
    say(`<b>Not quite.</b> The ${NAMES[i]} is busy only ${Math.round(Math.min(...caps()) / caps()[i] * 100)}% of the time, so it has spare capacity. Look for the station that never gets a break.`);
  }
}));
$("#aChef").addEventListener("click", () => change(() => S.chefs++, "chef"));
$("#aHost").addEventListener("click", () => change(() => S.hosts++, "host"));
$("#aTerm").addEventListener("click", () => change(() => S.terms++, "term"));
$("#aExploit").addEventListener("click", () => change(() => S.exploit = true, "exploit"));
$("#aRope").addEventListener("click", () => change(() => S.rope = !S.rope, "rope"));
$("#aReset").addEventListener("click", () => {
  resetState(); simLine.reset(); simLine.caps = caps(); simLine.rope = null; simLine.warm(3); updateUI();
  say(`<b>Step 1 · Identify.</b> Click the station you think is the constraint. Hint: look for the line that keeps growing, and the station that never gets a break.`);
});
updateUI();
let lastWip = -1;
function tickSim(){ const w = simLine.wip(); if (w !== lastWip){ $("#wip").textContent = w; lastWip = w; } }

/* ---------------- animation loop ---------------- */
let last = performance.now();
function frame(now){
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  for (const s of scenes){ if (!s.visible) continue; if (s.opts.animate) s.line.step(dt); render(s, now / 1000); }
  tickSim();
  requestAnimationFrame(frame);
}
function redrawAll(){ for (const s of scenes){ s.fit(); render(s, performance.now() / 1000); } }
requestAnimationFrame(frame);
let rz; addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(redrawAll, 120); });
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { readColors(); redrawAll(); });
new MutationObserver(() => { readColors(); redrawAll(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
if (document.fonts && document.fonts.ready) document.fonts.ready.then(redrawAll);

/* ---------------- five focusing steps ---------------- */
const STEPS = [
  { k: "Identify", q: "Where is the system stuck?", what: "Find the one resource whose capacity can't keep up with demand. Work piles up and waits in front of it.", ex: "The single cashier. Chefs and tables are ready, but guests stand in line to pay.", res: "" },
  { k: "Exploit", q: "Is any of the constraint's time being wasted?", what: "Get the most out of the constraint with what you already have, before spending money.", ex: "Let the cashier handle only payments: move phone orders elsewhere and print bills before guests ask.", res: "" },
  { k: "Subordinate", q: "Is everything else following the constraint's pace?", what: "Line every other step up behind the constraint. Running a non-constraint faster only builds piles of waiting work.", ex: "Time the kitchen and the host to the register's pace so guests aren't left waiting inside.", res: "Orue et al. (2023) designed how to carry out this step in a make-to-order plant by tying sales planning to operations." },
  { k: "Elevate", q: "Is more capacity still needed?", what: "If the constraint still holds back the goal, add capacity to it: equipment, people or hours.", ex: "Add a second payment terminal.", res: "" },
  { k: "Repeat", q: "Where did the constraint go?", what: "Once a constraint is broken, a new one appears somewhere else. Go back to Step 1, and don't let old habits become the next constraint.", ex: "With two terminals, the kitchen becomes the slowest step. Start again at Identify.", res: "Bacelar-Silva et al. (2024) ran all five steps, with drum-buffer-rope scheduling, in an ophthalmology imaging practice." }
];
const ring = $("#ring"), NS = "http://www.w3.org/2000/svg";
const cx = 230, cy = 230, R = 150, NR = 40;
const el = (n, a = {}, p = ring) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); p.appendChild(e); return e; };
const pt = (deg, r = R) => [cx + r * Math.cos(deg * Math.PI / 180), cy + r * Math.sin(deg * Math.PI / 180)];
const ang = k => -90 + k * 72;
const defs = el("defs");
for (const [id, cls] of [["ah", "ah"], ["ahl", "ah loop"]]){
  const m = el("marker", { id, viewBox: "0 0 10 10", refX: 7, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, defs);
  el("path", { d: "M0,0 L10,5 L0,10 z", class: cls }, m);
}
for (let k = 0; k < 5; k++){
  const a1 = ang(k) + 18, a2 = ang(k + 1) - 18; const [x1, y1] = pt(a1), [x2, y2] = pt(a2);
  const loop = k === 4;
  el("path", { d: `M${x1},${y1} A${R},${R} 0 0 1 ${x2},${y2}`, class: "arc" + (loop ? " loop" : ""), "marker-end": `url(#${loop ? "ahl" : "ah"})` });
}
const midK = el("text", { x: cx, y: cy - 34, class: "mid-k" }); midK.textContent = "STEP 01";
const mid = el("text", { x: cx, y: cy + 18, class: "mid" }); mid.textContent = "IDENTIFY";
const loopLbl = el("text", { class: "lbl on" });
const nodes = [], lbls = [];
STEPS.forEach((s, k) => {
  const [x, y] = pt(ang(k));
  const g = el("g", { class: "node", transform: `translate(${x},${y})`, tabindex: 0, role: "button", "aria-label": `Step ${k + 1}: ${s.k}` });
  el("circle", { r: NR }, g);
  const t = el("text", { class: "n" }, g); t.textContent = "0" + (k + 1);
  g.addEventListener("click", () => { stopPlay(); setStep(k); });
  g.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " "){ e.preventDefault(); stopPlay(); setStep(k); } });
  nodes.push(g);
  const a = ang(k), [lx, ly] = pt(a, R + 58); const c = Math.cos(a * Math.PI / 180);
  const lb = el("text", { x: lx, y: ly + (k === 0 ? -4 : 5), class: "lbl", "text-anchor": Math.abs(c) < .2 ? "middle" : (c > 0 ? "start" : "end") });
  lb.textContent = s.k; lbls.push(lb);
});
loopLbl.remove();
let cur = 0;
function setStep(k){
  cur = (k + 5) % 5; const s = STEPS[cur];
  nodes.forEach((n, i) => n.classList.toggle("on", i === cur));
  lbls.forEach((n, i) => n.classList.toggle("on", i === cur));
  midK.textContent = "STEP 0" + (cur + 1); mid.textContent = s.k.toUpperCase();
  $("#stepK").textContent = `Step 0${cur + 1} of 05`; $("#stepName").textContent = s.k; $("#stepQ").textContent = s.q;
  $("#stepWhat").textContent = s.what; $("#stepEx").textContent = s.ex;
  $("#stepResWrap").hidden = !s.res; $("#stepRes").textContent = s.res;
}
setStep(0);
let playT = null; const playBtn = $("#stepPlay");
function stopPlay(){ if (playT){ clearInterval(playT); playT = null; } playBtn.textContent = "▶ Play loop"; playBtn.setAttribute("aria-pressed", "false"); }
playBtn.addEventListener("click", () => {
  if (playT){ stopPlay(); return; }
  setStep(cur + 1); playT = setInterval(() => setStep(cur + 1), 3200);
  playBtn.textContent = "❚❚ Pause"; playBtn.setAttribute("aria-pressed", "true");
});
$("#stepPrev").addEventListener("click", () => { stopPlay(); setStep(cur - 1); });
$("#stepNext").addEventListener("click", () => { stopPlay(); setStep(cur + 1); });

/* ---------------- testing tabs + likert ---------------- */
const tabs = $$(".tab");
function selTab(t){
  tabs.forEach(x => { const on = x === t; x.setAttribute("aria-selected", on); x.tabIndex = on ? 0 : -1; $("#" + x.getAttribute("aria-controls")).hidden = !on; });
}
tabs.forEach((t, i) => {
  t.addEventListener("click", () => selTab(t));
  t.addEventListener("keydown", e => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft"){ e.preventDefault(); e.stopPropagation(); const n = tabs[(i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length]; selTab(n); n.focus(); }
  });
});
const LK = ["", "strongly disagree", "disagree", "somewhat disagree", "neutral", "somewhat agree", "agree", "strongly agree"];
$$(".scale button").forEach(b => b.addEventListener("click", () => {
  $$(".scale button").forEach(x => x.setAttribute("aria-pressed", x === b));
  const v = +b.textContent;
  $("#likertOut").textContent = `You chose ${v} (${LK[v]}). In a study like this, each plant's answers are combined into a TOC-practice score, and ANOVA and regression test whether higher scores go with better performance.`;
}));

/* ---------------- section rail + keyboard ---------------- */
const secs = $$("main > section");
const rail = $("#rail"), fill = $("#railFill");
const dots = secs.map(s => { const a = document.createElement("a"); a.href = "#" + s.id; a.innerHTML = `<span>${s.dataset.label}</span>`; a.setAttribute("aria-label", s.dataset.label); rail.appendChild(a); return a; });
let active = 0;
function spy(){
  const y = scrollY + 140; let i = 0;
  secs.forEach((s, k) => { if (s.offsetTop <= y) i = k; });
  if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) i = secs.length - 1;
  active = i;
  const top = secs[i].offsetTop, next = secs[i + 1] ? secs[i + 1].offsetTop : top + 1;
  const f = i === secs.length - 1 ? 0 : Math.max(0, Math.min(1, (y - top) / (next - top)));
  const p = (i + f) / (secs.length - 1);
  fill.style.width = `calc((100% - 12px) * ${p})`;
  dots.forEach((d, k) => { d.classList.toggle("on", k === i); d.classList.toggle("done", k < i); if (k === i) d.setAttribute("aria-current", "true"); else d.removeAttribute("aria-current"); });
}
addEventListener("scroll", spy, { passive: true }); addEventListener("resize", spy); spy();
function go(i){ i = Math.max(0, Math.min(secs.length - 1, i)); secs[i].scrollIntoView({ behavior: RM ? "auto" : "smooth", block: "start" }); }
addEventListener("keydown", e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = (e.target.tagName || "").toLowerCase(); if (tag === "input" || tag === "textarea" || tag === "select") return;
  if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === "j"){ e.preventDefault(); go(active + 1); }
  else if (e.key === "ArrowLeft" || e.key === "PageUp" || e.key === "k"){ e.preventDefault(); go(active - 1); }
  else if (e.key === "t" || e.key === "T"){ toggleTimer(); }
});

/* ---------------- 3-minute timer ---------------- */
const tBtn = $("#timer"), tTxt = $("#timerTxt"); let left = 180, tInt = null;
const fmt = s => Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
function paintTimer(){ tTxt.textContent = fmt(left); tBtn.classList.toggle("run", !!tInt); tBtn.classList.toggle("low", left <= 30); tBtn.setAttribute("aria-label", (tInt ? "Pause" : "Start") + " timer, " + fmt(left) + " left"); }
function toggleTimer(){
  if (tInt){ clearInterval(tInt); tInt = null; }
  else { if (left <= 0) left = 180; tInt = setInterval(() => { left--; if (left <= 0){ left = 0; clearInterval(tInt); tInt = null; } paintTimer(); }, 1000); }
  paintTimer();
}
tBtn.addEventListener("click", toggleTimer);
$("#timerReset").addEventListener("click", () => { clearInterval(tInt); tInt = null; left = 180; paintTimer(); });
paintTimer();
})();
