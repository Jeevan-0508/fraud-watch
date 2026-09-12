/* training.js — onboarding stepper through the 12 real patterns,
   with the actual indicators, false positives, countermeasures and
   regulatory hooks from the taxonomy. No game mechanics, just study mode.

   Three things this panel must not do, all of which it used to.
   1. Print a bare "w4" beside an observation. A taxonomy indicator weight is
      an analyst-assigned salience on a range this panel does not get to guess:
      it comes from FW.indicatorWeightScale(), it is shown over its maximum,
      and what it is not is stated next to the list rather than left to the
      reader. An unlabelled amber number beside a signal reads as how
      incriminating that signal is, which is the one thing it does not measure.
   2. Bury the taxonomy's own caveat. Three to four indicators per pattern
      carry a `notes` field, and it is where the taxonomy says things like
      "on its own this is only commercial behaviour". That was rendered as a
      trailing fragment of the 12px grey metadata line, at the lowest visual
      weight on the card, while the weight badge was highlighted. The caveat
      now sits at the weight of the signal it qualifies.
   3. Report an undocumented section as a property of the pattern. "No false
      positives documented for this pattern" is a gap in the taxonomy's
      coverage, not a finding that this pattern has none -- and read the second
      way it says observing it is proof. Tab counts are on the buttons so the
      ratio of indicators to documented false positives is visible without
      clicking either one. */
const FWTraining = (() => {
  let idx = 0;
  let activeTab = 'indicators';

  const TABS = ['indicators', 'falsepos', 'counter', 'reg'];

  function patterns() { return FW.patterns(); }
  function ready() { return typeof FW !== 'undefined' && FW.loaded() && (patterns() || []).length > 0; }

  // Absence of a section is a gap in the taxonomy's coverage. Never phrased as
  // a property of the pattern.
  function gapNote(section) {
    return `<p class="text-slate-400 text-sm">The taxonomy documents no ${section} for this pattern. ` +
      `That is the extent of what has been written down here, not a finding that there are none.</p>`;
  }

  function countFor(p, tab) {
    if (tab === 'indicators') return (p.indicators || []).length;
    if (tab === 'falsepos') return (p.false_positives || []).length;
    if (tab === 'reg') return (p.regulatory_hooks || []).length;
    const c = p.countermeasures || {};
    return ['preventive', 'detective', 'responsive'].reduce((n, b) => n + ((c[b] || []).length), 0);
  }

  function renderTabCounts(p) {
    document.querySelectorAll('#tr-tabs .tab-btn').forEach(btn => {
      const tab = btn.dataset.tab;
      if (TABS.indexOf(tab) < 0) return;
      const badge = btn.querySelector('.tab-count');
      if (badge) badge.textContent = String(countFor(p, tab));
    });
  }

  function renderUnloaded() {
    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    set('tr-progress', 'Taxonomy not loaded');
    set('tr-name', 'Field Guide unavailable');
    set('tr-summary', 'The pattern taxonomy has not arrived. Nothing is shown rather than a guide assembled from an empty dataset.');
    const badges = document.getElementById('tr-badges');
    if (badges) badges.innerHTML = '';
    const how = document.getElementById('tr-howitworks');
    if (how) how.innerHTML = '';
    const panel = document.getElementById('tr-panel');
    if (panel) panel.innerHTML = gapNote('pattern content, because the dataset has not loaded');
  }

  function render() {
    if (!ready()) { renderUnloaded(); return; }
    const p = patterns()[idx];
    document.getElementById('tr-progress').textContent = `Pattern ${idx + 1} of ${patterns().length}`;
    document.getElementById('tr-name').textContent = p.name;
    document.getElementById('tr-summary').textContent = p.summary;
    document.getElementById('tr-badges').innerHTML = `
      <span class="badge" style="background:${FW.categoryColor(p.category)}22;color:${FW.categoryColor(p.category)}">${p.category.replace(/_/g, ' ')}</span>
      <span class="badge" style="background:${FW.severityColor(p.severity)}22;color:${FW.severityColor(p.severity)}">${p.severity}</span>
      <span class="badge bg-slate-800 text-slate-300">${p.prevalence}</span>
      <span class="badge bg-slate-800 text-slate-300">${p.id}</span>`;
    document.getElementById('tr-howitworks').innerHTML = p.how_it_works.map(s => `<li>${s}</li>`).join('');
    renderTabCounts(p);
    renderTab(p);
  }

  // The weight, over the maximum of the scale the loaded taxonomy actually
  // uses. FW owns that range; this panel does not restate it.
  function weightBadge(i) {
    const scale = FW.indicatorWeightScale();
    if (!scale) return '';
    return `<span class="badge bg-slate-800 text-slate-300 shrink-0 whitespace-nowrap">salience ${i.weight} / ${scale.max}</span>`;
  }

  function weightLegend(p) {
    const scale = FW.indicatorWeightScale();
    if (!scale) return '';
    return `<div class="mt-3 border-t border-slate-800 pt-2 text-xs text-slate-400 space-y-1">
      <p><b class="text-slate-300">Salience ${scale.min}–${scale.max}</b> is a ${scale.kind.toLowerCase()} the taxonomy assigns: ${scale.means}</p>
      <p>It is not ${scale.doesNotMean}</p>
      <p>${(p.indicators || []).length} indicators are documented for this pattern. Observing any of them is an observation; it is not a finding that this pattern is present.</p>
    </div>`;
  }

  function renderTab(p) {
    const panel = document.getElementById('tr-panel');
    if (activeTab === 'indicators') {
      panel.innerHTML = `<div class="space-y-2">${(p.indicators || []).map(i => `
        <div class="bg-[#111823] rounded-lg px-3 py-2">
          <div class="flex items-start justify-between gap-3">
            <p class="text-sm text-slate-200">${i.signal}</p>
            ${weightBadge(i)}
          </div>
          <p class="text-xs text-slate-500 mt-0.5">Observable in: ${i.observable_in} · phase: ${i.phase.replace(/_/g, ' ')}</p>
          ${i.notes ? `<p class="text-sm text-slate-300 mt-1.5 border-l-2 border-slate-600 pl-2">${i.notes}</p>` : ''}
        </div>`).join('')}</div>${weightLegend(p)}`;
    } else if (activeTab === 'falsepos') {
      panel.innerHTML = (p.false_positives && p.false_positives.length)
        ? `<div class="space-y-3">${p.false_positives.map(f => `
            <div class="bg-[#111823] rounded-lg px-3 py-2">
              <p class="text-sm text-slate-200"><b>Looks like:</b> ${f.looks_like}</p>
              <p class="text-sm text-slate-400 mt-1"><b>Actually:</b> ${f.actually}</p>
              <p class="text-sm text-sky-300 mt-1"><b>Rule it out:</b> ${f.how_to_rule_out}</p>
            </div>`).join('')}</div>`
        : gapNote('false positives');
    } else if (activeTab === 'counter') {
      const buckets = ['preventive', 'detective', 'responsive'];
      panel.innerHTML = buckets.map(b => {
        const list = (p.countermeasures && p.countermeasures[b]) || [];
        return `<div class="mb-3">
          <p class="text-xs text-slate-500 uppercase mb-1">${b} (${list.length})</p>
          ${list.length
            ? `<ul class="text-sm text-slate-300 space-y-1">${list.map(c => `<li>• ${c}</li>`).join('')}</ul>`
            : gapNote(b + ' countermeasures')}
        </div>`;
      }).join('');
    } else if (activeTab === 'reg') {
      panel.innerHTML = (p.regulatory_hooks && p.regulatory_hooks.length)
        ? `<div class="space-y-2">${p.regulatory_hooks.map(r => `
            <div class="bg-[#111823] rounded-lg px-3 py-2">
              <p class="text-sm text-slate-200"><b>${r.instrument}</b> — ${r.provision}</p>
              <p class="text-xs text-slate-400 mt-1">${r.relevance}</p>
            </div>`).join('')}</div>`
        : gapNote('regulatory hooks');
    } else {
      throw new Error('training.renderTab: unknown tab "' + activeTab + '"; a panel would be left showing the previous pattern\'s content');
    }
  }

  function step(delta) {
    if (!ready()) { renderUnloaded(); return; }
    const n = patterns().length;
    idx = (idx + delta + n) % n;
    render();
  }

  function init() {
    document.getElementById('tr-prev').addEventListener('click', () => step(-1));
    document.getElementById('tr-next').addEventListener('click', () => step(1));
    document.querySelectorAll('#tr-tabs .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        activeTab = btn.dataset.tab;
        document.querySelectorAll('#tr-tabs .tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (!ready()) { renderUnloaded(); return; }
        renderTab(patterns()[idx]);
      });
    });
    render();
  }

  return { init, TABS, countFor };
})();
