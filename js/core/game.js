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
        this.lastCaseVehicle = null;

        this.time.delayedCall(1200, () => this.startCase());
      }

      /* The HUD used to print SOLVED and MISSED and no base, out of six
         buckets. Two counts out of a population whose size is not on screen
         invite the reader to supply the rest, and the rest included every case
         nobody called. Both counts now carry the base they came out of, and
         the uncalled cases are on screen instead of implied. */
      updateHud() {
        const dock = document.getElementById('port-hud-line');
        if (!dock) return;
        const s = this.scoring;
        const cut = FWScoring.tally(s);
        dock.innerHTML =
          `<span class="text-slate-400">SCORE</span> <b class="text-white">${s.totalScore}</b>` +
          `<span class="text-slate-400 ml-3">STREAK</span> <b class="text-amber-400">${s.streak}</b>` +
          `<span class="text-slate-400 ml-3">LEVEL</span> <b class="text-sky-400">${s.level}</b>` +
          `<span class="text-slate-400 ml-3">INTERCEPTED</span> <b class="text-emerald-400">${cut.casesSolved}</b>` +
          `<span class="text-slate-500">/${cut.resolutions}</span>` +
          `<span class="text-slate-400 ml-3">LEFT AFTER YOUR CALL</span> <b class="text-red-400">${cut.casesMissed}</b>` +
          `<span class="text-slate-500">/${cut.resolutions}</span>` +
          `<span class="text-slate-400 ml-3">NO CALL MADE</span> <b class="text-slate-300">${cut.uncalled}</b>` +
          `<span class="text-slate-500">/${cut.resolutions}</span>`;
        const note = document.getElementById('port-hud-note');
        if (note) {
          note.innerHTML = cut.legacyUnreconciled
            ? `<span class="text-amber-400/80">${FWScoring.LEGACY_NOTE}</span>`
            : `Every case ends in exactly one of ${FWScoring.OUTCOME_NAMES.length} recorded ways, and ${FWScoring.OUTCOME_NAMES.filter(n => !FWScoring.OUTCOMES[n].decided).length} of them are not calls you made. A case whose window closed is counted as uncalled, never as a decision.`;
        }
      }

      /* This used to exclude `this.caseVehicle`, which resolveOutcome had
         already set to null before the next case was scheduled — so the
         filter kept all six vehicles on every call and the same truck could
         carry two cases in a row. Reuse matters here: the case vehicle is the
         one truck wearing a tag, and a truck that is tagged twice running
         looks like a repeat offender when the generator was only rolling
         dice. The exclusion is now against the vehicle that actually carried
         the last case, and it says what it excludes and why. */
      pickCaseVehicle() {
        const free = this.vehicles.filter(v => v !== this.lastCaseVehicle);
        const pool = free.length ? free : this.vehicles;
        return pool[Math.floor(Math.random() * pool.length)];
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
          /* The tone used to be `hit.isDecoy ? 'warn' : 'bad'` — amber for a
             clue with an innocent explanation, red for a real indicator. That
             is the ground truth of the case, printed on the screen at the
             moment the check comes back, before the player has established
             anything. Whether the two are distinguishable is the whole
             question being asked; colouring them differently answers it.
             Both are observations and both read the same. */
          FWPortUI.pushRadio(`${data.id}: ${hit.signal}`, 'warn');
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
          else this.triggerFlee('decision');
        } else {
          if (action === 'flag') this.resolveOutcome('overCalled');
          else this.resolveOutcome('cleared');
        }
      }

      /* A flee starts either because the player waved a pattern case through
         or because the case window closed with nobody calling it. The vehicle
         behaves identically, the record must not: if it reaches the gate, the
         first is a call that went the other way and the second is no call at
         all. Interception is a call in either case. */
      triggerFlee(origin) {
        if (origin !== 'decision' && origin !== 'expiry') {
          throw new Error('triggerFlee: origin must be "decision" or "expiry" — the record cannot tell them apart afterwards.');
        }
        this.phase = 'fleeing';
        this.fleeOrigin = origin;
        const v = this.caseVehicle;
        v.setPaused(false);
        v.setSpeed(FWVehicle.FLEE_SPEED);
        v.setRoute(FWVehicle.escapeRoute(FWWorld.ZONE, { x: v.body.x, y: v.body.y }), false);
        v.onArrive = () => {
          if (this.phase !== 'fleeing') return;
          this.resolveOutcome(this.fleeOrigin === 'expiry' ? 'expiredPattern' : 'missed');
        };
        v.highlight(true);
        this.cameras.main.startFollow(v.body, true, 0.06, 0.06);
        FWPortUI.showChaseHud(this.activeCase.id, { onIntercept: () => this.interceptCase() });
        FWPortUI.pushRadio(
          origin === 'expiry'
            ? `${this.activeCase.id}: case window closed with no call made — heading for the exit gate.`
            : `${this.activeCase.id}: making a run for the exit gate!`,
          origin === 'expiry' ? 'info' : 'bad'
        );
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
        /* The tag and the highlight were always cleared here; the chase speed
           was not, and nothing else ever reset it. Only a fraud case flees, so
           every vehicle left at FLEE_SPEED was a fraud case — measured over
           twelve cases, the set of faster trucks was exactly the set that had
           carried one, and the marks never decayed. The world is not allowed
           to remember that. */
        v.restoreBaseSpeed();

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
        this.lastCaseVehicle = v;
        this.caseVehicle = null;
        this.activeCase = null;
        this.phase = 'none';
        FWVehicle.assertNoCaseResidue(this.vehicles, null);

        this.time.delayedCall(1500, () => this.startCase());
      }

      showRevealCard(outcome, delta, data) {
        /* The two expiry verdicts are deliberately neutral in icon, colour
           and wording: no tick, no siren, and no verb that implies the player
           did something. Colour is a claim here as much as text is. */
        const VERDICT = {
          caught:         { icon: '🚨', text: 'BUSTED!', color: 'text-emerald-400', flash: 'flash-good' },
          missed:         { icon: '🕵️', text: 'IT GOT AWAY', color: 'text-red-400', flash: 'flash-bad' },
          overCalled:     { icon: '🚫', text: 'FALSE ALARM', color: 'text-amber-400', flash: 'flash-bad' },
          cleared:        { icon: '✅', text: 'CLEAN — WAVED THROUGH', color: 'text-emerald-400', flash: 'flash-good' },
          expiredPattern: { icon: '⏱', text: 'WINDOW CLOSED — NO CALL MADE', color: 'text-slate-300', flash: null },
          expiredClean:   { icon: '⏱', text: 'WINDOW CLOSED — NO CALL MADE', color: 'text-slate-300', flash: null }
        }[outcome];
        if (!VERDICT) throw new Error('showRevealCard: no verdict for outcome ' + outcome);
        const uncalled = FWScoring.OUTCOMES[outcome] && !FWScoring.OUTCOMES[outcome].decided;

        let body;
        if (data.type === 'fraud') {
          /* `shown` used to fall back to `data.indicators` when the player had
             surfaced nothing, and the list was still headed "Clues you
             surfaced". A player who decided cold was shown the full clue set
             under a heading crediting them with finding it, the honest
             "None — you decided cold" branch below could therefore never
             render, and the countermeasure was derived from evidence the
             player never obtained. Measured: a cold decision listed three
             clues as surfaced and the empty branch never appeared once.
             Surfaced and not-surfaced are two claims, so they are two lists,
             each carrying its count against the case total. */
          const all = data.indicators || [];
          const surfaced = this.revealedIndicatorObjects;
          const surfacedSignals = new Set(surfaced.map(i => i.signal));
          const notSurfaced = all.filter(i => !surfacedSignals.has(i.signal));
          const cm = FW.bestCountermeasure(data.pattern, surfaced);
          body = `
            <div class="flex items-center gap-2 mb-2">
              <span class="badge" style="background:${FW.categoryColor(data.pattern.category)}22;color:${FW.categoryColor(data.pattern.category)}">${data.pattern.category.replace('_', ' ')}</span>
              <span class="badge" style="background:${FW.severityColor(data.pattern.severity)}22;color:${FW.severityColor(data.pattern.severity)}">${data.pattern.severity}</span>
            </div>
            <h3 class="text-lg font-bold text-white mb-1">${data.pattern.name}</h3>
            <p class="text-sm text-slate-400 mb-3">${data.pattern.summary}</p>
            <p class="text-xs text-slate-500 uppercase mb-1">Clues you surfaced (${surfaced.length} of ${all.length} this case carried)</p>
            <ul class="text-sm text-slate-300 space-y-1 mb-3">${surfaced.map(i => `<li>• ${i.signal}</li>`).join('') || '<li class="text-slate-500">None — you decided cold.</li>'}</ul>
            ${notSurfaced.length ? `<p class="text-xs text-slate-500 uppercase mb-1">Clues you did not surface (${notSurfaced.length} of ${all.length})</p>
            <ul class="text-sm text-slate-400 space-y-1 mb-3">${notSurfaced.map(i => `<li>• ${i.signal}</li>`).join('')}</ul>` : ''}
            <p class="text-xs text-slate-500 uppercase mb-1">${cm.derived ? `Would have caught it (${cm.bucket} countermeasure)` : `A ${cm.bucket} countermeasure for this pattern`}</p>
            <p class="text-sm text-sky-300">${cm.text}</p>
            <p class="text-[11px] text-slate-500 mt-1">${cm.basis}</p>`;
        } else if (!data.decoy) {
          body = `<p class="text-sm text-slate-400">No pattern in the generator's script for this one, and no borrowed clue either. Nothing to compare a call against.</p>`;
        } else {
          body = `
            <p class="text-sm text-slate-400 mb-3">This looked suspicious but wasn't. The clue mimicked <b>${data.decoy.pattern.name}</b>:</p>
            <p class="text-sm text-slate-300 mb-2">"${data.decoy.fp.looks_like}"</p>
            <p class="text-xs text-slate-500 uppercase mb-1">What it actually was</p>
            <p class="text-sm text-slate-300 mb-2">${data.decoy.fp.actually}</p>
            <p class="text-xs text-slate-500 uppercase mb-1">How to rule it out</p>
            <p class="text-sm text-sky-300">${data.decoy.fp.how_to_rule_out}</p>`;
        }

        const prefix = uncalled
          ? `<p class="text-[11px] text-slate-400 border-l-2 border-slate-600 pl-2 mb-3">No call was made on this case — its window closed first. The score moved; the streak and the interception rate did not, because there was no call to measure.</p>`
          : '';
        FWPortUI.queueReveal({
          icon: VERDICT.icon, text: VERDICT.text, color: VERDICT.color,
          flash: VERDICT.flash, delta, body: prefix + body
        });
      }

      update(time, delta) {
        if (this.world && this.world.sea) this.world.sea.tilePositionX += delta * 0.012;
        const dt = delta / 1000;
        this.vehicles.forEach(v => v.update(dt));

        if (this.activeCase && (this.phase === 'idle' || this.phase === 'investigating')) {
          this.caseElapsed += dt;
          if (this.caseElapsed > this.activeCase.caseSeconds) {
            /* The window closed with nobody calling it. This used to resolve a
               clean case as 'cleared' -- the same record the player gets for
               deliberately waving one through, complete with a green tick and
               "WAVED THROUGH" on the reveal card. Nobody waved anything. */
            FWPortUI.hideInvestigation();
            if (this.activeCase.type === 'fraud') this.triggerFlee('expiry');
            else this.resolveOutcome('expiredClean');
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
