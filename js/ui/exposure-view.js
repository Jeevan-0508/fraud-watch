/* ui/exposure-view.js — Phase 50's analyst-facing half.

   Layout carries the argument: the three cards have equal weight, and one
   of them is a list of figures this model refuses to produce. That card is
   not a footnote or a tooltip, because the numbers that are absent are as
   much of the model as the numbers that are present.

   Two invariants enforced here:
     - money is never shown without the measured hour count and the stated
       rate that produced it, in the same block of text;
     - exposure is never shown without the words that say it is not a loss. */
const FWExposureView = (() => {
  let els = {};
  let assumptionsOpen = false;

  const ALIGNMENT_LABEL = {
    ALIGNED: 'Aligned with the record',
    OVERCALLED: 'Over-called against the record',
    UNDERCALLED: 'Under-called against the record',
    AMBIGUOUS: 'Ambiguous — not scored',
    UNSCORABLE: 'No answer key held',
    NOT_A_CLAIM: 'Process outcome — asserts nothing'
  };

  const ALIGNMENT_TONE = {
    ALIGNED: 'bg-emerald-500',
    OVERCALLED: 'bg-amber-500',
    UNDERCALLED: 'bg-rose-500',
    AMBIGUOUS: 'bg-slate-500',
    UNSCORABLE: 'bg-slate-600',
    NOT_A_CLAIM: 'bg-slate-600'
  };

  function init() {
    els = {
      root: document.getElementById('exposure-view-root'),
      summary: document.getElementById('exposure-summary'),
      process: document.getElementById('exposure-process'),
      exposure: document.getElementById('exposure-attached'),
      refused: document.getElementById('exposure-refused'),
      assumptionsBtn: document.getElementById('exposure-assumptions-btn'),
      assumptions: document.getElementById('exposure-assumptions')
    };
    if (els.assumptionsBtn) {
      els.assumptionsBtn.addEventListener('click', () => {
        assumptionsOpen = !assumptionsOpen;
        renderAssumptions();
      });
    }
    renderRefused();
    renderAssumptions();
  }

  function renderRefused() {
    if (!els.refused) return;
    const rows = FWExposureModel.NOT_MODELLED.map(n => `
      <div class="mb-2 pb-2 border-b border-slate-800 last:border-0">
        <div class="text-[11px] text-rose-300/90 mb-0.5">${n.figure}</div>
        <div class="text-[10px] text-slate-500 leading-snug">${n.why}</div>
      </div>`).join('');
    els.refused.innerHTML = `
      <div class="text-[10px] uppercase tracking-wide text-slate-400 mb-1">Figures this model will not produce</div>
      <p class="text-[10px] text-slate-500 mb-2">Not missing because they are hard. Missing because producing them here would take a probability or a counterfactual this simulation does not have.</p>
      ${rows}`;
  }

  function renderAssumptions() {
    if (!els.assumptions || !els.assumptionsBtn) return;
    els.assumptionsBtn.textContent = assumptionsOpen ? 'Hide cost model assumptions' : 'Show cost model assumptions';
    if (!assumptionsOpen) {
      els.assumptions.classList.add('hidden');
      els.assumptions.innerHTML = '';
      return;
    }
    els.assumptions.classList.remove('hidden');
    const items = FWExposureModel.ASSUMPTIONS.map(a => `<li>${a}</li>`).join('');
    const bands = Object.keys(FWExposureModel.CARGO_BANDS).map(c => {
      const b = FWExposureModel.CARGO_BANDS[c];
      return `<tr class="border-b border-slate-800/60">
        <td class="py-1 pr-2 text-[10px] text-slate-300">${c}</td>
        <td class="py-1 pr-2 text-[10px] font-mono text-slate-400 whitespace-nowrap">${FWExposureModel.fmt(b.low)} – ${FWExposureModel.fmt(b.high)}</td>
        <td class="py-1 text-[10px] text-slate-500">${b.driver}</td>
      </tr>`;
    }).join('');
    els.assumptions.innerHTML = `
      <ul class="list-disc list-inside space-y-1 text-[10px] text-slate-400 mb-3">${items}</ul>
      <div class="text-[10px] uppercase tracking-wide text-slate-400 mb-1">Assumed value bands, per full trailer load</div>
      <table class="w-full text-left"><tbody>${bands}</tbody></table>`;
  }

  function renderProcess(state) {
    if (!els.process) return;
    const p = FWExposureModel.portfolio(state);
    const rows = p.alignmentRows.length ? p.alignmentRows.map(r => `
      <div class="mb-1.5">
        <div class="flex items-center justify-between text-[10px] mb-0.5">
          <span class="text-slate-400">${ALIGNMENT_LABEL[r.alignment] || r.alignment}</span>
          <span class="font-mono text-slate-300">${r.hoursLabel} · ${r.cases} case${r.cases === 1 ? '' : 's'}</span>
        </div>
        <div class="h-1.5 rounded bg-slate-800 overflow-hidden">
          <div class="h-full ${ALIGNMENT_TONE[r.alignment] || 'bg-slate-600'}" style="width:${Math.round(r.shareOfEffort * 100)}%"></div>
        </div>
      </div>`).join('')
      : '<p class="text-[10px] text-slate-600 italic">No case has been closed yet, so no effort has been booked against an outcome.</p>';

    const perCase = p.hoursPerClosedCase != null
      ? `${p.hoursPerClosedCase.toFixed(1)} h per closed case`
      : 'no closed cases to average';

    els.process.innerHTML = `
      <div class="text-[10px] uppercase tracking-wide text-slate-400 mb-1">Cost of the process</div>
      <div class="font-orbitron text-lg text-white leading-tight">${p.totalHoursLabel}</div>
      <div class="text-[10px] text-slate-500 mb-2">measured investigative effort across ${p.closedCases} closed case${p.closedCases === 1 ? '' : 's'} · ${perCase}</div>
      <div class="bg-[#0b1119] border border-slate-800 rounded-lg p-2 mb-2">
        <div class="text-[11px] text-slate-200">${p.totalHoursLabel} × €${p.rate}/h = <b>${p.totalCostLabel}</b></div>
        <div class="text-[10px] text-slate-500 mt-0.5">Hours are measured by this simulation. The rate is a stated assumption — change it and this total rescales, while every ratio below stays the same.</div>
      </div>
      <div class="text-[10px] uppercase tracking-wide text-slate-400 mb-1">Where that effort went</div>
      ${rows}
      <p class="text-[10px] text-slate-500 mt-1">Effort on an over-called case is a real cost and not a verdict on the analyst — over-calls are an expected output of working from signals.</p>`;
  }

  function renderExposure(state) {
    if (!els.exposure) return;
    const p = FWExposureModel.portfolio(state);
    const openMos = state.moEngine
      ? Array.from(state.moEngine.mos.values()).filter(m => m.status !== 'CLOSED' && !m.verdictOutcome)
      : [];
    const sheets = openMos
      .map(m => FWExposureModel.caseSheet(state, m))
      .sort((a, b) => (b.exposure.high || 0) - (a.exposure.high || 0))
      .slice(0, 6);

    const list = sheets.length ? sheets.map(s => {
      const cargoNames = s.exposure.attached
        ? Array.from(new Set(s.exposure.consignments.map(c => c.cargo))).join(', ')
        : null;
      return `<div class="bg-[#0b1119] border border-slate-800 rounded-lg p-2 mb-1.5">
        <div class="flex items-center justify-between mb-0.5">
          <span class="font-mono text-[11px] text-slate-300">${s.moId}</span>
          <span class="font-mono text-[11px] ${s.exposure.attached ? 'text-sky-300' : 'text-slate-600'}">${s.exposure.label}</span>
        </div>
        <div class="text-[10px] text-slate-500">${cargoNames ? cargoNames : 'nothing consigned to this case on record'} · ${s.checksRun} check${s.checksRun === 1 ? '' : 's'} run · ${s.cost.hoursLabel} spent</div>
      </div>`;
    }).join('') : '<p class="text-[10px] text-slate-600 italic">No open cases right now.</p>';

    els.exposure.innerHTML = `
      <div class="text-[10px] uppercase tracking-wide text-slate-400 mb-1">Exposure attached to open cases</div>
      <div class="font-orbitron text-lg ${p.openExposure.attached ? 'text-sky-300' : 'text-slate-500'} leading-tight">${p.openExposure.label}</div>
      <div class="text-[10px] text-slate-500 mb-1">${p.openWithConsignment} of ${p.openCases} open case${p.openCases === 1 ? '' : 's'} has a consignment on record${p.openWithoutConsignment ? ` · ${p.openWithoutConsignment} with none, reported as absent rather than as zero` : ''}</div>
      <p class="text-[10px] text-amber-300/80 mb-2">This is what is at stake, not a loss and not an expected loss. A case carrying the largest band in the port may be entirely benign; a confirmed one may carry the smallest. The range is wide on purpose and the model will not narrow it.</p>
      ${list}`;
  }

  function render(state) {
    if (!state || !els.root || !window.FWExposureModel) return;
    renderProcess(state);
    renderExposure(state);
    if (els.summary) {
      const p = FWExposureModel.portfolio(state);
      els.summary.textContent = `${p.totalHoursLabel} booked · ${p.closedCases} case${p.closedCases === 1 ? '' : 's'} closed · ${p.openCases} open`;
    }
  }

  return { init, render };
})();
