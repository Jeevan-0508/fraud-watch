/* game.js — the dispatch simulator: spawns shipments on an SVG map,
   reveals real taxonomy indicators as clues, scores flag/clear decisions. */
const FWGame = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const ORIGIN_X = 40, DEST_X = 960;
  const LANE_Y = [60, 140, 220, 300, 380];

  let svg, alertFeed, inspectorBody, revealBackdrop, revealCard;
  let statEls = {};
  let running = false;
  let shipments = [];
  let nextId = 1;
  let selectedId = null;
  let spawnAcc = 0;
  let lastTs = null;
  let revealQueue = [];
  let revealShowing = false;

  const state = {
    score: 0, streak: 0, resolved: 0, correct: 0, incorrect: 0,
    level: 1, categoryCaught: {}
  };

  function el(tag, attrs) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function difficulty() {
    const lvl = state.level;
    return {
      spawnInterval: Math.max(0.9, 2.6 - lvl * 0.25),
      speed: 55 + lvl * 9,
      indicatorCount: lvl <= 2 ? 3 : (lvl <= 4 ? 2 : 1),
      fraudChance: Math.min(0.6, 0.32 + lvl * 0.03),
      decoyChance: Math.min(0.7, 0.22 + lvl * 0.07)
    };
  }

  function buildStatic() {
    svg.innerHTML = '';
    svg.appendChild(el('rect', { x: 0, y: 0, width: 1000, height: 460, fill: 'transparent' }));
    LANE_Y.forEach(y => {
      svg.appendChild(el('line', { class: 'lane-track', x1: ORIGIN_X + 30, y1: y, x2: DEST_X - 30, y2: y }));
    });
    svg.appendChild(el('rect', { class: 'depot', x: ORIGIN_X - 22, y: 20, width: 34, height: 420, rx: 6 }));
    svg.appendChild(el('rect', { class: 'depot', x: DEST_X - 12, y: 20, width: 34, height: 420, rx: 6 }));
    const t1 = el('text', { x: ORIGIN_X - 5, y: 452, fill: '#64748b', 'font-size': '11', 'text-anchor': 'middle' });
    t1.textContent = 'ORIGIN'; svg.appendChild(t1);
    const t2 = el('text', { x: DEST_X + 5, y: 452, fill: '#64748b', 'font-size': '11', 'text-anchor': 'middle' });
    t2.textContent = 'DEPOT'; svg.appendChild(t2);
  }

  function spawn() {
    const diff = difficulty();
    const isFraud = Math.random() < diff.fraudChance;
    const lane = Math.floor(Math.random() * LANE_Y.length);
    const id = 'SH-' + (2000 + nextId++);
    let pattern = null, indicators = [], decoy = null;
    if (isFraud) {
      pattern = FW.randomPattern();
      indicators = FW.pickIndicators(pattern, diff.indicatorCount, state.level > 3 ? 'subtle' : 'strong');
    } else if (Math.random() < diff.decoyChance) {
      decoy = FW.pickDecoy();
    }
    const shipment = {
      id, lane, x: ORIGIN_X, y: LANE_Y[lane],
      speed: diff.speed * (0.85 + Math.random() * 0.3),
      type: isFraud ? 'fraud' : 'clean',
      pattern, indicators, decoy,
      revealedIdx: 0, revealedDecoy: false,
      resolved: false, group: null, spawnTs: performance.now()
    };
    renderTruck(shipment);
    shipments.push(shipment);
  }

  function renderTruck(s) {
    const g = el('g', { class: 'truck', transform: `translate(${s.x - 23},${s.y - 11})`, 'data-id': s.id });
    g.appendChild(el('rect', { class: 'truck-body', x: 0, y: 0, width: 46, height: 22, rx: 4, fill: '#1c2531', stroke: '#334155' }));
    const label = el('text', { x: 23, y: 15, 'font-size': '9', fill: '#94a3b8', 'text-anchor': 'middle' });
    label.textContent = s.id.slice(-4);
    g.appendChild(label);
    const dot = el('circle', { class: 'truck-clue-dot', cx: 42, cy: 3, r: 0, style: 'display:none' });
    g.appendChild(dot);
    g.addEventListener('click', () => selectShipment(s.id));
    svg.appendChild(g);
    s.group = g; s.dotEl = dot;
  }

  function selectShipment(id) {
    selectedId = id;
    renderInspector();
  }

  function renderInspector() {
    const s = shipments.find(x => x.id === selectedId && !x.resolved);
    if (!s) { inspectorBody.innerHTML = '<p class="text-slate-500">Select a shipment on the map.</p>'; return; }
    const clues = [];
    for (let i = 0; i < s.revealedIdx; i++) {
      const ind = s.indicators[i];
      clues.push(`<li class="text-slate-300"><span class="text-amber-400">⚠</span> ${ind.signal}</li>`);
    }
    if (s.revealedDecoy && s.decoy) {
      clues.push(`<li class="text-slate-300"><span class="text-amber-400">⚠</span> ${s.decoy.fp.looks_like}</li>`);
    }
    inspectorBody.innerHTML = `
      <p class="font-semibold text-white mb-1">${s.id} <span class="text-xs text-slate-500">lane ${s.lane + 1}</span></p>
      <ul class="text-sm space-y-1 mb-3 min-h-[40px]">${clues.length ? clues.join('') : '<li class="text-slate-500">No clues surfaced yet — keep watching.</li>'}</ul>
      <div class="flex gap-2">
        <button id="btn-flag" class="flex-1 bg-red-500 hover:bg-red-400 text-white font-semibold rounded-lg py-1.5 text-sm">Flag fraud</button>
        <button id="btn-clear" class="flex-1 bg-emerald-500 hover:bg-emerald-400 text-[#0b0f14] font-semibold rounded-lg py-1.5 text-sm">Clear</button>
      </div>`;
    document.getElementById('btn-flag').onclick = () => decide(s, 'flag');
    document.getElementById('btn-clear').onclick = () => decide(s, 'clear');
  }

  function pushAlert(text, tone = 'info') {
    const colors = { info: 'border-sky-400', warn: 'border-amber-400', bad: 'border-red-400', good: 'border-emerald-400' };
    const div = document.createElement('div');
    div.className = `alert-item text-xs bg-[#111823] rounded-lg px-3 py-2 ${colors[tone] || colors.info}`;
    div.textContent = text;
    alertFeed.prepend(div);
    while (alertFeed.children.length > 40) alertFeed.removeChild(alertFeed.lastChild);
  }

  function decide(s, action) {
    if (s.resolved) return;
    resolve(s, action);
  }

  function resolve(s, action) {
    s.resolved = true;
    const progress = Math.min(1, (s.x - ORIGIN_X) / (DEST_X - ORIGIN_X));
    const speedFrac = action === 'auto' ? 0 : (1 - progress);
    let correct, delta, tone;

    if (s.type === 'fraud') {
      if (action === 'flag') { correct = true; delta = Math.round(60 + 80 * speedFrac); tone = 'good'; }
      else if (action === 'clear') { correct = false; delta = -50; tone = 'bad'; }
      else { correct = false; delta = -70; tone = 'bad'; }
    } else {
      if (action === 'clear') { correct = true; delta = Math.round(20 + 20 * speedFrac); tone = 'good'; }
      else if (action === 'flag') { correct = false; delta = -30; tone = 'bad'; }
      else { correct = true; delta = 10; tone = 'good'; }
    }

    state.streak = correct ? state.streak + 1 : 0;
    const mult = correct ? (1 + Math.min(state.streak, 10) * 0.05) : 1;
    delta = Math.round(delta * mult);
    state.score = Math.max(0, state.score + delta);
    state.resolved++;
    if (correct) state.correct++; else state.incorrect++;
    if (correct && s.type === 'fraud') {
      state.categoryCaught[s.pattern.category] = (state.categoryCaught[s.pattern.category] || 0) + 1;
    }

    if (action === 'auto' && s.type === 'clean') {
      pushAlert(`${s.id} delivered clean — no pattern present.`, 'good');
    } else if (action === 'auto' && s.type === 'fraud') {
      pushAlert(`BREACH: ${s.id} reached the depot unflagged — ${s.pattern.name}.`, 'bad');
      queueReveal(s, action, correct, delta);
    } else {
      queueReveal(s, action, correct, delta);
    }

    updateStats();
    if (selectedId === s.id) { selectedId = null; renderInspector(); }
    fadeOut(s);
  }

  function fadeOut(s) {
    if (s.group) {
      s.group.style.transition = 'opacity .35s';
      s.group.style.opacity = '0';
      setTimeout(() => s.group && s.group.remove(), 400);
    }
  }

  function queueReveal(s, action, correct, delta) {
    revealQueue.push({ s, action, correct, delta });
    if (!revealShowing) showNextReveal();
  }

  function showNextReveal() {
    if (!revealQueue.length) { revealShowing = false; return; }
    revealShowing = true;
    const { s, action, correct, delta } = revealQueue.shift();
    const headColor = correct ? 'text-emerald-400' : 'text-red-400';
    const headText = correct ? 'Correct call' : (action === 'auto' ? 'Missed — breach' : 'Wrong call');

    let body;
    if (s.type === 'fraud') {
      const shown = s.indicators.slice(0, s.revealedIdx || s.indicators.length);
      const cm = FW.bestCountermeasure(s.pattern, shown.length ? shown : s.indicators);
      body = `
        <div class="flex items-center gap-2 mb-2">
          <span class="badge" style="background:${FW.categoryColor(s.pattern.category)}22;color:${FW.categoryColor(s.pattern.category)}">${s.pattern.category.replace('_',' ')}</span>
          <span class="badge" style="background:${FW.severityColor(s.pattern.severity)}22;color:${FW.severityColor(s.pattern.severity)}">${s.pattern.severity}</span>
        </div>
        <h3 class="text-lg font-bold text-white mb-1">${s.pattern.name}</h3>
        <p class="text-sm text-slate-400 mb-3">${s.pattern.summary}</p>
        <p class="text-xs text-slate-500 uppercase mb-1">Indicators shown</p>
        <ul class="text-sm text-slate-300 space-y-1 mb-3">${shown.map(i => `<li>• ${i.signal}</li>`).join('') || '<li class="text-slate-500">None surfaced before resolution.</li>'}</ul>
        <p class="text-xs text-slate-500 uppercase mb-1">Would have caught it (${cm.bucket})</p>
        <p class="text-sm text-sky-300">${cm.text}</p>`;
    } else if (s.decoy) {
      body = `
        <h3 class="text-lg font-bold text-white mb-1">Clean shipment</h3>
        <p class="text-sm text-slate-400 mb-3">This looked suspicious but wasn't. The clue mimicked <b>${s.decoy.pattern.name}</b>:</p>
        <p class="text-sm text-slate-300 mb-2">"${s.decoy.fp.looks_like}"</p>
        <p class="text-xs text-slate-500 uppercase mb-1">What it actually was</p>
        <p class="text-sm text-slate-300 mb-2">${s.decoy.fp.actually}</p>
        <p class="text-xs text-slate-500 uppercase mb-1">How to rule it out</p>
        <p class="text-sm text-sky-300">${s.decoy.fp.how_to_rule_out}</p>`;
    } else {
      body = `<h3 class="text-lg font-bold text-white mb-1">Clean shipment</h3>
        <p class="text-sm text-slate-400">No fraud pattern, no notable clues. Straightforward delivery.</p>`;
    }

    revealCard.innerHTML = `
      <div class="flex items-center justify-between mb-3">
        <span class="font-bold ${headColor}">${headText}</span>
        <span class="font-mono text-sm ${delta >= 0 ? 'text-emerald-400' : 'text-red-400'}">${delta >= 0 ? '+' : ''}${delta}</span>
      </div>
      ${body}
      <button id="reveal-close" class="mt-4 w-full bg-slate-800 hover:bg-slate-700 rounded-lg py-2 text-sm font-semibold">Continue</button>`;
    revealBackdrop.classList.remove('hidden');
    document.getElementById('reveal-close').onclick = () => {
      revealBackdrop.classList.add('hidden');
      showNextReveal();
    };
  }

  function updateStats() {
    statEls.score.textContent = state.score;
    statEls.streak.textContent = state.streak;
    statEls.level.textContent = state.level;
    statEls.resolved.textContent = state.resolved;
    const total = state.correct + state.incorrect;
    statEls.accuracy.textContent = total ? Math.round(100 * state.correct / total) + '%' : '—';
    if (state.resolved > 0 && state.resolved % 6 === 0) state.level = Math.min(6, 1 + Math.floor(state.resolved / 6));
    FWCharts.update(state);
  }

  function tick(ts) {
    if (!running) return;
    if (lastTs === null) lastTs = ts;
    const dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;
    const diff = difficulty();

    spawnAcc += dt;
    if (spawnAcc >= diff.spawnInterval) { spawnAcc = 0; spawn(); }

    shipments.forEach(s => {
      if (s.resolved) return;
      s.x += s.speed * dt;
      const progress = (s.x - ORIGIN_X) / (DEST_X - ORIGIN_X);

      const thresholds = [0.18, 0.45, 0.72];
      const maxClues = s.type === 'fraud' ? s.indicators.length : 0;
      while (s.revealedIdx < maxClues && progress >= thresholds[s.revealedIdx]) {
        pushAlert(`${s.id}: ${s.indicators[s.revealedIdx].signal}`, 'warn');
        s.revealedIdx++;
        s.dotEl.style.display = '';
        s.dotEl.setAttribute('r', '3');
        if (selectedId === s.id) renderInspector();
      }
      if (s.decoy && !s.revealedDecoy && progress >= 0.35) {
        pushAlert(`${s.id}: ${s.decoy.fp.looks_like}`, 'warn');
        s.revealedDecoy = true;
        s.dotEl.style.display = '';
        s.dotEl.setAttribute('r', '3');
        if (selectedId === s.id) renderInspector();
      }

      if (s.group) s.group.setAttribute('transform', `translate(${s.x - 23},${s.y - 11})`);

      if (s.x >= DEST_X - 15) {
        resolve(s, 'auto');
      }
    });

    shipments = shipments.filter(s => !s.resolved || (performance.now() - s.spawnTs) < 60000);
    requestAnimationFrame(tick);
  }

  function start() {
    if (running) return;
    running = true; lastTs = null; spawnAcc = 0;
    document.getElementById('btn-start').textContent = 'Running…';
    document.getElementById('btn-start').disabled = true;
    requestAnimationFrame(tick);
  }

  function init() {
    svg = document.getElementById('map');
    alertFeed = document.getElementById('alert-feed');
    inspectorBody = document.getElementById('inspector-body');
    revealBackdrop = document.getElementById('reveal-backdrop');
    revealCard = document.getElementById('reveal-card');
    statEls = {
      score: document.getElementById('stat-score'),
      accuracy: document.getElementById('stat-accuracy'),
      streak: document.getElementById('stat-streak'),
      level: document.getElementById('stat-level'),
      resolved: document.getElementById('stat-resolved')
    };
    buildStatic();
    FWCharts.init();
    document.getElementById('btn-start').addEventListener('click', start);
  }

  return { init };
})();
