/* simulation/awayReport.js — pure counting logic behind the "while you
   were away" report (mega-spec Phase 9). No DOM here; js/ui/away-report.js
   owns when to snapshot/show and how to render it.

   Since Phase 50 there IS a cost/exposure model (exposureModel.js), so
   this reports the exposure band newly attached to cases opened while you
   were away. That is a band and it is what was at stake -- not a loss,
   not an expected loss. Loss and loss-avoided figures stay refused for
   the reasons exposureModel.NOT_MODELLED gives, so this report still
   never shows an "estimated exposure" line. */
const FWAwayReportEngine = (() => {
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

  return { snapshot, diff };
})();
