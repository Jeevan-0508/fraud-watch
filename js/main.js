/* main.js — bootstraps data load and wires up the stats + field-guide
   slide-over panels. The game itself owns the main stage. */
document.addEventListener('DOMContentLoaded', async () => {
  await FW.load();
  FWGame.init();
  FWTraining.init();

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
});
