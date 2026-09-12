/* entities/vehicle.js — Phase 2: ambient traffic.
   A vehicle is a small rectangle "truck" that patrols a route of
   world-space waypoints in a loop. Pure Phaser display objects; no
   physics engine needed since routes are simple polylines and the port
   is not simulating collisions — this is a signal/investigation game,
   not a driving sim.

   This header used to say there was "one designated 'suspect' vehicle
   whose route detours into an incident sequence when a case is active",
   and the constructor carried an `isSuspect` flag to match. Neither was
   true: no caller ever set the flag, nothing ever read it, and core/game.js
   picks the case vehicle afresh at random for every case. Both are gone,
   because a dormant permanent-suspect field in a fraud game is one careless
   `isSuspect: data.type === 'fraud'` away from rendering the answer.

   The rule this module now enforces instead: a vehicle carries marks WHILE
   it carries a case (a tag, a highlight, a chase speed) and must carry none
   of them afterwards. Only a fraud case ever flees, so any per-case mark
   left behind is a record of which vehicles were fraudulent — readable off
   the world without opening a single case, and cumulative, since it never
   decays. assertNoCaseResidue() is the check; it throws. */
const FWVehicle = (() => {
  // Ambient patrol speed. Every vehicle starts here and must return here.
  const AMBIENT_SPEED = 70; // world px/sec
  // Chase pacing while a case vehicle runs for the gate. This is a pacing
  // value, not a property of the vehicle: it must not survive the case.
  const FLEE_SPEED = 130;

  function dist(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }

  class Vehicle {
    constructor(scene, route, opts = {}) {
      this.scene = scene;
      this.route = route.slice();
      this.loop = opts.loop !== false;
      // baseSpeed is what this vehicle is; speed is what it is doing now.
      this.baseSpeed = opts.speed || AMBIENT_SPEED;
      this.speed = this.baseSpeed;
      this.wpIndex = 0;
      this.color = opts.color || 0x5b7a99;
      this.id = opts.id || Math.random().toString(36).slice(2, 8);
      this.paused = false;
      this.highlighted = false; // part of the case-residue vocabulary below
      this.onArrive = opts.onArrive || null; // called when route completes (non-loop)
      this.done = false;

      const start = this.route[0];
      this.body = scene.add.rectangle(start.x, start.y, 34, 18, this.color)
        .setStrokeStyle(1, 0xffffff, 0.25).setDepth(5);
      this.cab = scene.add.rectangle(start.x, start.y, 10, 16, 0x1c2531).setDepth(6);
      this.label = null;
      if (opts.tag) {
        this.label = scene.add.text(start.x, start.y - 18, opts.tag, {
          fontFamily: 'Orbitron, sans-serif', fontSize: '9px', color: '#94a3b8'
        }).setOrigin(0.5).setDepth(7);
      }
      this._face(this.route[1] || start);
    }

    _face(target) {
      const a = Math.atan2(target.y - this.body.y, target.x - this.body.x);
      this.body.setRotation(a);
      this.cab.setRotation(a);
      this.cab.x = this.body.x + Math.cos(a) * 14;
      this.cab.y = this.body.y + Math.sin(a) * 14;
    }

    setRoute(route, loop = true) {
      this.route = route.slice();
      this.wpIndex = 0;
      this.loop = loop;
      this.done = false;
      this._face(this.route[1] || this.route[0]);
    }

    setPaused(p) { this.paused = p; }

    setTag(text) {
      if (!this.label) {
        this.label = this.scene.add.text(this.body.x, this.body.y - 18, text, {
          fontFamily: 'Orbitron, sans-serif', fontSize: '9px', color: '#94a3b8'
        }).setOrigin(0.5).setDepth(7);
      } else {
        this.label.setText(text);
      }
    }

    clearTag() {
      if (this.label) { this.label.destroy(); this.label = null; }
    }

    highlight(on) {
      this.highlighted = !!on;
      this.body.setStrokeStyle(on ? 3 : 1, on ? 0xfacc15 : 0xffffff, on ? 1 : 0.25);
    }

    // Temporary, case-scoped speed. Pairs with restoreBaseSpeed().
    setSpeed(px) { this.speed = px; }

    restoreBaseSpeed() { this.speed = this.baseSpeed; }

    // Every mark a case puts on a vehicle, in one place, so a new one cannot
    // be added without the residue check below seeing it.
    caseResidue() {
      const r = [];
      if (this.speed !== this.baseSpeed) r.push('speed ' + this.speed + ' \u2260 base ' + this.baseSpeed);
      if (this.highlighted) r.push('highlight still on');
      if (this.label) r.push('tag still reads "' + (this.label.text || '') + '"');
      if (this.onArrive) r.push('onArrive handler still attached');
      if (!this.loop) r.push('still on a non-looping route');
      if (this.paused) r.push('still paused mid-investigation');
      if (this.done) r.push('still parked at the end of a finished route');
      return r;
    }

    update(dt) {
      if (this.paused || this.done || this.route.length < 2) return;
      const target = this.route[this.wpIndex + 1];
      if (!target) {
        if (this.loop) { this.wpIndex = 0; this._face(this.route[1]); }
        else { this.done = true; if (this.onArrive) this.onArrive(this); }
        return;
      }
      const here = { x: this.body.x, y: this.body.y };
      const d = dist(here, target);
      const step = this.speed * dt;
      if (d <= step) {
        this.body.x = target.x; this.body.y = target.y;
        this.wpIndex++;
        const next = this.route[this.wpIndex + 1];
        if (next) this._face(next);
        else if (this.loop) { this.wpIndex = -1; }
      } else {
        const a = Math.atan2(target.y - here.y, target.x - here.x);
        this.body.x += Math.cos(a) * step;
        this.body.y += Math.sin(a) * step;
        this.body.setRotation(a);
      }
      this.cab.x = this.body.x + Math.cos(this.body.rotation) * 14;
      this.cab.y = this.body.y + Math.sin(this.body.rotation) * 14;
      this.cab.setRotation(this.body.rotation);
      if (this.label) { this.label.x = this.body.x; this.label.y = this.body.y - 18; }
    }

    destroy() {
      this.body.destroy(); this.cab.destroy();
      if (this.label) this.label.destroy();
    }
  }

  // Builds a set of stock ambient loop routes from the world ZONE box.
  function ambientRoutes(ZONE) {
    const midY = ZONE.mainRoad.y + ZONE.mainRoad.h / 2;
    const svcX = ZONE.serviceRoad.x + ZONE.serviceRoad.w / 2;
    const gateX = ZONE.exitGate.x; // gate centre-Y is not used here: ambient routes stop on the main road
    const depotIn = { x: ZONE.depot.x + ZONE.depot.w / 2, y: ZONE.depot.y };
    const parkIn = { x: ZONE.parkingLot.x + ZONE.parkingLot.w / 2, y: ZONE.parkingLot.y + ZONE.parkingLot.h };
    const whIn = { x: ZONE.warehouse.x + ZONE.warehouse.w / 2, y: ZONE.warehouse.y + ZONE.warehouse.h };

    return [
      // main road cruise, terminal exit to gate and back
      [{ x: 320, y: midY }, { x: svcX, y: midY }, { x: gateX - 40, y: midY }, { x: svcX, y: midY }],
      // depot loop
      [{ x: svcX, y: midY }, { x: svcX, y: depotIn.y + 20 }, depotIn, { x: svcX, y: depotIn.y + 20 }, { x: svcX, y: midY }],
      // parking lot loop
      [{ x: svcX, y: midY }, parkIn, { x: svcX, y: midY }],
      // warehouse loading loop
      [{ x: svcX, y: midY }, { x: whIn.x, y: midY }, whIn, { x: whIn.x, y: midY }, { x: svcX, y: midY }],
      // checkpoint pass-through
      [{ x: svcX, y: ZONE.checkpoint.y + ZONE.checkpoint.h + 10 }, { x: svcX, y: midY }, { x: 320, y: midY }],
      // gate cruise
      [{ x: svcX, y: midY }, { x: gateX - 30, y: midY }, { x: svcX, y: midY }]
    ];
  }

  // The escape route a caught suspect takes once an incident triggers:
  // wherever it is -> service road -> main road -> exit gate.
  function escapeRoute(ZONE, from) {
    const midY = ZONE.mainRoad.y + ZONE.mainRoad.h / 2;
    const svcX = ZONE.serviceRoad.x + ZONE.serviceRoad.w / 2;
    const gateX = ZONE.exitGate.x + ZONE.exitGate.w - 10;
    const gateY = ZONE.exitGate.y + ZONE.exitGate.h / 2;
    return [
      { x: from.x, y: from.y },
      { x: svcX, y: from.y },
      { x: svcX, y: midY },
      { x: gateX, y: midY },
      { x: gateX, y: gateY }
    ];
  }

  /* Throws if any vehicle that is not currently carrying a case still wears a
     mark the case put on it. `carrying` is the vehicle a case is open on right
     now (or null). Only a fraud case ever flees, so a leftover chase speed is
     not cosmetic: the set of visibly faster trucks becomes exactly the set of
     vehicles that carried a fraud case, and it only ever grows. */
  function assertNoCaseResidue(vehicles, carrying) {
    const dirty = (vehicles || [])
      .filter(v => v && v !== carrying)
      .map(v => ({ id: v.id, residue: v.caseResidue() }))
      .filter(x => x.residue.length);
    if (dirty.length) {
      throw new Error('FWVehicle.assertNoCaseResidue: a resolved case left marks on ' +
        dirty.map(x => x.id + ' (' + x.residue.join('; ') + ')').join(', ') +
        ' \u2014 the world must not record which vehicles were fraudulent.');
    }
    return true;
  }

  return { Vehicle, ambientRoutes, escapeRoute, assertNoCaseResidue, AMBIENT_SPEED, FLEE_SPEED };
})();
