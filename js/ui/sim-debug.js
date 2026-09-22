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

  /* WHETHER THIS PAGE LOAD IS A NEW RUN OR THE LAST ONE CONTINUED. Written once
     by boot(), read by the warm-start decision and by the line the header
     prints. Nothing else may key off it. */
  let resumed = { resumed: false, refusal: 'NOT_BOOTED' };

  /* WHY THE HEADER SAYS WHICH. A resumed run opens on day 3 with cases already
     in the queue, and without a line saying so that is indistinguishable from a
     simulation that invented three days of history on load. The refusals are
     printed too: "nothing was saved" and "this browser would not let the app
     store anything" are different facts, and the second one is the one worth
     knowing before spending an hour on a run that will not survive a refresh. */
  const RESUME_NOTE = {
    NO_SAVE: 'Fresh run — nothing was saved from a previous visit.',
    UNAVAILABLE: 'Fresh run — this browser is not letting the page store anything, so this run will not survive a refresh.',
    UNREADABLE: 'Fresh run — the saved run could not be read back.',
    WRONG_VERSION: 'Fresh run — the saved run was written by an older version of this build.',
    INCOMPLETE: 'Fresh run — the saved run was missing part of the world.',
    NO_STORE: 'Fresh run — saving is not available in this build.',
    RESTORE_REFUSED: 'Fresh run — the saved run was refused.'
  };

  function reportResume() {
    const el = document.getElementById('sim-resume-note');
    if (!el) return;
    el.textContent = resumed.resumed
      ? `Resumed the saved run — day ${resumed.day}, ${resumed.cases} case${resumed.cases === 1 ? '' : 's'} already open.`
      : (RESUME_NOTE[resumed.refusal] || RESUME_NOTE.RESTORE_REFUSED);
  }

  /* THE SAVE CADENCE IS THE STORE'S, NOT THIS PANEL'S. This only wires it: the
     throttled save rides the tick every other renderer rides, and the flush
     rides both page-exit events because one of them fires on desktop and the
     other is the one mobile browsers actually deliver. */
  function registerSaving() {
    if (!window.FWLiveSimStore) return;
    FWSimRunner.onTick((state) => { FWLiveSimStore.maybeSave(state); });
    const flush = () => { FWLiveSimStore.flush(FWSimRunner.getState()); };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    const btn = document.getElementById('sim-fresh-btn');
    if (btn) {
      btn.addEventListener('click', () => {
        /* Deliberately destructive and deliberately confirmed. Without this the
           saved run is a trap: a player who wants to start over has no way to
           ask for it, because every reload now continues. */
        if (typeof window.confirm === 'function' && !window.confirm('Discard the saved run and start a new world? This cannot be undone.')) return;
        FWLiveSimStore.clear();
        if (window.location && typeof window.location.reload === 'function') window.location.reload();
      });
    }
  }

  /* One sim-hour. Chosen as the smallest interval measured to place every truck
     (0 of 8 at hour 0, 8 of 8 at hour 1), not as a round number that looked
     right. */
  const WARM_START_SECONDS = 3600;

  function boot() {
    if (booted) return;
    booted = true;
    /* A REFRESH USED TO BE A NEW WORLD. The player who fast-forwarded to day 3
       and reloaded got day 1, no cases, no discovered combinations, and nothing
       said that had happened. The store decides: a compatible snapshot is
       continued; anything else (no save, refused storage, an older shape) falls
       through to the fresh boot that has always been here. */
    const loaded = window.FWLiveSimStore ? FWLiveSimStore.load() : { ok: false, refusal: 'NO_STORE', snapshot: null };
    const restored = loaded.ok ? FWSimRunner.restore(loaded.snapshot) : null;
    resumed = restored
      ? { resumed: true, day: restored.clock.day, cases: restored.moEngine.mos.size }
      : { resumed: false, refusal: loaded.refusal || 'RESTORE_REFUSED' };
    if (!restored) FWSimRunner.boot();
    FWSimRunner.onTick(render);
    if (window.FWMoIntelligence) {
      FWMoIntelligence.init();
      FWSimRunner.onTick(FWMoIntelligence.render);
    }
    // Booted after the panel it exports from, because it binds a control that
    // lives in that panel's header.
    if (window.FWCaseExport) FWCaseExport.init();
    if (window.FWEntityInspector) {
      FWEntityInspector.init();
      FWSimRunner.onTick((state) => { if (FWEntityInspector.isOpen()) FWEntityInspector.render(state); });
    }
    /* Slice 75: the network map. Booted before the older panels because it is
       what the tab now opens on, and driven by the same onTick as everything
       else -- the renderer observes the clock and never advances it. */
    if (window.FWFreightMap) {
      FWFreightMap.init();
      FWSimRunner.onTick(FWFreightMap.render);
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
    if (window.FWAutonomousWorld) FWAutonomousWorld.init();
    /* WARM START, and why there is one. A truck's first journey is drawn on its
       first behavior tick, not at t=0, so at the instant the run is created no
       truck has a journey and the network map draws eleven places and nothing
       moving. Measured at seed 12345: sim hour 0 has 0 of 8 trucks placeable,
       sim hour 1 has 8 of 8. Since Slice 77 the Live Sim is what the page opens
       on, so that empty first frame is now the first thing anyone sees, and it
       reads as a broken drawing rather than as a world that has not started.

       This advances the simulation's own clock by a declared interval before the
       first paint. It fabricates nothing: WARM_START_SECONDS of the run happen
       exactly as they would have happened with nobody watching, by the same
       tick path, and the clock says so -- the header opens on hour 1 rather than
       hour 0 and does not pretend otherwise. */
    /* The warm start is for a world that has not started. A resumed run has
       already had hours happen in it, so advancing it again would add an hour of
       simulation nobody asked for on every refresh. */
    if (!resumed.resumed) FWSimRunner.fastForward(WARM_START_SECONDS);
    reportResume();
    registerSaving();
    FWSimRunner.start();
    render(FWSimRunner.getState());
    if (window.FWMoIntelligence) FWMoIntelligence.render(FWSimRunner.getState());
    if (window.FWFreightMap) FWFreightMap.render(FWSimRunner.getState());
    if (window.FWNetworkView) FWNetworkView.render(FWSimRunner.getState());
    if (window.FWCalibrationView) FWCalibrationView.render(FWSimRunner.getState());
    if (window.FWShiftView) FWShiftView.render(FWSimRunner.getState());
    if (window.FWFacilityView) FWFacilityView.render(FWSimRunner.getState());
    if (window.FWExposureView) FWExposureView.render(FWSimRunner.getState());
    if (window.FWAnalyticsView) FWAnalyticsView.render(FWSimRunner.getState());
  }

  function fmtPct(x) { return Math.round(x * 100) + '%'; }

  // The band and its tone are moEngine's, not this panel's second opinion.
  /* The index used to print as `78%`, which is a denominator claim over a
     sum that divides nothing. Its unit, its scale and what it is not now
     travel with it, and at either end of the clamp the caveat is stated
     rather than the stale number printed alone. */
  function indexLine(mo) {
    const decl = FWMoEngine.CONFIDENCE_INDEX;
    const n = mo.indexScaleNote;
    const bound = n && (n.saturated || n.floored) ? ` &mdash; ${n.reason}` : '';
    const basis = FWMoEngine.indexBasis(mo);
    return `${decl.displayLabel} ${FWMoEngine.formatIndex(mo.confidence)} (${decl.unit}; not a probability that fraud occurred)${bound}<br>${basis.note}`;
  }

  function bandBadgeClass(band) { return FWMoEngine.bandTone(band); }

  // Discovery-class labels and tones come from moEngine, the module that
  // assigns the class. This panel held the third copy of both maps.
  function classificationBadgeClass(cls) { return FWMoEngine.classificationTone(cls); }
  function classificationLabel(cls) { return FWMoEngine.classificationLabel(cls); }


  // The sim root carries a fw-shift-* class so the whole view visibly
  // changes with the port's time of day (Phase 37) rather than the shift
  // being a word in the clock line nobody reads.
  function applyShiftTint(shift) {
    if (!els.root) return;
    Object.keys(FWSimDebugShiftClasses).forEach(s => els.root.classList.remove(FWSimDebugShiftClasses[s]));
    const cls = FWSimDebugShiftClasses[shift];
    if (cls) els.root.classList.add(cls);
  }

  /* THE CLOCK READ-OUT THIS MODULE USED TO OWN IS GONE, AND WHY.

     There were two clocks on this page. This one and the one in the map header
     printed the same day, the same time, the same shift and the same speed, a few
     hundred pixels apart, and a reader who noticed both had to work out whether
     they were two clocks or one. The map header keeps its clock, because that is
     where the drawing it describes is; this module no longer reaches for
     #sim-clock at all, and index.html no longer declares it, so nothing here
     looks up an element the page does not have.

     WHAT THIS FUNCTION STILL DOES, and the bug that made keeping it necessary.

     The shift tint over the whole Live Sim view was applied inside this function
     BELOW a `if (!els.clock) return` guard. So the tint on an entire view was
     conditional on one small text node existing, and deleting that text node as a
     duplicate would silently have taken the tint with it -- a visual change with
     no visible cause, in a module nobody would have thought to look in. The tint
     is a property of the view and not of a clock line, so it is applied first and
     unconditionally, and it is all this function does now. The name is kept
     because the caller and the render order are unchanged. */
  function renderClock(state) {
    applyShiftTint(state.clock.shift());
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
        <td class="py-1 pr-2 text-[11px] text-slate-400">${FWEntityEngine.statusLabel('truck', t.status)}</td>
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
      /* This used to compare ev.severity against the disruption token as a bare
         inline literal, against a vocabulary nothing declared, and it decided
         both the row's tone and whether the answer key was shown at all. A value
         outside the space took the else branch of both, so a recorded disruption
         rendered as ordinary traffic with its note dropped. The space is declared
         by the module that stamps it now, and the outside-the-space case has its
         own branch and says so on the row. With that module absent there is no
         declaration to compare against, so the answer is that the row cannot be
         classified -- not a second local copy of the comparison. */
      const basis = window.FWEventEngine
        ? FWEventEngine.severityBasis(ev.severity).basis
        : 'UNDECLARED';
      const gt = ev.metadata && ev.metadata.groundTruth;
      const TONE = {
        DISRUPTION: 'border-amber-500/60 text-amber-200',
        ROUTINE: 'border-slate-700 text-slate-400',
        UNDECLARED: 'border-fuchsia-500/60 text-fuchsia-200'
      };
      const tone = TONE[basis] || TONE.ROUTINE;
      const gtNote = basis === 'DISRUPTION' ? groundTruthNote(gt) : '';
      const undeclaredNote = basis === 'UNDECLARED'
        ? ` <span class="text-fuchsia-300">[this row carries a severity this program does not declare, so whether it recorded a disruption is not known here and it is not being shown as routine traffic]</span>`
        : '';
      return `<div class="text-[11px] leading-snug border-l-2 ${tone} pl-2 py-0.5">
        <span class="text-slate-500">${t2(ev.timestamp)}</span> ${ev.type.replace(/_/g, ' ')} — ${ev.entityId}${gtNote}${undeclaredNote}
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

  // The sighting count is the figure; novelty is that count restated, and is
  // withheld once it stops distinguishing counts.
  function noveltyChip(mo) {
    const n = FWMoEngine.noveltyNote(mo.recurrenceCount - 1);
    return n.value == null ? 'novelty withheld (floor reached)' : 'novelty ' + n.value + ' (the count restated)';
  }

  function renderMOs(state) {
    if (!els.moList) return;
    const MO_LIST_CAP = 12;
    const mos = Array.from(state.moEngine.mos.values())
      .sort((a, b) => b.lastObserved - a.lastObserved);

    const summary = FWMoEngine.discoverySummary(state.moEngine);
    // Four buckets used to be printed with no base. They are a declared
    // partition of the open cases, so they are printed over it.
    const classSpans = FWMoEngine.CLASSIFICATIONS.map(k =>
      `<span>${summary.byClassification[k]} / ${summary.classifiedTotal} ${FWMoEngine.classificationTally(k)}</span>`
    ).join('');
    const reachSpan = (summary.unissuableClasses || []).length
      ? `<span class="basis-full text-slate-600 italic">${summary.reachNote}</span>`
      : '';
    // Two of the four classes are issued from opposite evidence, so the class
    // tally alone cannot say what it counted.
    const reasonSpans = summary.byReason
      ? FWMoEngine.CLASSIFICATION_REASON_KEYS.map(k =>
        `<span>${summary.byReason[k]} / ${summary.reasonBase} ${FWMoEngine.classificationReasonEntry(k).note}</span>`).join('')
      : '';
    // Two populations, two answers, both named: the floor separates every
    // combination the catalogue allows and separates almost none of the cases
    // actually opened.
    const floorSpan = (summary.voteFloorNote ? `<span class="basis-full text-slate-600 italic">${summary.voteFloorNote}</span>` : '') +
      (summary.observedVoteFloorNote ? `<span class="basis-full text-slate-600 italic">${summary.observedVoteFloorNote}</span>` : '');
    /* The class and reason tallies above both end in a throw whose message
       says the buckets must add to the base. Neither of those comparisons can
       fail: the bucket key is checked against the declared list first, so the
       sum is an identity. That is worth printing beside them, because a panel
       that shows a tally and asserts it reconciles invites the reader to treat
       the assertion as evidence the numbers are right. Counted over the
       register as its own population, with the base named. */
    const recon = window.FWReconcile ? FWReconcile.capability() : null;
    const reconSpan = recon
      ? `<span class="basis-full text-slate-600 italic">${recon.note}</span>`
      : '';
    /* The same disclosure for the other half of the app that refuses things: the
       formatters that will not render a value nobody derived. None of them can
       be reached with a bad value by any path this app takes, which is worth
       printing beside the figures they render, because a guarded number reads as
       a checked number. */
    const guards = window.FWRenderGuards ? FWRenderGuards.capability() : null;
    const guardSpan = guards
      ? `<span class="basis-full text-slate-600 italic">${guards.note}</span>`
      : '';
    /* And the register those reachability figures are read out of. `writable`
       is a claim about the source code and nothing in a page can read the
       source tree, so in a browser this line always reports the check as not
       run -- which is the point: the figures are derived from a declaration,
       and whether that declaration has been compared to a line of the codebase
       is a separate fact the reader is entitled to. */
    const wstate = window.FWEntityEngine ? FWEntityEngine.writableCheckState() : null;
    const writableSpan = wstate
      ? `<span class="basis-full text-slate-600 italic">${wstate.note}</span>`
      : '';
    /* And the strongest claim this simulation makes about its own generator: that
       a disruption's hidden explanation cannot be read off an event's shape. The
       phrase this panel uses for that elsewhere belongs to the event feed only, so
       the note below is worded for the case list. That check needs
       100 annotated events and the event log is a ring buffer holding at most
       LOG_CAP events of which roughly one percent are disruptions, so the log can
       never hold enough -- the claim is asserted only over a capture no page keeps.
       A page showing false-positive counts should say the claim behind them has
       not been checked on what it is showing. */
    const sepState = (window.FWFalsePositiveEngine && window.FWEventEngine && state && state.eventEngine)
      ? FWFalsePositiveEngine.separabilityCheckState(state.eventEngine.log, FWEventEngine.LOG_CAP) : null;
    const sepSpan = sepState
      ? `<span class="basis-full text-slate-600 italic">${sepState.note}</span>`
      : '';
    const summaryHtml = `<div class="text-[10px] text-slate-500 mb-2 flex flex-wrap gap-x-3 gap-y-0.5">
      <span>${summary.totalSignatures} distinct behavior patterns seen</span>
      ${classSpans}
      ${reachSpan}
      ${reasonSpans}
      ${floorSpan}
      ${reconSpan}
      ${guardSpan}
      ${writableSpan}
      ${sepSpan}
    </div>`;

    if (!mos.length) {
      els.moList.innerHTML = summaryHtml + '<p class="text-slate-600 text-xs italic">No open cases yet — normal traffic only.</p>';
      return;
    }
    /* THE PANEL SHOWS TWELVE AND THERE ARE MORE THAN TWELVE NOW (Slice 81).

       This was `mos.slice(0, 12)` with nothing said about the other cases. At
       the fleet size this build shipped with there were rarely twelve, so the
       cut never bit; measured at the fleet size it ships with NOW there are
       routinely thirty-odd, and the panel was dropping two thirds of them
       silently while its own summary counted all of them. A list that is a
       subset of its own headline has to name the subset. */
    const shown = mos.slice(0, MO_LIST_CAP);
    const cutNote = mos.length > shown.length
      ? `<p class="text-amber-500/80 text-[10px] mb-2">Showing the ${shown.length} most recently observed of
         ${mos.length} cases. The counts above are over all ${mos.length}, not over these ${shown.length}.</p>`
      : '';
    els.moList.innerHTML = summaryHtml + cutNote + shown.map(mo => {
      const fpScope = mo.falsePositives || { items: [], note: '' };
      const fp = (fpScope.items || [])
        .map(f => `<li>${typeof f === 'string' ? f : (f.looks_like || JSON.stringify(f))}</li>`).join('');
      const cm = mo.patternCountermeasures || { picks: [], note: '' };
      const actions = (cm.picks || []).map(a => `<li><span class="uppercase text-[9px] text-slate-600">${a.bucket}</span> ${a.text}</li>`).join('');
      const diffs = (mo.resemblanceNotes || []).map(d => `<li>${d}</li>`).join('');
      const related = (mo.relatedHistoricalPatterns || []).map(p => p.name).join(', ');
      return `<div class="bg-[#0e1520] border border-slate-800 rounded-lg p-2 mb-2">
        <div class="flex items-center justify-between mb-1">
          <span class="font-mono text-[11px] text-slate-300">${mo.id} · ${mo.entities.truckId}</span>
          <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold ${bandBadgeClass(mo.confidenceBand)}">${mo.confidenceBand} · idx ${FWMoEngine.formatIndex(mo.confidence)}</span>
        </div>
        <div class="text-xs text-white mb-1">${mo.title || mo.matchedPatternName || 'Unclassified pattern'}</div>
        <div class="flex items-center gap-2 mb-1">
          <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold ${classificationBadgeClass(mo.classification)}">${classificationLabel(mo.classification)}</span>
          <span class="text-[10px] text-slate-500">${noveltyChip(mo)} · the combination it opened with seen ${mo.recurrenceCount}×</span>
        </div>
        ${mo.classificationReasonNote ? `<div class="text-[10px] text-slate-600 mb-1">Why this badge: ${mo.classificationReasonNote}</div>` : ''}
        <div class="text-[10px] text-slate-500 mb-1">${indexLine(mo)}</div>
        <div class="text-[10px] text-slate-500 mb-1">status: ${mo.status}${closureHand(mo)}</div>
        <div class="text-[10px] text-slate-500 mb-1">${examinationLine(mo)}</div>
        ${related ? `<div class="text-[10px] text-slate-500 mb-1">Closest known patterns: ${related}</div>` : ''}
        ${diffs ? `<div class="text-[10px] text-slate-500">${diffs.replace(/<li>/g, '').replace(/<\/li>/g, ' ')}</div>` : ''}
        ${fp ? `<div class="text-[10px] text-slate-500">Could be innocent: <ul class="list-disc list-inside">${fp}</ul>${fpScope.note}</div>` : ''}
        ${!fp && fpScope.note ? `<div class="text-[10px] text-slate-500">${fpScope.note}</div>` : ''}
        ${actions ? `<div class="text-[10px] text-slate-500">Countermeasures documented for ${cm.patternName}: <ul class="list-disc list-inside">${actions}</ul>${cm.note}</div>` : ''}
        ${!actions && cm.note ? `<div class="text-[10px] text-slate-500">${cm.note}</div>` : ''}
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

  return { init, boot, show, render, groundTruthNote, examinationLine, closureHand, ANSWER_KEY_CAPTION,
    WARM_START_SECONDS };
})();
