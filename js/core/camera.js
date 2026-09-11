/* core/camera.js — drag-to-pan, wheel-to-zoom, and a reset-view control
   for the Port Meridian scene. Deliberately simple: no physics, no
   inertia, just direct camera manipulation so it stays light on CPU. */
const FWCamera = (() => {
  function attach(scene, worldW, worldH) {
    const cam = scene.cameras.main;
    cam.setBounds(0, 0, worldW, worldH);
    cam.setZoom(0.72);
    cam.centerOn(worldW * 0.42, worldH * 0.55);

    let dragging = false, lastX = 0, lastY = 0;

    scene.input.on('pointerdown', (p) => { dragging = true; lastX = p.x; lastY = p.y; });
    scene.input.on('pointerup', () => { dragging = false; });
    scene.input.on('pointermove', (p) => {
      if (!dragging) return;
      cam.scrollX -= (p.x - lastX) / cam.zoom;
      cam.scrollY -= (p.y - lastY) / cam.zoom;
      lastX = p.x; lastY = p.y;
    });
    scene.input.on('wheel', (_p, _o, _dx, dy) => {
      const next = Phaser.Math.Clamp(cam.zoom - dy * 0.0006, 0.5, 1.8);
      cam.setZoom(next);
    });

    return {
      reset: () => { cam.setZoom(0.72); cam.centerOn(worldW * 0.42, worldH * 0.55); }
    };
  }
  return { attach };
})();
