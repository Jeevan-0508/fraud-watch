/* ui/exposure-view.js — Phase 50's analyst-facing half.

   Layout carries the argument: the three cards have equal weight, and one
   of them is a list of figures this model refuses to produce. That card is
   not a footnote or a tooltip, because the numbers that are absent are as
   much of the model as the numbers that are present.

   Two invariants enforced here:
     - money is never shown without the measured hour count and the stated
       rate that produced it, in the same block of text;
     - exposure is never shown without the words that say it is not a loss.

   The "where that effort went" rows are built from closed cases, because
   an alignment only exists once a case is closed. The analytics dashboard
   counts measured effort across every case, so the two panels legitimately
   show different hour totals. The reconciliation block below names the gap
   rather than leaving the reader to treat it as an error in one of them. */
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

  // The hours above are the hours of closed cases. This says where the rest
  // of the measured effort in the run sits, and why it cannot appear in an
  // alignment row.
  /* The same seconds, cut a second way: by what the checks on the case came
     back with. Both cuts sum to the same total independently, which is
     stated, and they are deliberately not crossed into a grid — the reason
     is in the refused register on this same panel. */
  function renderExaminationCut(state, recon) {
    const x = FWExposureModel.effortByExamination(state);
    if (!x.total.seconds) return '';
    const label = {
      ANSWERED: 'on cases a check answered on',
      NOTHING_TO_FETCH: 'on cases where a check found there was no record of that kind to fetch, and nothing else answered',
      UNREACHABLE: 'on cases where the sources could not be reached, and nothing answered'
    };
    const rows = ['ANSWERED', 'NOTHING_TO_FETCH', 'UNREACHABLE']
      .filter(k => x.byClass[k].seconds > 0)
      .map(k => `<li>${x.byClass[k].hoursLabel} on ${x.byClass[k].cases} case${x.byClass[k].cases === 1 ? '' : 's'} ${label[k]}</li>`)
      .join('');
    const sameTotal = Math.abs(x.total.seconds - recon.total.seconds) < 1;
    return `<div class="mt-2 pt-2 border-t border-slate-800">
      <div class="text-[10px] uppercase tracking-wide text-slate-400 mb-1">The same hours, cut by what came back</div>
      <div class="text-[11px] text-slate-200 mb-1">${x.nothingCameBack.hoursLabel} across ${x.nothingCameBack.cases} case${x.nothingCameBack.cases === 1 ? '' : 's'} × €${x.rate}/h = <b>${x.nothingCameBack.costLabel}</b> went into cases where no check ever answered anything</div>
      <ul class="list-disc list-inside text-[10px] text-slate-400 space-y-0.5 mb-1">${rows}</ul>
      <div class="text-[10px] text-slate-500">${sameTotal ? 'These are the same measured seconds as the cut above' : 'These hours are a subset of the measured total'}, sorted by what the checks came back with instead of by whether a closure exists to book them against. Each cut sums to the total on its own; they are not crossed with each other. Cases no check was ever run on hold none of these hours by construction — effort here is only ever created by running a check.</div>
      <div class="text-[10px] text-slate-400">None of it is waste. That a record of that kind does not exist is a finding about this port, and no analyst knows in advance which check will answer — which is why there is no cost-per-answer figure on this panel and a reason for its absence in the refused register.</div>
    </div>`;
  }

  function renderReconciliation(state) {
    const r = FWExposureModel.effortReconciliation(state);
    if (!r.total.seconds) {
      return `<div class="mt-2 pt-2 border-t border-slate-800"><div class="text-[10px] text-slate-600 italic">No record check has been run yet, so there are no measured hours to reconcile.</div></div>`;
    }
    const rows = [
      `<li>${r.booked.hoursLabel} on ${r.booked.cases} case${r.booked.cases === 1 ? '' : 's'} with a closure on the ledger — the hours the rows above are built from</li>`,
      `<li>${r.unbooked.hoursLabel} on ${r.unbooked.cases} case${r.unbooked.cases === 1 ? '' : 's'} with no closure yet, so no alignment exists to book them against</li>`
    ];
    if (r.postClosure.seconds) {
      rows.push(`<li>${r.postClosure.hoursLabel} spent on ${r.postClosure.cases} case${r.postClosure.cases === 1 ? '' : 's'} after its closure was already booked — a case the engine faded on its own stays investigable, and that effort is real but arrives after the row was written</li>`);
    }
    return `<div class="mt-2 pt-2 border-t border-slate-800">
      <div class="text-[10px] uppercase tracking-wide text-slate-400 mb-1">All measured effort in this run, and where it sits</div>
      <div class="text-[11px] text-slate-200 mb-1">${r.total.hoursLabel} across ${r.total.cases} case${r.total.cases === 1 ? '' : 's'} × €${r.rate}/h = <b>${r.total.costLabel}</b></div>
      <ul class="list-disc list-inside text-[10px] text-slate-400 space-y-0.5 mb-1">${rows.join('')}</ul>
      ${renderExaminationCut(state, r)}
      <div class="text-[10px] text-slate-500">This is the same total the analytics dashboard reports as measured effort; the hours at the top of this card are the closed subset of it, which is why the two figures differ. The unbooked hours are not waste and not yet an over-call — they are hours spent on cases nobody has decided. They are not split across the alignment rows in the proportions the closed cases show: the open cases are the ones that have resisted resolution, so assuming they resolve the same way is the one assumption the caseload argues against.</div>
    </div>`;
  }

  function renderProcess(state) {
    if (!els.process) return;
    const p = FWExposureModel.portfolio(state);
    // A bar is a share, so it is drawn only where a base exists. When no
    // effort has been booked the share is null, not 0, and the row says so
    // instead of showing an empty bar that reads as "none of it went here".
    const rows = p.alignmentRows.length ? p.alignmentRows.map(r => `
      <div class="mb-1.5">
        <div class="flex items-center justify-between text-[10px] mb-0.5">
          <span class="text-slate-400">${ALIGNMENT_LABEL[r.alignment] || r.alignment}</span>
          <span class="font-mono text-slate-300">${r.hoursLabel} · ${r.cases} case${r.cases === 1 ? '' : 's'}</span>
        </div>
        ${r.shareOfEffort == null
          ? '<div class="text-[9px] text-slate-500 italic">no effort booked on any closure, so there is no total for this to be a share of</div>'
          : `<div class="h-1.5 rounded bg-slate-800 overflow-hidden">
          <div class="h-full ${ALIGNMENT_TONE[r.alignment] || 'bg-slate-600'}" style="width:${Math.round(r.shareOfEffort * 100)}%"></div>
        </div>`}
      </div>`).join('')
      : '<p class="text-[10px] text-slate-600 italic">No case has been closed yet, so no effort has been booked against an outcome.</p>';

    const barBase = p.alignmentRows.length && p.alignmentRows[0].shareOfEffort != null
      ? `<p class="text-[10px] text-slate-500 mt-0.5">Each bar is that row's hours as a share of the ${p.alignmentRows[0].shareBase} booked against a closure — not of the effort measured in the run, which is larger.</p>`
      : '';

    const perCase = p.hoursPerClosedCase.value != null
      ? `${p.hoursPerClosedCase.value.toFixed(1)} h per closed case (${p.hoursPerClosedCase.basisLabel})`
      : p.hoursPerClosedCase.n
        ? `per-case mean withheld · ${p.hoursPerClosedCase.basisLabel}`
        : 'no closure on the ledger to average';

    els.process.innerHTML = `
      <div class="text-[10px] uppercase tracking-wide text-slate-400 mb-1">Cost of the process</div>
      <div class="font-orbitron text-lg text-white leading-tight">${p.bookedHoursLabel}</div>
      <div class="text-[10px] text-slate-500 mb-2">investigative effort booked against a closure, on ${p.closedCases} closed case${p.closedCases === 1 ? '' : 's'} · ${perCase}</div>
      <p class="text-[10px] text-amber-300/80 mb-2">${p.effortBasis.note}${p.hoursPerClosedCase.withheld && p.hoursPerClosedCase.n ? ' ' + p.hoursPerClosedCase.note : ''}</p>
      <div class="bg-[#0b1119] border border-slate-800 rounded-lg p-2 mb-2">
        <div class="text-[11px] text-slate-200">${p.bookedHoursLabel} × €${p.rate}/h = <b>${p.bookedCostLabel}</b></div>
        <div class="text-[10px] text-slate-500 mt-0.5">Hours are measured by this simulation. The rate is a stated assumption — change it and this total rescales, while every ratio below stays the same.</div>
      </div>
      <div class="text-[10px] uppercase tracking-wide text-slate-400 mb-1">Where the booked effort went</div>
      ${rows}
      ${barBase}
      <p class="text-[10px] text-slate-500 mt-1">Effort on an over-called case is a real cost and not a verdict on the analyst — over-calls are an expected output of working from signals.</p>
      ${renderReconciliation(state)}`;
  }

  function renderExposure(state) {
    if (!els.exposure) return;
    const p = FWExposureModel.portfolio(state);
    // A second copy of a filter that was wrong in the engine too. One owner now.
    const openMos = FWMoEngine.standingPartition(
      state.moEngine ? Array.from(state.moEngine.mos.values()) : []).open;
    // Truncating is a claim the rest did not matter, so the pool is counted
    // and the omission is stated rather than left as a short list.
    const SHOWN = 6;
    const allSheets = openMos
      .map(m => FWExposureModel.caseSheet(state, m))
      .sort((a, b) => (b.exposure.high || 0) - (a.exposure.high || 0));
    const sheets = allSheets.slice(0, SHOWN);
    const hidden = allSheets.length - sheets.length;
    const hiddenNote = hidden
      ? `<p class="text-[10px] text-slate-500 mt-1">Showing the ${sheets.length} widest bands of ${allSheets.length} live cases. The ${hidden} not listed are ordered by band and nothing else, so a case low on this list is not a case found to be less serious.</p>`
      : (allSheets.length ? `<p class="text-[10px] text-slate-500 mt-1">All ${allSheets.length} live case${allSheets.length === 1 ? '' : 's'} listed, none omitted.</p>` : '');

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
      <div class="text-[9px] text-slate-500 italic mb-1">${p.standingNote}${p.closedWithoutVerdict ? ` The band above covers live cases only: it does not include the ${p.closedWithoutVerdict} closed with no verdict, which were counted as open until Slice 48 and carried exposure with them.` : ''}</div>
      <p class="text-[10px] text-amber-300/80 mb-2">This is what is at stake, not a loss and not an expected loss. A case carrying the largest band in the port may be entirely benign; a confirmed one may carry the smallest. The range is wide on purpose and the model will not narrow it.</p>
      ${list}
      ${hiddenNote}`;
  }

  function render(state) {
    if (!state || !els.root || !window.FWExposureModel) return;
    renderProcess(state);
    renderExposure(state);
    if (els.summary) {
      const p = FWExposureModel.portfolio(state);
      // "N closed - M open" read as a partition of the case register and was not
      // one: closed came from the outcome ledger, open from a filter that matched
      // everything. Both scopes are named, and the third group is stated.
      els.summary.textContent = `${p.bookedHoursLabel} booked of ${p.effortBasis.measuredHoursLabel} measured · ${p.closedCases} on the outcome ledger · ` +
        `of ${p.standingTotal} case${p.standingTotal === 1 ? '' : 's'} raised: ${p.openCases} live, ` +
        `${p.standing.CLOSED_WITH_VERDICT} closed with a verdict, ${p.closedWithoutVerdict} closed with none`;
    }
  }

  return { init, render };
})();
