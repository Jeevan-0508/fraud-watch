/* main.js — bootstraps data load, wires the classic/Port-Meridian world
   toggle, and the stats + field-guide slide-over panels. */
document.addEventListener('DOMContentLoaded', async () => {
  await FW.load();
  FWGame.init();
  FWTraining.init();
  FWSimDebug.init();

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

  // ---- world toggle: Classic Watch <-> Port Meridian ----
  const stage = document.getElementById('stage');
  const portRoot = document.getElementById('port-root');
  const simRoot = document.getElementById('sim-root');
  const classicHud = document.getElementById('hud');
  let portBooted = false;

  document.querySelectorAll('#world-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#world-tabs .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const world = btn.dataset.world;
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
    });
  });

  document.getElementById('btn-port-reset').addEventListener('click', () => FWCoreGame.resetView());
});
