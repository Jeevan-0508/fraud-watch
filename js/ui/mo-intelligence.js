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

   No fake intelligence (Phase 67): "historical pattern match" below is
   explicitly labeled as an indicator-keyword vote count, not a
   statistical/ML similarity score, because that's what it actually is. */
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

  function classificationBadgeClass(cls) {
    const map = {
      KNOWN_MO: 'bg-slate-700 text-slate-300',
      MO_VARIANT: 'bg-indigo-900 text-indigo-300',
      POTENTIAL_NEW_MO: 'bg-fuchsia-900 text-fuchsia-300',
      EMERGING_BEHAVIOR: 'bg-rose-900 text-rose-300'
    };
    return map[cls] || map.KNOWN_MO;
  }

  function classificationLabel(cls) {
    const map = { KNOWN_MO: 'Known MO', MO_VARIANT: 'New Variant', POTENTIAL_NEW_MO: 'Potential New MO', EMERGING_BEHAVIOR: 'Emerging Behavior' };
    return map[cls] || cls;
  }

  function severityBadgeClass(sev) {
    const map = { LOW: 'bg-slate-700 text-slate-200', WATCH: 'bg-sky-900 text-sky-300', ELEVATED: 'bg-amber-900 text-amber-300', HIGH: 'bg-orange-900 text-orange-300', CRITICAL: 'bg-red-900 text-red-300' };
    return map[sev] || map.LOW;
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
    els.summary.textContent = `${mos.length} total cases · ${summary.totalSignatures} distinct behavior signatures seen`;
  }

  function renderEvidenceList(mo) {
    if (!mo.evidence || !mo.evidence.length) return '';
    const rows = mo.evidence.map(e =>
      `<li>${e.signalType.replace(/_/g, ' ')} — contribution ${e.contribution}, reliability ${Math.round(e.reliability * 100)}% (${fmtSimTime(e.at)})</li>`
    ).join('');
    return `<div class="mb-2"><div class="text-[10px] font-semibold text-slate-400 uppercase mb-1">Signals & evidence</div><ul class="list-disc list-inside text-[10px] text-slate-400 space-y-0.5">${rows}</ul></div>`;
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
    const rows = mo.relatedHistoricalPatterns.map(p =>
      `<li>${p.name} — ${p.votes} indicator-keyword vote${p.votes === 1 ? '' : 's'} (heuristic keyword match, not a statistical similarity score)</li>`
    ).join('');
    return `<div class="mb-2"><div class="text-[10px] font-semibold text-slate-400 uppercase mb-1">Historical pattern match</div><ul class="list-disc list-inside text-[10px] text-slate-400 space-y-0.5">${rows}</ul></div>`;
  }

  function renderDifferences(mo) {
    if (!mo.differencesFromKnownPatterns || !mo.differencesFromKnownPatterns.length) return '';
    const rows = mo.differencesFromKnownPatterns.map(d => `<li>${d}</li>`).join('');
    return `<div class="mb-2"><div class="text-[10px] font-semibold text-slate-400 uppercase mb-1">What makes this different</div><ul class="list-disc list-inside text-[10px] text-slate-400 space-y-0.5">${rows}</ul></div>`;
  }

  function renderFalsePositives(mo) {
    if (!mo.falsePositivePossibilities || !mo.falsePositivePossibilities.length) return '';
    const rows = mo.falsePositivePossibilities.map(f => {
      if (typeof f === 'string') return `<li>${f}</li>`;
      return `<li><b>${f.looks_like || ''}</b> — actually: ${f.actually || ''} <i>(rule out: ${f.how_to_rule_out || ''})</i></li>`;
    }).join('');
    return `<div class="mb-2"><div class="text-[10px] font-semibold text-slate-400 uppercase mb-1">Possible legitimate explanations</div><ul class="list-disc list-inside text-[10px] text-slate-400 space-y-0.5">${rows}</ul></div>`;
  }

  function renderActions(mo) {
    const buttons = ACTIONS.map(a =>
      `<button data-mo-action="${a.action}" data-mo-id="${mo.id}" class="px-2 py-1 rounded-md text-[10px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 ${mo.status === a.status ? 'ring-1 ring-sky-500' : ''}">${a.label}</button>`
    ).join('');
    return `<div class="flex flex-wrap gap-1.5 mt-2">${buttons}</div>`;
  }

  function renderExecutiveSummary(mo) {
    const sigTypes = (mo.signature || '').split('+').map(t => t.replace(/_/g, ' ')).join(', ');
    return `<div class="mb-2 text-[11px] text-slate-300 leading-snug">
      Involves <b>${mo.entities.truckId}</b>${mo.entities.driverId ? ` (driver ${mo.entities.driverId})` : ''}.
      Detected from: ${sigTypes || 'a correlated signal combination'}.
      This exact combination has been observed ${mo.recurrenceCount} time${mo.recurrenceCount === 1 ? '' : 's'} in this simulation, currently classified
      <b>${classificationLabel(mo.classification)}</b> (novelty ${mo.noveltyScore}/100).
      Confidence ${Math.round(mo.confidence)}%, severity ${mo.severity}.
      ${mo.resolutionReason ? `<br>Resolution note: ${mo.resolutionReason}` : ''}
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
        <div class="text-[10px] font-semibold text-slate-400 uppercase mb-1">Recommended</div>
        <ul class="list-disc list-inside text-[10px] text-slate-400 space-y-0.5 mb-1">${(mo.recommendedActions || []).map(a => `<li>${a}</li>`).join('')}</ul>
        ${renderActions(mo)}
      </div>` : '';

    return `<div class="bg-[#0e1520] border border-slate-800 rounded-lg p-2">
      <div class="flex items-center justify-between mb-1 gap-2 flex-wrap">
        <span class="font-mono text-[11px] text-slate-300">${mo.id} · ${mo.entities.truckId}</span>
        <div class="flex items-center gap-1.5 flex-wrap">
          <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold ${severityBadgeClass(mo.severity)}">${mo.severity} · ${Math.round(mo.confidence)}%</span>
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

  return { init, render, setFilter, handleAction };
})();
