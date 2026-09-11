/* training.js — onboarding stepper through the 12 real patterns,
   with the actual indicators, false positives, countermeasures and
   regulatory hooks from the taxonomy. No game mechanics, just study mode. */
const FWTraining = (() => {
  let idx = 0;
  let activeTab = 'indicators';

  function patterns() { return FW.patterns(); }

  function render() {
    const p = patterns()[idx];
    document.getElementById('tr-progress').textContent = `Pattern ${idx + 1} of ${patterns().length}`;
    document.getElementById('tr-name').textContent = p.name;
    document.getElementById('tr-summary').textContent = p.summary;
    document.getElementById('tr-badges').innerHTML = `
      <span class="badge" style="background:${FW.categoryColor(p.category)}22;color:${FW.categoryColor(p.category)}">${p.category.replace('_',' ')}</span>
      <span class="badge" style="background:${FW.severityColor(p.severity)}22;color:${FW.severityColor(p.severity)}">${p.severity}</span>
      <span class="badge bg-slate-800 text-slate-300">${p.prevalence}</span>
      <span class="badge bg-slate-800 text-slate-300">${p.id}</span>`;
    document.getElementById('tr-howitworks').innerHTML = p.how_it_works.map(s => `<li>${s}</li>`).join('');
    renderTab(p);
  }

  function renderTab(p) {
    const panel = document.getElementById('tr-panel');
    if (activeTab === 'indicators') {
      panel.innerHTML = `<div class="space-y-2">${p.indicators.map(i => `
        <div class="bg-[#111823] rounded-lg px-3 py-2 flex items-start justify-between gap-3">
          <div>
            <p class="text-sm text-slate-200">${i.signal}</p>
            <p class="text-xs text-slate-500 mt-0.5">Observable in: ${i.observable_in} · phase: ${i.phase.replace('_',' ')}${i.notes ? ' · ' + i.notes : ''}</p>
          </div>
          <span class="badge bg-slate-800 text-amber-300 shrink-0">w${i.weight}</span>
        </div>`).join('')}</div>`;
    } else if (activeTab === 'falsepos') {
      panel.innerHTML = (p.false_positives && p.false_positives.length)
        ? `<div class="space-y-3">${p.false_positives.map(f => `
            <div class="bg-[#111823] rounded-lg px-3 py-2">
              <p class="text-sm text-slate-200"><b>Looks like:</b> ${f.looks_like}</p>
              <p class="text-sm text-slate-400 mt-1"><b>Actually:</b> ${f.actually}</p>
              <p class="text-sm text-sky-300 mt-1"><b>Rule it out:</b> ${f.how_to_rule_out}</p>
            </div>`).join('')}</div>`
        : `<p class="text-slate-500 text-sm">No false positives documented for this pattern.</p>`;
    } else if (activeTab === 'counter') {
      const buckets = ['preventive', 'detective', 'responsive'];
      panel.innerHTML = buckets.map(b => `
        <div class="mb-3">
          <p class="text-xs text-slate-500 uppercase mb-1">${b}</p>
          <ul class="text-sm text-slate-300 space-y-1">${(p.countermeasures[b] || []).map(c => `<li>• ${c}</li>`).join('')}</ul>
        </div>`).join('');
    } else if (activeTab === 'reg') {
      panel.innerHTML = (p.regulatory_hooks && p.regulatory_hooks.length)
        ? `<div class="space-y-2">${p.regulatory_hooks.map(r => `
            <div class="bg-[#111823] rounded-lg px-3 py-2">
              <p class="text-sm text-slate-200"><b>${r.instrument}</b> — ${r.provision}</p>
              <p class="text-xs text-slate-400 mt-1">${r.relevance}</p>
            </div>`).join('')}</div>`
        : `<p class="text-slate-500 text-sm">No regulatory hooks documented for this pattern.</p>`;
    }
  }

  function init() {
    document.getElementById('tr-prev').addEventListener('click', () => {
      idx = (idx - 1 + patterns().length) % patterns().length;
      render();
    });
    document.getElementById('tr-next').addEventListener('click', () => {
      idx = (idx + 1) % patterns().length;
      render();
    });
    document.querySelectorAll('#tr-tabs .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        activeTab = btn.dataset.tab;
        document.querySelectorAll('#tr-tabs .tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderTab(patterns()[idx]);
      });
    });
    render();
  }

  return { init };
})();
