/* game.js — the dispatch simulator: spawns shipments on an SVG cargo-yard
   scene, reveals real taxonomy indicators as clues over a dispatch radio
   feed, and scores bust/wave decisions with arcade-style reveal drama. */
const FWGame = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const ORIGIN_X = 40, DEST_X = 960;
  const LANE_Y = [60, 140, 220, 300, 380];

  let svg, stage, alertFeed, inspector, revealBackdrop, revealCard, revealFlash;
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
    score: 0, streak: 0, resolved: 0,
    aligned: 0, diverged: 0, undecided: 0,
    level: 1, categoryCaught: {}
  };

  /* A resolution is exactly one of these three, and the third is not a
     variety of the first two. A shipment that rolled to the depot gate with
     nobody pressing anything is not a call the player got right and not a
     call the player got wrong -- it is a call that was never made. Until
     this slice all three landed in one correct/incorrect pair, so the ACC
     pill read a percentage for a player who had made no calls at all
     (measured: 56% after 108 resolutions, none of them decided). */
  const RESOLUTION = ['DECIDED_ALIGNED', 'DECIDED_DIVERGED', 'NO_DECISION'];
  const RESOLUTION_LABEL = {
    DECIDED_ALIGNED: 'Your call matched the reveal',
    DECIDED_DIVERGED: 'Your call went the other way',
    NO_DECISION: 'Reached the gate with no call made'
  };
  const RESOLUTION_TONE = {
    DECIDED_ALIGNED: 'text-emerald-400',
    DECIDED_DIVERGED: 'text-red-400',
    // Deliberately neutral: not deciding is not a third grade of wrong.
    NO_DECISION: 'text-slate-400'
  };

  /* What the arcade meter is measured against, said on the panel that shows
     it. The Sim's calibration panel reports an alignment percentage too, and
     it means something else: it compares closures to the RECORDED verdict.
     This one compares a call to the reveal, which is the pattern flag this
     trainer generated for the shipment -- an answer key that exists only
     because the shipment is synthetic. Same word in English, two different
     meters, so neither panel may leave it unstated. */
  const METER_SCOPE =
    'Measured against the reveal: the pattern flag this trainer generated for ' +
    'the shipment. Not comparable with the Sim\'s calibration alignment, which ' +
    'is measured against a recorded verdict, and not a score of anybody.';

  /* The one place the three buckets are read. Throws rather than reports if
     they do not account for every resolution -- the failure this replaces was
     silent by construction. */
  function tallyResolutions() {
    const cut = {
      DECIDED_ALIGNED: state.aligned,
      DECIDED_DIVERGED: state.diverged,
      NO_DECISION: state.undecided
    };
    let sum = 0;
    RESOLUTION.forEach(k => {
      if (typeof cut[k] !== 'number') {
        throw new Error('FWGame.tallyResolutions: no count for resolution ' + k);
      }
      sum += cut[k];
    });
    if (sum !== state.resolved) {
      throw new Error(
        'FWGame.tallyResolutions: buckets sum to ' + sum + ' but ' + state.resolved +
        ' shipments resolved. A resolution in the base and in no bucket is the ' +
        'shape that let undecided shipments be scored as calls.'
      );
    }
    cut.decided = state.aligned + state.diverged;
    cut.resolved = state.resolved;
    return cut;
  }

  /* The meter, built through analyticsEngine.metric rather than divided here,
     so it carries n / N on the row that states it and is withheld below the
     same minimum sample every other rate in this project is held to. */
  function alignmentMeter() {
    const cut = tallyResolutions();
    const m = FWAnalyticsEngine.metric({
      id: 'arcade-call-alignment',
      label: 'Calls matching the reveal',
      kind: FWAnalyticsEngine.KIND.RATE,
      numerator: cut.DECIDED_ALIGNED,
      denominator: cut.decided,
      of: 'calls you made (BUST or WAVE THROUGH)',
      note: METER_SCOPE
    });
    // The pill always shows the base. A percentage appears only once the
    // sample clears the threshold; below it the counts stand alone.
    const pill = cut.decided === 0
      ? '0 / 0'
      : (m.withheld ? m.ratioLabel : m.ratioLabel + ' \u00b7 ' + FWAnalyticsEngine.pct(m.value));
    return { metric: m, cut, pill };
  }

  function elNS(tag, attrs) {
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
    LANE_Y.forEach(y => {
      svg.appendChild(elNS('line', { class: 'lane-track', x1: ORIGIN_X + 30, y1: y, x2: DEST_X - 30, y2: y }));
    });
    svg.appendChild(elNS('circle', { class: 'depot-glow', cx: DEST_X, cy: 230, r: 140 }));
    svg.appendChild(elNS('rect', { class: 'depot', x: ORIGIN_X - 22, y: 20, width: 34, height: 420, rx: 6 }));
    svg.appendChild(elNS('rect', { class: 'depot', x: DEST_X - 12, y: 20, width: 34, height: 420, rx: 6 }));
    const t1 = elNS('text', { x: ORIGIN_X - 5, y: 452, fill: '#475569', 'font-size': '10', 'text-anchor': 'middle' });
    t1.textContent = 'YARD'; svg.appendChild(t1);
    const t2 = elNS('text', { x: DEST_X + 5, y: 452, fill: '#475569', 'font-size': '10', 'text-anchor': 'middle' });
    t2.textContent = 'DEPOT GATE'; svg.appendChild(t2);
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
    const g = elNS('g', { class: 'truck', transform: `translate(${s.x - 24},${s.y - 12})`, 'data-id': s.id });
    g.appendChild(elNS('circle', { class: 'spotlight-ring', cx: 24, cy: 12, r: 16 }));
    g.appendChild(elNS('rect', { class: 'truck-body', x: 0, y: 2, width: 34, height: 20, rx: 3, fill: '#1c2531', stroke: '#334155' }));
    g.appendChild(elNS('rect', { class: 'truck-cab', x: 34, y: 5, width: 12, height: 17, rx: 2 }));
    g.appendChild(elNS('circle', { cx: 46, cy: 9, r: 1.6, fill: '#facc15' }));
    const label = elNS('text', { x: 17, y: 15, 'font-size': '8', fill: '#94a3b8', 'text-anchor': 'middle' });
    label.textContent = s.id.slice(-4);
    g.appendChild(label);
    const dot = elNS('circle', { class: 'truck-clue-dot', cx: 44, cy: -1, r: 0, style: 'display:none' });
    g.appendChild(dot);
    g.addEventListener('click', () => selectShipment(s.id));
    svg.appendChild(g);
    s.group = g; s.dotEl = dot;
  }

  function rects() {
    return { stageRect: stage.getBoundingClientRect(), svgRect: svg.getBoundingClientRect() };
  }

  function positionInspector(s) {
    const { stageRect, svgRect } = rects();
    const scaleX = svgRect.width / 1000, scaleY = svgRect.height / 460;
    const offX = svgRect.left - stageRect.left, offY = svgRect.top - stageRect.top;
    let left = offX + s.x * scaleX;
    let top = offY + s.y * scaleY;
    const w = 256;
    left = Math.max(w / 2 + 8, Math.min(stageRect.width - w / 2 - 8, left));
    top = Math.max(90, top);
    inspector.style.left = left + 'px';
    inspector.style.top = top + 'px';
    inspector.style.transform = 'translate(-50%, -112%)';
  }

  function selectShipment(id) {
    if (selectedId) {
      const prev = shipments.find(x => x.id === selectedId);
      if (prev && prev.group) prev.group.classList.remove('spotlighted');
    }
    selectedId = id;
    const s = shipments.find(x => x.id === id && !x.resolved);
    if (s && s.group) s.group.classList.add('spotlighted');
    renderInspector();
  }

  function renderInspector() {
    const s = shipments.find(x => x.id === selectedId && !x.resolved);
    if (!s) { inspector.classList.add('hidden'); return; }
    inspector.classList.remove('hidden');
    const clues = [];
    for (let i = 0; i < s.revealedIdx; i++) {
      clues.push(`<li class="text-slate-200"><span class="text-amber-400">⚠</span> ${s.indicators[i].signal}</li>`);
    }
    if (s.revealedDecoy && s.decoy) {
      clues.push(`<li class="text-slate-200"><span class="text-amber-400">⚠</span> ${s.decoy.fp.looks_like}</li>`);
    }
    inspector.innerHTML = `
      <div class="bg-[#0d1420] border border-sky-500/40 rounded-xl p-3 shadow-xl shadow-black/50">
        <p class="font-orbitron text-xs text-sky-300 mb-1.5">${s.id} · LANE ${s.lane + 1}</p>
        <ul class="text-xs space-y-1 mb-2.5 min-h-[32px]">${clues.length ? clues.join('') : '<li class="text-slate-500">No clues yet — keep watching.</li>'}</ul>
        <div class="flex gap-2">
          <button id="btn-flag" class="flex-1 bg-red-500 hover:bg-red-400 text-white font-bold rounded-lg py-1.5 text-xs">🚨 BUST</button>
          <button id="btn-clear" class="flex-1 bg-emerald-500 hover:bg-emerald-400 text-[#0b0f14] font-bold rounded-lg py-1.5 text-xs">✅ WAVE THROUGH</button>
        </div>
      </div>`;
    positionInspector(s);
    document.getElementById('btn-flag').onclick = () => decide(s, 'flag');
    document.getElementById('btn-clear').onclick = () => decide(s, 'clear');
  }

  function pushAlert(text, tone = 'info') {
    const colors = { info: 'border-sky-400', warn: 'border-amber-400', bad: 'border-red-400', good: 'border-emerald-400' };
    const div = document.createElement('div');
    div.className = `alert-item text-[11px] leading-snug bg-[#0e1520] rounded px-2 py-1 ${colors[tone] || colors.info}`;
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
    // 'auto' means the shipment reached the gate on its own. Nobody called it.
    const decided = action !== 'auto';
    let aligned, delta;

    if (s.type === 'fraud') {
      if (action === 'flag') { aligned = true; delta = Math.round(60 + 80 * speedFrac); }
      else if (action === 'clear') { aligned = false; delta = -50; }
      else { aligned = null; delta = -70; }
    } else {
      if (action === 'clear') { aligned = true; delta = Math.round(20 + 20 * speedFrac); }
      else if (action === 'flag') { aligned = false; delta = -30; }
      else { aligned = null; delta = 10; }
    }

    /* Points are a consequence of what happened in the yard: a pattern that
       reached the gate costs, an uneventful arrival pays a little. The streak
       and the meter are a record of the player's calls, so a resolution
       nobody called leaves both untouched rather than extending or breaking
       them. Score and meter answer different questions on purpose. */
    if (decided) state.streak = aligned ? state.streak + 1 : 0;
    const mult = decided && aligned ? (1 + Math.min(state.streak, 10) * 0.05) : 1;
    delta = Math.round(delta * mult);
    state.score = Math.max(0, state.score + delta);
    state.resolved++;
    if (!decided) state.undecided++;
    else if (aligned) state.aligned++;
    else state.diverged++;
    if (decided && aligned && s.type === 'fraud') {
      state.categoryCaught[s.pattern.category] = (state.categoryCaught[s.pattern.category] || 0) + 1;
    }

    if (!decided) {
      /* What the yard saw, and only that. This line used to read "cleared the
         gate - no pattern present", which is the generated flag stated as an
         observation in the live radio feed (Slice 34, one module over), in the
         one tone the feed uses for a good outcome. The reveal card is where
         the answer key belongs, labelled as one. */
      const surfaced = s.revealedIdx + (s.revealedDecoy ? 1 : 0);
      pushAlert(
        `${s.id} reached the depot gate with no call made — ` +
        `${surfaced} clue${surfaced === 1 ? '' : 's'} had surfaced by then.`,
        'info'
      );
    }
    if (decided || s.type === 'fraud') queueReveal(s, action, aligned, delta);

    updateStats();
    if (selectedId === s.id) { selectedId = null; inspector.classList.add('hidden'); }
    fadeOut(s);
  }

  function fadeOut(s) {
    if (s.group) {
      s.group.style.transition = 'opacity .35s';
      s.group.style.opacity = '0';
      setTimeout(() => s.group && s.group.remove(), 400);
    }
  }

  function queueReveal(s, action, aligned, delta) {
    revealQueue.push({ s, action, aligned, delta });
    if (!revealShowing) showNextReveal();
  }

  function verdict(s, action, aligned) {
    if (s.type === 'fraud') {
      if (action === 'flag') return { text: 'BUSTED!', icon: '🚨', color: 'text-emerald-400', flash: 'flash-good' };
      if (action === 'clear') return { text: 'IT GOT AWAY', icon: '🕵️', color: 'text-red-400', flash: 'flash-bad' };
      return { text: 'BREACH!', icon: '🚨', color: 'text-red-400', flash: 'flash-bad' };
    }
    if (action === 'flag') return { text: 'FALSE ALARM', icon: '🚫', color: 'text-amber-400', flash: 'flash-bad' };
    return { text: 'CLEAN — WAVED THROUGH', icon: '✅', color: 'text-emerald-400', flash: 'flash-good' };
  }

  function showNextReveal() {
    if (!revealQueue.length) { revealShowing = false; return; }
    revealShowing = true;
    const { s, action, aligned, delta } = revealQueue.shift();
    const v = verdict(s, action, aligned);

    revealFlash.className = v.flash;
    revealFlash.classList.remove('hidden');
    setTimeout(() => revealFlash.classList.add('hidden'), 650);

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
        <p class="text-sm text-slate-400 mb-3">This looked suspicious but wasn't. The clue mimicked <b>${s.decoy.pattern.name}</b>:</p>
        <p class="text-sm text-slate-300 mb-2">"${s.decoy.fp.looks_like}"</p>
        <p class="text-xs text-slate-500 uppercase mb-1">What it actually was</p>
        <p class="text-sm text-slate-300 mb-2">${s.decoy.fp.actually}</p>
        <p class="text-xs text-slate-500 uppercase mb-1">How to rule it out</p>
        <p class="text-sm text-sky-300">${s.decoy.fp.how_to_rule_out}</p>`;
    } else {
      body = `<p class="text-sm text-slate-400">No fraud pattern, no notable clues. Straightforward delivery.</p>`;
    }

    revealCard.innerHTML = `
      <div class="text-center mb-3">
        <span class="siren text-3xl">${v.icon}</span>
        <div class="verdict-text text-3xl sm:text-4xl ${v.color}">${v.text}</div>
        <div class="font-mono text-sm mt-1 ${delta >= 0 ? 'text-emerald-400' : 'text-red-400'}">${delta >= 0 ? '+' : ''}${delta} pts</div>
      </div>
      <div class="reveal-detail bg-[#0d1420] border border-slate-700 rounded-xl p-4 text-left">
        ${action === 'auto' ? `<p class="text-[11px] text-slate-400 border-l-2 border-slate-600 pl-2 mb-3">No call was made on this one \u2014 it reached the gate first. The points moved; the calls meter did not, because there was no call to measure.</p>` : ''}
        ${body}
        <button id="reveal-close" class="mt-4 w-full bg-slate-800 hover:bg-slate-700 rounded-lg py-2 text-sm font-semibold">Continue</button>
      </div>`;
    revealBackdrop.classList.remove('hidden');
    document.getElementById('reveal-close').onclick = () => {
      revealBackdrop.classList.add('hidden');
      showNextReveal();
    };
  }

  /* The scoreboard's own words for its own numbers. Three disjoint rows that
     sum to the resolutions, then the meter with its base and its scope. */
  function renderScoreboard() {
    const host = document.getElementById('scoreboard-note');
    if (!host) return;
    const { metric: m, cut } = alignmentMeter();
    const rows = RESOLUTION.map(k => `
      <div class="flex items-baseline justify-between gap-3">
        <span class="text-slate-400">${RESOLUTION_LABEL[k]}</span>
        <span class="font-mono ${RESOLUTION_TONE[k]}">${cut[k]}</span>
      </div>`).join('');
    host.innerHTML = `
      <div class="text-[11px] space-y-1 mb-3">
        ${rows}
        <div class="flex items-baseline justify-between gap-3 border-t border-slate-800 pt-1">
          <span class="text-slate-500">Shipments resolved</span>
          <span class="font-mono text-slate-300">${cut.resolved}</span>
        </div>
      </div>
      <div class="text-[11px] text-slate-300 mb-1">
        Calls matching the reveal:
        <span class="font-mono text-white">${m.ratioLabel}</span>
        ${m.withheld ? '' : `<span class="font-mono text-white"> \u00b7 ${FWAnalyticsEngine.pct(m.value)}</span>`}
        <span class="text-slate-500">${m.basisLabel}</span>
      </div>
      ${m.withheld ? `<p class="text-[10px] text-slate-500 italic mb-1">${m.withheldReason}</p>` : ''}
      <p class="text-[10px] text-slate-500 italic">${METER_SCOPE}</p>
      <p class="text-[10px] text-slate-500 italic mt-1">${cut.NO_DECISION} of these ${cut.resolved} were never called, so they are in no numerator and in no denominator of that rate. Points still moved for them: the score follows what happened in the yard, the rate follows what you decided.</p>`;
  }

  function updateStats() {
    statEls.score.textContent = state.score;
    statEls.streak.textContent = state.streak;
    statEls.level.textContent = state.level;
    statEls.resolved.textContent = state.resolved;
    // Always the base. A bare percentage here was over a population that
    // included every shipment nobody called.
    statEls.accuracy.textContent = alignmentMeter().pill;
    if (state.resolved > 0 && state.resolved % 6 === 0) state.level = Math.min(6, 1 + Math.floor(state.resolved / 6));
    FWCharts.update(state, tallyResolutions());
    renderScoreboard();
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

      if (s.group) s.group.setAttribute('transform', `translate(${s.x - 24},${s.y - 12})`);
      if (selectedId === s.id) positionInspector(s);

      if (s.x >= DEST_X - 15) resolve(s, 'auto');
    });

    shipments = shipments.filter(s => !s.resolved || (performance.now() - s.spawnTs) < 60000);
    requestAnimationFrame(tick);
  }

  function start() {
    if (running) return;
    running = true; lastTs = null; spawnAcc = 0;
    document.getElementById('start-overlay').classList.add('hidden');
    requestAnimationFrame(tick);
  }

  function init() {
    stage = document.getElementById('stage');
    svg = document.getElementById('map');
    alertFeed = document.getElementById('alert-feed');
    inspector = document.getElementById('inspector');
    revealBackdrop = document.getElementById('reveal-backdrop');
    revealCard = document.getElementById('reveal-card');
    revealFlash = document.getElementById('reveal-flash');
    statEls = {
      score: document.getElementById('stat-score'),
      accuracy: document.getElementById('stat-accuracy'),
      streak: document.getElementById('stat-streak'),
      level: document.getElementById('stat-level'),
      resolved: document.getElementById('stat-resolved')
    };
    buildStatic();
    FWCharts.init();
    renderScoreboard();
    document.getElementById('btn-start').addEventListener('click', start);
  }

  return {
    init, state, RESOLUTION, RESOLUTION_LABEL, RESOLUTION_TONE, METER_SCOPE,
    tallyResolutions, alignmentMeter, renderScoreboard
  };
})();
