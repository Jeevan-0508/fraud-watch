/* ui/away-report.js — owns the snapshot/show lifecycle for "while you
   were away" (Phase 9). Two triggers, both real: the browser tab going
   background/foreground (document visibilitychange), and switching the
   Classic Watch / Port Meridian / Live Sim world-tab away from and back
   to 'sim'. The simulation clock/loop never stops for either -- this
   just surfaces what happened while nobody was looking at it. */
const FWAwayReport = (() => {
  let els = {};
  let lastSnapshot = null;
  const MIN_SIM_SECONDS_TO_SHOW = 60; // ignore flickers/instant tab switches

  function init() {
    els = {
      modal: document.getElementById('away-report-modal'),
      backdrop: document.getElementById('away-report-backdrop'),
      body: document.getElementById('away-report-body'),
      close: document.getElementById('away-report-close'),
      close2: document.getElementById('away-report-close-2')
    };
    if (els.close) els.close.addEventListener('click', hide);
    if (els.close2) els.close2.addEventListener('click', hide);
    if (els.backdrop) els.backdrop.addEventListener('click', hide);

    document.addEventListener('visibilitychange', () => {
      const state = FWSimRunner.getState();
      if (!state) return;
      if (document.hidden) {
        markLeft(state);
      } else {
        checkAndShow(state);
      }
    });
  }

  function markLeft(state) {
    lastSnapshot = FWAwayReportEngine.snapshot(state);
  }

  function checkAndShow(state) {
    if (!state) return;
    if (!lastSnapshot) { markLeft(state); return; } // first view this session, nothing to diff against yet
    const after = FWAwayReportEngine.snapshot(state);
    const report = FWAwayReportEngine.diff(lastSnapshot, after, state);
    lastSnapshot = after;
    if (!report || report.simSecondsElapsed < MIN_SIM_SECONDS_TO_SHOW || !report.hasContent) return;
    show(report);
  }

  function classificationLabel(cls) {
    const map = { KNOWN_MO: 'known MO', MO_VARIANT: 'new variant', POTENTIAL_NEW_MO: 'potential new MO', EMERGING_BEHAVIOR: 'emerging behavior' };
    return map[cls] || cls;
  }

  function fmtDuration(simSeconds) {
    const days = Math.floor(simSeconds / 86400);
    const hours = Math.floor((simSeconds % 86400) / 3600);
    const mins = Math.floor((simSeconds % 3600) / 60);
    const parts = [];
    if (days) parts.push(`${days}d`);
    if (hours) parts.push(`${hours}h`);
    if (!days && mins) parts.push(`${mins}m`);
    return parts.length ? parts.join(' ') : '<1m';
  }

  function render(report) {
    const classRows = Object.entries(report.newByClassification)
      .map(([cls, n]) => `<li>${n} ${classificationLabel(cls)}</li>`).join('');
    const statusRows = Object.entries(report.statusDeltas)
      .map(([status, delta]) => `<li>${status.replace(/_/g, ' ')}: ${delta > 0 ? '+' : ''}${delta}</li>`).join('');

    return `
      <div class="text-2xl font-orbitron text-white mb-1">Simulation advanced ${fmtDuration(report.simSecondsElapsed)}</div>
      <div class="text-xs text-slate-400 mb-4">while this tab wasn't the active view</div>
      <div class="grid grid-cols-2 gap-3 text-xs mb-4">
        <div class="bg-[#0e1520] border border-slate-800 rounded-lg p-2">
          <div class="text-slate-500 uppercase text-[10px] mb-0.5">Events</div>
          <div class="text-white text-lg font-semibold">${report.eventsSinceThen}</div>
        </div>
        <div class="bg-[#0e1520] border border-slate-800 rounded-lg p-2">
          <div class="text-slate-500 uppercase text-[10px] mb-0.5">New cases</div>
          <div class="text-white text-lg font-semibold">${report.newMosSinceThen}</div>
        </div>
      </div>
      ${classRows ? `<div class="mb-3"><div class="text-[10px] font-semibold text-slate-400 uppercase mb-1">New cases by discovery classification</div><ul class="list-disc list-inside text-xs text-slate-300 space-y-0.5">${classRows}</ul></div>` : ''}
      ${statusRows ? `<div class="mb-3"><div class="text-[10px] font-semibold text-slate-400 uppercase mb-1">Case status movement</div><ul class="list-disc list-inside text-xs text-slate-300 space-y-0.5">${statusRows}</ul></div>` : ''}
      <p class="text-[10px] text-slate-600 italic">No exposure/loss estimate shown -- that model doesn't exist in this simulation yet, so this deliberately doesn't show a made-up euro figure. Open MO Intelligence Center to review what's new.</p>
    `;
  }

  function show(report) {
    if (!els.body || !els.modal) return;
    els.body.innerHTML = render(report);
    els.modal.classList.remove('hidden');
  }

  function hide() {
    if (els.modal) els.modal.classList.add('hidden');
  }

  // Called from main.js's world-tab switcher: leaving 'sim' marks the
  // point to diff from next time; arriving at 'sim' checks and shows.
  function onWorldTabLeftSim() {
    const state = FWSimRunner.getState();
    if (state) markLeft(state);
  }
  function onWorldTabEnteredSim() {
    const state = FWSimRunner.getState();
    if (state) checkAndShow(state);
  }

  return { init, onWorldTabLeftSim, onWorldTabEnteredSim, hide };
})();
