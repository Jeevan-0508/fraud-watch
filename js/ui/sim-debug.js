/* ui/sim-debug.js — visible window into the simulation engines built in
   Slices 1-3. Deliberately a debug/inspector view, not a polished
   screen: the point right now is to see the clock, entities, event
   stream and MOs actually running so pacing/feel can be judged before
   any of it gets a real game UI on top. Reuses Classic Watch/Port
   Meridian's dark-panel DOM conventions so it doesn't look bolted on. */
const FWSimDebugShiftClasses = {
  night: 'fw-shift-night', morning: 'fw-shift-morning',
  peak: 'fw-shift-peak', evening: 'fw-shift-evening'
};

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
    if (window.FWMoIntelligence) {
      FWMoIntelligence.init();
      FWSimRunner.onTick(FWMoIntelligence.render);
    }
    if (window.FWEntityInspector) {
      FWEntityInspector.init();
      FWSimRunner.onTick((state) => { if (FWEntityInspector.isOpen()) FWEntityInspector.render(state); });
    }
    if (window.FWNetworkView) {
      FWNetworkView.init();
      FWSimRunner.onTick(FWNetworkView.render);
    }
    if (window.FWCalibrationView) {
      FWCalibrationView.init();
      FWSimRunner.onTick(FWCalibrationView.render);
    }
    if (window.FWShiftView) {
      FWShiftView.init();
      FWSimRunner.onTick(FWShiftView.render);
    }
    FWSimRunner.start();
    render(FWSimRunner.getState());
    if (window.FWMoIntelligence) FWMoIntelligence.render(FWSimRunner.getState());
    if (window.FWNetworkView) FWNetworkView.render(FWSimRunner.getState());
    if (window.FWCalibrationView) FWCalibrationView.render(FWSimRunner.getState());
    if (window.FWShiftView) FWShiftView.render(FWSimRunner.getState());
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

  function classificationBadgeClass(cls) {
    const map = {
      KNOWN_MO: 'bg-slate-700 text-slate-300',
      MO_VARIANT: 'bg-indigo-900 text-indigo-300',
      POTENTIAL_NEW_MO: 'bg-fuchsia-900 text-fuchsia-300',
      EMERGING_BEHAVIOR: 'bg-rose-900 text-rose-300'
    };
    return map[cls] || map.KNOWN_MO;
  }

  function classificationLabel(cls) {
    const map = {
      KNOWN_MO: 'Known MO',
      MO_VARIANT: 'New Variant',
      POTENTIAL_NEW_MO: 'Potential New MO',
      EMERGING_BEHAVIOR: 'Emerging Behavior'
    };
    return map[cls] || cls;
  }

  // The sim root carries a fw-shift-* class so the whole view visibly
  // changes with the port's time of day (Phase 37) rather than the shift
  // being a word in the clock line nobody reads.
  function applyShiftTint(shift) {
    if (!els.root) return;
    Object.keys(FWSimDebugShiftClasses).forEach(s => els.root.classList.remove(FWSimDebugShiftClasses[s]));
    const cls = FWSimDebugShiftClasses[shift];
    if (cls) els.root.classList.add(cls);
  }

  function renderClock(state) {
    if (!els.clock) return;
    const c = state.clock;
    const shift = c.shift();
    applyShiftTint(shift);
    els.clock.innerHTML =
      `<b class="text-white">Day ${c.day}</b> · ${c.timeOfDay()} · ` +
      `<span class="uppercase shift-chip shift-chip-${shift}">${shift}</span> · ` +
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
      return `<tr class="border-b border-slate-800/60 cursor-pointer hover:bg-slate-800/40" data-truck-id="${t.id}" title="Click to inspect ${t.id}">
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

    const summary = FWMoEngine.discoverySummary(state.moEngine);
    const summaryHtml = `<div class="text-[10px] text-slate-500 mb-2 flex flex-wrap gap-x-3 gap-y-0.5">
      <span>${summary.totalSignatures} distinct behavior patterns seen</span>
      <span class="text-fuchsia-400">${summary.byClassification.POTENTIAL_NEW_MO} potential new MOs</span>
      <span class="text-indigo-400">${summary.byClassification.MO_VARIANT} new variants</span>
      <span class="text-rose-400">${summary.byClassification.EMERGING_BEHAVIOR} unmatched behavior</span>
      <span>${summary.byClassification.KNOWN_MO} confirmed recurring</span>
    </div>`;

    if (!mos.length) {
      els.moList.innerHTML = summaryHtml + '<p class="text-slate-600 text-xs italic">No open cases yet — normal traffic only.</p>';
      return;
    }
    els.moList.innerHTML = summaryHtml + mos.slice(0, 12).map(mo => {
      const fp = (mo.falsePositivePossibilities || []).slice(0, 2)
        .map(f => `<li>${typeof f === 'string' ? f : (f.looks_like || JSON.stringify(f))}</li>`).join('');
      const actions = (mo.recommendedActions || []).slice(0, 2).map(a => `<li>${a}</li>`).join('');
      const diffs = (mo.differencesFromKnownPatterns || []).map(d => `<li>${d}</li>`).join('');
      const related = (mo.relatedHistoricalPatterns || []).map(p => p.name).join(', ');
      return `<div class="bg-[#0e1520] border border-slate-800 rounded-lg p-2 mb-2">
        <div class="flex items-center justify-between mb-1">
          <span class="font-mono text-[11px] text-slate-300">${mo.id} · ${mo.entities.truckId}</span>
          <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold ${severityBadgeClass(mo.severity)}">${mo.severity} · ${Math.round(mo.confidence)}%</span>
        </div>
        <div class="text-xs text-white mb-1">${mo.title || mo.matchedPatternName || 'Unclassified pattern'}</div>
        <div class="flex items-center gap-2 mb-1">
          <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold ${classificationBadgeClass(mo.classification)}">${classificationLabel(mo.classification)}</span>
          <span class="text-[10px] text-slate-500">novelty ${mo.noveltyScore} · seen ${mo.recurrenceCount}×</span>
        </div>
        <div class="text-[10px] text-slate-500 mb-1">status: ${mo.status}</div>
        ${related ? `<div class="text-[10px] text-slate-500 mb-1">Closest known patterns: ${related}</div>` : ''}
        ${diffs ? `<div class="text-[10px] text-slate-500">${diffs.replace(/<li>/g, '').replace(/<\/li>/g, ' ')}</div>` : ''}
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
