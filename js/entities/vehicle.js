/* entities/vehicle.js — Phase 2: ambient traffic.
   A vehicle is a small rectangle "truck" that patrols a route of
   world-space waypoints in a loop, plus one designated "suspect"
   vehicle whose route detours into an incident sequence when a case
   is active. Pure Phaser display objects; no physics engine needed
   since routes are simple polylines and the port is not simulating
   collisions — this is a signal/investigation game, not a driving sim. */
const FWVehicle = (() => {
  const SPEED = 70; // world px/sec

  function dist(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }

  class Vehicle {
    constructor(scene, route, opts = {}) {
      this.scene = scene;
      this.route = route.slice();
      this.loop = opts.loop !== false;
      this.speed = opts.speed || SPEED;
      this.wpIndex = 0;
      this.color = opts.color || 0x5b7a99;
      this.isSuspect = !!opts.isSuspect;
      this.id = opts.id || Math.random().toString(36).slice(2, 8);
      this.paused = false;
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
      this.body.setStrokeStyle(on ? 3 : 1, on ? 0xfacc15 : 0xffffff, on ? 1 : 0.25);
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
    const gateX = ZONE.exitGate.x, gateY = ZONE.exitGate.y + ZONE.exitGate.h / 2;
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

  return { Vehicle, ambientRoutes, escapeRoute };
})();
