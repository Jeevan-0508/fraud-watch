/* ui/mo-intelligence.js — the MO Intelligence Center (mega-spec Phases
   22-25, 28-30): a persistent, filterable queue over every MO the
   correlation/novelty engines have ever created, plus a forensic
   detail view and the player actions that actually move a case
   through its lifecycle (NEW -> MONITORING/INVESTIGATING/ESCALATED ->
   CONFIRMED/FALSE_POSITIVE/DISMISSED/RESOLVED).

   Deliberately separate from sim-debug.js: that panel is a lightweight
   "is the engine alive" pulse check capped at 12 recent cards. This
   module is the actual investigator-facing surface -- every MO that
   has ever existed stays visible here, filterable by status and by
   discovery classification, and nothing disappears just because its
   evidence faded or a status changed.

   No fake intelligence (Phase 67): the pattern list below is explicitly
   labelled a keyword vote count, not a statistical/ML similarity score,
   because that is what it actually is. It said "indicator-keyword" for a
   long time, which credited the count to the taxonomy's documented
   indicators -- data rankPatterns never reads. The votes are counted over a
   pattern's name, category and aliases, and that is now what is stated, next
   to how many scoring patterns are not shown. */
const FWMoIntelligence = (() => {
  let els = {};
  let statusFilter = 'ALL';
  let classFilter = 'ALL';
  const expanded = new Set();

  const STATUS_FILTERS = ['ALL', 'NEW', 'MONITORING', 'INVESTIGATING', 'ESCALATED', 'CONFIRMED', 'FALSE_POSITIVE', 'DISMISSED', 'RESOLVED'];
  const CLASS_FILTERS = ['ALL', 'POTENTIAL_NEW_MO', 'MO_VARIANT', 'EMERGING_BEHAVIOR', 'KNOWN_MO'];

  const ACTIONS = [
    { action: 'investigate', label: 'Investigate', status: 'INVESTIGATING' },
    { action: 'monitor', label: 'Monitor', status: 'MONITORING' },
    { action: 'escalate', label: 'Escalate', status: 'ESCALATED' },
    { action: 'confirm', label: 'Confirm Fraud', status: 'CONFIRMED' },
    { action: 'falsepositive', label: 'Mark False Positive', status: 'FALSE_POSITIVE' },
    { action: 'dismiss', label: 'Dismiss', status: 'DISMISSED' },
    { action: 'resolve', label: 'Resolve', status: 'RESOLVED' }
  ];

  function init() {
    els = {
      root: document.getElementById('mo-intel-root'),
      summary: document.getElementById('mo-intel-summary'),
      statusTabs: document.getElementById('mo-intel-status-tabs'),
      classTabs: document.getElementById('mo-intel-class-tabs'),
      list: document.getElementById('mo-intel-list')
    };
    if (els.list) {
      els.list.addEventListener('click', (e) => {
        const actionBtn = e.target.closest('[data-mo-action]');
        if (actionBtn) {
          handleAction(actionBtn.dataset.moId, actionBtn.dataset.moAction);
          return;
        }
        const investBtn = e.target.closest('[data-mo-invest]');
        if (investBtn) {
          handleInvestigation(investBtn.dataset.moId, investBtn.dataset.moInvest);
          return;
        }
        const viewBtn = e.target.closest('[data-mo-view]');
        if (viewBtn) {
          const id = viewBtn.dataset.moView;
          if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
          render(FWSimRunner.getState());
        }
      });
    }
  }

  function setFilter(kind, value) {
    if (kind === 'status') statusFilter = value;
    else if (kind === 'class') classFilter = value;
    render(FWSimRunner.getState());
  }

  function handleAction(moId, action) {
    const state = FWSimRunner.getState();
    if (!state) return;
    const mo = state.moEngine.mos.get(moId);
    if (!mo) return;
    const def = ACTIONS.find(a => a.action === action);
    if (!def) return;
    FWMoEngine.setStatus(mo, def.status, `Analyst action: ${def.label} (MO Intelligence Center)`);
    // Closing a case is the only action that asserts something checkable,
    // so it gets logged and checked against the simulation's own record
    // (outcomeEngine, Phases 30/58). Non-terminal actions return null.
    if (window.FWOutcomeEngine) FWOutcomeEngine.recordVerdict(state, mo, def.status);
    render(state);
    if (window.FWCalibrationView) FWCalibrationView.render(state);
  }

  function handleInvestigation(moId, actionKey) {
    const state = FWSimRunner.getState();
    if (!state) return;
    const mo = state.moEngine.mos.get(moId);
    if (!mo) return;
    FWInvestigationEngine.performAction(state, mo, actionKey);
    render(state);
  }

  function fmtSimTime(absSeconds) {
    const day = Math.floor(absSeconds / 86400) + 1;
    const s = Math.floor(absSeconds % 86400);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return `Day ${day} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  function statusBadgeClass(status) {
    const open = { NEW: 'bg-sky-900 text-sky-300', MONITORING: 'bg-slate-700 text-slate-200', INVESTIGATING: 'bg-amber-900 text-amber-300', ESCALATED: 'bg-orange-900 text-orange-300' };
    const closed = { CONFIRMED: 'bg-red-900 text-red-300', FALSE_POSITIVE: 'bg-emerald-900 text-emerald-300', DISMISSED: 'bg-slate-800 text-slate-500', RESOLVED: 'bg-indigo-900 text-indigo-300' };
    return open[status] || closed[status] || 'bg-slate-700 text-slate-200';
  }

  // Labels and tones for the discovery classes are moEngine's, not a second
  // copy here that could disagree with sim-debug's third one.
  function classificationBadgeClass(cls) { return FWMoEngine.classificationTone(cls); }
  function classificationLabel(cls) { return FWMoEngine.classificationLabel(cls); }


  /* Was a local copy of the band-to-colour map, duplicated again in
     sim-debug.js. moEngine owns the band, so it owns its tone; a second copy
     is how two panels come to disagree about what a band means. */
  function bandBadgeClass(band) { return FWMoEngine.bandTone(band); }

  /* The taxonomy's assessed harm for the pattern this case RESEMBLES. Stated
     separately from the confidence band and scoped in words, because the two
     point in opposite directions often enough to matter: a thin correlation
     against a pattern the taxonomy assesses as high harm used to render as
     "severity LOW". Informational in both directions -- it says nothing about
     whether this case is that pattern. */
  /* THE MOST PROMINENT NUMBER IN THE APP, AND IT USED TO END IN A PERCENT
     SIGN. It is a sum of weight * reliability multiplied by a calibration
     constant; nothing is divided, so there is no base, no n / N, and no
     percentage to state. Printed as `Confidence 78%` it reads as a probability
     that fraud occurred -- exactly the collapse of "we observed X" into "X
     means fraud" that every other panel in this app is built to refuse. Same
     number, declared unit, disclosed model, and the ceiling caveat when the
     clamp has stopped it tracking its own source. */
  function indexSentence(mo) {
    const decl = FWMoEngine.CONFIDENCE_INDEX;
    const n = mo.indexScaleNote;
    const bound = n && (n.saturated || n.floored)
      ? ` <span class="text-amber-300/80">Withheld as a distinguishing figure: ${n.reason}</span>`
      : '';
    const reach = FWMoEngine.indexReach();
    return `${decl.displayLabel} <b>${FWMoEngine.formatIndex(mo.confidence)}</b> (band <b>${mo.confidenceBand}</b> — the same number, banded, not a second measurement).
      ${decl.means[0].toUpperCase() + decl.means.slice(1)} It is ${decl.unit}. Denominator: ${decl.denominator}
      It is not ${decl.doesNotMean}${bound}
      <span class="text-amber-300/80">Scope of the sum, not a rate over it &mdash; ${FWMoEngine.indexBasis(mo).note}</span>
      <span class="text-slate-500">Elsewhere this app calls the same number "confidence" &mdash; ${decl.storedAs} One quantity, and this is its unit.
      ${reach.note}</span>`;
  }

  function patternHarmNote(mo) {
    if (typeof FW === 'undefined' || !FW.loaded() || !mo.relatedPattern) return '';
    const scale = FW.severityScale();
    const pat = (FW.patterns() || []).find(p => p.id === mo.relatedPattern);
    if (!pat || !scale) return '';
    return `<br>The taxonomy assesses <b>${pat.name}</b> as <b>${pat.severity}</b> harm if it occurs — ` +
      `${scale.means} That is a property of the pattern, not a finding about this case, and it is not ${scale.doesNotMean}`;
  }

  function tabBtn(kind, value, label, active) {
    return `<button data-tab-kind="${kind}" data-tab-value="${value}" class="px-2 py-1 rounded-md text-[10px] font-semibold ${active ? 'bg-sky-700 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}">${label}</button>`;
  }

  function renderTabs(mos) {
    if (els.statusTabs) {
      els.statusTabs.innerHTML = STATUS_FILTERS.map(s => {
        const count = s === 'ALL' ? mos.length : mos.filter(m => m.status === s).length;
        return tabBtn('status', s, `${s.replace(/_/g, ' ')} (${count})`, statusFilter === s);
      }).join('');
      els.statusTabs.querySelectorAll('[data-tab-kind="status"]').forEach(b => {
        b.addEventListener('click', () => setFilter('status', b.dataset.tabValue));
      });
    }
    if (els.classTabs) {
      els.classTabs.innerHTML = CLASS_FILTERS.map(c => {
        const count = c === 'ALL' ? mos.length : mos.filter(m => m.classification === c).length;
        const label = c === 'ALL' ? 'All' : classificationLabel(c);
        return tabBtn('class', c, `${label} (${count})`, classFilter === c);
      }).join('');
      els.classTabs.querySelectorAll('[data-tab-kind="class"]').forEach(b => {
        b.addEventListener('click', () => setFilter('class', b.dataset.tabValue));
      });
    }
  }

  function renderSummary(state, mos) {
    if (!els.summary) return;
    const summary = FWMoEngine.discoverySummary(state.moEngine);
    const byClass = FWMoEngine.CLASSIFICATIONS
      .map(k => `${summary.byClassification[k]} ${FWMoEngine.classificationTally(k)}`).join(' · ');
    // A bucket that reads 0 because no case can carry it reads exactly like a
    // bucket that reads 0 because none has come up, and one of those is an
    // observation while the other is an impossibility.
    const unissuable = (summary.unissuableClasses || []).length ? ` ${summary.reachNote}` : '';
    // The class tally counts two different findings in the same bucket, so the
    // reason tally is printed with it, over the same base.
    const byReason = summary.byReason
      ? ' · by reason: ' + FWMoEngine.CLASSIFICATION_REASON_KEYS
        .map(k => `${summary.byReason[k]} ${FWMoEngine.classificationReasonEntry(k).note}`).join(' · ')
      : '';
    const unstated = summary.reasonNotStated
      ? ` ${summary.reasonNotStated} of ${summary.reasonBase} cases state no reason (not a reason of "none").`
      : '';
    els.summary.textContent = `${mos.length} total cases · ${summary.totalSignatures} distinct behavior signatures seen · ` +
      `by discovery class over ${summary.classifiedTotal} cases: ${byClass}` + byReason + unstated + unissuable +
      (summary.voteFloorNote ? ` ${summary.voteFloorNote}` : '') +
      (summary.observedVoteFloorNote ? ` ${summary.observedVoteFloorNote}` : '');
  }

  /* Never "novelty 100/100": that reads as a share and there is no base. The
     figure is the sighting count restated, and past the floor it is refused
     outright rather than printed stale. */
  function noveltyLine(mo) {
    const n = FWMoEngine.noveltyNote(mo.recurrenceCount - 1);
    return n.value == null
      ? `<br><span class="text-slate-400">${n.note}</span>`
      : `<br><span class="text-slate-400">Novelty ${n.value} on a 0-${FWMoEngine.RECURRENCE_NOVELTY.max} axis — ${n.note}.</span>`;
  }

  /* The lifetime that decided whether this row still counts, stated on the row.
     It was a hand-set constant in the catalog that nothing printed, while the
     word "decayed" beside it carried the whole consequence.

     Where there is no declared lifetime this used to return nothing at all, so
     the row read as though the question had not come up -- while the entity
     inspector, for the same absence, invented a lifetime from the signal expiry
     window and printed it as a declared one. One absence, two panels, two
     policies, neither stated. Both now call the one owner in signalEngine. */
  function decayClause(e) {
    return ` · ${FWSignalEngine.decayClause(e.signalType, null).text}`;
  }

  function renderEvidenceList(mo) {
    if (!mo.evidence || !mo.evidence.length) return '';
    const active = new Set(mo.activeSignals || mo.signals || []);
    const decl = FWMoEngine.EVIDENCE_CONTRIBUTION;
    // "reliability 55%" was a 0-1 type constant wearing a percent sign over
    // nothing divided, printed per row as if it graded that row. One owner for
    // the string now, and the caveat is stated below rather than assumed.
    const rows = mo.evidence.map(e =>
      `<li>${e.signalType.replace(/_/g, ' ')} — contributes ${e.contribution} ${decl.unit.split(',')[0]}, ${FWSignalEngine.formatReliability(e.reliability)} (${fmtSimTime(e.at)})${decayClause(e)}${active.has(e.signalId) ? '' : ' <span class="text-slate-600">· decayed, no longer counting toward the index</span>'}</li>`
    ).join('');
    /* Two sums of one quantity at two scopes, stated rather than left for the
       eye to add up into the index it will not match. The word "reconciled"
       used to be here and has been removed: both sums come off the same loop
       over the same rows, so their agreeing is an arithmetic identity, not a
       cross-check. Which rows are active and which decayed is guaranteed by
       the loop having no third branch -- see scopes.reconciliation. */
    const scopes = FWMoEngine.contributionScopes(mo);
    return `<div class="mb-2"><div class="text-[10px] font-semibold text-slate-400 uppercase mb-1">Signals & evidence</div><ul class="list-disc list-inside text-[10px] text-slate-400 space-y-0.5">${rows}</ul>
      <div class="text-[9px] text-slate-500 italic mt-1">${scopes.note} A contribution is not ${decl.doesNotMean}</div>
      <div class="text-[9px] text-slate-600 italic mt-1">The two figures above are the same sum cut in two, so that they add up is arithmetic rather than a check on it: ${scopes.reconciliation.cannotDetect} That each row is counted once is ${scopes.reconciliation.disjointnessBasis}</div>
      <div class="text-[9px] text-slate-500 italic mt-1">${FWSignalEngine.reliabilityNote()}</div>
      <div class="text-[9px] text-slate-500 italic mt-1">${FWSignalEngine.effectiveSpan().note}</div>
      <div class="text-[9px] text-slate-500 italic mt-1">${FWSignalEngine.decayInfluence().note}</div></div>`;
  }

  function renderTimeline(mo) {
    if (!mo.timeline || !mo.timeline.length) return '';
    const rows = mo.timeline.map(t => `<li>${fmtSimTime(t.t)} — ${t.type.replace(/_/g, ' ')}</li>`).join('');
    return `<div class="mb-2"><div class="text-[10px] font-semibold text-slate-400 uppercase mb-1">Timeline</div><ul class="list-disc list-inside text-[10px] text-slate-400 space-y-0.5">${rows}</ul></div>`;
  }

  function renderHistoricalMatch(mo) {
    if (!mo.relatedHistoricalPatterns || !mo.relatedHistoricalPatterns.length) {
      return `<div class="mb-2 text-[10px] text-slate-500 italic">No taxonomy pattern shares any keyword with this signal combination.</div>`;
    }
    // "indicator-keyword vote" credited the count to indicator data this engine
    // never reads. The vote is over name, category and aliases, and the number
    // of patterns that scored but are not shown is now stated.
    const cov = mo.resemblanceCoverage;
    // The vote count is now distinct keywords, and the keywords themselves are
    // listed: a count printed without the thing it counts is a claim the reader
    // cannot check, and this one used to be inflated by repeated signals.
    const rows = mo.relatedHistoricalPatterns.map(p =>
      `<li>${p.name} — ${p.votes} shared keyword${p.votes === 1 ? '' : 's'}${p.keywords && p.keywords.length ? ` (${p.keywords.join(', ')})` : ''} (heuristic keyword match, not a statistical similarity score)</li>`
    ).join('');
    // A resemblance that was re-derived is not the resemblance the case opened
    // with, and reading the current one as the original would be reading a
    // revision as a constant.
    const revs = (mo.resemblanceRevisions || []).length
      ? `<div class="text-[9px] text-amber-300/70 italic mt-1">Revised ${mo.resemblanceRevisions.length} time${mo.resemblanceRevisions.length === 1 ? '' : 's'} since this case opened. ${mo.resemblanceRevisions.map(r => `${r.from || 'no pattern'} → ${r.to || 'no pattern'}: ${r.reason}`).join(' ')}</div>`
      : '';
    const basis = mo.resemblanceBasis ? `<div class="text-[9px] text-slate-500 italic mt-1">${mo.resemblanceBasis.note}</div>` : '';
    return `<div class="mb-2"><div class="text-[10px] font-semibold text-slate-400 uppercase mb-1">Documented patterns sharing vocabulary</div><ul class="list-disc list-inside text-[10px] text-slate-400 space-y-0.5">${rows}</ul>
      ${cov ? `<div class="text-[9px] text-slate-500 italic mt-1">${cov.note}</div>` : ''}${basis}${revs}</div>`;
  }

  /* The heading used to read "What makes this different" over a list of
     resemblance sentences, and vanished entirely for a recurring case, which
     left the case most strongly associated with a pattern saying nothing about
     how it differs from it. The heading now matches the content, and the
     difference question is refused in the open. */
  function renderDifferences(mo) {
    const notes = mo.resemblanceNotes || [];
    if (!notes.length) return '';
    const rows = notes.map(d => `<li>${d}</li>`).join('');
    return `<div class="mb-2"><div class="text-[10px] font-semibold text-slate-400 uppercase mb-1">How this case relates to documented patterns</div><ul class="list-disc list-inside text-[10px] text-slate-400 space-y-0.5">${rows}</ul></div>`;
  }

  /* "Recommended" over a responsive countermeasure quoted from a pattern the
     case merely shares vocabulary with. The heading now says whose
     countermeasures these are, each carries its bucket, and the coverage line
     states how many of the documented set are shown and which bucket is not
     read at all. */
  function renderCountermeasures(mo) {
    const cm = mo.patternCountermeasures;
    if (!cm) return '';
    const scope = FWMoEngine.COUNTERMEASURE_SCOPE;
    const rows = (cm.picks || [])
      .map(p => `<li><span class="text-slate-500 uppercase text-[9px]">${p.bucket}</span> ${p.text}</li>`).join('');
    const head = cm.patternName
      ? `Countermeasures documented for ${cm.patternName}`
      : 'Countermeasures';
    return `<div class="mb-1">
      <div class="text-[10px] font-semibold text-slate-400 uppercase mb-1">${head}</div>
      ${rows ? `<ul class="list-disc list-inside text-[10px] text-slate-400 space-y-0.5 mb-1">${rows}</ul>` : ''}
      <div class="text-[9px] text-amber-300/80 mb-1">${cm.note}</div>
      <div class="text-[9px] text-slate-500 italic mb-1">These are ${scope.means} They are not ${scope.doesNotMean}</div>
    </div>`;
  }

  /* This section used to show the first two of however many the taxonomy
     documented, drop the rest silently, and vanish altogether when there were
     none. All of them now, the count stated, and an empty set stated as a gap
     in the taxonomy's coverage rather than rendered as an absence of innocent
     explanations. */
  function renderFalsePositives(mo) {
    const fp = mo.falsePositives;
    if (!fp) return '';
    const rows = (fp.items || []).map(f => {
      if (typeof f === 'string') return `<li>${f}</li>`;
      return `<li><b>${f.looks_like || ''}</b> — actually: ${f.actually || ''} <i>(rule out: ${f.how_to_rule_out || ''})</i></li>`;
    }).join('');
    return `<div class="mb-2"><div class="text-[10px] font-semibold text-slate-400 uppercase mb-1">Possible legitimate explanations${fp.documented ? ` (${fp.documented})` : ''}</div>
      ${rows ? `<ul class="list-disc list-inside text-[10px] text-slate-400 space-y-0.5">${rows}</ul>` : ''}
      <div class="text-[9px] text-slate-500 italic mt-1">${fp.note}</div></div>`;
  }

  function fmtEffort(seconds) {
    const h = Math.floor(seconds / 3600), m = Math.round((seconds % 3600) / 60);
    if (h && m) return `${h}h ${m}m`;
    if (h) return `${h}h`;
    return `${m}m`;
  }

  function outcomeBadgeClass(outcome) {
    const map = {
      EXCULPATORY: 'bg-emerald-900 text-emerald-300',
      MIXED: 'bg-amber-900 text-amber-300',
      CORROBORATING: 'bg-orange-900 text-orange-300',
      // Deliberately not a warning colour and not a success colour. "There
      // was nothing to look at" is neither, and tinting it either way
      // would make a coverage gap read as a result.
      NO_RECORD_EXISTS: 'bg-slate-800 text-sky-300',
      INCONCLUSIVE: 'bg-slate-800 text-slate-500'
    };
    return map[outcome] || map.INCONCLUSIVE;
  }

  function fmtDelta(delta) {
    if (!delta) return 'no change';
    return `${delta > 0 ? '+' : ''}${delta} pts`;
  }

  function renderFindings(mo) {
    const findings = (mo.investigation && mo.investigation.findings) || [];
    if (!findings.length) return '';
    const rows = findings.map(f => `<li class="mb-1">
      <span class="px-1 py-0.5 rounded text-[9px] font-semibold ${outcomeBadgeClass(f.outcome)}">${f.outcome}</span>
      <span class="text-slate-400">${fmtDelta(f.confidenceDelta)} · ${fmtSimTime(f.at)}</span>
      <div class="text-slate-400">${f.narrative}</div>
    </li>`).join('');
    return `<div class="mb-2"><div class="text-[10px] font-semibold text-slate-400 uppercase mb-1">Findings</div><ul class="text-[10px] text-slate-400 list-none">${rows}</ul></div>`;
  }

  /* What is worth the hours (adviceEngine). This block is careful about
     one thing above all: it orders the checks and it must not read as an
     opinion about the case. So the wording is about effort throughout,
     the inputs to the ordering are printed next to it, and the fact that
     no expected confidence movement went into it is stated rather than
     assumed to be obvious. When the coverage is exhausted this block says
     so and puts nothing forward -- an advisory that always has a next
     action to sell is selling.

     Slice 25 adds the coverage line underneath it, and the reason it is
     four counts rather than a progress figure is that the four are
     different facts. A signal type answered on by a check, a type a check
     was run against and got nothing from, a type nobody has looked at,
     and a type no source in this simulation can read are not degrees of
     the same thing, and a single percentage would put the port's own
     blind spot on the same axis as work not yet done. */
  function renderAdvice(advice, investigable) {
    if (!advice || !investigable) return '';
    if (advice.nothingAvailable) return '';
    const gap = advice.uncheckableNote
      ? `<div class="text-[10px] text-amber-300/80 mt-1">${advice.uncheckableNote}</div>` : '';
    const head = `<div class="text-[10px] font-semibold text-slate-400 uppercase mt-2 mb-1">Worth the hours</div>`;
    const part = advice.typePartition;
    const coverage = part ? `<div class="text-[10px] text-slate-500 mt-1">
      Of this case's ${part.total} signal type${part.total === 1 ? '' : 's'}:
      ${part.spokenTo.length} answered on by a completed check ·
      ${part.unread.length} attempted with nothing to show for it ·
      ${part.neverAttempted.length} not yet looked at ·
      ${part.unsourced.length} that no record source here can read.
      Four counts, not a progress figure &mdash; a gap in what this port records is not work outstanding.
    </div>` : '';
    const unread = advice.unreadNote
      ? `<div class="text-[10px] text-sky-300/80 mt-1">${advice.unreadNote}</div>` : '';
    const foot = `<div class="text-[9px] text-slate-500 italic mt-1">Ordered by coverage per hour: signal types not yet spoken to, times the stated chance the source returns anything, over the effort it costs. No expected confidence movement goes into this ordering in either direction &mdash; the deltas are asymmetric on purpose, so ranking by them would promote either the checks most likely to corroborate or the checks most likely to clear. Which check is worth running is not a claim about what it will find.</div>`;

    if (advice.exhausted) {
      return `${head}<div class="text-[10px] text-slate-400">${advice.exhaustedNote}</div>${unread}${coverage}${gap}${foot}`;
    }

    const rows = advice.candidates.slice(0, 4).map(c => {
      const lead = c === advice.leading;
      return `<li class="mb-1">
        <span class="font-mono text-[10px] ${lead ? 'text-sky-300' : 'text-slate-500'}">#${c.rank}${c.tied ? ' =' : ''}</span>
        <span class="text-[10px] ${lead ? 'text-slate-200' : 'text-slate-400'}">${c.label}</span>
        ${c.secondOpinionOnly ? '<span class="text-[9px] text-slate-500">second opinion only</span>' : ''}
        ${!c.secondOpinionOnly && c.reopensUnreadTypes && c.reopensUnreadTypes.length ? '<span class="text-[9px] text-sky-300/80">reaches ground a spent check could not read</span>' : ''}
        <div class="text-[10px] text-slate-500">${c.basis}</div>
      </li>`;
    }).join('');

    const tie = advice.leadingIsTied
      ? `<div class="text-[10px] text-slate-500">The leading checks tie on these inputs, so no order is claimed between them.</div>` : '';

    return `${head}
      <ul class="list-none text-[10px]">${rows}</ul>
      ${tie}${unread}${coverage}${gap}${foot}`;
  }

  /* Investigation panel (Phases 28-29). Two things are stated plainly here
     because they're true of the underlying engine: confidence is shown
     split into the engine-derived part and the investigation-derived part,
     and gathering evidence can move it either way -- finding a documented
     explanation lowers it more than finding nothing raises it, because a
     record is verifiable and an absence isn't. */
  function renderInvestigation(mo) {
    const state = FWSimRunner.getState();
    if (!state) return '';
    const investigable = FWInvestigationEngine.isInvestigable(mo);
    const sum = FWInvestigationEngine.summary(mo);
    const base = mo.baseConfidence != null ? mo.baseConfidence : mo.confidence;

    /* THE METER USED TO KEY ON THE ADJUSTMENT, NOT ON THE CHECKS. Both
       outcomes that learn nothing move confidence by exactly zero, so a
       case with three checks that all came back empty or unreachable fell
       to the else branch and told the analyst "no investigative checks run
       yet" — in the one panel where the decision to close is taken, and
       about precisely the case the examination vocabulary exists to
       distinguish. Keyed on checksRun now, with the two states named
       separately. */
    const ex = FWInvestigationEngine.examination(mo);
    const checkPhrase = sum.checksRun === 0
      ? '· no record source has been checked yet'
      : sum.adjustment
        ? `<b class="${sum.adjustment < 0 ? 'text-emerald-400' : 'text-orange-400'}">${fmtDelta(sum.adjustment)}</b> from ${sum.checksRun} completed check${sum.checksRun === 1 ? '' : 's'}`
        : `· unchanged by ${sum.checksRun} completed check${sum.checksRun === 1 ? '' : 's'}`;
    const decl = FWMoEngine.CONFIDENCE_INDEX;
    const meter = `<div class="text-[10px] text-slate-400 mb-1">
      ${decl.displayLabel} ${FWMoEngine.formatIndex(mo.confidence)} = ${Math.round(base)} index points from correlated signals
      ${checkPhrase}
      ${sum.effortSeconds ? ` · ${fmtEffort(sum.effortSeconds)} of analyst effort spent` : ''}
    </div>`;

    /* How far this case has been taken, in the shared vocabulary, stated at
       the point of decision. Framed in both directions: a case nothing has
       answered on is not thereby suspicious and not thereby clear. */
    const examLine = ex.everAnswered
      ? ''
      : `<div class="text-[10px] text-amber-300/80 mb-1">Nothing has answered on this case yet — ${ex.note}. That is neither a reason to escalate it nor a reason to clear it; it is a statement about what has been looked at.</div>`;

    const advice = window.FWAdviceEngine ? FWAdviceEngine.advise(state, mo) : null;
    const actions = FWInvestigationEngine.availableActions(state, mo);
    let controls;
    if (!investigable) {
      controls = `<div class="text-[10px] text-slate-500 italic">An analyst closed this case — investigative actions are locked.</div>`;
    } else if (!actions.length) {
      controls = `<div class="text-[10px] text-slate-500 italic">No record source in this simulation can speak to this signal combination.</div>`;
    } else {
      controls = `<div class="flex flex-wrap gap-1.5">` + actions.map(a =>
        `<button data-mo-invest="${a.key}" data-mo-id="${mo.id}" ${a.done ? 'disabled' : ''}
          title="${a.question}${a.siteRecordLikelihood != null ? ` About a ${a.siteRecordLikelihood}% chance a record covering this exists at all, from the site coverage assumptions.` : ''}"
          class="px-2 py-1 rounded-md text-[10px] font-semibold ${a.done ? 'bg-slate-900 text-slate-600 cursor-not-allowed' : 'bg-sky-900 hover:bg-sky-800 text-sky-200'}">${a.label}${a.done ? ' ✓' : ` · ${fmtEffort(a.effortSeconds)}`}${!a.done && a.siteRecordLikelihood != null ? ` · ~${a.siteRecordLikelihood}% has a record` : ''}</button>`
      ).join('') + `</div>`;
    }

    return `<div class="mb-2 pt-2 border-t border-slate-800">
      <div class="text-[10px] font-semibold text-slate-400 uppercase mb-1">Investigate</div>
      ${meter}
      ${examLine}
      ${FWMoEngine.closureHand(mo).hand === 'ENGINE_FADE' ? `<div class="text-[10px] text-slate-500 italic mb-1">${FWMoEngine.closureHand(mo).note}. The records can still be checked.</div>` : ''}
      ${controls}
      ${renderAdvice(advice, investigable)}
      <div class="text-[9px] text-slate-500 italic mt-1">Each source can be checked once per case. A check may come back inconclusive and change nothing. Finding no explanation is an absence of evidence, not proof — it moves confidence far less than finding a documented one. A site record check can also come back with no record existing at all, which moves confidence by exactly nothing: a missing record where watching is thin is what thin watching produces.</div>
      ${sum.noRecordChecks ? `<div class="text-[10px] text-sky-300/80 mt-1">${sum.noRecordChecks} check${sum.noRecordChecks === 1 ? '' : 's'} found no record to examine. That is a gap in what this port observes, counted separately from checks that were run and came back empty.</div>` : ''}
      ${renderFindings(mo)}
    </div>`;
  }

  function renderVerdictOutcome(mo) {
    const v = mo.verdictOutcome;
    if (!v) return '';
    return `<div class="mb-2 pt-2 border-t border-slate-800">
      <div class="text-[10px] font-semibold text-slate-400 uppercase mb-1">Checked against the simulation's record</div>
      <div class="text-[10px] text-slate-400">${v.narrative}</div>
      <div class="text-[9px] text-slate-500 italic mt-1">Shown after closing only. "Unexplained" means no benign cause is on record for it — not that an act is proven.</div>
    </div>`;
  }

  function renderActions(mo) {
    const buttons = ACTIONS.map(a =>
      `<button data-mo-action="${a.action}" data-mo-id="${mo.id}" class="px-2 py-1 rounded-md text-[10px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 ${mo.status === a.status ? 'ring-1 ring-sky-500' : ''}">${a.label}</button>`
    ).join('');
    return `<div class="flex flex-wrap gap-1.5 mt-2">${buttons}</div>`;
  }

  // WHERE the case's signals were observed (Phase 5). A case is a chain
  // of signals over time and a truck moves, so a case often has no single
  // location -- moEngine refuses to invent one, and this refuses to print
  // one. The wording also has to keep the site out of the accusation: a
  // site appears here because a record exists there.
  function renderCaseSites(mo) {
    if (!mo.siteSpread) return '';
    const note = (FWMoEngine.SITE_SPREAD_NOTE && FWMoEngine.SITE_SPREAD_NOTE[mo.siteSpread]) || '';
    if (mo.siteSpread === 'UNSITED') {
      return `<div class="text-[10px] text-slate-500 mt-1">Observed on the open road, at no site. ${note}</div>`;
    }
    const list = (mo.sites || []).map(st =>
      `${st.facilityName} (${st.signalCount} signal${st.signalCount === 1 ? '' : 's'})`).join(', ');
    const road = mo.unsitedSignalCount
      ? ` Plus ${mo.unsitedSignalCount} signal${mo.unsitedSignalCount === 1 ? '' : 's'} observed on the open road, at no site.`
      : '';
    return `<div class="text-[10px] text-slate-500 mt-1">Recorded at: ${list}.${road} ${note}</div>`;
  }

  /* The class was printed with its declared meaning and nothing else. Two of
     the four classes are issued from opposite evidence -- a thin vocabulary
     overlap and a low sighting count both produce "Potential New MO" -- so the
     reason is printed beside the label. Without it the badge asserts one of two
     facts and the reader picks. */
  function classificationReasonLine(mo) {
    if (!mo.classificationReason) return '';
    const d = mo.classificationDetail || {};
    const floor = d.voteFloorConsulted
      ? ` Its top-ranked pattern shares ${d.topVotes} keyword${d.topVotes === 1 ? '' : 's'}, against a declared floor of ${d.voteFloor}.`
      : '';
    const revs = (mo.classificationRevisions || []).length
      ? ` This badge has been re-derived ${mo.classificationRevisions.length} time${mo.classificationRevisions.length === 1 ? '' : 's'} since the case opened: ${mo.classificationRevisions.map(r => `${classificationLabel(r.from)} → ${classificationLabel(r.to)}`).join(', ')}.`
      : '';
    return `<div class="text-[9px] text-slate-500 italic mt-1">Why this badge: ${mo.classificationReasonNote}${floor}${revs} ${(mo.classificationBasis || {}).note || ''}</div>`;
  }

  function renderExecutiveSummary(mo) {
    const sigTypes = (mo.signature || '').split('+').map(t => t.replace(/_/g, ' ')).join(', ');
    return `<div class="mb-2 text-[11px] text-slate-300 leading-snug">
      Involves <b>${mo.entities.truckId}</b>${mo.entities.driverId ? ` (driver ${mo.entities.driverId})` : ''}.
      Opened on the combination: ${sigTypes || 'a correlated signal combination'} — the types it opened with, which the evidence below may since have added to.
      That opening combination has been observed ${mo.recurrenceCount} time${mo.recurrenceCount === 1 ? '' : 's'} in this simulation, currently classified
      <b>${classificationLabel(mo.classification)}</b> — ${FWMoEngine.CLASSIFICATION[mo.classification].means}
      ${classificationReasonLine(mo)}
      ${noveltyLine(mo)}
      ${indexSentence(mo)}
      ${patternHarmNote(mo)}
      ${mo.resolutionReason ? `<br>Resolution note: ${mo.resolutionReason}` : ''}
      ${renderCaseSites(mo)}
    </div>`;
  }

  function renderCard(mo) {
    const isOpen = expanded.has(mo.id);
    const detail = isOpen ? `
      <div class="mt-2 pt-2 border-t border-slate-800">
        ${renderExecutiveSummary(mo)}
        ${renderTimeline(mo)}
        ${renderEvidenceList(mo)}
        ${renderHistoricalMatch(mo)}
        ${renderDifferences(mo)}
        ${renderFalsePositives(mo)}
        ${renderInvestigation(mo)}
        ${renderVerdictOutcome(mo)}
        ${renderCountermeasures(mo)}
        ${renderActions(mo)}
      </div>` : '';

    return `<div class="bg-[#0e1520] border border-slate-800 rounded-lg p-2">
      <div class="flex items-center justify-between mb-1 gap-2 flex-wrap">
        <span class="font-mono text-[11px] text-slate-300">${mo.id} · ${mo.entities.truckId}</span>
        <div class="flex items-center gap-1.5 flex-wrap">
          <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold ${bandBadgeClass(mo.confidenceBand)}">${mo.confidenceBand} · idx ${FWMoEngine.formatIndex(mo.confidence)}</span>
          <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold ${classificationBadgeClass(mo.classification)}">${classificationLabel(mo.classification)}</span>
          <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold ${statusBadgeClass(mo.status)}">${mo.status.replace(/_/g, ' ')}</span>
          <button data-mo-view="${mo.id}" class="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-700 hover:bg-slate-600 text-white">${isOpen ? 'HIDE' : 'VIEW'}</button>
        </div>
      </div>
      <div class="text-xs text-white">${mo.title || 'Unclassified pattern'}</div>
      ${detail}
    </div>`;
  }

  function filteredSorted(state) {
    const mos = Array.from(state.moEngine.mos.values());
    return mos
      .filter(m => statusFilter === 'ALL' || m.status === statusFilter)
      .filter(m => classFilter === 'ALL' || m.classification === classFilter)
      .sort((a, b) => {
        const aOpen = FWMoEngine.OPEN_STATUSES.has(a.status) ? 0 : 1;
        const bOpen = FWMoEngine.OPEN_STATUSES.has(b.status) ? 0 : 1;
        if (aOpen !== bOpen) return aOpen - bOpen;
        return b.lastObserved - a.lastObserved;
      });
  }

  function render(state) {
    if (!state || !els.root) return;
    if (els.root.classList && els.root.classList.contains('hidden')) return;
    const allMos = Array.from(state.moEngine.mos.values());
    renderTabs(allMos);
    renderSummary(state, allMos);
    const mos = filteredSorted(state);
    if (!els.list) return;
    if (!mos.length) {
      els.list.innerHTML = '<p class="text-slate-600 text-xs italic">No cases match this filter.</p>';
      return;
    }
    els.list.innerHTML = mos.map(renderCard).join('');
  }

  return { init, render, setFilter, handleAction, handleInvestigation };
})();
