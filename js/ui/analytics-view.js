/* ui/analytics-view.js — Phase 58's analyst-facing half.

   The design constraint, and it is the only one that matters here: on a
   dashboard, a percentage inherits authority from its typography. Six
   figures in six identical tiles read as six comparable measurements
   whatever the caption says. So this panel never renders a value alone.
   Every tile carries, at the same size as the label:

     - the counts the figure came from (n / N), on rates
     - what N actually counts, in words
     - for a coverage figure, that it is not a rate at all

   A group whose percentages are taken over more than one base says so on
   the group, not in a footnote. And the discovery group ends where a
   trend chart would obviously sit, with the reason there is no chart
   there rendered at full weight instead. */
const FWAnalyticsView = (() => {
  let els = {};
  let assumptionsOpen = false;
  let openGroup = null; // which group's per-metric detail is expanded

  const KIND_TINT = {
    COUNT: { value: 'text-slate-200', chip: 'text-slate-500', chipLabel: 'count' },
    RATE: { value: 'text-sky-300', chip: 'text-sky-500/70', chipLabel: 'rate' },
    PARAMETER: { value: 'text-amber-300', chip: 'text-amber-500/70', chipLabel: 'assumption' }
  };

  function tint(kind) { return KIND_TINT[kind] || KIND_TINT.COUNT; }

  function init() {
    els = {
      root: document.getElementById('analytics-root'),
      summary: document.getElementById('analytics-summary'),
      groups: document.getElementById('analytics-groups'),
      refused: document.getElementById('analytics-refused'),
      basesBtn: document.getElementById('analytics-bases-btn'),
      assumptionsBtn: document.getElementById('analytics-assumptions-btn'),
      assumptions: document.getElementById('analytics-assumptions')
    };
    if (els.assumptionsBtn) {
      els.assumptionsBtn.addEventListener('click', () => {
        assumptionsOpen = !assumptionsOpen;
        renderAssumptions();
      });
    }
    if (els.groups) {
      els.groups.addEventListener('click', (ev) => {
        const head = ev.target && ev.target.closest ? ev.target.closest('[data-analytics-group]') : null;
        if (!head) return;
        const id = head.dataset.analyticsGroup;
        openGroup = openGroup === id ? null : id;
        const state = window.FWSimRunner && FWSimRunner.getState();
        if (state) render(state);
      });
    }
    renderAssumptions();
    renderRefused();
  }

  function renderAssumptions() {
    if (!els.assumptions || !els.assumptionsBtn) return;
    els.assumptionsBtn.textContent = assumptionsOpen
      ? 'Hide how these figures are counted'
      : 'Show how these figures are counted';
    if (!assumptionsOpen) {
      els.assumptions.classList.add('hidden');
      els.assumptions.innerHTML = '';
      return;
    }
    els.assumptions.classList.remove('hidden');
    const items = FWAnalyticsEngine.ASSUMPTIONS.map(a => `<li>${a}</li>`).join('');
    els.assumptions.innerHTML =
      `<ul class="list-disc list-inside space-y-1 text-[10px] text-slate-400">${items}</ul>`;
  }

  // Same register treatment as the exposure and site panels: reasons in
  // words, at the weight of the numbers.
  function renderRefused() {
    if (!els.refused) return;
    const items = FWAnalyticsEngine.NOT_MODELLED.map(n => `
      <div class="mb-2 pb-2 border-b border-slate-800 last:border-0 last:pb-0 last:mb-0">
        <div class="text-[11px] text-rose-300">${n.figure}</div>
        <div class="text-[10px] text-slate-400 mt-0.5">${n.why}</div>
      </div>`).join('');
    els.refused.innerHTML = `
      <div class="text-[10px] uppercase tracking-wide text-rose-400/80 mb-1.5">Not shown here, and why</div>
      ${items}`;
  }

  function metricTile(m, expanded) {
    const t = tint(m.kind);
    const value = m.withheld
      ? `<span class="font-mono text-[15px] ${t.value}">${m.ratioLabel}</span>`
      : `<span class="font-mono text-[15px] ${t.value}">${m.valueLabel}</span>`;
    // On a rate that IS shown as a percentage, the counts stay visible
    // beside it. This is the line that stops the panel laundering a
    // 2-of-3 into a confident 67%.
    const counts = m.kind === 'RATE' && !m.withheld
      ? `<span class="font-mono text-[10px] text-slate-400 ml-1.5">${m.ratioLabel}</span>` : '';
    const basis = m.kind === 'PARAMETER'
      ? `<div class="text-[10px] text-amber-300/70 mt-0.5">Not a rate: ${m.of}.</div>`
      : `<div class="text-[10px] text-slate-500 mt-0.5">${m.kind === 'RATE' ? m.basisLabel : m.of}</div>`;
    const withheld = m.withheld
      ? `<div class="text-[10px] text-slate-400 mt-0.5">${m.withheldReason}</div>` : '';
    const note = m.note && expanded
      ? `<div class="text-[10px] text-slate-500 mt-1 pt-1 border-t border-slate-800">${m.note}</div>` : '';
    return `<div class="bg-[#0e1520] border border-slate-800 rounded-lg p-2">
      <div class="flex items-baseline justify-between gap-2">
        <span class="text-[11px] text-slate-300">${m.label}</span>
        <span class="text-[9px] uppercase tracking-wide ${t.chip}">${t.chipLabel}</span>
      </div>
      <div class="mt-0.5">${value}${counts}</div>
      ${basis}${withheld}${note}
    </div>`;
  }

  function groupBlock(g) {
    const expanded = openGroup === g.id;
    const tiles = g.metrics.map(m => metricTile(m, expanded)).join('');
    const basesLine = g.denominators.shared
      ? (g.denominators.bases.length === 1
        ? `<div class="text-[10px] text-slate-500 mt-1.5">All percentages in this group are over the same base: ${g.denominators.bases[0]}.</div>`
        : '')
      : `<div class="text-[10px] text-amber-300/80 mt-1.5">${g.denominators.note}</div>`;
    const trendRefusal = g.id === 'discovery'
      ? `<div class="mt-2 bg-[#0e1520] border border-rose-900/40 rounded-lg p-2">
           <div class="text-[10px] uppercase tracking-wide text-rose-400/80 mb-1">Where the discovery-rate chart would be</div>
           <div class="text-[10px] text-slate-400">${FWAnalyticsEngine.NOT_MODELLED[0].why}</div>
         </div>`
      : '';
    return `<div class="mb-3">
      <div class="flex items-center justify-between gap-2 cursor-pointer" data-analytics-group="${g.id}">
        <h4 class="text-[11px] font-semibold text-slate-300 uppercase tracking-wide">${g.title}</h4>
        <span class="text-[10px] text-sky-400">${expanded ? 'hide notes' : 'show notes'}</span>
      </div>
      <p class="text-[10px] text-slate-500 mt-1 mb-1.5">${g.blurb}</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-1.5">${tiles}</div>
      ${basesLine}${trendRefusal}
    </div>`;
  }

  function render(state) {
    if (!state || !els.root) return;
    if (!window.FWAnalyticsEngine) return;
    const dash = FWAnalyticsEngine.dashboard(state);
    if (!dash) return;
    if (els.groups) {
      els.groups.innerHTML = dash.groups.map(groupBlock).join('');
    }
    if (els.summary) {
      els.summary.textContent =
        `${dash.totalMetrics} figures · ${dash.rateCount} of them rates, over ${dash.distinctBases} different base` +
        `${dash.distinctBases === 1 ? '' : 's'} · ${dash.withheldCount} held back as counts below a sample of ${dash.minSample}`;
    }
    if (els.basesBtn) {
      els.basesBtn.textContent = dash.distinctBases > 1
        ? `The ${dash.rateCount} percentages on this panel are taken over ${dash.distinctBases} different bases — they are not comparable with one another`
        : `Every percentage on this panel is taken over the same base`;
    }
  }

  return { init, render };
})();
