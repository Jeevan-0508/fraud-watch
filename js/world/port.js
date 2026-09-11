/* world/port.js — Phase 1: Port Meridian geography.
   Draws the readable world: terminal, depot, warehouse, parking,
   checkpoint, restricted area, dock, roads, exit gate. Pure Phaser
   graphics/shapes — no image assets, so the repo stays static-friendly.
   Ambient touches (water scroll, blinking lights, ship bob, crane sway)
   are kept deliberately light here; full vehicle/worker AI is Phase 2. */
const FWWorld = (() => {
  const WORLD_W = 2000, WORLD_H = 1100;
  const ZONE = {
    sea:        { x: 0,   y: 0,   w: 260,  h: 1100 },
    dockA:      { x: 60,  y: 260 },
    dockB:      { x: 60,  y: 640 },
    terminal:   { x: 300, y: 140, w: 360, h: 820 },
    crane:      { x: 660, y: 140, w: 90,  h: 820 },
    mainRoad:   { x: 260, y: 1000, w: 1660, h: 60 },
    serviceRoad:{ x: 900, y: 200, w: 60,  h: 800 },
    depot:      { x: 1000, y: 760, w: 240, h: 190 },
    parkingLot: { x: 1040, y: 560, w: 260, h: 170 },
    warehouse:  { x: 1300, y: 700, w: 300, h: 250 },
    checkpoint: { x: 880, y: 190, w: 100, h: 70 },
    restricted: { x: 820, y: 40,  w: 220, h: 170 },
    exitGate:   { x: 1870, y: 970, w: 60, h: 110 }
  };

  function label(scene, x, y, text, color = '#64748b') {
    return scene.add.text(x, y, text, {
      fontFamily: 'Orbitron, sans-serif', fontSize: '11px', color
    }).setAlpha(0.85);
  }

  function build(scene) {
    const g = scene.add.graphics();
    const handles = { lights: [], ships: [], cranes: [] };

    // ---- ground ----
    g.fillStyle(0x0b0f14, 1).fillRect(0, 0, WORLD_W, WORLD_H);

    // ---- sea + water tile ----
    if (!scene.textures.exists('waveTile')) {
      const wg = scene.make.graphics({ x: 0, y: 0, add: false });
      wg.fillStyle(0x0d2230, 1).fillRect(0, 0, 64, 64);
      wg.lineStyle(2, 0x18384a, 0.8);
      wg.beginPath(); wg.arc(16, 20, 20, Math.PI, 0); wg.strokePath();
      wg.beginPath(); wg.arc(48, 46, 20, Math.PI, 0); wg.strokePath();
      wg.generateTexture('waveTile', 64, 64);
      wg.destroy();
    }
    const sea = scene.add.tileSprite(ZONE.sea.x, ZONE.sea.y, ZONE.sea.w, ZONE.sea.h, 'waveTile').setOrigin(0, 0);
    handles.sea = sea;

    // ---- dock + ships ----
    [ZONE.dockA, ZONE.dockB].forEach((d, i) => {
      g.fillStyle(0x1c2531, 1).fillRect(d.x - 20, d.y - 10, 60, 90);
      const hull = scene.add.rectangle(d.x + 90, d.y + 35, 170, 60, 0x27384a).setStrokeStyle(1, 0x3a4b60);
      const cabin = scene.add.rectangle(d.x + 150, d.y + 15, 34, 26, 0x1c2531).setStrokeStyle(1, 0x3a4b60);
      scene.tweens.add({ targets: [hull, cabin], y: '+=4', duration: 2600 + i * 300, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
      handles.ships.push(hull);
    });
    label(scene, ZONE.sea.x + 30, 20, 'SHIP DOCKING AREA', '#38bdf8');

    // ---- container terminal ----
    const colors = [0x38536b, 0x5a3b3b, 0x3b5a44, 0x5a4f2f];
    let ci = 0;
    for (let col = 0; col < 5; col++) {
      for (let row = 0; row < 6; row++) {
        const cx = ZONE.terminal.x + col * 68 + 10;
        const cy = ZONE.terminal.y + row * 130 + 10;
        const stackH = 1 + (row % 2);
        for (let s = 0; s < stackH; s++) {
          g.fillStyle(colors[ci % colors.length], 1).fillRect(cx, cy - s * 22, 56, 20);
          g.lineStyle(1, 0x0b0f14, 1).strokeRect(cx, cy - s * 22, 56, 20);
        }
        ci++;
      }
    }
    label(scene, ZONE.terminal.x + 60, ZONE.terminal.y - 20, 'CONTAINER TERMINAL 4', '#94a3b8');

    // ---- cranes ----
    for (let i = 0; i < 3; i++) {
      const cx = ZONE.crane.x + 20 + i * 25;
      const tower = scene.add.rectangle(cx, ZONE.crane.y + 400, 8, 780, 0x2a3646);
      const arm = scene.add.rectangle(cx, ZONE.crane.y + 30, 140, 8, 0x2a3646).setOrigin(0.1, 0.5);
      scene.tweens.add({ targets: arm, angle: { from: -4, to: 4 }, duration: 4000 + i * 500, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
      handles.cranes.push({ tower, arm });
    }
    label(scene, ZONE.crane.x, ZONE.crane.y - 20, 'CRANE AREA', '#94a3b8');

    // ---- roads ----
    [ZONE.mainRoad, ZONE.serviceRoad].forEach(r => {
      g.fillStyle(0x161d27, 1).fillRect(r.x, r.y, r.w, r.h);
      g.lineStyle(2, 0x2a333f, 1);
      if (r.w > r.h) { g.lineBetween(r.x, r.y + r.h / 2, r.x + r.w, r.y + r.h / 2); }
      else { g.lineBetween(r.x + r.w / 2, r.y, r.x + r.w / 2, r.y + r.h); }
    });
    label(scene, ZONE.mainRoad.x + 20, ZONE.mainRoad.y - 22, 'MAIN ROAD', '#475569');
    label(scene, ZONE.serviceRoad.x - 60, ZONE.serviceRoad.y + 10, 'SERVICE RD', '#475569');

    // ---- depot ----
    g.fillStyle(0x141b26, 1).fillRect(ZONE.depot.x, ZONE.depot.y, ZONE.depot.w, ZONE.depot.h);
    g.lineStyle(1, 0x2a333f, 1).strokeRect(ZONE.depot.x, ZONE.depot.y, ZONE.depot.w, ZONE.depot.h);
    label(scene, ZONE.depot.x + 10, ZONE.depot.y + 8, 'CARGO DEPOT', '#94a3b8');

    // ---- parking lot ----
    g.fillStyle(0x11161f, 1).fillRect(ZONE.parkingLot.x, ZONE.parkingLot.y, ZONE.parkingLot.w, ZONE.parkingLot.h);
    g.lineStyle(1, 0x263140, 1);
    for (let i = 0; i < 6; i++) {
      const lx = ZONE.parkingLot.x + 10 + i * 42;
      g.lineBetween(lx, ZONE.parkingLot.y + 6, lx, ZONE.parkingLot.y + ZONE.parkingLot.h - 6);
    }
    label(scene, ZONE.parkingLot.x + 10, ZONE.parkingLot.y - 20, 'TRUCK PARKING', '#94a3b8');

    // ---- warehouse + loading bays ----
    g.fillStyle(0x171f2b, 1).fillRect(ZONE.warehouse.x, ZONE.warehouse.y, ZONE.warehouse.w, ZONE.warehouse.h);
    g.lineStyle(1, 0x2a333f, 1).strokeRect(ZONE.warehouse.x, ZONE.warehouse.y, ZONE.warehouse.w, ZONE.warehouse.h);
    for (let i = 0; i < 4; i++) {
      g.fillStyle(0x0d1420, 1).fillRect(ZONE.warehouse.x + 15 + i * 70, ZONE.warehouse.y + ZONE.warehouse.h - 8, 50, 16);
    }
    label(scene, ZONE.warehouse.x + 10, ZONE.warehouse.y + 8, 'WAREHOUSE — LOADING BAYS', '#94a3b8');

    // ---- checkpoint (animated barrier) ----
    g.fillStyle(0x161d27, 1).fillRect(ZONE.checkpoint.x, ZONE.checkpoint.y, ZONE.checkpoint.w, ZONE.checkpoint.h);
    const barrier = scene.add.rectangle(ZONE.checkpoint.x + 50, ZONE.checkpoint.y + 35, 60, 5, 0xf87171).setOrigin(0, 0.5);
    scene.tweens.add({ targets: barrier, angle: { from: 0, to: -70 }, duration: 1200, yoyo: true, hold: 1800, repeat: -1, ease: 'Cubic.inOut' });
    label(scene, ZONE.checkpoint.x - 10, ZONE.checkpoint.y - 20, 'SECURITY CHECKPOINT', '#f59e0b');

    // ---- restricted area ----
    g.fillStyle(0x2a1414, 0.35).fillRect(ZONE.restricted.x, ZONE.restricted.y, ZONE.restricted.w, ZONE.restricted.h);
    g.lineStyle(1, 0xf87171, 0.6);
    g.strokeRect(ZONE.restricted.x, ZONE.restricted.y, ZONE.restricted.w, ZONE.restricted.h);
    label(scene, ZONE.restricted.x + 10, ZONE.restricted.y + 8, 'RESTRICTED AREA', '#f87171');

    // ---- exit gate ----
    g.fillStyle(0x161d27, 1).fillRect(ZONE.exitGate.x, ZONE.exitGate.y, ZONE.exitGate.w, ZONE.exitGate.h);
    g.lineStyle(1, 0x38bdf8, 0.7).strokeRect(ZONE.exitGate.x, ZONE.exitGate.y, ZONE.exitGate.w, ZONE.exitGate.h);
    label(scene, ZONE.exitGate.x - 20, ZONE.exitGate.y - 20, 'EXIT GATE', '#38bdf8');

    // ---- dusk tint + security lights ----
    scene.add.rectangle(WORLD_W / 2, WORLD_H / 2, WORLD_W, WORLD_H, 0x0a1a2a, 0.18).setBlendMode(Phaser.BlendModes.MULTIPLY);
    const lightSpots = [
      [ZONE.checkpoint.x + 50, ZONE.checkpoint.y - 10],
      [ZONE.warehouse.x + 20, ZONE.warehouse.y + 10],
      [ZONE.warehouse.x + ZONE.warehouse.w - 20, ZONE.warehouse.y + 10],
      [ZONE.depot.x + 20, ZONE.depot.y + 10],
      [ZONE.exitGate.x + 30, ZONE.exitGate.y - 10]
    ];
    lightSpots.forEach(([lx, ly], i) => {
      const glow = scene.add.circle(lx, ly, 14, 0xfde68a, 0.35);
      scene.tweens.add({ targets: glow, alpha: { from: 0.15, to: 0.5 }, duration: 1400 + i * 220, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
      handles.lights.push(glow);
    });

    handles.zones = ZONE;
    handles.worldSize = { w: WORLD_W, h: WORLD_H };
    return handles;
  }

  return { build, ZONE, WORLD_W, WORLD_H };
})();
