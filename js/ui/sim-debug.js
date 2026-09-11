/* ui/sim-debug.js — visible window into the simulation engines built in
   Slices 1-3. Deliberately a debug/inspector view, not a polished
   screen: the point right now is to see the clock, entities, event
   stream and MOs actually running so pacing/feel can be judged before
   any of it gets a real game UI on top. Reuses Classic Watch/Port
   Meridian's dark-panel DOM conventions so it doesn't look bolted on. */
const FWSimDebug = (() => {
  let els = {};
  let booted = false;

  function init() {
    els = {
      root: document.getElementById('sim-root'),
      clock: document.getElementById('sim-clock'),
      speedBtns: document.querySelectorAll('#sim-speed-controls .sim-speed-btn'),
      pauseBtn: document.getElementById('sim-pause-btn'),
      ffBtn: document.getElementById('sim-ff-btn'),
      entityTable: document.getElementById('sim-entity-table'),
      eventFeed: document.getElementById('sim-event-feed'),
      moList: document.getElementById('sim-mo-list'),
      counts: document.getElementById('sim-counts')
    };

    els.speedBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const state = FWSimRunner.getState();
        if (!state) return;
        state.clock.resume();
        state.clock.setSpeed(Number(btn.dataset.speed));
        els.speedBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    if (els.pauseBtn) {
      els.pauseBtn.addEventListener('click', () => {
        const state = FWSimRunner.getState();
        if (!state) return;
        if (state.clock.running) { state.clock.pause(); els.pauseBtn.textContent = '▶ Resume'; }
        else { state.clock.resume(); els.pauseBtn.textContent = '⏸ Pause'; }
      });
    }

    if (els.ffBtn) {
      els.ffBtn.addEventListener('click', () => {
        FWSimRunner.fastForward(3600); // jump 1 sim-hour instantly
        render(FWSimRunner.getState());
      });
    }
  }

  function boot() {
    if (booted) return;
    booted = true;
    FWSimRunner.boot();
    FWSimRunner.onTick(render);
    FWSimRunner.start();
    render(FWSimRunner.getState());
  }

  function fmtPct(x) { return Math.round(x * 100) + '%'; }

  function severityBadgeClass(sev) {
    const map = {
      LOW: 'bg-slate-700 text-slate-200',
      WATCH: 'bg-sky-900 text-sky-300',
      ELEVATED: 'bg-amber-900 text-amber-300',
      HIGH: 'bg-orange-900 text-orange-300',
      CRITICAL: 'bg-red-900 text-red-300'
    };
    return map[sev] || map.LOW;
  }

  function renderClock(state) {
    if (!els.clock) return;
    const c = state.clock;
    els.clock.innerHTML =
      `<b class="text-white">Day ${c.day}</b> · ${c.timeOfDay()} · ` +
      `<span class="uppercase text-slate-400">${c.shift()}</span> · ` +
      `<span class="text-sky-400">${c.running ? c.speed + 'x' : 'PAUSED'}</span>`;
  }

  function renderCounts(state) {
    if (!els.counts) return;
    const reg = state.registry;
    const parts = FWEntityEngine.KINDS.map(k => `${FWEntityEngine.all(reg, k).length} ${k}s`);
    els.counts.textContent = parts.join(' · ') + ` · ${state.totalEvents} events so far`;
  }

  function renderEntities(state) {
    if (!els.entityTable) return;
    const trucks = FWEntityEngine.all(state.registry, 'truck');
    els.entityTable.innerHTML = trucks.map(t => {
      const active = FWSignalEngine.getActiveSignals(t, FWSimRunner.absoluteNow(state.clock));
      const sigBadge = active.length
        ? `<span class="px-1.5 py-0.5 rounded bg-amber-900 text-amber-300 text-[10px]">${active.length} signal${active.length > 1 ? 's' : ''}</span>`
        : '<span class="text-slate-600 text-[10px]">—</span>';
      return `<tr class="border-b border-slate-800/60">
        <td class="py-1 pr-2 font-mono text-[11px] text-slate-300">${t.id}</td>
        <td class="py-1 pr-2 text-[11px] text-slate-400">${t.status.replace(/_/g, ' ')}</td>
        <td class="py-1 pr-2 text-[11px] text-slate-500">${t.driverId || '—'}</td>
        <td class="py-1">${sigBadge}</td>
      </tr>`;
    }).join('');
  }

  function renderEvents(state) {
    if (!els.eventFeed) return;
    els.eventFeed.innerHTML = state.recentEvents.slice(0, 20).map(ev => {
      const isDisruption = ev.severity === 'warn';
      const gt = ev.metadata && ev.metadata.groundTruth;
      const tone = isDisruption ? 'border-amber-500/60 text-amber-200' : 'border-slate-700 text-slate-400';
      const gtNote = isDisruption && gt
        ? (gt.legitimate ? ` <span class="text-emerald-500">(benign: ${gt.cause})</span>` : ' <span class="text-red-400">(unexplained)</span>')
        : '';
      return `<div class="text-[11px] leading-snug border-l-2 ${tone} pl-2 py-0.5">
        <span class="text-slate-500">${t2(ev.timestamp)}</span> ${ev.type.replace(/_/g, ' ')} — ${ev.entityId}${gtNote}
      </div>`;
    }).join('');
  }

  function t2(absSeconds) {
    const s = Math.floor(absSeconds % 86400);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  function renderMOs(state) {
    if (!els.moList) return;
    const mos = Array.from(state.moEngine.mos.values())
      .sort((a, b) => b.lastObserved - a.lastObserved);
    if (!mos.length) {
      els.moList.innerHTML = '<p class="text-slate-600 text-xs italic">No open cases yet — normal traffic only.</p>';
      return;
    }
    els.moList.innerHTML = mos.slice(0, 12).map(mo => {
      const fp = (mo.falsePositivePossibilities || []).slice(0, 2)
        .map(f => `<li>${typeof f === 'string' ? f : (f.looks_like || JSON.stringify(f))}</li>`).join('');
      const actions = (mo.recommendedActions || []).slice(0, 2).map(a => `<li>${a}</li>`).join('');
      return `<div class="bg-[#0e1520] border border-slate-800 rounded-lg p-2 mb-2">
        <div class="flex items-center justify-between mb-1">
          <span class="font-mono text-[11px] text-slate-300">${mo.id} · ${mo.entities.truckId}</span>
          <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold ${severityBadgeClass(mo.severity)}">${mo.severity} · ${Math.round(mo.confidence)}%</span>
        </div>
        <div class="text-xs text-white mb-1">${mo.title || mo.matchedPatternName || 'Unclassified pattern'}</div>
        <div class="text-[10px] text-slate-500 mb-1">status: ${mo.status}</div>
        ${fp ? `<div class="text-[10px] text-slate-500">Could be innocent: <ul class="list-disc list-inside">${fp}</ul></div>` : ''}
        ${actions ? `<div class="text-[10px] text-slate-500">Recommended: <ul class="list-disc list-inside">${actions}</ul></div>` : ''}
      </div>`;
    }).join('');
  }

  function render(state) {
    if (!state || !els.root || els.root.classList.contains('hidden')) return;
    renderClock(state);
    renderCounts(state);
    renderEntities(state);
    renderEvents(state);
    renderMOs(state);
  }

  function show() {
    boot();
    render(FWSimRunner.getState());
  }

  return { init, boot, show, render };
})();
