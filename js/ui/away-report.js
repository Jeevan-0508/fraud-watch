/* ui/away-report.js — owns the snapshot/show lifecycle for "while you
   were away" (Phase 9). Two triggers, both real: the browser tab going
   background/foreground (document visibilitychange), and switching the
   Classic Watch / Port Meridian / Live Sim world-tab away from and back
   to 'sim'. The simulation clock/loop never stops for either -- this
   just surfaces what happened while nobody was looking at it.

   The counts here are counts of what was RECORDED while away, and since
   Slices 16-18 the simulation is explicit that recording varies by shift
   and by site. So the report shows the shifts the away window spanned with
   their stated oversight parameters, and how many of the new cases have no
   site record to pull at all. Neither adjusts a count -- they say what the
   count is a count of. */
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

  function fmtHours(seconds) {
    const h = seconds / 3600;
    if (h >= 10) return `${Math.round(h)}h`;
    if (h >= 1) return `${Math.round(h * 10) / 10}h`;
    return `${Math.max(1, Math.round(seconds / 60))}m`;
  }

  // Hours per shift with each shift's stated oversight parameter beside
  // them. No composite average: see awayReport.js's header for why that
  // figure is refused rather than merely omitted.
  function shiftMixBlock(mix) {
    if (!mix || !mix.rows || !mix.rows.length) return '';
    const rows = mix.rows.map(r => `<li>${r.label} (${r.window}): ${fmtHours(r.seconds)} — stated oversight ${Math.round(r.oversight * 100)}%, throughput \u00d7${r.throughput}</li>`).join('');
    return `<div class="mb-3">
      <div class="text-[10px] font-semibold text-slate-400 uppercase mb-1">Which watch this window ran through</div>
      <ul class="list-disc list-inside text-xs text-slate-300 space-y-0.5">${rows}</ul>
      ${mix.truncated ? '<div class="text-[10px] text-slate-500 italic mt-1">Window longer than this breakdown covers; the hours above account for only part of it.</div>' : ''}
      <div class="text-[10px] text-slate-500 italic mt-1">Oversight is the stated chance an occurrence is recorded at all — a model parameter, not a measured rate. The event count above is therefore not comparable with another away period of the same length that ran through a different mix of watches. No average oversight figure is given for the window: it would read as "how much of this period was covered", and dividing the count by it returns the assumption, not what happened.</div>
    </div>`;
  }

  // Whether there is a site record to pull for the new cases at all. This is
  // the structural absence the NO_RECORD_EXISTS check outcome names, known
  // before any check is spent because it follows from where signals were seen.
  function siteSourceBlock(src) {
    if (!src || !src.cases) return '';
    const lines = [
      `<li>${src.sourceless} of ${src.cases} were observed entirely on the open road, so no site record exists to pull for them</li>`,
      `<li>${src.sited} of ${src.cases} touched at least one site that keeps records</li>`
    ];
    if (src.sited) {
      lines.push(`<li>${src.thin} of ${src.sited} sited case${src.thin === 1 ? '' : 's'} sit at sites whose assumed coverage is under ${src.thinThresholdPct}%, where a check is likelier to return "no such record" than an answer</li>`);
    }
    return `<div class="mb-3">
      <div class="text-[10px] font-semibold text-slate-400 uppercase mb-1">Record sources for the new cases</div>
      <ul class="list-disc list-inside text-xs text-slate-300 space-y-0.5">${lines.join('')}</ul>
      <div class="text-[10px] text-slate-500 italic mt-1">A missing record is a fact about this port's watching, not about the carrier: where coverage is thin, an absent record is what thin coverage produces, so it never counts toward a case.</div>
    </div>`;
  }

  function render(report) {
    const classRows = Object.entries(report.newByClassification)
      .map(([cls, n]) => `<li>${n} ${classificationLabel(cls)}</li>`).join('');
    const statusRows = Object.entries(report.statusDeltas)
      .map(([status, delta]) => `<li>${status.replace(/_/g, ' ')}: ${delta > 0 ? '+' : ''}${delta}</li>`).join('');

    const ex = report.newExposure;
    const exposureRow = (ex && ex.attached)
      ? `<div class="mb-3 bg-[#0e1520] border border-slate-800 rounded-lg p-2">
          <div class="text-[10px] font-semibold text-slate-400 uppercase mb-0.5">Exposure attached to the new cases</div>
          <div class="text-sky-300 font-mono text-sm">${ex.label}</div>
          <div class="text-[10px] text-slate-500">across ${ex.cases} of the new case${ex.cases === 1 ? '' : 's'} — the value of goods that were at stake, not a loss and not an estimate of one</div>
        </div>`
      : '';

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
      ${shiftMixBlock(report.shiftMix)}
      ${siteSourceBlock(report.siteSources)}
      ${statusRows ? `<div class="mb-3"><div class="text-[10px] font-semibold text-slate-400 uppercase mb-1">Case status movement</div><ul class="list-disc list-inside text-xs text-slate-300 space-y-0.5">${statusRows}</ul></div>` : ''}
      ${exposureRow}
      <p class="text-[10px] text-slate-600 italic">No loss or loss-avoided figure is shown. The cost model (Exposure &amp; Cost panel) refuses both: one needs a probability of loss this simulation does not have, the other needs a counterfactual nobody can observe. Open MO Intelligence Center to review what's new.</p>
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
