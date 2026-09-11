/* ui/port-ui.js — Phase 2-8: DOM chrome for Port Meridian.
   Mirrors Classic Watch's game.js DOM patterns (inspector/radio/reveal)
   but as a standalone namespace so core/game.js can stay Phaser-only
   orchestration logic. Deliberate simplification vs. Classic Watch:
   the investigation panel is a FIXED dock (not floating over the
   truck), because Port Meridian has camera pan/zoom, so mapping a
   moving world point to screen space reliably needs the camera's
   worldView — game.js pauses the suspect vehicle while its panel is
   open instead, which is simpler and still fair gameplay. */
const FWPortUI = (() => {
  let els = {};
  let revealQueue = [];
  let revealShowing = false;

  const ACTION_LABEL = {
    MANIFEST: '📋 Check manifest',
    GPS: '📍 Pull GPS trail',
    SEAL: '🔒 Inspect seal',
    NEARBY: '👀 Scan nearby vehicles',
    ROUTE: '🗺️ Verify route',
    DRIVER: '🧑 Check driver ID'
  };
  const ACTIONS = Object.keys(ACTION_LABEL);

  function init() {
    els = {
      investigate: document.getElementById('port-investigate'),
      radioFeed: document.getElementById('port-alert-feed'),
      chaseHud: document.getElementById('port-chase-hud'),
      revealFlash: document.getElementById('port-reveal-flash'),
      revealBackdrop: document.getElementById('port-reveal-backdrop'),
      revealCard: document.getElementById('port-reveal-card')
    };
  }

  function pushRadio(text, tone = 'info') {
    if (!els.radioFeed) return;
    const colors = { info: 'border-sky-400', warn: 'border-amber-400', bad: 'border-red-400', good: 'border-emerald-400' };
    const div = document.createElement('div');
    div.className = `alert-item text-[11px] leading-snug bg-[#0e1520] rounded px-2 py-1 ${colors[tone] || colors.info}`;
    div.textContent = text;
    els.radioFeed.prepend(div);
    while (els.radioFeed.children.length > 40) els.radioFeed.removeChild(els.radioFeed.lastChild);
  }

  // state: { tag, cargo, revealed: {ACTION: {text,isClue}|null}, usedCount }
  function renderInvestigation(state, callbacks) {
    if (!els.investigate) return;
    els.investigate.classList.remove('hidden');
    const rows = ACTIONS.map(a => {
      const res = state.revealed[a];
      const used = res !== undefined;
      const line = used
        ? `<div class="text-[11px] mt-0.5 ${res && res.isClue ? 'text-amber-300' : 'text-slate-500'}">${used ? (res ? res.text : 'Nothing unusual.') : ''}</div>`
        : '';
      return `
        <div class="mb-1.5">
          <button data-act="${a}" ${used ? 'disabled' : ''}
            class="act-btn w-full text-left text-xs px-2 py-1.5 rounded-lg ${used ? 'bg-slate-800/40 text-slate-500' : 'bg-slate-800 hover:bg-slate-700 text-slate-200'}">
            ${ACTION_LABEL[a]}
          </button>
          ${line}
        </div>`;
    }).join('');

    els.investigate.innerHTML = `
      <div class="bg-[#0d1420] border border-sky-500/40 rounded-xl p-3 shadow-xl shadow-black/50 w-72">
        <p class="font-orbitron text-xs text-sky-300 mb-0.5">${state.tag} · ${state.cargo}</p>
        <p class="text-[10px] text-slate-500 mb-2">Investigating — not every check finds something.</p>
        <div class="max-h-48 overflow-y-auto scrollbar-thin pr-1">${rows}</div>
        <div class="flex gap-2 mt-2">
          <button id="port-btn-flag" class="flex-1 bg-red-500 hover:bg-red-400 text-white font-bold rounded-lg py-1.5 text-xs">🚨 FLAG</button>
          <button id="port-btn-clear" class="flex-1 bg-emerald-500 hover:bg-emerald-400 text-[#0b0f14] font-bold rounded-lg py-1.5 text-xs">✅ CLEAR</button>
          <button id="port-btn-close" class="px-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs">✕</button>
        </div>
      </div>`;

    els.investigate.querySelectorAll('.act-btn').forEach(btn => {
      btn.onclick = () => callbacks.onAction(btn.dataset.act);
    });
    document.getElementById('port-btn-flag').onclick = () => callbacks.onFlag();
    document.getElementById('port-btn-clear').onclick = () => callbacks.onClear();
    document.getElementById('port-btn-close').onclick = () => callbacks.onClose();
  }

  function hideInvestigation() {
    if (els.investigate) els.investigate.classList.add('hidden');
  }

  function showChaseHud(tag, callbacks) {
    if (!els.chaseHud) return;
    els.chaseHud.classList.remove('hidden');
    els.chaseHud.innerHTML = `
      <div class="bg-[#0d1420] border border-red-500/50 rounded-xl p-3 text-center shadow-xl shadow-black/50 animate-pulse">
        <p class="font-orbitron text-xs text-red-400 mb-1">⚠ ${tag} RUNNING FOR THE GATE</p>
        <button id="port-btn-intercept" class="w-full bg-red-500 hover:bg-red-400 text-white font-bold rounded-lg py-2 text-sm">🚧 INTERCEPT</button>
      </div>`;
    document.getElementById('port-btn-intercept').onclick = () => callbacks.onIntercept();
  }

  function hideChaseHud() {
    if (els.chaseHud) els.chaseHud.classList.add('hidden');
  }

  function queueReveal(data) {
    revealQueue.push(data);
    if (!revealShowing) showNextReveal();
  }

  function showNextReveal() {
    if (!revealQueue.length) { revealShowing = false; return; }
    revealShowing = true;
    const { icon, text, color, flash, delta, body } = revealQueue.shift();

    if (els.revealFlash) {
      els.revealFlash.className = flash;
      els.revealFlash.classList.remove('hidden');
      setTimeout(() => els.revealFlash.classList.add('hidden'), 650);
    }

    els.revealCard.innerHTML = `
      <div class="text-center mb-3">
        <span class="siren text-3xl">${icon}</span>
        <div class="verdict-text text-3xl sm:text-4xl ${color}">${text}</div>
        <div class="font-mono text-sm mt-1 ${delta >= 0 ? 'text-emerald-400' : 'text-red-400'}">${delta >= 0 ? '+' : ''}${delta} pts</div>
      </div>
      <div class="reveal-detail bg-[#0d1420] border border-slate-700 rounded-xl p-4 text-left">
        ${body}
        <button id="port-reveal-close" class="mt-4 w-full bg-slate-800 hover:bg-slate-700 rounded-lg py-2 text-sm font-semibold">Continue</button>
      </div>`;
    els.revealBackdrop.classList.remove('hidden');
    document.getElementById('port-reveal-close').onclick = () => {
      els.revealBackdrop.classList.add('hidden');
      showNextReveal();
    };
  }

  return { init, pushRadio, renderInvestigation, hideInvestigation, showChaseHud, hideChaseHud, queueReveal, ACTIONS, ACTION_LABEL };
})();
