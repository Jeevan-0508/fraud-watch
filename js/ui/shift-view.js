/* ui/shift-view.js — Phase 37's analyst-facing half: what the shift model
   is doing, stated openly.

   The load-bearing sentence in this panel is the caveat. Per-shift
   disruption counts are the single easiest chart in this whole project to
   misread: night is quiet, therefore night is safe. It isn't -- night is
   quiet partly because fewer things move and partly because far less of
   what happens gets recorded. So the observed count is always shown
   beside the modelled coverage that produced it, never alone.

   Slice 29 gave this panel the two things its sibling site panel has had
   since Phase 5 and it did not: a refused register rendered at the same
   weight as the counts (the caveat sentence was carrying that whole load
   alone), and a scope label on its headline total. The site panel counts
   the same recorded disruptions and cuts them by site, accounting only for
   the ones that happened at a site; this one cuts the whole population by
   shift, road records included. Both headlines now say which. */
const FWShiftView = (() => {
  let els = {};
  let assumptionsOpen = false;

  const TINT = {
    night:   { dot: 'bg-indigo-400',  text: 'text-indigo-300',  bar: 'bg-indigo-500' },
    morning: { dot: 'bg-sky-400',     text: 'text-sky-300',     bar: 'bg-sky-500' },
    peak:    { dot: 'bg-amber-400',   text: 'text-amber-300',   bar: 'bg-amber-500' },
    evening: { dot: 'bg-orange-400',  text: 'text-orange-300',  bar: 'bg-orange-500' }
  };

  function tint(shift) { return TINT[shift] || TINT.morning; }

  function init() {
    els = {
      root: document.getElementById('shift-view-root'),
      refused: document.getElementById('shift-refused'),
      summary: document.getElementById('shift-summary'),
      current: document.getElementById('shift-current'),
      table: document.getElementById('shift-table'),
      assumptionsBtn: document.getElementById('shift-assumptions-btn'),
      assumptions: document.getElementById('shift-assumptions')
    };
    if (els.assumptionsBtn) {
      els.assumptionsBtn.addEventListener('click', () => {
        assumptionsOpen = !assumptionsOpen;
        renderAssumptions();
      });
    }
    renderAssumptions();
    renderRefused();
  }

  // The site panel's treatment, applied here: reasons in words, in a card,
  // not a footnote.
  function renderRefused() {
    if (!els.refused) return;
    const items = FWShiftEngine.NOT_MODELLED.map(n => `
      <div class="mb-2 pb-2 border-b border-slate-800 last:border-0 last:pb-0 last:mb-0">
        <div class="text-[11px] text-rose-300">${n.figure}</div>
        <div class="text-[10px] text-slate-400 mt-0.5">${n.why}</div>
      </div>`).join('');
    els.refused.innerHTML = `
      <div class="text-[10px] uppercase tracking-wide text-rose-400/80 mb-1.5">Not modelled here</div>
      ${items}`;
  }

  function renderAssumptions() {
    if (!els.assumptions || !els.assumptionsBtn) return;
    els.assumptionsBtn.textContent = assumptionsOpen ? 'Hide model assumptions' : 'Show model assumptions';
    if (!assumptionsOpen) {
      els.assumptions.classList.add('hidden');
      els.assumptions.innerHTML = '';
      return;
    }
    els.assumptions.classList.remove('hidden');
    const items = FWShiftEngine.ASSUMPTIONS.map(a => `<li>${a}</li>`).join('');
    els.assumptions.innerHTML =
      `<ul class="list-disc list-inside space-y-1 text-[10px] text-slate-400">${items}</ul>`;
  }

  function bar(label, value, max, cls) {
    const pct = Math.max(0, Math.min(100, Math.round((value / max) * 100)));
    return `<div class="mb-1.5">
      <div class="flex items-center justify-between text-[10px] text-slate-500 mb-0.5">
        <span>${label}</span><span class="text-slate-300 font-mono">${value.toFixed(2)}×</span>
      </div>
      <div class="h-1.5 rounded bg-slate-800 overflow-hidden"><div class="h-full ${cls}" style="width:${pct}%"></div></div>
    </div>`;
  }

  function renderCurrent(state) {
    if (!els.current) return;
    const shift = state.clock.shift();
    const p = FWShiftEngine.profile(shift);
    const t = tint(shift);
    els.current.innerHTML = `
      <div class="flex items-center gap-2 mb-1">
        <span class="w-2.5 h-2.5 rounded-full ${t.dot}"></span>
        <span class="font-orbitron text-sm ${t.text}">${p.label} shift</span>
        <span class="text-[10px] text-slate-500 font-mono">${p.window}</span>
      </div>
      <div class="text-[10px] text-slate-500 mb-2">Day ${state.clock.day} · ${state.clock.timeOfDay()}</div>
      ${bar('Traffic throughput', p.throughput, 1.5, t.bar)}
      ${bar('Oversight coverage', p.oversight, 1, 'bg-emerald-500')}
      <p class="text-[10px] text-slate-500 mt-1">${FWShiftEngine.OVERSIGHT_RATIONALE[shift] || ''}</p>
      <p class="text-[10px] text-amber-300/80 mt-2">Modelled: about ${Math.round((1 - p.oversight) * 100)}% of disruptions occurring in this shift are never recorded at all — they still happen.</p>
      <p class="text-[10px] text-slate-500 mt-1.5">Both bars above shape this shift's count and they pull opposite ways: throughput decides how much moves, coverage decides how much of what happens gets written down. A count carrying both cannot be read as either.</p>`;
  }

  function renderTable(state) {
    if (!els.table) return;
    const rows = FWShiftEngine.summary(state.shiftTracker);
    const maxObserved = Math.max(1, ...rows.map(r => r.observed));
    const current = state.clock.shift();
    els.table.innerHTML = rows.map(r => {
      const t = tint(r.shift);
      const w = Math.round((r.observed / maxObserved) * 100);
      const isNow = r.shift === current;
      return `<div class="bg-[#0e1520] border ${isNow ? 'border-slate-600' : 'border-slate-800'} rounded-lg p-2 mb-1.5">
        <div class="flex items-center justify-between mb-1">
          <span class="flex items-center gap-1.5 text-[11px] ${t.text}">
            <span class="w-2 h-2 rounded-full ${t.dot}"></span>${r.label}
            <span class="text-slate-600 font-mono text-[10px]">${r.window}</span>
            ${isNow ? '<span class="text-[9px] uppercase tracking-wide text-slate-500">now</span>' : ''}
          </span>
          <span class="font-mono text-[11px] text-slate-300">${r.observed} recorded</span>
        </div>
        <div class="h-1.5 rounded bg-slate-800 overflow-hidden mb-1"><div class="h-full ${t.bar}" style="width:${w}%"></div></div>
        <div class="text-[10px] text-slate-500">
          coverage ${Math.round(r.oversight * 100)}% · throughput ${r.throughput.toFixed(2)}× · modelled unrecorded ~${r.modelledMissRate}%
        </div>
        <div class="text-[10px] text-slate-500">${r.topType
          ? `most recorded here: ${r.topType.replace(/_/g, ' ').toLowerCase()} (${r.topTypeCount}×)`
          : 'nothing recorded here yet'}</div>
      </div>`;
    }).join('');
  }

  function render(state) {
    if (!state || !els.root || !state.clock) return;
    if (!window.FWShiftEngine) return;
    renderCurrent(state);
    renderTable(state);
    if (els.summary) {
      // Asserted to sum, and scope-labelled against the site panel, which
      // cuts this same population by site and leaves the road records out
      // of its table.
      const totals = FWShiftEngine.recordedTotals(state.shiftTracker);
      els.summary.textContent =
        `all ${totals.total} recorded disruption${totals.total === 1 ? '' : 's'} in this run, cut by shift · road records included`;
    }
  }

  return { init, render, tint };
})();
