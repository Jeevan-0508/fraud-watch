/* core/game.js — Port Meridian orchestration.
   Vertical slice covered here: ambient traffic drives its loops ->
   one vehicle per case carries the scenario's clue set -> clicking it
   opens the investigation panel -> a wrong "clear" on a real fraud
   case triggers a flee-to-gate incident with a chase HUD -> every
   outcome resolves through the same reveal-card language as Classic
   Watch, and scores persist via systems/scoring.js.
   Still deliberately out of scope here: missions/free-roam (Ph.9) and
   day-night/audio polish (Ph.10) — see README roadmap. */
const FWCoreGame = (() => {
  let game = null;
  let camCtrl = null;

  function boot(containerId) {
    if (game) return game;
    const el = document.getElementById(containerId);
    FWPortUI.init();

    class PortScene extends Phaser.Scene {
      constructor() { super('PortScene'); }

      create() {
        this.world = FWWorld.build(this);
        camCtrl = FWCamera.attach(this, FWWorld.WORLD_W, FWWorld.WORLD_H);

        this.scoring = FWScoring.load();
        this.updateHud();

        this.vehicles = [];
        const routes = FWVehicle.ambientRoutes(FWWorld.ZONE);
        routes.forEach((route, i) => {
          const v = new FWVehicle.Vehicle(this, route, {
            id: 'v' + i,
            color: [0x5b7a99, 0x63896b, 0x8a6b5b, 0x6b6b99, 0x99775b, 0x5b8a99][i % 6]
          });
          v.body.setInteractive({ useHandCursor: true });
          v.body.on('pointerdown', () => this.onVehicleClicked(v));
          this.vehicles.push(v);
        });

        this.caseNo = 0;
        this.activeCase = null;   // scenario data + runtime fields
        this.caseVehicle = null;
        this.caseElapsed = 0;
        this.phase = 'none';      // none | idle | investigating | fleeing | resolved
        this.revealed = {};
        this.revealedIndicatorObjects = [];

        this.time.delayedCall(1200, () => this.startCase());
      }

      updateHud() {
        const s = this.scoring;
        const dock = document.getElementById('port-hud-line');
        if (dock) {
          dock.innerHTML =
            `<span class="text-slate-400">SCORE</span> <b class="text-white">${s.totalScore}</b>` +
            `<span class="text-slate-400 ml-3">STREAK</span> <b class="text-amber-400">${s.streak}</b>` +
            `<span class="text-slate-400 ml-3">LEVEL</span> <b class="text-sky-400">${s.level}</b>` +
            `<span class="text-slate-400 ml-3">SOLVED</span> <b class="text-emerald-400">${s.casesSolved}</b>` +
            `<span class="text-slate-400 ml-3">MISSED</span> <b class="text-red-400">${s.casesMissed}</b>`;
        }
      }

      pickCaseVehicle() {
        const free = this.vehicles.filter(v => v !== this.caseVehicle);
        return free[Math.floor(Math.random() * free.length)];
      }

      startCase() {
        this.caseNo++;
        const data = FWScenario.generate(this.scoring.level, this.caseNo);
        const v = this.pickCaseVehicle();
        v.setTag(`${data.id} · ${data.carrier}`);

        this.activeCase = data;
        this.caseVehicle = v;
        this.caseElapsed = 0;
        this.phase = 'idle';
        this.revealed = {};
        this.revealedIndicatorObjects = [];

        FWPortUI.pushRadio(`${data.id}: ${data.carrier} inbound with ${data.cargo}.`, 'info');
      }

      onVehicleClicked(v) {
        if (this.phase === 'idle' && v === this.caseVehicle) {
          this.phase = 'investigating';
          v.setPaused(true);
          this.renderInvestigationPanel();
        } else if (v !== this.caseVehicle) {
          FWPortUI.pushRadio('No open case on that vehicle right now.', 'info');
        }
      }

      renderInvestigationPanel() {
        const data = this.activeCase;
        FWPortUI.renderInvestigation(
          { tag: data.id, cargo: `${data.carrier} — ${data.cargo}`, revealed: this.revealed },
          {
            onAction: (action) => this.checkAction(action),
            onFlag: () => this.decide('flag'),
            onClear: () => this.decide('clear'),
            onClose: () => this.closeInvestigation()
          }
        );
      }

      checkAction(action) {
        const data = this.activeCase;
        const hit = data.actionMap[action];
        if (hit) {
          this.revealed[action] = { text: hit.signal, isClue: true };
          if (!hit.isDecoy) this.revealedIndicatorObjects.push(hit);
          FWPortUI.pushRadio(`${data.id}: ${hit.signal}`, hit.isDecoy ? 'warn' : 'bad');
        } else {
          this.revealed[action] = { text: 'Nothing unusual.', isClue: false };
        }
        this.renderInvestigationPanel();
      }

      closeInvestigation() {
        if (this.phase !== 'investigating') return;
        this.phase = 'idle';
        this.caseVehicle.setPaused(false);
        FWPortUI.hideInvestigation();
      }

      decide(action) {
        if (this.phase !== 'investigating' && this.phase !== 'idle') return;
        const data = this.activeCase;
        FWPortUI.hideInvestigation();
        if (data.type === 'fraud') {
          if (action === 'flag') this.resolveOutcome('caught');
          else this.triggerFlee();
        } else {
          if (action === 'flag') this.resolveOutcome('false');
          else this.resolveOutcome('cleared');
        }
      }

      triggerFlee() {
        this.phase = 'fleeing';
        const v = this.caseVehicle;
        v.setPaused(false);
        v.speed = 130;
        v.setRoute(FWVehicle.escapeRoute(FWWorld.ZONE, { x: v.body.x, y: v.body.y }), false);
        v.onArrive = () => { if (this.phase === 'fleeing') this.resolveOutcome('missed'); };
        v.highlight(true);
        this.cameras.main.startFollow(v.body, true, 0.06, 0.06);
        FWPortUI.showChaseHud(this.activeCase.id, { onIntercept: () => this.interceptCase() });
        FWPortUI.pushRadio(`${this.activeCase.id}: making a run for the exit gate!`, 'bad');
      }

      interceptCase() {
        if (this.phase !== 'fleeing') return;
        this.resolveOutcome('caught');
      }

      resolveOutcome(outcome) {
        const v = this.caseVehicle;
        const data = this.activeCase;
        this.phase = 'resolved';
        FWPortUI.hideChaseHud();
        this.cameras.main.stopFollow();
        v.highlight(false);
        v.setPaused(false);
        v.onArrive = null;

        const before = this.scoring;
        const severity = data.pattern ? data.pattern.severity : 'medium';
        this.scoring = FWScoring.applyOutcome(before, outcome, { severity });
        const delta = this.scoring.totalScore - before.totalScore;
        this.updateHud();

        this.showRevealCard(outcome, delta, data);

        // vehicle returns to ambient duty after the case closes
        const routes = FWVehicle.ambientRoutes(FWWorld.ZONE);
        v.setRoute(routes[Math.floor(Math.random() * routes.length)], true);
        v.clearTag();
        this.caseVehicle = null;
        this.activeCase = null;
        this.phase = 'none';

        this.time.delayedCall(1500, () => this.startCase());
      }

      showRevealCard(outcome, delta, data) {
        const VERDICT = {
          caught:  { icon: '🚨', text: 'BUSTED!', color: 'text-emerald-400', flash: 'flash-good' },
          missed:  { icon: '🕵️', text: 'IT GOT AWAY', color: 'text-red-400', flash: 'flash-bad' },
          false:   { icon: '🚫', text: 'FALSE ALARM', color: 'text-amber-400', flash: 'flash-bad' },
          cleared: { icon: '✅', text: 'CLEAN — WAVED THROUGH', color: 'text-emerald-400', flash: 'flash-good' }
        }[outcome];

        let body;
        if (data.type === 'fraud') {
          const shown = this.revealedIndicatorObjects.length ? this.revealedIndicatorObjects : data.indicators;
          const cm = FW.bestCountermeasure(data.pattern, shown);
          body = `
            <div class="flex items-center gap-2 mb-2">
              <span class="badge" style="background:${FW.categoryColor(data.pattern.category)}22;color:${FW.categoryColor(data.pattern.category)}">${data.pattern.category.replace('_', ' ')}</span>
              <span class="badge" style="background:${FW.severityColor(data.pattern.severity)}22;color:${FW.severityColor(data.pattern.severity)}">${data.pattern.severity}</span>
            </div>
            <h3 class="text-lg font-bold text-white mb-1">${data.pattern.name}</h3>
            <p class="text-sm text-slate-400 mb-3">${data.pattern.summary}</p>
            <p class="text-xs text-slate-500 uppercase mb-1">Clues you surfaced</p>
            <ul class="text-sm text-slate-300 space-y-1 mb-3">${shown.map(i => `<li>• ${i.signal}</li>`).join('') || '<li class="text-slate-500">None — you decided cold.</li>'}</ul>
            <p class="text-xs text-slate-500 uppercase mb-1">Would have caught it (${cm.bucket})</p>
            <p class="text-sm text-sky-300">${cm.text}</p>`;
        } else {
          body = `
            <p class="text-sm text-slate-400 mb-3">This looked suspicious but wasn't. The clue mimicked <b>${data.decoy.pattern.name}</b>:</p>
            <p class="text-sm text-slate-300 mb-2">"${data.decoy.fp.looks_like}"</p>
            <p class="text-xs text-slate-500 uppercase mb-1">What it actually was</p>
            <p class="text-sm text-slate-300 mb-2">${data.decoy.fp.actually}</p>
            <p class="text-xs text-slate-500 uppercase mb-1">How to rule it out</p>
            <p class="text-sm text-sky-300">${data.decoy.fp.how_to_rule_out}</p>`;
        }

        FWPortUI.queueReveal({ icon: VERDICT.icon, text: VERDICT.text, color: VERDICT.color, flash: VERDICT.flash, delta, body });
      }

      update(time, delta) {
        if (this.world && this.world.sea) this.world.sea.tilePositionX += delta * 0.012;
        const dt = delta / 1000;
        this.vehicles.forEach(v => v.update(dt));

        if (this.activeCase && (this.phase === 'idle' || this.phase === 'investigating')) {
          this.caseElapsed += dt;
          if (this.caseElapsed > this.activeCase.caseSeconds) {
            FWPortUI.hideInvestigation();
            if (this.activeCase.type === 'fraud') this.triggerFlee();
            else this.resolveOutcome('cleared');
          }
        }
      }
    }

    game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: containerId,
      width: el.clientWidth || 1200,
      height: el.clientHeight || 640,
      backgroundColor: '#05070a',
      scene: PortScene,
      render: { antialias: true }
    });

    window.addEventListener('resize', () => {
      if (!game) return;
      game.scale.resize(el.clientWidth, el.clientHeight);
    });

    return game;
  }

  function resetView() { if (camCtrl) camCtrl.reset(); }

  return { boot, resetView };
})();
