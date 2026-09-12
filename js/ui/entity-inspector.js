/* ui/entity-inspector.js — click any truck in the Live Sim debug table
   to see its full picture in one place (mega-spec Phase 42): current
   state, the driver/trailer/carrier it's linked to right now, active
   risk signals, recent event history, and every MO (open or closed)
   this truck has ever been part of.

   Entity reputation is shown (Phase 33) but is explicitly not framed
   as guilt: a truck with three past cases that all closed
   FALSE_POSITIVE is not "riskier," it's just been investigated more --
   the panel lists outcomes plainly rather than compressing history
   into a single score that would misrepresent that.

   SITES ARE INSPECTABLE TOO (Phase 5), and they need the opposite
   treatment from a truck rather than the same one. For a truck, the cases
   it appears in are cases ABOUT it. For a site they are not: a site
   appears in a case because a record exists there, and every movement in
   the port crosses a handful of gates and yards. A gatehouse accrues
   cases the way a road accrues traffic. Slice 17 already had to mark
   sites STRUCTURAL in the network graph for exactly this reason, and an
   inspector that listed a site's cases as "case history" would
   reintroduce the same artefact one entity at a time.

   Worse, the count has no denominator. How many movements passed through
   a site is not tracked anywhere in this simulation, so a site's case
   count is a numerator on its own -- it cannot be turned into a rate, and
   the coverage model refuses a per-site incident rate for a separate and
   equally binding reason. The facility panel therefore states the count,
   states the assumed coverage that produced it, and states plainly that
   a site cannot be a subject of a case in this model: there is no such
   entity role, so nothing here is an allegation about a site.

   WHETHER A CASE WAS EXAMINED AT ALL (Slice 26). This panel predated the
   distinction between a check that answered, a check that found nothing
   to fetch, and no check at all, so it listed a truck's cases by status
   as though every status had been arrived at by looking. Some were not.
   A case that faded and closed with no check ever run against it is not
   the same fact as one dismissed after the records were pulled, and
   compressing both into "1 dismissed" hid the more useful half. Both
   panels now state which, in counts, and both say the same thing about
   what those counts are: an unexamined case is a fact about what was
   looked at, never a fact about the truck.

   AND WHOSE HAND CLOSED IT (Slice 35). The examination line says how far a
   case was taken; it does not say who took it there. A case can have two
   answered checks on it and still have been dropped by the correlation
   engine when its signals stopped, because running a check does not touch
   the status -- so a badge reading DISMISSED beside "2 checks run, 2
   answered" reads as an analyst having examined it and decided, when
   nobody decided anything. Both case lists here now carry the closing hand
   from moEngine's own rule rather than a fourth local reading of one
   boolean.

   AND WHAT A PULL AGAINST A SITE ACTUALLY RETURNED (Slice 35). The site
   panel cut its record pulls two ways -- the ones with nothing to fetch,
   and "the rest returned something to read" -- and the rest included the
   pulls where the source could not be reached. Effort spent, nothing read,
   counted as read. It runs one way only, and it ran on the one panel whose
   whole subject is not confusing how hard a site watches with what
   happened there. The cut is three ways now, summed and asserted in the
   engine that owns the outcomes. */
const FWEntityInspector = (() => {
  let els = {};
  let openKind = null;   // 'truck' | 'facility'
  let openId = null;

  function init() {
    els = {
      panel: document.getElementById('entity-inspector-panel'),
      backdrop: document.getElementById('entity-inspector-backdrop'),
      close: document.getElementById('entity-inspector-close'),
      title: document.getElementById('entity-inspector-title'),
      body: document.getElementById('entity-inspector-body'),
      entityTable: document.getElementById('sim-entity-table'),
      facilityTable: document.getElementById('facility-table')
    };
    if (els.close) els.close.addEventListener('click', hide);
    if (els.backdrop) els.backdrop.addEventListener('click', hide);
    if (els.entityTable) {
      els.entityTable.addEventListener('click', (e) => {
        const row = e.target.closest('[data-truck-id]');
        if (!row) return;
        show('truck', row.dataset.truckId);
      });
    }
    if (els.facilityTable) {
      els.facilityTable.addEventListener('click', (e) => {
        const row = e.target.closest('[data-facility-id]');
        if (!row) return;
        show('facility', row.dataset.facilityId);
      });
    }
  }

  // Two-argument form. The single-argument call is kept working because
  // network-view opens trucks by id, and silently changing that would
  // break a working surface for no gain.
  function show(kind, id) {
    if (id === undefined) { id = kind; kind = 'truck'; }
    openKind = kind;
    openId = id;
    if (els.panel) els.panel.classList.remove('hidden');
    render(FWSimRunner.getState());
  }

  function hide() {
    openKind = null;
    openId = null;
    if (els.panel) els.panel.classList.add('hidden');
  }

  function isOpen() { return openId != null; }

  function statusBadgeClass(status) {
    const open = { NEW: 'bg-sky-900 text-sky-300', MONITORING: 'bg-slate-700 text-slate-200', INVESTIGATING: 'bg-amber-900 text-amber-300', ESCALATED: 'bg-orange-900 text-orange-300' };
    const closed = { CONFIRMED: 'bg-red-900 text-red-300', FALSE_POSITIVE: 'bg-emerald-900 text-emerald-300', DISMISSED: 'bg-slate-800 text-slate-500', RESOLVED: 'bg-indigo-900 text-indigo-300' };
    return open[status] || closed[status] || 'bg-slate-700 text-slate-200';
  }

  /* The closing hand, from moEngine's rule rather than a local reading of
     `autoFaded`. Both case lists on this panel use it: a site's list and a
     truck's list print the same status words and neither said who arrived
     at them. Nothing is printed for an open case -- there is no closing
     hand yet, and inventing one would report a decision. */
  function closureHandLine(mo) {
    if (!window.FWMoEngine || !FWMoEngine.closureHand) return '';
    const h = FWMoEngine.closureHand(mo);
    if (h.hand !== 'ENGINE_FADE') return '';
    return `<div class="text-[10px] text-slate-500 italic">${h.note}.</div>`;
  }

  function fmtSimTime(absSeconds) {
    const day = Math.floor(absSeconds / 86400) + 1;
    const s = Math.floor(absSeconds % 86400);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return `Day ${day} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  /* A site's panel, and the three things it must not become.

     It must not become a case history. A site is in a case because a
     record exists there, so the heading says that instead, and every row
     says whether the whole case was observed at this one site or whether
     this site is one of several -- reusing the spread the case already
     carries rather than inventing a location for it.

     It must not become a ranking. The count here is a count of records at
     an observation point. The site that watches hardest records the most,
     which is stated with the count and not underneath it.

     It must not become a rate. How many movements passed through a site is
     not tracked anywhere in this simulation, so the count has no
     denominator and cannot be given one honestly -- separately from the
     coverage model's own refusal of a per-site incident rate. */
  function renderFacility(state) {
    const facility = FWEntityEngine.get(state.registry, 'facility', openId);
    if (!facility) { hide(); return; }
    const arch = FWFacilityEngine.archetype(facility.kind);
    const summary = FWFacilityEngine.siteSummary(state.registry, state.facilityTracker);
    const row = summary.rows.find(r => r.facilityId === facility.id) || {
      recorded: 0, meanCoverage: 0, coverageAdjusted: null, rawRank: null, adjustedRank: null,
      rankMoved: false, topType: null, topTypeCount: 0, byShift: {}
    };

    if (els.title) els.title.textContent = `${facility.name} — ${arch.label}`;

    const whatHtml = `<div>
      <div class="text-[10px] font-semibold text-slate-400 uppercase mb-1">What this site is</div>
      <div class="text-[11px] text-slate-300 space-y-0.5">
        <div>Type: ${arch.label} · status ${facility.status.replace(/_/g, ' ').toLowerCase()}</div>
        <div>Assumed oversight factor: ${arch.oversightFactor.toFixed(2)}× the shift's own coverage</div>
        <div>Mean assumed coverage across the day: ${Math.round(row.meanCoverage * 100)}%</div>
      </div>
      <p class="text-[10px] text-slate-500 mt-1">${arch.rationale}</p>
      <p class="text-[10px] text-slate-500 mt-1">Both figures are stated modeling assumptions, not measured detection rates for anything.</p>
    </div>`;

    const shiftRows = Object.keys(row.byShift || {})
      .sort((a, b) => row.byShift[b] - row.byShift[a])
      .map(k => `<li>${k} — ${row.byShift[k]}</li>`).join('');

    const recordsHtml = `<div>
      <div class="text-[10px] font-semibold text-slate-400 uppercase mb-1">Records at this site (${row.recorded})</div>
      <div class="text-[11px] text-slate-300 space-y-0.5">
        <div>Most recorded here: ${row.topType ? `${row.topType.replace(/_/g, ' ').toLowerCase()} (${row.topTypeCount}×)` : 'nothing recorded here yet'}</div>
        <div>Rank by raw records: ${row.rawRank != null ? '#' + row.rawRank : '—'} · rank once grossed up by its own assumed coverage: ${row.adjustedRank != null ? '#' + row.adjustedRank : '—'}${row.rankMoved ? ' <span class="text-amber-300/80">(moves)</span>' : ''}</div>
      </div>
      ${shiftRows ? `<ul class="list-disc list-inside text-[11px] text-slate-400 space-y-0.5 mt-1">${shiftRows}</ul>` : ''}
      <p class="text-[10px] text-amber-300/80 mt-1">Recording is work. A site that reconciles every movement produces records and a site that reconciles nothing produces silence, so this number measures observation at least as much as occurrence.</p>
      <p class="text-[10px] text-slate-500 mt-1">How many movements passed through here is not tracked in this simulation, so this count has no denominator: it cannot be turned into a rate, and the coverage model separately refuses a per-site incident rate because dividing records by an assumed coverage returns the assumption.</p>
    </div>`;

    const cases = Array.from(state.moEngine.mos.values())
      .filter(m => (m.sites || []).some(x => x.facilityId === facility.id))
      .sort((a, b) => b.lastObserved - a.lastObserved);

    const caseRows = cases.map(m => {
      const here = (m.sites || []).find(x => x.facilityId === facility.id);
      const sole = m.entities && m.entities.facilityId === facility.id;
      const spreadNote = (FWMoEngine.SITE_SPREAD_NOTE && FWMoEngine.SITE_SPREAD_NOTE[m.siteSpread]) || '';
      return `<div class="bg-[#0e1520] border border-slate-800 rounded-lg px-2 py-1.5">
        <div class="flex items-center justify-between gap-2">
          <span class="font-mono text-[10px] text-slate-400">${m.id}</span>
          <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold ${statusBadgeClass(m.status)}">${m.status.replace(/_/g, ' ')}</span>
        </div>
        <div class="text-[11px] text-white">${m.title}</div>
        <div class="text-[10px] text-slate-500">${here ? here.signalCount : 0} of this case's signals were observed here${sole ? ', and every signal in it was' : ', and it also has signals recorded elsewhere'}.</div>
        <div class="text-[10px] text-slate-600">${spreadNote}</div>
        ${closureHandLine(m)}
      </div>`;
    }).join('');

    const casesHtml = `<div>
      <div class="text-[10px] font-semibold text-slate-400 uppercase mb-1">Cases with a signal observed here (${cases.length})</div>
      <p class="text-[10px] text-slate-500 mb-1">Not a case history for this site. A site appears in a case because a record exists here, and every movement in this port crosses a handful of gates and yards, so a busy gatehouse accumulates cases the way a road accumulates traffic.</p>
      ${cases.length ? `<div class="space-y-1.5">${caseRows}</div>`
        : '<p class="text-slate-600 italic text-[11px]">No case has a signal recorded here yet. That is an absence of records, which is not the same as an absence of events.</p>'}
    </div>`;

    /* What the site-record checks touching this site came back with. The
       count is measured and the denominator is real -- the checks run --
       and it is still not a measurement of this site's coverage, because
       the empty results were generated from the stated coverage parameter
       printed a few lines above. Reading the observed empty share as
       evidence about coverage would be taking the assumption back out of
       its own output. */
    const checks = FWInvestigationEngine.siteCheckOutcomes(Array.from(state.moEngine.mos.values()), facility.id);
    const cut = checks.cut;
    const cutRows = cut
      ? cut.keys.map(k => `<div>${cut[k]} of ${cut.checks} ${cut.notes[k]}.</div>`).join('')
      : '';
    const checksHtml = checks.checks
      ? `<div>
          <div class="text-[10px] font-semibold text-slate-400 uppercase mb-1">Record checks pulled against this site (${checks.checks})</div>
          <div class="text-[11px] text-slate-300 space-y-0.5">
            <div>Across ${checks.cases} case${checks.cases === 1 ? '' : 's'}:</div>
            ${cutRows}
          </div>
          <p class="text-[10px] text-slate-500 mt-1">Three buckets over the ${cut ? cut.checks : checks.checks} pulls, summing to them. A pull that could not be reached is not a record that was read, and it is not the same fact as no record existing: the first says this attempt missed, the second says the record was never written.</p>
          <p class="text-[10px] text-amber-300/80 mt-1">This is a count of what the analyst's own checks here returned. It is not a measured coverage rate for this site: those empty results are produced by the assumed coverage figure stated above, so reading them back as evidence about coverage would be returning the assumption to itself.</p>
        </div>`
      : `<div>
          <div class="text-[10px] font-semibold text-slate-400 uppercase mb-1">Record checks pulled against this site (0)</div>
          <p class="text-[11px] text-slate-600 italic">No case with a signal here has had its site record pulled yet. Nothing is known about what this site would have returned, which is not the same as it having nothing.</p>
        </div>`;

    const framingHtml = `<div class="bg-[#0e1520] border border-rose-900/40 rounded-xl p-2">
      <div class="text-[10px] uppercase tracking-wide text-rose-400/80 mb-1">What this panel is not</div>
      <p class="text-[10px] text-slate-400">A site cannot be the subject of a case in this model — there is no such entity role, and nothing on this panel is an allegation about a site or the people who run it. Everything above is either a stated assumption about how well this site is observed, or a count of records that exist here.</p>
      <p class="text-[10px] text-slate-400 mt-1">The same limit applies here as everywhere else in the network view: a site connects to nearly everything whatever is happening, which is why sites are excluded from the structural analysis there rather than being read as unusually connected.</p>
    </div>`;

    els.body.innerHTML = whatHtml + recordsHtml + checksHtml + casesHtml + framingHtml;
  }

  function render(state) {
    if (!openId || !state || !els.body) return;
    if (openKind === 'facility') return renderFacility(state);
    return renderTruck(state);
  }

  function renderTruck(state) {
    const truck = FWEntityEngine.get(state.registry, 'truck', openId);
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

    const rollup = FWInvestigationEngine.examinationRollup(allCases);
    const rollupRows = rollup.total
      ? FWInvestigationEngine.EXAMINATION_CLASSES
        .filter(k => rollup.byClass[k] > 0)
        .map(k => `<li>${rollup.byClass[k]} — ${rollup.notes[k]}</li>`).join('')
      : '';
    const rollupHtml = rollup.total
      ? `<div class="bg-[#0e1520] border border-slate-800 rounded-lg px-2 py-1.5 mb-1.5">
          <div class="text-[10px] text-slate-400">Of these ${rollup.total} case${rollup.total === 1 ? '' : 's'}, how far each was actually examined:</div>
          <ul class="list-disc list-inside text-[10px] text-slate-400 space-y-0.5 mt-0.5">${rollupRows}</ul>
          ${rollup.effortSeconds ? `<div class="text-[10px] text-slate-500 mt-0.5">${(rollup.effortSeconds / 3600).toFixed(1)} measured hours of analyst effort across them.</div>` : ''}
          <p class="text-[10px] text-slate-500 mt-1">Counts, not shares. A handful of cases is below the sample size the analytics model requires before it will show a rate, and a percentage over two cases would read as a pattern.</p>
          <p class="text-[10px] text-amber-300/80 mt-1">A case nobody looked at, and a case where the records did not exist to look at, are facts about this port's coverage and this analyst's time. Neither is a fact about this truck, in either direction: it is not evidence it was involved in something, and it is not evidence it was not.</p>
        </div>`
      : '';

    // By current status, and said as that. Half of these labels belong to
    // cases still open, and calling an open case's status an outcome would
    // report a case as concluded because a panel needed a word.
    const statusSummary = Object.keys(outcomeCounts).length
      ? Object.entries(outcomeCounts).map(([k, v]) => `${v} ${k.replace(/_/g, ' ').toLowerCase()}`).join(' · ')
      : 'no prior cases';

    const casesHtml = `<div>
      <div class="text-[10px] font-semibold text-slate-400 uppercase mb-1">Case history (${allCases.length}) — by current status: ${statusSummary}</div>
      ${rollupHtml}
      ${allCases.length
        ? `<div class="space-y-1.5">${allCases.sort((a, b) => b.lastObserved - a.lastObserved).map(m => {
            const ex = FWInvestigationEngine.examination(m);
            return `
            <div class="bg-[#0e1520] border border-slate-800 rounded-lg px-2 py-1.5">
              <div class="flex items-center justify-between gap-2">
                <span class="font-mono text-[10px] text-slate-400">${m.id}</span>
                <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold ${statusBadgeClass(m.status)}">${m.status.replace(/_/g, ' ')}</span>
              </div>
              <div class="text-[11px] text-white">${m.title}</div>
              <div class="text-[10px] ${ex.everAnswered ? 'text-slate-500' : 'text-sky-300/80'}">${ex.checksRun
                ? `${ex.checksRun} check${ex.checksRun === 1 ? '' : 's'} run — ${ex.note}`
                : 'No check was ever run against this case.'}</div>
              ${closureHandLine(m)}
            </div>`; }).join('')}</div>`
        : '<p class="text-slate-600 italic text-[11px]">This truck has never triggered a correlated case. History and reputation here are informational only -- they never decide the next case on their own (Phase 33).</p>'}
    </div>`;

    els.body.innerHTML = linksHtml + signalsHtml + historyHtml + casesHtml;
  }

  return { init, show, hide, render, isOpen };
})();
