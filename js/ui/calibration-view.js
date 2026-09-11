/* ui/calibration-view.js — the analyst calibration mirror (Phases 30/58).
   Shows what happened to the cases you closed, checked against the
   simulation's own answer key.

   Three deliberate refusals, all enforced by outcomeEngine and restated
   here in the copy so the panel can't be misread:
     - Percentages are withheld until there are enough decided cases to
       mean anything. Under that, counts only.
     - A case with some signals explained and some not is AMBIGUOUS and is
       excluded from the rates, because neither verdict was unreasonable.
     - "Unexplained" never becomes "fraud", and the panel never tells the
       player they were right or wrong -- only whether the call leaned
       past what the record supported.
   No monetary or exposure figure appears here: no loss model exists in
   this codebase yet (Phase 50), so there is nothing honest to show. */
const FWCalibrationView = (() => {
  let els = {};

  function init() {
    els = {
      root: document.getElementById('calibration-root'),
      summary: document.getElementById('calibration-summary'),
      body: document.getElementById('calibration-body'),
      ledger: document.getElementById('calibration-ledger')
    };
  }

  function fmtEffort(seconds) {
    const h = Math.floor(seconds / 3600), m = Math.round((seconds % 3600) / 60);
    if (h && m) return `${h}h ${m}m`;
    if (h) return `${h}h`;
    return `${m}m`;
  }

  function fmtSimTime(absSeconds) {
    const day = Math.floor(absSeconds / 86400) + 1;
    const s = Math.floor(absSeconds % 86400);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return `Day ${day} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  function alignmentBadgeClass(alignment) {
    const map = {
      ALIGNED: 'bg-emerald-900 text-emerald-300',
      OVERCALLED: 'bg-orange-900 text-orange-300',
      UNDERCALLED: 'bg-amber-900 text-amber-300',
      AMBIGUOUS: 'bg-slate-800 text-slate-400',
      UNSCORABLE: 'bg-slate-800 text-slate-500',
      NOT_A_CLAIM: 'bg-slate-800 text-slate-500'
    };
    return map[alignment] || map.UNSCORABLE;
  }

  function alignmentLabel(alignment) {
    const map = {
      ALIGNED: 'in line with the record',
      OVERCALLED: 'went past the record',
      UNDERCALLED: 'stopped short of the record',
      AMBIGUOUS: 'record was mixed',
      UNSCORABLE: 'nothing to check against',
      NOT_A_CLAIM: 'process outcome, not scored'
    };
    return map[alignment] || alignment;
  }

  function tendencyLine(cal) {
    if (!cal.tendency) return '';
    const map = {
      BALANCED: 'Across the decided cases so far, over-calls and under-calls are even.',
      LEANS_OVERCALL: 'Across the decided cases so far, this analyst leans toward escalating cases the records already explained.',
      LEANS_UNDERCALL: 'Across the decided cases so far, this analyst leans toward clearing cases the records did not explain.'
    };
    return `<div class="text-[10px] text-slate-400 mb-2">${map[cal.tendency] || ''}</div>`;
  }

  function bar(label, count, total, colorClass) {
    const pct = total ? Math.round((count / total) * 100) : 0;
    return `<div class="mb-1">
      <div class="flex justify-between text-[10px] text-slate-400"><span>${label}</span><span>${count}${total ? ` · ${pct}%` : ''}</span></div>
      <div class="h-1.5 bg-slate-800 rounded"><div class="h-1.5 rounded ${colorClass}" style="width:${pct}%"></div></div>
    </div>`;
  }

  function renderBody(cal) {
    if (!cal.totalClosed) {
      return `<p class="text-slate-600 text-xs italic">No cases closed yet. Close one as Confirm Fraud or Mark False Positive in the MO Intelligence Center and it will be checked against the simulation's record here.</p>`;
    }

    const head = `<div class="text-[10px] text-slate-400 mb-2">
      ${cal.totalClosed} case${cal.totalClosed === 1 ? '' : 's'} closed · ${cal.scoredCount} made a claim that could be checked · ${cal.decisiveCount} had an unmixed record
      ${cal.totalEffortSeconds ? ` · ${fmtEffort(cal.totalEffortSeconds)} of investigative effort behind them` : ' · no investigative effort behind them'}
    </div>`;

    if (!cal.rates) {
      return head + `<div class="text-[10px] text-slate-400 mb-2">
        In line with the record: ${cal.counts.ALIGNED} · went past it: ${cal.counts.OVERCALLED} · stopped short: ${cal.counts.UNDERCALLED} · mixed record: ${cal.counts.AMBIGUOUS}
      </div>
      <div class="text-[10px] text-slate-500 italic">Percentages are withheld until ${cal.minSample} cases with an unmixed record have been decided — below that a rate would be noise dressed up as a measurement.</div>`;
    }

    const t = cal.decisiveCount;
    return head + tendencyLine(cal) +
      bar('In line with the record', cal.counts.ALIGNED, t, 'bg-emerald-500') +
      bar('Went past the record (escalated something explained)', cal.counts.OVERCALLED, t, 'bg-orange-500') +
      bar('Stopped short of the record (cleared something unexplained)', cal.counts.UNDERCALLED, t, 'bg-amber-500') +
      `<div class="text-[10px] text-slate-400 mt-2">Excluded from the rates above: ${cal.counts.AMBIGUOUS} case${cal.counts.AMBIGUOUS === 1 ? '' : 's'} whose record was mixed.</div>` +
      `<div class="text-[10px] ${cal.blindCount ? 'text-orange-300' : 'text-slate-400'} mt-1">${cal.blindCount} of ${cal.scoredCount} closed without checking a single record source first.</div>`;
  }

  function renderLedger(engine) {
    const rows = engine.ledger.slice().sort((a, b) => b.at - a.at).slice(0, 15).map(e => `
      <div class="bg-[#0e1520] border border-slate-800 rounded-lg p-2">
        <div class="flex items-center justify-between gap-2 flex-wrap mb-1">
          <span class="font-mono text-[11px] text-slate-300">${e.moId} · closed ${e.verdict.replace(/_/g, ' ')}</span>
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold ${alignmentBadgeClass(e.alignment)}">${alignmentLabel(e.alignment)}</span>
            <span class="text-[10px] text-slate-500">${fmtSimTime(e.at)}</span>
          </div>
        </div>
        <div class="text-[10px] text-slate-400">${e.narrative}</div>
        <div class="text-[10px] text-slate-500 mt-1">Confidence at close ${Math.round(e.confidenceAtClose)}% · ${e.checksRun} record check${e.checksRun === 1 ? '' : 's'} run${e.effortSeconds ? ` · ${fmtEffort(e.effortSeconds)} effort` : ''}</div>
      </div>`).join('');
    return rows || '';
  }

  function render(state) {
    if (!state || !els.root || !state.outcomeEngine) return;
    if (els.root.classList && els.root.classList.contains('hidden')) return;
    const cal = FWOutcomeEngine.calibration(state.outcomeEngine);
    if (els.summary) {
      els.summary.textContent = cal.totalClosed
        ? `${cal.totalClosed} closed · ${cal.decisiveCount} with an unmixed record`
        : 'nothing closed yet';
    }
    if (els.body) els.body.innerHTML = renderBody(cal);
    if (els.ledger) els.ledger.innerHTML = renderLedger(state.outcomeEngine);
  }

  return { init, render };
})();
