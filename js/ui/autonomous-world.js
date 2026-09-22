/* ui/autonomous-world.js — the "AUTONOMOUS WORLD" panel.

   Every other panel in the Live Sim renders FWSimRunner's in-memory
   state, which only exists while this tab is open. This panel renders
   something different on purpose: data/dashboard-summary.json, written by
   scripts/tick.js on a schedule that has nothing to do with any browser.
   It is the one place in the app that says, out loud, the fact the rest of
   the UI implies but never states: the analyst does not run the world,
   the world runs on its own, and this tab is just watching it.

   Never throws on a missing/stale file (a fresh clone with no committed
   tick yet, a fetch blocked by a file:// origin, a network hiccup): it
   reports a named refusal instead, the same discipline as
   livesim-store's REFUSALS and awayReport's NOT_MODELLED. */
const FWAutonomousWorld = (() => {
  const SUMMARY_URL = 'data/dashboard-summary.json';
  const POLL_MS = 60000; // re-fetch once a minute; the file changes every 6h at most

  const REFUSALS = {
    NO_FETCH: 'This build has no fetch() available, so the autonomous-world panel cannot be shown.',
    NOT_FOUND: 'data/dashboard-summary.json has not been written yet — the scheduled tick has not run for this repository.',
    UNREADABLE: 'data/dashboard-summary.json could not be parsed as the shape this panel expects.'
  };

  let els = {};
  let pollHandle = null;

  function fmtAgo(iso) {
    if (!iso) return '—';
    const ms = Date.now() - Date.parse(iso);
    if (!(ms >= 0)) return 'just now';
    const mins = Math.round(ms / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 48) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
    return `${Math.round(hrs / 24)} days ago`;
  }

  function fmtIn(iso) {
    if (!iso) return '—';
    const ms = Date.parse(iso) - Date.now();
    if (ms <= 0) return 'due now';
    const hrs = ms / 3600000;
    return hrs < 1 ? `~${Math.round(ms / 60000)} min` : `~${hrs.toFixed(1)} hours`;
  }

  function renderRefusal(why) {
    if (!els.root) return;
    els.root.innerHTML = `<div class="text-[11px] text-slate-500">AUTONOMOUS WORLD — ${why}</div>`;
  }

  function renderSummary(s) {
    if (!els.root) return;
    const w = s.world, sim = s.simulation;
    const events = (s.recentEvents || []).slice(0, 8).map(e =>
      `<li class="flex justify-between gap-2"><span class="${e.severity === 'warn' ? 'text-amber-400' : 'text-slate-400'}">${e.type}</span><span class="text-slate-600">${e.entityId || ''}</span></li>`
    ).join('');
    els.root.innerHTML = `
      <div class="flex flex-wrap items-baseline justify-between gap-3 mb-2">
        <div>
          <div class="text-[10px] uppercase tracking-widest text-emerald-400 font-orbitron">Fraud Watch &middot; Autonomous World</div>
          <div class="font-orbitron text-sm text-slate-200">SIMULATION TIME &mdash; DAY ${sim.day} &middot; ${sim.timeOfDay}</div>
        </div>
        <div class="flex items-center gap-1.5 text-[11px] text-emerald-400">
          <span class="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> AUTONOMOUS
        </div>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] mb-2">
        <div class="bg-slate-900/60 rounded-lg p-2"><div class="text-slate-500">TICK</div><div class="text-slate-200 font-semibold">#${s.tick}</div></div>
        <div class="bg-slate-900/60 rounded-lg p-2"><div class="text-slate-500">LAST TICK</div><div class="text-slate-200 font-semibold">${fmtAgo(s.lastTickReal)}</div></div>
        <div class="bg-slate-900/60 rounded-lg p-2"><div class="text-slate-500">NEXT EXPECTED</div><div class="text-slate-200 font-semibold">${fmtIn(s.nextExpectedTickReal)}</div></div>
        <div class="bg-slate-900/60 rounded-lg p-2"><div class="text-slate-500">SHIFT</div><div class="text-slate-200 font-semibold">${sim.shift}</div></div>
      </div>
      <div class="grid grid-cols-3 sm:grid-cols-6 gap-2 text-[11px] mb-2">
        <div><div class="text-slate-500">Shipments</div><div class="text-slate-200">${w.activeShipments}</div></div>
        <div><div class="text-slate-500">Entities</div><div class="text-slate-200">${w.totalEntities}</div></div>
        <div><div class="text-slate-500">Open cases</div><div class="text-slate-200">${w.openInvestigations}</div></div>
        <div><div class="text-slate-500">Active signals</div><div class="text-slate-200">${w.activeSignals}</div></div>
        <div><div class="text-slate-500">Incidents</div><div class="text-slate-200">${w.incidents}</div></div>
        <div><div class="text-slate-500">Total events</div><div class="text-slate-200">${w.networkActivityTotal}</div></div>
      </div>
      <details class="fw-note">
        <summary>Recent world events (most recent tick)</summary>
        <ul class="text-[11px] mt-1 space-y-0.5">${events || '<li class="text-slate-600">none yet</li>'}</ul>
      </details>
      <p class="text-[10px] text-slate-600 mt-2">The analyst does not run this world. It advances on a schedule (scripts/tick.js, every 6 real hours) whether or not this tab is open, and this panel only shows what the last tick left behind.</p>
    `;
  }

  function fetchSummary() {
    if (typeof fetch !== 'function') { renderRefusal(REFUSALS.NO_FETCH); return; }
    fetch(SUMMARY_URL, { cache: 'no-store' }).then(r => {
      if (!r.ok) { renderRefusal(REFUSALS.NOT_FOUND); return null; }
      return r.json();
    }).then(json => {
      if (!json) return;
      if (!json.simulation || !json.world) { renderRefusal(REFUSALS.UNREADABLE); return; }
      renderSummary(json);
    }).catch(() => renderRefusal(REFUSALS.NOT_FOUND));
  }

  function init() {
    els.root = document.getElementById('autonomous-world-root');
    if (!els.root) return;
    fetchSummary();
    if (pollHandle) clearInterval(pollHandle);
    pollHandle = setInterval(fetchSummary, POLL_MS);
  }

  return { init, fetchSummary, REFUSALS };
})();
