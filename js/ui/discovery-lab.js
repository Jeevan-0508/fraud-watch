/* ui/discovery-lab.js -- the Discovery Lab (mega-spec Part 11/12): the one
   screen that shows candidateEngine's own record, and lets an analyst move
   it, and nothing else. moEngine already showed POTENTIAL_NEW_MO/
   EMERGING_BEHAVIOR as filter chips on the MO Intelligence Center; this is
   the dedicated surface Part 11 actually asked for -- a signature's whole
   CANDIDATE -> REVIEW -> {VALIDATED,REJECTED} life, and the two buttons
   (Start Review, Validate/Reject) that are the only way it ever moves.

   THE SCOREBOARD READS ONLY REAL STATE (Part 12). Every number on it comes
   from FWCandidateEngine.summary() or FWMoEngine.discoverySummary() --
   reconciled tallies the engines already compute and already throw on if a
   record fails to sort into exactly one bucket. Nothing here is a second,
   UI-side computation of a number an engine already owns, and nothing here
   is a predictive score: it is a count of what has been surfaced and a
   count of what has been resolved, same discipline calibration-view.js
   applies to analyst decisions -- a mirror, not a score.

   GROUND-TRUTH BOUNDARY, RESTATED FOR THIS FILE. intentEngine.GROUND_TRUTH
   names "any file under js/ui/" as forbidden from reading the plan book,
   for the same reason candidateEngine itself is forbidden downstream of
   behaviorEngine: this panel is the analyst's own view of what the
   defender-visible engines surfaced, not a window onto the hidden
   adversary state that produced it. So "adversarial" here means the two
   things a defender can actually see set against each other -- how much
   still-novel signal moEngine is surfacing, against how much of that this
   review process has actually resolved -- never a comparison against
   intentBook, which this file never reads and never will. */
const FWDiscoveryLab = (() => {
  let els = {};
  let stateFilter = 'ALL';

  function stateFilters() { return ['ALL'].concat(FWCandidateEngine.STATES); }

  const STATE_TONE = {
    CANDIDATE: 'bg-slate-700 text-slate-200',
    REVIEW: 'bg-amber-900 text-amber-300',
    VALIDATED: 'bg-emerald-900 text-emerald-300',
    REJECTED: 'bg-rose-900 text-rose-300'
  };
  function stateTone(s) { return STATE_TONE[s] || 'bg-slate-700 text-slate-200'; }

  /* A validation rate over fewer than this many resolved candidates is a
     coin flip wearing a percentage sign. Below it the panel prints the two
     counts and stops -- the same refusal calibration-view.js and
     analytics-view.js already both apply to their own rates, restated here
     rather than copied as a shared constant because the base each of the
     three withholds against is a different quantity (decided cases,
     analytics samples, resolved candidates) and a shared threshold would
     imply they ought to agree, which they have no reason to. ASSUMED. */
  const MIN_RESOLVED_FOR_RATE = 3;

  const ACTIONS = [
    { action: 'start-review', label: 'Start Review', fromState: 'CANDIDATE' },
    { action: 'validate', label: 'Validate', fromState: 'REVIEW', verdict: 'VALIDATED' },
    { action: 'reject', label: 'Reject', fromState: 'REVIEW', verdict: 'REJECTED' }
  ];

  function init() {
    els = {
      root: document.getElementById('discovery-lab-root'),
      scoreboard: document.getElementById('discovery-lab-scoreboard'),
      tabs: document.getElementById('discovery-lab-tabs'),
      list: document.getElementById('discovery-lab-list')
    };
    if (els.list) {
      els.list.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-cand-action]');
        if (btn) handleAction(btn.dataset.candSignature, btn.dataset.candAction);
      });
    }
  }

  function setFilter(value) {
    stateFilter = value;
    render(FWSimRunner.getState());
  }

  /* Refuses rather than throws on a stale click, the same shape
     startReview()/resolve() themselves return -- a button rendered for a
     record already moved past this step by the time it was clicked is a
     stale render, not a logic error, and re-rendering is the whole fix. */
  function handleAction(signature, action) {
    const state = FWSimRunner.getState();
    if (!state || !state.candidateStore || !signature) return;
    const def = ACTIONS.find(a => a.action === action);
    if (!def) return;
    const now = FWSimRunner.absoluteNow(state.clock);
    if (def.action === 'start-review') {
      FWCandidateEngine.startReview(state.candidateStore, signature, now);
    } else {
      const note = typeof window.prompt === 'function' ? window.prompt('Note for this ' + def.label.toLowerCase() + ' (optional):', '') : '';
      if (note === null) return; // cancelled, not an empty note
      FWCandidateEngine.resolve(state.candidateStore, signature, def.verdict, now, note);
    }
    render(state);
  }

  function fmtAt(absSeconds) {
    return window.FWMoIntelligence ? FWMoIntelligence.fmtSimTime(absSeconds) : String(absSeconds);
  }

  function renderTabs(records) {
    if (!els.tabs) return;
    els.tabs.innerHTML = stateFilters().map(s => {
      const count = s === 'ALL' ? records.length : records.filter(r => r.state === s).length;
      const active = stateFilter === s;
      return `<button data-tab-value="${s}" class="px-2 py-1 rounded-md text-[10px] font-semibold ${active ? 'bg-sky-700 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}">${s.replace(/_/g, ' ')} (${count})</button>`;
    }).join('');
    els.tabs.querySelectorAll('[data-tab-value]').forEach(b => {
      b.addEventListener('click', () => setFilter(b.dataset.tabValue));
    });
  }

  function renderScoreboard(state) {
    if (!els.scoreboard) return;
    const csum = FWCandidateEngine.summary(state.candidateStore);
    const dsum = FWMoEngine.discoverySummary(state.moEngine);
    const eligibleSighted = FWCandidateEngine.ELIGIBLE_CLASSIFICATIONS
      .reduce((n, k) => n + (dsum.byClassification[k] || 0), 0);
    const resolved = csum.byState.VALIDATED + csum.byState.REJECTED;
    const rateLine = resolved >= MIN_RESOLVED_FOR_RATE
      ? `${Math.round((csum.byState.VALIDATED / resolved) * 100)}% of ${resolved} resolved candidates validated as a genuinely new pattern.`
      : `Validated ${csum.byState.VALIDATED} of ${resolved} resolved -- rate withheld until at least ${MIN_RESOLVED_FOR_RATE} are resolved, to avoid a percentage over a coin-flip base.`;
    els.scoreboard.innerHTML = `
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
        <div class="bg-[#0e1520] border border-slate-800 rounded-lg p-2"><div class="text-[10px] text-slate-500">Still-novel cases sighted</div><div class="text-base text-white">${eligibleSighted}</div></div>
        <div class="bg-[#0e1520] border border-slate-800 rounded-lg p-2"><div class="text-[10px] text-slate-500">Candidates surfaced</div><div class="text-base text-white">${csum.total}</div></div>
        <div class="bg-[#0e1520] border border-slate-800 rounded-lg p-2"><div class="text-[10px] text-slate-500">Awaiting / in review</div><div class="text-base text-white">${csum.byState.CANDIDATE} / ${csum.byState.REVIEW}</div></div>
        <div class="bg-[#0e1520] border border-slate-800 rounded-lg p-2"><div class="text-[10px] text-slate-500">Validated / rejected</div><div class="text-base text-white">${csum.byState.VALIDATED} / ${csum.byState.REJECTED}</div></div>
      </div>
      <p class="text-[10px] text-slate-500">${rateLine} "Still-novel cases sighted" is every case moEngine currently classifies ${FWCandidateEngine.ELIGIBLE_CLASSIFICATIONS.join(' or ')} -- a candidate is only surfaced once a signature reaches ${FWCandidateEngine.CANDIDATE_SIGHTING_FLOOR} such sightings, so this count is always >= candidates surfaced, never the same number restated.</p>`;
  }

  function renderProvenance(record) {
    const rows = record.provenance.map(p =>
      `<span class="px-1.5 py-0.5 rounded text-[9px] font-semibold ${FWMoEngine.classificationTone(p.classification)}">${p.moId}</span>`).join(' ');
    return `<div class="text-[10px] text-slate-500 mt-1">Provenance (${record.provenance.length}, append-only): ${rows}</div>`;
  }

  function renderHistory(record) {
    const line = record.history.map(h =>
      `${h.from || 'start'} \u2192 ${h.to}${h.at != null ? ' (' + fmtAt(h.at) + ')' : ''}`).join(' \u2022 ');
    return `<div class="text-[9px] text-slate-500 italic mt-1">${line}</div>`;
  }

  function renderActions(record) {
    const buttons = ACTIONS.filter(a => a.fromState === record.state).map(a =>
      `<button data-cand-action="${a.action}" data-cand-signature="${record.signature}" class="px-2 py-1 rounded-md text-[10px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300">${a.label}</button>`).join('');
    return buttons ? `<div class="flex flex-wrap gap-1.5 mt-2">${buttons}</div>` : '';
  }

  function renderCard(record) {
    return `<div class="bg-[#0e1520] border border-slate-800 rounded-lg p-2">
      <div class="flex items-center justify-between mb-1 gap-2 flex-wrap">
        <span class="font-mono text-[11px] text-slate-300">${record.signature}</span>
        <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold ${stateTone(record.state)}">${record.state}</span>
      </div>
      <div class="text-[10px] text-slate-500">First seen ${fmtAt(record.firstSeenAt)} \u00b7 promoted to candidate ${fmtAt(record.promotedAt)}${record.resolvedAt != null ? ' \u00b7 resolved ' + fmtAt(record.resolvedAt) : ''}</div>
      ${record.resolutionNote ? `<div class="text-[10px] text-slate-400 mt-1">Resolution note: ${record.resolutionNote}</div>` : ''}
      ${renderProvenance(record)}
      ${renderHistory(record)}
      ${renderActions(record)}
    </div>`;
  }

  function filteredSorted(state) {
    const all = FWCandidateEngine.summary(state.candidateStore).records;
    return all
      .filter(r => stateFilter === 'ALL' || r.state === stateFilter)
      .sort((a, b) => b.promotedAt - a.promotedAt);
  }

  function render(state) {
    if (!state || !els.root || !state.candidateStore) return;
    if (els.root.classList && els.root.classList.contains('hidden')) return;
    renderScoreboard(state);
    const all = FWCandidateEngine.summary(state.candidateStore).records;
    renderTabs(all);
    const records = filteredSorted(state);
    if (!els.list) return;
    els.list.innerHTML = records.length
      ? records.map(renderCard).join('')
      : '<p class="text-slate-600 text-xs italic">No candidates match this filter.</p>';
  }

  return { init, render, setFilter, handleAction };
})();
