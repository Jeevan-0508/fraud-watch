/* simulation/awayReport.js — pure counting logic behind the "while you
   were away" report (mega-spec Phase 9). No DOM here; js/ui/away-report.js
   owns when to snapshot/show and how to render it.

   Since Phase 50 there IS a cost/exposure model (exposureModel.js), so
   this reports the exposure band newly attached to cases opened while you
   were away. That is a band and it is what was at stake -- not a loss,
   not an expected loss. Loss and loss-avoided figures stay refused for
   the reasons exposureModel.NOT_MODELLED gives, so this report still
   never shows an "estimated exposure" line.

   Since Slices 16-18 there is also a site/coverage layer, and it changes
   what the counts in this report MEAN. Two additions follow from it:

     - The away window is broken down into the shifts it actually spanned,
       each carrying the stated oversight parameter for that shift. An
       eight-hour absence across the night watch and an eight-hour absence
       across the morning watch are not comparable counts, and without the
       breakdown the report invites exactly that comparison.
     - For the cases opened while away, it reports how many have no site
       record to pull at all, and how many sit at sites whose assumed
       coverage is thin. That is the same structural absence
       investigationEngine's NO_RECORD_EXISTS outcome names -- known here
       in advance of any check, because it is a fact about where the
       signals were observed rather than about the case.

   Since Slice 26 there is a shared four-class examination vocabulary, and
   this report predated it while being the one panel whose entire subject is
   a period when nobody was looking. Two things followed from that gap:

     - The status-movement list showed net deltas per status. In this
       simulation a case can reach DISMISSED without an analyst ever seeing
       it: moEngine fades an idle open case out on its own and flags it
       autoFaded. So "dismissed +3" in a report about an absence read as
       three decisions taken, when it can be three cases that went quiet.
       The window now splits its closures by whether an analyst closed them
       and by investigationEngine's examination class, sum-asserted. The old
       reading could only ever overstate how far the caseload was taken.
     - "New cases" counted the ledger delta, while the classification list,
       the record-source breakdown and the exposure band below it counted
       cases whose FIRST SIGNAL fell in the window. Those are different
       populations -- correlation needs a second signal type, so opening
       always lags the first signal (300s to 6300s in the seeded run) -- and
       at 17 of 1920 window boundaries in that one run the headline did not
       equal the list beneath it. Everything per-case now counts cases
       OPENED in the window, with the cases whose first signal predates the
       window named as a labelled subset rather than silently dropped.

   What is deliberately NOT computed: a single average oversight figure for
   the window. It would read as the fraction of the period that was
   watched, and the obvious next step -- dividing the event count by it --
   is the circular arithmetic facilityEngine.NOT_MODELLED already refuses.
   Hours per shift and the per-shift parameter, side by side, say the same
   thing without offering the division. */
const FWAwayReportEngine = (() => {
  const MAX_HOUR_STEPS = 20000; // an away window is bounded; never spin on a bad input
  // A site whose assumed coverage is below this is reported as thin. The
  // threshold is a stated reporting cut-off, not a risk boundary.
  const THIN_COVERAGE = 0.5;

  /* Figures this report will not print, and why. Same register pattern as
     exposureModel / facilityEngine / shiftEngine: a refusal is content. */
  const NOT_MODELLED = [
    {
      figure: 'How many of these you would have caught, or closed differently, had you been watching',
      why: 'The simulation clock does not stop for the tab, and nothing here branches on whether anyone was looking. Every event and every fade in this window would have happened identically with the panel open, so a "cost of being away" figure would be a counterfactual with no model behind it -- the same reason the exposure model refuses loss-avoided.'
    },
    {
      figure: 'A share of the window\'s closures that went unexamined, as a rate',
      why: 'An away window closes a handful of cases at most. The analytics model withholds any rate under its own minimum-sample floor, and a percentage over three or four closures reads far stronger than the count it came from. The counts are shown with their base instead, and no bucket is dropped from them.'
    },
    {
      figure: 'The fade-outs read as a consequence of the absence',
      why: 'A case fades when its signals stop and it has been idle past the engine\'s threshold, whoever is at the screen. Attributing the fades to the absence would turn a fact about the signals into a fact about the analyst. What this report can say honestly is the narrower thing: these closed while nobody was looking, and this many had nothing ever answered against them.'
    }
  ];

  // Sim-seconds of the away window that fell in each shift, bucketed by
  // hour-of-day off the same clock mapping the simulation itself runs on.
  function shiftMix(fromAbs, toAbs) {
    if (!window.FWShiftEngine || !window.FWSimClock || !(toAbs > fromAbs)) {
      return { rows: [], truncated: false };
    }
    const order = FWShiftEngine.SHIFT_ORDER;
    const seconds = {};
    order.forEach(s => { seconds[s] = 0; });
    let cursor = fromAbs, steps = 0, truncated = false;
    while (cursor < toAbs) {
      if (steps++ >= MAX_HOUR_STEPS) { truncated = true; break; }
      const hour = Math.floor((cursor % FWSimClock.SECONDS_PER_DAY) / 3600);
      const until = Math.min(Math.floor(cursor / 3600) * 3600 + 3600, toAbs);
      const name = FWSimClock.shiftForHour(hour);
      if (seconds[name] != null) seconds[name] += until - cursor;
      cursor = until;
    }
    const rows = order.map(s => {
      const p = FWShiftEngine.profile(s);
      return {
        shift: s, label: p.label, window: p.window, seconds: seconds[s],
        oversight: p.oversight, throughput: p.throughput
      };
    }).filter(r => r.seconds > 0);
    return { rows, truncated };
  }

  // Whether a site record covering each new case exists at all. Road-observed
  // signals have no site to ask (investigationEngine.narrateSiteUnavailable),
  // which is an absent source rather than an unchecked one.
  function siteSources(state, newlyCreated) {
    if (!window.FWInvestigationEngine || !newlyCreated.length) return null;
    let sourceless = 0, sited = 0, thin = 0;
    newlyCreated.forEach(m => {
      const signals = FWInvestigationEngine.signalsForMo(state, m);
      const ctx = FWInvestigationEngine.siteRecordChance(state, m, signals);
      if (!ctx) { sourceless += 1; return; }
      sited += 1;
      if (ctx.chance < THIN_COVERAGE) thin += 1;
    });
    return {
      cases: newlyCreated.length, sourceless, sited, thin,
      thinThresholdPct: Math.round(THIN_COVERAGE * 100)
    };
  }

  /* Which population "new cases in this window" means, reconciled instead of
     left to two callers to disagree about. openedAt is when correlation
     opened the case; firstObserved is when its earliest signal was seen, and
     that can predate the window even for a case opened inside it. Both are
     true facts; the report counts the opened ones and names the other as a
     labelled subset. Throws rather than print two headlines that disagree. */
  function newCaseScope(mos, fromAbs, ledgerDelta) {
    const opened = mos.filter(m => openedAtOf(m) > fromAbs);
    let signalInWindow = 0, signalPredatesWindow = 0;
    opened.forEach(m => {
      if (m.firstObserved > fromAbs) signalInWindow += 1;
      else signalPredatesWindow += 1;
    });
    if (signalInWindow + signalPredatesWindow !== opened.length) {
      throw new Error('awayReport: new-case first-signal split does not reconcile');
    }
    if (ledgerDelta != null && opened.length !== ledgerDelta) {
      throw new Error(
        'awayReport: ' + opened.length + ' cases opened in the window but the case ledger ' +
        'grew by ' + ledgerDelta + '. The headline count and the per-case breakdowns below it ' +
        'would be describing different populations.'
      );
    }
    return { cases: opened, opened: opened.length, signalInWindow, signalPredatesWindow };
  }

  // Cases whose first signal predates openedAt for every case built before
  // Slice 32; fall back to firstObserved so an older snapshot still sorts.
  function openedAtOf(mo) {
    return mo.openedAt != null ? mo.openedAt : mo.firstObserved;
  }

  /* What actually happened to the cases that reached a closing status while
     nobody was looking. Two cuts over ONE base (the closures in this
     window), each sum-asserted:
       - who closed it: an analyst, or the engine fading an idle case out
       - what had come back by then: investigationEngine's four examination
         classes, via the shared classifyCounts precedence rule
     Neither is a judgement of the closure. A faded case is not a mistake and
     an unexamined one is not a wrong verdict; they are facts about how far
     the case got, which a status label alone does not carry. */
  function closuresInWindow(state, before) {
    if (!window.FWMoEngine || !window.FWInvestigationEngine) return null;
    const prior = (before && before.statusById) || null;
    if (!prior) return null;
    const closed = Array.from(state.moEngine.mos.values()).filter(m => {
      if (!FWMoEngine.CLOSED_STATUSES.has(m.status)) return false;
      const was = prior[m.id];
      // Opened AND closed inside the window counts: it was never open while
      // anyone could see it. Already closed before the window does not.
      return was === undefined || !FWMoEngine.CLOSED_STATUSES.has(was);
    });
    if (!closed.length) return { total: 0, engineFaded: 0, analystClosed: 0, byClass: null, byStatus: {} };

    let engineFaded = 0, analystClosed = 0;
    const byStatus = {};
    closed.forEach(m => {
      // moEngine's own rule (Slice 35), not a third local reading of the flag.
      if (FWMoEngine.closureHand(m).hand === 'ENGINE_FADE') engineFaded += 1;
      else analystClosed += 1;
      byStatus[m.status] = (byStatus[m.status] || 0) + 1;
    });
    if (engineFaded + analystClosed !== closed.length) {
      throw new Error('awayReport: closure hands do not reconcile with the closures counted');
    }
    // examinationRollup asserts its own four classes sum to the base.
    const rollup = FWInvestigationEngine.examinationRollup(closed);
    return {
      total: closed.length,
      engineFaded,
      analystClosed,
      byClass: rollup.byClass,
      classes: rollup.classes,
      notes: rollup.notes,
      neverAnswered: rollup.total - rollup.byClass.ANSWERED,
      byStatus
    };
  }

  function snapshot(state) {
    if (!state) return null;
    const mos = Array.from(state.moEngine.mos.values());
    const byStatus = {};
    // Per-case status as well as the tally. A net delta per status cannot
    // say which cases moved, and "which cases" is what the examination cut
    // below needs -- two cases swapping statuses net to zero.
    const statusById = {};
    mos.forEach(m => {
      byStatus[m.status] = (byStatus[m.status] || 0) + 1;
      statusById[m.id] = m.status;
    });
    return {
      simAbsoluteNow: FWSimRunner.absoluteNow(state.clock),
      totalEvents: state.totalEvents,
      totalMos: mos.length,
      byStatus,
      statusById
    };
  }

  function diff(before, after, state) {
    if (!before || !after) return null;
    const simSecondsElapsed = after.simAbsoluteNow - before.simAbsoluteNow;
    const eventsSinceThen = after.totalEvents - before.totalEvents;
    const newMosSinceThen = after.totalMos - before.totalMos;

    const mos = Array.from(state.moEngine.mos.values());
    const newCases = newCaseScope(mos, before.simAbsoluteNow, newMosSinceThen);
    const newlyCreated = newCases.cases;
    const newByClassification = newlyCreated.reduce((acc, m) => {
      acc[m.classification] = (acc[m.classification] || 0) + 1;
      return acc;
    }, {});

    // Exposure band attached to cases opened while away. Bands are summed,
    // which widens the range -- correct, because the uncertainty compounds
    // rather than averaging out.
    let newExposure = { attached: false, low: null, high: null, label: 'no consignments attached', cases: 0 };
    if (window.FWExposureModel) {
      let low = 0, high = 0, n = 0;
      newlyCreated.forEach(m => {
        const ex = FWExposureModel.exposureForMo(state, m);
        if (ex.attached) { low += ex.low; high += ex.high; n += 1; }
      });
      if (n) {
        newExposure = {
          attached: true, low, high, cases: n,
          label: FWExposureModel.fmt(low) + ' – ' + FWExposureModel.fmt(high)
        };
      }
    }

    const statusDeltas = {};
    const allStatuses = new Set([...Object.keys(before.byStatus), ...Object.keys(after.byStatus)]);
    allStatuses.forEach(s => {
      const d = (after.byStatus[s] || 0) - (before.byStatus[s] || 0);
      if (d !== 0) statusDeltas[s] = d;
    });

    return {
      shiftMix: shiftMix(before.simAbsoluteNow, after.simAbsoluteNow),
      siteSources: siteSources(state, newlyCreated),
      newCaseScope: {
        opened: newCases.opened,
        signalInWindow: newCases.signalInWindow,
        signalPredatesWindow: newCases.signalPredatesWindow
      },
      closures: closuresInWindow(state, before),
      simSecondsElapsed,
      simDaysElapsed: simSecondsElapsed / 86400,
      eventsSinceThen,
      newMosSinceThen,
      newByClassification,
      newExposure,
      statusDeltas,
      hasContent: simSecondsElapsed > 0 && (eventsSinceThen > 0 || newMosSinceThen > 0 || Object.keys(statusDeltas).length > 0)
    };
  }

  return {
    snapshot, diff, shiftMix, siteSources, newCaseScope, closuresInWindow,
    THIN_COVERAGE, NOT_MODELLED
  };
})();
