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

  function snapshot(state) {
    if (!state) return null;
    const mos = Array.from(state.moEngine.mos.values());
    const byStatus = {};
    mos.forEach(m => { byStatus[m.status] = (byStatus[m.status] || 0) + 1; });
    return {
      simAbsoluteNow: FWSimRunner.absoluteNow(state.clock),
      totalEvents: state.totalEvents,
      totalMos: mos.length,
      byStatus
    };
  }

  function diff(before, after, state) {
    if (!before || !after) return null;
    const simSecondsElapsed = after.simAbsoluteNow - before.simAbsoluteNow;
    const eventsSinceThen = after.totalEvents - before.totalEvents;
    const newMosSinceThen = after.totalMos - before.totalMos;

    const mos = Array.from(state.moEngine.mos.values());
    const newlyCreated = mos.filter(m => m.firstObserved > before.simAbsoluteNow);
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

  return { snapshot, diff, shiftMix, siteSources, THIN_COVERAGE };
})();
