/* main.js — bootstraps data load, wires the world toggle (Live Sim /
   Classic Watch / Port Meridian), and the stats + field-guide slide-over
   panels. */
const DEFAULT_WORLD = 'sim';
document.addEventListener('DOMContentLoaded', async () => {
  await FW.load();
  FWGame.init();
  FWTraining.init();
  FWSimDebug.init();
  if (window.FWAwayReport) FWAwayReport.init();

  function wirePanel(openBtnId, panelId, closeBtnId, backdropId) {
    const panel = document.getElementById(panelId);
    const open = () => panel.classList.remove('hidden');
    const close = () => panel.classList.add('hidden');
    document.getElementById(openBtnId).addEventListener('click', open);
    document.getElementById(closeBtnId).addEventListener('click', close);
    document.getElementById(backdropId).addEventListener('click', close);
  }
  wirePanel('btn-stats', 'stats-panel', 'stats-close', 'stats-backdrop');
  wirePanel('btn-guide', 'guide-panel', 'guide-close', 'guide-backdrop');

  // ---- world toggle: Live Sim <-> Classic Watch <-> Port Meridian ----
  const stage = document.getElementById('stage');
  const portRoot = document.getElementById('port-root');
  const simRoot = document.getElementById('sim-root');
  const classicHud = document.getElementById('hud');
  let portBooted = false;
  let previousWorld = null; // no world applied yet

  /* One path applies a world, whether it came from a click or from the page
     opening on its default. Duplicating the show/hide arithmetic for the
     initial view is how a landing state drifts out of step with the tab it
     claims to be on. */
  function selectWorld(world) {
    document.querySelectorAll('#world-tabs .tab-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.world === world);
    });
    stage.classList.toggle('hidden', world !== 'classic');
    portRoot.classList.toggle('hidden', world !== 'port');
    if (simRoot) simRoot.classList.toggle('hidden', world !== 'sim');
    // Classic Watch's top HUD tracks its own separate score/streak —
    // hide it outside Classic Watch so its numbers don't sit next to
    // the other worlds' own HUDs and look like one HUD.
    if (classicHud) classicHud.classList.toggle('hidden', world !== 'classic');
    if (world === 'port' && !portBooted) {
      FWCoreGame.boot('port-canvas-mount');
      portBooted = true;
    }
    if (world === 'sim') {
      FWSimDebug.show();
    }
    if (window.FWAwayReport) {
      if (previousWorld === 'sim' && world !== 'sim') FWAwayReport.onWorldTabLeftSim();
      if (world === 'sim') FWAwayReport.onWorldTabEnteredSim();
    }
    previousWorld = world;
  }

  document.querySelectorAll('#world-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => selectWorld(btn.dataset.world));
  });

  document.getElementById('btn-port-reset').addEventListener('click', () => FWCoreGame.resetView());

  /* The page opens on the live network simulation. Classic Watch and Port
     Meridian are unchanged and reachable from their own tabs; DEFAULT_WORLD is
     the only thing that decides which world the page opens on, and index.html
     carries the same starting state in its markup so there is no flash of the
     wrong world before this handler runs. */
  selectWorld(DEFAULT_WORLD);
});
