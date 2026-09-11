/* simulation/awayReport.js — pure counting logic behind the "while you
   were away" report (mega-spec Phase 9). No DOM here; js/ui/away-report.js
   owns when to snapshot/show and how to render it.

   Deliberately honest about what it does NOT know yet: there is no
   exposure/loss model in this codebase (mega-spec Phase 50), so this
   never invents a euro figure. It reports real counters only --
   events, new cases, and where existing cases moved to -- and says so
   explicitly rather than showing a fabricated "estimated exposure"
   line. */
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
      statusDeltas,
      hasContent: simSecondsElapsed > 0 && (eventsSinceThen > 0 || newMosSinceThen > 0 || Object.keys(statusDeltas).length > 0)
    };
  }

  return { snapshot, diff };
})();
