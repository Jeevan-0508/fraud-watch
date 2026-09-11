/* ui/entity-inspector.js — click any truck in the Live Sim debug table
   to see its full picture in one place (mega-spec Phase 42): current
   state, the driver/trailer/carrier it's linked to right now, active
   risk signals, recent event history, and every MO (open or closed)
   this truck has ever been part of.

   Entity reputation is shown (Phase 33) but is explicitly not framed
   as guilt: a truck with three past cases that all closed
   FALSE_POSITIVE is not "riskier," it's just been investigated more --
   the panel lists outcomes plainly rather than compressing history
   into a single score that would misrepresent that. */
const FWEntityInspector = (() => {
  let els = {};
  let openTruckId = null;

  function init() {
    els = {
      panel: document.getElementById('entity-inspector-panel'),
      backdrop: document.getElementById('entity-inspector-backdrop'),
      close: document.getElementById('entity-inspector-close'),
      title: document.getElementById('entity-inspector-title'),
      body: document.getElementById('entity-inspector-body'),
      entityTable: document.getElementById('sim-entity-table')
    };
    if (els.close) els.close.addEventListener('click', hide);
    if (els.backdrop) els.backdrop.addEventListener('click', hide);
    if (els.entityTable) {
      els.entityTable.addEventListener('click', (e) => {
        const row = e.target.closest('[data-truck-id]');
        if (!row) return;
        show(row.dataset.truckId);
      });
    }
  }

  function show(truckId) {
    openTruckId = truckId;
    if (els.panel) els.panel.classList.remove('hidden');
    render(FWSimRunner.getState());
  }

  function hide() {
    openTruckId = null;
    if (els.panel) els.panel.classList.add('hidden');
  }

  function isOpen() { return openTruckId != null; }

  function statusBadgeClass(status) {
    const open = { NEW: 'bg-sky-900 text-sky-300', MONITORING: 'bg-slate-700 text-slate-200', INVESTIGATING: 'bg-amber-900 text-amber-300', ESCALATED: 'bg-orange-900 text-orange-300' };
    const closed = { CONFIRMED: 'bg-red-900 text-red-300', FALSE_POSITIVE: 'bg-emerald-900 text-emerald-300', DISMISSED: 'bg-slate-800 text-slate-500', RESOLVED: 'bg-indigo-900 text-indigo-300' };
    return open[status] || closed[status] || 'bg-slate-700 text-slate-200';
  }

  function fmtSimTime(absSeconds) {
    const day = Math.floor(absSeconds / 86400) + 1;
    const s = Math.floor(absSeconds % 86400);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return `Day ${day} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  function render(state) {
    if (!openTruckId || !state || !els.body) return;
    const truck = FWEntityEngine.get(state.registry, 'truck', openTruckId);
    if (!truck) { hide(); return; }

    const driver = truck.driverId ? FWEntityEngine.get(state.registry, 'driver', truck.driverId) : null;
    const trailer = truck.trailerId ? FWEntityEngine.get(state.registry, 'trailer', truck.trailerId) : null;
    const carrier = truck.carrierId ? FWEntityEngine.get(state.registry, 'carrier', truck.carrierId) : null;

    const now = FWSimRunner.absoluteNow(state.clock);
    const activeSignals = FWSignalEngine.getActiveSignals(truck, now);

    const allCases = Array.from(state.moEngine.mos.values()).filter(m => m.entities.truckId === truck.id);
    const outcomeCounts = allCases.reduce((acc, m) => { acc[m.status] = (acc[m.status] || 0) + 1; return acc; }, {});

    if (els.title) els.title.textContent = `${truck.id} — ${truck.status.replace(/_/g, ' ')}`;

    const linksHtml = `<div>
      <div class="text-[10px] font-semibold text-slate-400 uppercase mb-1">Currently linked to</div>
      <div class="text-[11px] text-slate-300 space-y-0.5">
        <div>Driver: ${driver ? `${driver.id} (${driver.name}) — ${driver.status.replace(/_/g, ' ')}` : '—'}</div>
        <div>Trailer: ${trailer ? `${trailer.id} — seal ${trailer.sealId || '—'} — ${trailer.status.replace(/_/g, ' ')}` : '—'}</div>
        <div>Carrier: ${carrier ? `${carrier.name} (${carrier.scac || carrier.id})` : '—'}</div>
        <div>Location: ${truck.location || '—'}</div>
      </div>
    </div>`;

    const signalsHtml = `<div>
      <div class="text-[10px] font-semibold text-slate-400 uppercase mb-1">Active risk signals (${activeSignals.length})</div>
      ${activeSignals.length
        ? `<ul class="list-disc list-inside text-[11px] text-slate-400 space-y-0.5">${activeSignals.map(s => `<li>${s.type.replace(/_/g, ' ')} — reliability ${Math.round(s.reliability * 100)}%</li>`).join('')}</ul>`
        : '<p class="text-slate-600 italic text-[11px]">None right now.</p>'}
    </div>`;

    const history = (truck.history || []).slice(-10).reverse();
    const historyHtml = `<div>
      <div class="text-[10px] font-semibold text-slate-400 uppercase mb-1">Recent history</div>
      ${history.length
        ? `<ul class="list-disc list-inside text-[11px] text-slate-400 space-y-0.5">${history.map(h => `<li>${fmtSimTime(h.t)} — ${(h.summary || h.type).toString().replace(/_/g, ' ')}</li>`).join('')}</ul>`
        : '<p class="text-slate-600 italic text-[11px]">No recorded events yet.</p>'}
    </div>`;

    const outcomeSummary = Object.keys(outcomeCounts).length
      ? Object.entries(outcomeCounts).map(([k, v]) => `${v} ${k.replace(/_/g, ' ').toLowerCase()}`).join(' · ')
      : 'no prior cases';

    const casesHtml = `<div>
      <div class="text-[10px] font-semibold text-slate-400 uppercase mb-1">Case history (${allCases.length}) — ${outcomeSummary}</div>
      ${allCases.length
        ? `<div class="space-y-1.5">${allCases.sort((a, b) => b.lastObserved - a.lastObserved).map(m => `
            <div class="bg-[#0e1520] border border-slate-800 rounded-lg px-2 py-1.5">
              <div class="flex items-center justify-between gap-2">
                <span class="font-mono text-[10px] text-slate-400">${m.id}</span>
                <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold ${statusBadgeClass(m.status)}">${m.status.replace(/_/g, ' ')}</span>
              </div>
              <div class="text-[11px] text-white">${m.title}</div>
            </div>`).join('')}</div>`
        : '<p class="text-slate-600 italic text-[11px]">This truck has never triggered a correlated case. History and reputation here are informational only -- they never decide the next case on their own (Phase 33).</p>'}
    </div>`;

    els.body.innerHTML = linksHtml + signalsHtml + historyHtml + casesHtml;
  }

  return { init, show, hide, render, isOpen };
})();
