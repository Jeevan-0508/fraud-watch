/* ui/facility-view.js — Phase 5's analyst-facing half: per-site records,
   and the observation bias that makes them dangerous to read.

   This panel exists to make one mistake hard to make. Sorted by recorded
   disruptions, the top of the list is the best-watched site in the port,
   because watching produces records. So the raw ordering and the
   coverage-adjusted ordering are shown side by side, disagreements are
   called out, and a refused card sits at the same visual weight as the
   table saying that neither ordering is a risk ranking and that the
   adjustment cannot correct the bias it illustrates. */
const FWFacilityView = (() => {
  let els = {};
  let assumptionsOpen = false;
  let mode = 'raw'; // raw | adjusted

  const KIND_TINT = {
    GATEHOUSE: { text: 'text-emerald-300', bar: 'bg-emerald-500', dot: 'bg-emerald-400' },
    CROSS_DOCK: { text: 'text-sky-300', bar: 'bg-sky-500', dot: 'bg-sky-400' },
    YARD: { text: 'text-amber-300', bar: 'bg-amber-500', dot: 'bg-amber-400' },
    REMOTE_DEPOT: { text: 'text-rose-300', bar: 'bg-rose-500', dot: 'bg-rose-400' }
  };

  function tint(kind) { return KIND_TINT[kind] || KIND_TINT.YARD; }
  function pretty(type) { return type ? type.replace(/_/g, ' ').toLowerCase() : ''; }
  function pct(x) { return Math.round(x * 100) + '%'; }

  function init() {
    els = {
      root: document.getElementById('facility-view-root'),
      summary: document.getElementById('facility-summary'),
      table: document.getElementById('facility-table'),
      refused: document.getElementById('facility-refused'),
      modeBtn: document.getElementById('facility-mode-btn'),
      bias: document.getElementById('facility-bias'),
      assumptionsBtn: document.getElementById('facility-assumptions-btn'),
      assumptions: document.getElementById('facility-assumptions')
    };
    if (els.modeBtn) {
      els.modeBtn.addEventListener('click', () => {
        mode = mode === 'raw' ? 'adjusted' : 'raw';
        const state = window.FWSimRunner && FWSimRunner.getState();
        if (state) render(state);
      });
    }
    if (els.assumptionsBtn) {
      els.assumptionsBtn.addEventListener('click', () => {
        assumptionsOpen = !assumptionsOpen;
        renderAssumptions();
      });
    }
    renderAssumptions();
    renderRefused();
  }

  function renderAssumptions() {
    if (!els.assumptions || !els.assumptionsBtn) return;
    els.assumptionsBtn.textContent = assumptionsOpen ? 'Hide coverage model assumptions' : 'Show coverage model assumptions';
    if (!assumptionsOpen) {
      els.assumptions.classList.add('hidden');
      els.assumptions.innerHTML = '';
      return;
    }
    els.assumptions.classList.remove('hidden');
    const items = FWFacilityEngine.ASSUMPTIONS.map(a => `<li>${a}</li>`).join('');
    els.assumptions.innerHTML =
      `<ul class="list-disc list-inside space-y-1 text-[10px] text-slate-400">${items}</ul>`;
  }

  // Same treatment as exposureModel's refused register: reasons, in
  // words, at the same weight as the numbers. Not a footnote.
  function renderRefused() {
    if (!els.refused) return;
    const items = FWFacilityEngine.NOT_MODELLED.map(n => `
      <div class="mb-2 pb-2 border-b border-slate-800 last:border-0 last:pb-0 last:mb-0">
        <div class="text-[11px] text-rose-300">${n.figure}</div>
        <div class="text-[10px] text-slate-400 mt-0.5">${n.why}</div>
      </div>`).join('');
    els.refused.innerHTML = `
      <div class="text-[10px] uppercase tracking-wide text-rose-400/80 mb-1.5">Not modelled here</div>
      ${items}`;
  }

  function renderBias(summary) {
    if (!els.bias) return;
    if (!summary.anyRecords) {
      els.bias.innerHTML = '<p class="text-[10px] text-slate-500">No disruption has been recorded at any site yet. That is an absence of records, which is not the same as an absence of events.</p>';
      return;
    }
    const topRaw = summary.byRaw[0];
    const topAdj = summary.byAdjusted[0];
    const moved = summary.rows.filter(r => r.rankMoved).length;
    const disagreeLine = summary.orderingsDisagree
      ? `The two orderings disagree: ${moved} of ${summary.rows.length} sites change position, and the site at the top changes from <span class="text-slate-300">${topRaw.name}</span> (most records) to <span class="text-slate-300">${topAdj.name}</span> (most records once its assumed coverage is divided out).`
      : 'The two orderings currently agree. With this little data that is coincidence, not corroboration — it will come apart as records accumulate.';
    els.bias.innerHTML = `
      <div class="text-[10px] uppercase tracking-wide text-slate-500 mb-1.5">Observation bias</div>
      <p class="text-[10px] text-slate-400 mb-1.5">${disagreeLine}</p>
      <p class="text-[10px] text-amber-300/80">Recording is work. A site that reconciles every movement produces records; a site that reconciles nothing produces silence. Ranked by raw count, the best-run site in this port floats to the top of the list.</p>
      <p class="text-[10px] text-slate-500 mt-1.5">${summary.unsited.recorded} disruption${summary.unsited.recorded === 1 ? ' was' : 's were'} recorded on the public road, attributable to no site${summary.unsited.topType ? ` (most often ${pretty(summary.unsited.topType)}, ${summary.unsited.topTypeCount}×)` : ''}. Those are reported here rather than charged to whichever site the vehicle last touched.</p>`;
  }

  function renderTable(state) {
    if (!els.table) return;
    const summary = FWFacilityEngine.siteSummary(state.registry, state.facilityTracker);
    const rows = mode === 'adjusted' ? summary.byAdjusted : summary.byRaw;
    const key = mode === 'adjusted' ? 'coverageAdjusted' : 'recorded';
    const max = Math.max(1, ...rows.map(r => r[key] || 0));

    if (els.modeBtn) {
      els.modeBtn.textContent = mode === 'adjusted'
        ? 'Sorted by coverage-adjusted count — switch to raw records'
        : 'Sorted by raw records — switch to coverage-adjusted';
    }

    els.table.innerHTML = rows.map(r => {
      const t = tint(r.kind);
      const val = r[key] || 0;
      const w = Math.round((val / max) * 100);
      return `<div class="bg-[#0e1520] border border-slate-800 rounded-lg p-2 mb-1.5 cursor-pointer hover:border-slate-700" data-facility-id="${r.facilityId}" title="Open this site in the inspector">
        <div class="flex items-center justify-between mb-1">
          <span class="flex items-center gap-1.5 text-[11px] ${t.text}">
            <span class="w-2 h-2 rounded-full ${t.dot}"></span>${r.name}
            <span class="text-slate-600 text-[10px]">${r.kindLabel}</span>
          </span>
          <span class="font-mono text-[11px] text-slate-300">${r.recorded} recorded</span>
        </div>
        <div class="h-1.5 rounded bg-slate-800 overflow-hidden mb-1"><div class="h-full ${t.bar}" style="width:${w}%"></div></div>
        <div class="text-[10px] text-slate-500">
          assumed coverage ${pct(r.meanCoverage)} (site factor ${r.oversightFactor.toFixed(2)}× the shift's) ·
          grossed up by that coverage: ${r.coverageAdjusted != null ? r.coverageAdjusted : 'n/a'}
        </div>
        <div class="text-[10px] text-slate-500">rank by records #${r.rawRank} · rank once grossed up #${r.adjustedRank}${r.rankMoved ? ' <span class="text-amber-300/80">(moves)</span>' : ''}</div>
        <div class="text-[10px] text-slate-600 mt-0.5">${r.topType ? `most recorded here: ${pretty(r.topType)} (${r.topTypeCount}×)` : 'nothing recorded here yet'}</div>
        <div class="text-[10px] text-slate-600 mt-0.5">${r.rationale}</div>
      </div>`;
    }).join('');

    renderBias(summary);
    if (els.summary) {
      els.summary.textContent = `${summary.totalRecorded} disruption${summary.totalRecorded === 1 ? '' : 's'} recorded across ${summary.rows.length} sites · click a site for its full record`;
    }
  }

  function render(state) {
    if (!state || !els.root || !state.registry) return;
    if (!window.FWFacilityEngine) return;
    renderTable(state);
  }

  return { init, render, tint };
})();
