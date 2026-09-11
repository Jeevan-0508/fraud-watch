/* core/game.js — boots the Phaser 3 world. Phase 1 scope only:
   Port Meridian geography + camera. Ambient vehicle/worker/ship AI,
   the scenario engine, investigation UI and chase mode are later
   phases layered on top of this scene, not rewrites of it. */
const FWCoreGame = (() => {
  let game = null;
  let camCtrl = null;

  function boot(containerId) {
    if (game) return game;
    const el = document.getElementById(containerId);

    class PortScene extends Phaser.Scene {
      constructor() { super('PortScene'); }
      create() {
        this.world = FWWorld.build(this);
        camCtrl = FWCamera.attach(this, FWWorld.WORLD_W, FWWorld.WORLD_H);
      }
      update(time, delta) {
        if (this.world && this.world.sea) this.world.sea.tilePositionX += delta * 0.012;
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
