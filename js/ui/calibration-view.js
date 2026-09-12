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
   No monetary or exposure figure appears here even though a cost model
   now exists (Phase 50, exposureModel.js). Deliberate: that model prices
   the process, and pricing a *calibration* outcome would mean pricing an
   over- or under-call, which is the first entry on its refused list. The
   effort those calls consumed is reported in the Exposure & Cost panel
   instead, in hours.

   Since Slice 18 a record check can come back structurally empty
   (NO_RECORD_EXISTS: the site keeps no record of that kind at that hour).
   A case decided on nothing but empty checks is reported here as its own
   count, because its alignment measures this port's coverage as much as
   the analyst's judgement. It stays inside the rates all the same, for the
   reason outcomeEngine's header gives: removing it would measure
   calibration only where the port could see.

   Slice 28 replaces the two examination lines this panel used to carry
   ("closed blind" over one base, "all checks came back empty" over
   another, overlapping and neither of them complete) with the four
   disjoint classes investigationEngine defines, over the single base of
   scored closures. That base is deliberately the larger one -- an
   ambiguous-record case can be closed with nothing having answered too --
   so it is labelled, and the same sort over the rate base is given beside
   it rather than left to be assumed identical. What this panel will not do
   with those classes is compare alignment between them; the reason is in
   outcomeEngine.NOT_MODELLED and is rendered on screen.

   SLICE 36, TWO CATCH-UPS ON THIS PANEL'S OWN NUMBERS.

   The three headline bars printed a count and a percentage and never the
   base the percentage was over. The base is named once, in a sentence
   above them, and it is not the base of the examination rows a few lines
   below -- which is exactly why the base note under those rows exists.
   Every other rate in this project carries its denominator on the row that
   states it; these three, the ones a reader looks at first, did not. They
   do now, and bar() refuses to print a percentage over a base of nothing
   rather than rendering 0%.

   The ledger row said how many checks were run and then named exactly one
   of the three things a check can come back as -- the ones with no record
   to fetch. On a closure with one such check and two the source could not
   be reached, the row read "3 record checks run · 1 with no such record to
   fetch", leaving two unaccounted for on a row whose own subject is how
   far the case was taken. The ledger has recorded all three counts since
   Slice 28 and this panel rendered one of them. All three now, summed and
   asserted against the checks run, which is the same discipline the
   examination rows above already hold themselves to. */
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

  /* A rate on this panel carries its own denominator, like every other
     rate in this project. Without it the reader has one base in a sentence
     above and a different base under the rows below, and no way to tell
     which of the two each percentage was taken over. A bar with no base is
     drawn with no percentage rather than with 0%: a share of nothing is not
     zero, and the counts beside it are the honest figure. */
  function bar(label, count, total, colorClass) {
    const hasBase = total > 0;
    const pct = hasBase ? Math.round((count / total) * 100) : 0;
    const value = hasBase ? `${count} / ${total} · ${pct}%` : `${count}`;
    return `<div class="mb-1">
      <div class="flex justify-between text-[10px] text-slate-400"><span>${label}</span><span class="font-mono">${value}</span></div>
      <div class="h-1.5 bg-slate-800 rounded"><div class="h-1.5 rounded ${colorClass}" style="width:${pct}%"></div></div>
    </div>`;
  }

  const CLASS_LABEL = {
    ANSWERED: 'A check answered on it',
    NOTHING_TO_FETCH: 'Checks were run, and there was no record of that kind to fetch',
    UNREACHABLE: 'Checks were run, and the sources could not be reached',
    NEVER_LOOKED: 'No record source was checked at all'
  };

  /* No tone carries a judgement on a row (Slice 36). NEVER_LOOKED was
     drawn in the same orange this panel gives OVERCALLED, on a block whose
     own closing sentence says it is not a scoring of the closures. A case
     nobody looked at is a fact about where the hours went; it is not a
     worse closure than one the records answered. */
  const CLASS_TONE = {
    ANSWERED: 'text-slate-300',
    NOTHING_TO_FETCH: 'text-slate-400',
    UNREACHABLE: 'text-slate-400',
    NEVER_LOOKED: 'text-slate-300'
  };

  /* HOW FAR EACH CLOSED CASE WAS TAKEN BEFORE IT WAS CLOSED. Four disjoint
     classes over one base, stated to sum to it, since the two figures this
     replaces did not. Counts, plus a percentage per class only once the
     base clears the same minimum sample the rates above use. Framed in
     both directions in the copy, because a closure nobody could get an
     answer on is not thereby a wrong closure. */
  function examinationBlock(cal) {
    const ex = cal.examination;
    if (!ex || !ex.base) return '';
    // The classes come from investigationEngine; the row prose is this
    // panel's. A class the engine adds and this panel has no words for
    // would render as a blank row rather than as a missing one.
    ex.classes.forEach(k => {
      if (!CLASS_LABEL[k] || !CLASS_TONE[k]) {
        throw new Error(
          'calibration-view: examination class ' + k + ' has no row on this panel. A class with ' +
          'no row still sits in the base of every percentage here and in none of the numerators.'
        );
      }
    });
    const rows = ex.classes.map(k => {
      const n = ex.byClass[k];
      const pctText = cal.examinationRateEligible ? ` · ${Math.round((n / ex.base) * 100)}%` : '';
      return `<div class="flex justify-between gap-2 text-[10px] ${CLASS_TONE[k]}">
        <span>${CLASS_LABEL[k]}</span><span class="font-mono">${n} / ${ex.base}${pctText}</span>
      </div>`;
    }).join('');
    const subset = ex.allUnseeable
      ? `<div class="text-[10px] text-slate-500 mt-1">Of the ${ex.byClass.NOTHING_TO_FETCH} in the second row, ${ex.allUnseeable} had <em>every</em> check come back with nothing to fetch. A stronger statement about this port's coverage, so it is stated separately — it is part of that row and not an addition to it.</div>`
      : '';
    const baseNote = cal.examinationBaseIsRateBase
      ? ''
      : `<div class="text-[10px] text-slate-500 mt-1">These four are taken over the ${ex.base} closures that made a checkable claim, which is a larger base than the ${cal.decisiveCount} the percentages above use: a case whose record was mixed can also have been closed with nothing having answered. Over that smaller base, ${cal.decisiveNeverAnswered} closure${cal.decisiveNeverAnswered === 1 ? '' : 's'} had no check answer. The two sets of percentages are not comparable with each other.</div>`;
    return `<div class="mt-3 pt-2 border-t border-slate-800">
      <div class="text-[10px] text-slate-300 font-semibold mb-1">How far each closed case was taken first</div>
      <div class="text-[10px] text-slate-500 mb-1">Every closure falls in exactly one of these four, so unlike the rest of this panel they sum to their base. ${ex.neverAnswered} of ${ex.base} were closed without any check having answered anything about the case.</div>
      ${rows}
      ${subset}
      <div class="text-[10px] text-slate-400 mt-1">This is not a scoring of the closures. A case nobody could get an answer on is not a bad call, and one that got an answer is not a correct one — the alignment above is what is checked against the record, and it is checked the same way for all four classes. None of these cases is removed from it.</div>
      ${baseNote}
    </div>`;
  }

  // What this panel will not report, at the same weight as the figures.
  function refusalsBlock() {
    const items = FWOutcomeEngine.NOT_MODELLED.map(n => `
      <div class="mb-1">
        <div class="text-[10px] text-slate-300">${n.figure}</div>
        <div class="text-[10px] text-slate-500">${n.why}</div>
      </div>`).join('');
    return `<div class="mt-3 pt-2 border-t border-slate-800">
      <div class="text-[10px] text-slate-300 font-semibold mb-1">Not reported here, and why</div>
      ${items}
    </div>`;
  }

  /* WHICH CASES THESE PERCENTAGES CAN BE ABOUT (Slice 68). The line below this
     block used to say only how many cases were excluded for having a mixed
     record. That count is true and it is not the fact a reader needs: the
     exclusion is decided by how many signals a case carries and by nothing
     else, so it runs hardest against the biggest cases and the percentages
     above are taken over the smallest ones. Rendered at the same weight as the
     count it replaces, with the per-row denominators, and a share withheld on
     any row too thin to carry one. */
  function ambiguityBlock(cal) {
    const a = cal.ambiguity;
    if (!a) return '';
    const rows = a.rows.filter(r => r.closures > 0).map(r => {
      const share = r.decisiveShare === null
        ? 'share withheld'
        : Math.round(r.decisiveShare * 100) + '% counted';
      return `<div class="flex justify-between gap-2"><span class="text-slate-400">${r.signals} signal${r.signals === 1 ? '' : 's'}</span>` +
        `<span class="text-slate-500">${r.decisive} of ${r.closures} counted · ${r.ambiguous} left out · ${share}</span></div>`;
    }).join('');
    const arithmetic = a.chanceDeclared
      ? `<div class="text-[10px] text-slate-500 mt-1">Expected chance of being left out, from the per-signal chance the simulation declares: ${[2, 3, 4, 6].map(n => n + ' signals ' + Math.round(FWOutcomeEngine.ambiguityChance(n) * 100) + '%').join(' · ')}. This is a property of the model, not of this run.</div>`
      : `<div class="text-[10px] text-slate-500 mt-1">${a.note}</div>`;
    return `<div class="mt-2 rounded border border-slate-700 bg-slate-900/60 p-2 space-y-1">
      <div class="text-[11px] text-slate-300">Excluded from the ${cal.rates ? 'percentages' : 'counts'} above: ${cal.counts.AMBIGUOUS} case${cal.counts.AMBIGUOUS === 1 ? '' : 's'} whose record was mixed.</div>
      <div class="text-[10px] text-slate-400">${a.sentence}</div>
      ${a.state === 'MEASURED' ? `<div class="text-[10px] space-y-0.5 mt-1">${rows}</div>` : `<div class="text-[10px] text-slate-500">${a.note}</div>`}
      ${arithmetic}
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
      <div class="text-[10px] text-slate-500 italic">Percentages are withheld until ${cal.minSample} cases with an unmixed record have been decided — below that a rate would be noise dressed up as a measurement.</div>`
      + ambiguityBlock(cal) + examinationBlock(cal) + refusalsBlock();
    }

    const t = cal.decisiveCount;
    return head + tendencyLine(cal) +
      bar('In line with the record', cal.counts.ALIGNED, t, 'bg-emerald-500') +
      bar('Went past the record (escalated something explained)', cal.counts.OVERCALLED, t, 'bg-orange-500') +
      bar('Stopped short of the record (cleared something unexplained)', cal.counts.UNDERCALLED, t, 'bg-amber-500') +
      ambiguityBlock(cal) +
      examinationBlock(cal) + refusalsBlock();
  }

  /* What the checks behind one closure came back with, all three kinds,
     summing to the checks run. The ledger has recorded the answered and
     unreachable counts alongside the no-record one since Slice 28; this row
     named only the last of them, so on a closure whose sources could not be
     reached the arithmetic on the row did not close and the missing checks
     were left to be guessed at. Zero counts are dropped from the sentence
     but never from the sum. */
  function checksLine(e) {
    const run = e.checksRun || 0;
    if (!run) return 'no record check was run';
    const parts = [
      { n: e.answeredChecks || 0, text: 'answered' },
      { n: e.noRecordChecks || 0, text: 'found no such record to fetch' },
      { n: e.inconclusiveChecks || 0, text: 'could not be reached' }
    ];
    const sum = parts.reduce((a, p) => a + p.n, 0);
    if (sum !== run) {
      throw new Error(
        'calibration-view: the checks on ' + e.moId + ' do not reconcile (' + sum + ' accounted ' +
        'for vs ' + run + ' run). A check left off this row is read as having answered something.'
      );
    }
    const named = parts.filter(p => p.n > 0).map(p => `${p.n} ${p.text}`).join(', ');
    return `${run} record check${run === 1 ? '' : 's'} run — ${named}`;
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
        <div class="text-[10px] text-slate-500 mt-1">${FWMoEngine.CONFIDENCE_INDEX.displayLabel} at close ${FWMoEngine.formatIndex(e.confidenceAtClose)} · ${checksLine(e)}${e.effortSeconds ? ` · ${fmtEffort(e.effortSeconds)} effort` : ''}${e.checksRun && !e.everAnswered ? ' · none of them answered' : ''}</div>
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
