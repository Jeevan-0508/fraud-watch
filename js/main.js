/* main.js — bootstraps data load, mode switching, and both modules. */
document.addEventListener('DOMContentLoaded', async () => {
  await FW.load();
  FWGame.init();
  FWTraining.init();

  const views = { game: document.getElementById('view-game'), training: document.getElementById('view-training') };
  document.querySelectorAll('#mode-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#mode-tabs .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.dataset.mode;
      views.game.classList.toggle('hidden', mode !== 'game');
      views.training.classList.toggle('hidden', mode !== 'training');
    });
  });
});
