/* ui/sim-debug.js — visible window into the simulation engines built in
   Slices 1-3. Deliberately a debug/inspector view, not a polished
   screen: the point right now is to see the clock, entities, event
   stream and MOs actually running so pacing/feel can be judged before
   any of it gets a real game UI on top. Reuses Classic Watch/Port
   Meridian's dark-panel DOM conventions so it doesn't look bolted on.

   Slice 34: this file was written in Slices 1-3 and never revisited, and it
   had drifted furthest from the discipline everything built on top of it
   follows. Three catch-ups, in order of how badly they read:

     1. The event feed printed the simulation's hidden answer key straight
        into the live stream as "(benign: cause)" or a red "(unexplained)".
        Both read as observations about the event -- which is what they look
        like sitting next to the recorded disruption line -- and the second
        read as a threat level because of the colour. It is neither. It is
        the per-event ground truth falsePositiveEngine generated, the thing
        every refusal in this project cites as the figure it will not reach
        for, and no panel an analyst uses can see it. Worse, groundTruth
        legitimate:false does not say an event was fraud; it says this
        simulation generated no benign cause for it, which outcomeEngine
        carefully calls UNEXPLAINED and scores against only as calibration
        AGAINST THE RECORD. It is now labelled as the answer key, in neutral
        colour, with what its absence-of-a-cause actually means stated, and
        the feed carries a standing caption saying so.
     2. The case summary called the KNOWN_MO count "confirmed recurring".
        CONFIRMED is a verdict status in this app. That classification is a
        signal-signature resemblance to a documented pattern and confirms
        nothing, which is why the analytics panel words it as a resemblance.
     3. Each case card printed "status: DISMISSED" and nothing else, so a
        case an analyst closed and a case moFaded out on its own read
        identically -- the Slice 32 finding, in a second panel -- and a
        status still implied it was arrived at, which is Slice 26's. Both now
        come from the shared vocabulary rather than a new local copy. */
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
    if (window.FWFacilityView) {
      FWFacilityView.init();
      FWSimRunner.onTick(FWFacilityView.render);
    }
    if (window.FWExposureView) {
      FWExposureView.init();
      FWSimRunner.onTick(FWExposureView.render);
    }
    if (window.FWAnalyticsView) {
      FWAnalyticsView.init();
      FWSimRunner.onTick(FWAnalyticsView.render);
    }
    FWSimRunner.start();
    render(FWSimRunner.getState());
    if (window.FWMoIntelligence) FWMoIntelligence.render(FWSimRunner.getState());
    if (window.FWNetworkView) FWNetworkView.render(FWSimRunner.getState());
    if (window.FWCalibrationView) FWCalibrationView.render(FWSimRunner.getState());
    if (window.FWShiftView) FWShiftView.render(FWSimRunner.getState());
    if (window.FWFacilityView) FWFacilityView.render(FWSimRunner.getState());
    if (window.FWExposureView) FWExposureView.render(FWSimRunner.getState());
    if (window.FWAnalyticsView) FWAnalyticsView.render(FWSimRunner.getState());
  }

  function fmtPct(x) { return Math.round(x * 100) + '%'; }

  // The band and its tone are moEngine's, not this panel's second opinion.
  function bandBadgeClass(band) { return FWMoEngine.bandTone(band); }

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
    const parts = FWEntityEngine.KINDS.map(k => `${FWEntityEngine.all(reg, k).length} ${FWEntityEngine.plural(k)}`);
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

  /* The per-event answer key, marked as one. Two things this must not do:
     read as something observed at the port, and read as a verdict. The
     colour is neutral for the second reason -- the old red on the no-cause
     branch put a threat tone on the absence of an innocent explanation. */
  function groundTruthNote(gt) {
    if (!gt) return '';
    const body = gt.legitimate
      ? `benign cause generated: ${gt.cause}`
      : 'no benign cause generated for this one';
    return ` <span class="text-slate-500">[answer key: ${body}]</span>`;
  }

  const ANSWER_KEY_CAPTION =
    'The bracketed answer key on disruption lines is this simulation\'s own ' +
    'per-event ground truth, shown here because this is the engine inspector and ' +
    'pacing cannot be judged without it. Nothing an analyst uses can see it: no ' +
    'case, panel, check outcome or exposure figure in this app is derived from it, ' +
    'and every refusal elsewhere that mentions a hidden ledger means this. ' +
    '"No benign cause generated" is the absence of an innocent explanation, not the ' +
    'presence of proof of anything — the calibration panel scores verdicts against ' +
    'it as a comparison with the record and never as a right answer about the world.';

  function renderEvents(state) {
    if (!els.eventFeed) return;
    const caption = `<div class="text-[10px] text-slate-500 italic border border-slate-800 rounded p-1.5 mb-2">${ANSWER_KEY_CAPTION}</div>`;
    els.eventFeed.innerHTML = caption + state.recentEvents.slice(0, 20).map(ev => {
      const isDisruption = ev.severity === 'warn';
      const gt = ev.metadata && ev.metadata.groundTruth;
      const tone = isDisruption ? 'border-amber-500/60 text-amber-200' : 'border-slate-700 text-slate-400';
      const gtNote = isDisruption ? groundTruthNote(gt) : '';
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

  /* How far the case was taken, from investigationEngine's shared
     examination vocabulary rather than a fourth local copy of the rule. A
     status says a case has a label; it does not say the label was arrived
     at by looking. Framed as a fact about the work, not about the case. */
  function examinationLine(mo) {
    if (!window.FWInvestigationEngine || !FWInvestigationEngine.examination) return '';
    const ex = FWInvestigationEngine.examination(mo);
    if (!ex.checksRun) return 'examination: no record check has been run against this case';
    return `examination: ${ex.checksRun} check${ex.checksRun === 1 ? '' : 's'} run, ` +
      `${ex.answeredChecks} of ${ex.checksRun} answered — ${ex.note}`;
  }

  // Whether anybody decided this, or whether the correlation engine faded it
  // out on its own when its signals stopped. The two are not the same fact
  // and the status word is identical for both. The rule and its wording are
  // moEngine's -- it is the module that fades a case -- and as of Slice 35
  // three panels were each reading the one boolean their own way.
  function closureHand(mo) {
    if (!window.FWMoEngine || !FWMoEngine.closureHand) return '';
    const h = FWMoEngine.closureHand(mo);
    if (h.hand !== 'ENGINE_FADE') return '';
    return ` <span class="text-slate-500">(${h.note})</span>`;
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
      <span>${summary.byClassification.KNOWN_MO} resembling a documented pattern that has recurred</span>
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
          <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold ${bandBadgeClass(mo.confidenceBand)}">${mo.confidenceBand} · ${Math.round(mo.confidence)}%</span>
        </div>
        <div class="text-xs text-white mb-1">${mo.title || mo.matchedPatternName || 'Unclassified pattern'}</div>
        <div class="flex items-center gap-2 mb-1">
          <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold ${classificationBadgeClass(mo.classification)}">${classificationLabel(mo.classification)}</span>
          <span class="text-[10px] text-slate-500">novelty ${mo.noveltyScore} · seen ${mo.recurrenceCount}×</span>
        </div>
        <div class="text-[10px] text-slate-500 mb-1">status: ${mo.status}${closureHand(mo)}</div>
        <div class="text-[10px] text-slate-500 mb-1">${examinationLine(mo)}</div>
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

  return { init, boot, show, render, groundTruthNote, examinationLine, closureHand, ANSWER_KEY_CAPTION };
})();
