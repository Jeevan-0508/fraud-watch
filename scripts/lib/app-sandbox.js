/* scripts/lib/app-sandbox.js — loads the Fraud Watch browser app's own
   source files into a Node `vm` context so the simulation engine can run
   headless, outside any browser tab. This is production code (used by
   scripts/tick.js in the scheduled GitHub Action), not a test-only shim.

   Why the app's real files, unmodified: the autonomous world must be the
   SAME simulation the browser observes, not a second engine. Every file
   here is loaded byte-for-byte off disk, the same way index.html loads it
   with <script> tags, so the tick script and the browser can never drift
   into simulating two different worlds.

   FWGlobals (js/globals.js) is the one file that publishes every module's
   binding onto `window`, and it throws if any module in its own list
   failed to load — including UI modules that reference `document`. That
   is why every file the browser loads is loaded here too, UI included,
   even though the tick script only ever calls FWSimRunner/FWLiveSimStore.
   A minimal DOM shim (below) is enough for those UI files to define their
   module without ever being initialised or rendered. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO_ROOT = path.join(__dirname, '..', '..');
const JS_ROOT = path.join(REPO_ROOT, 'js');

const FILES = [
  'data.js',
  'world/port.js', 'core/camera.js', 'entities/vehicle.js',
  'systems/scenario.js', 'systems/scoring.js', 'systems/livesim-store.js', 'ui/port-ui.js', 'core/game.js',
  'simulation/rng.js', 'simulation/clock.js', 'simulation/reconcile.js', 'ui/copy-rules.js', 'ui/render-guards.js',
  'simulation/entities/truck.js', 'simulation/entities/driver.js',
  'simulation/entities/trailer.js', 'simulation/entities/shipment.js',
  'simulation/entities/carrier.js', 'simulation/entities/facility.js',
  'simulation/worldGraph.js',
  'simulation/journeyEngine.js',
  'simulation/shiftEngine.js', 'simulation/facilityEngine.js', 'simulation/entityEngine.js',
  'simulation/eventEngine.js', 'simulation/falsePositiveEngine.js',
  'simulation/intentEngine.js', 'simulation/behaviorEngine.js',
  'simulation/signalEngine.js', 'simulation/moEngine.js', 'simulation/actEngine.js', 'simulation/investigationEngine.js',
  'simulation/candidateEngine.js',
  'simulation/adviceEngine.js', 'simulation/outcomeEngine.js', 'simulation/exposureModel.js',
  'simulation/analyticsEngine.js', 'simulation/simRunner.js',
  'ui/sim-debug.js', 'ui/mo-intelligence.js', 'ui/discovery-lab.js', 'ui/case-export.js', 'ui/entity-inspector.js',
  'ui/freight-map.js',
  'simulation/networkEngine.js', 'simulation/awayReport.js',
  'ui/away-report.js', 'ui/network-view.js', 'ui/calibration-view.js',
  'ui/shift-view.js', 'ui/exposure-view.js', 'ui/facility-view.js', 'ui/analytics-view.js', 'ui/autonomous-world.js',
  'game.js', 'training.js', 'charts.js',
  'globals.js'
];

class FakeEl {
  constructor(id) {
    this.id = id || '';
    this._html = '';
    this._text = '';
    this.dataset = {};
    this.value = '';
    this.children = [];
    this.style = {};
    this._listeners = {};
    this._classes = new Set();
    this.classList = {
      add: (...c) => c.forEach(x => this._classes.add(x)),
      remove: (...c) => c.forEach(x => this._classes.delete(x)),
      toggle: (c, on) => {
        const has = this._classes.has(c);
        const want = on === undefined ? !has : !!on;
        if (want) this._classes.add(c); else this._classes.delete(c);
        return want;
      },
      contains: (c) => this._classes.has(c)
    };
  }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
  addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); }
  removeEventListener() {}
  dispatch(type, ev) { (this._listeners[type] || []).forEach(fn => fn(ev || { target: this })); return this; }
  appendChild(c) { this.children.push(c); return c; }
  prepend(c) { this.children.unshift(c); return c; }
  removeChild(c) { this.children = this.children.filter(x => x !== c); return c; }
  remove() {}
  get lastChild() { return this.children.length ? this.children[this.children.length - 1] : null; }
  get firstChild() { return this.children.length ? this.children[0] : null; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest() { return null; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }; }
  getContext() { return null; }
  setAttribute(k, v) { this[k] = v; }
  getAttribute(k) { return this[k]; }
  focus() {}
  scrollIntoView() {}
  insertAdjacentHTML(pos, html) { this._html += html; }
}

/* Boots a fresh, headless copy of the app's script realm. No network,
   no localStorage (undefined, same as a file:// origin refusing storage —
   livesim-store's own save()/load() already treat that as "start fresh"),
   no timers left running: setInterval/requestAnimationFrame are stubbed to
   no-ops because the tick script drives time itself via
   FWSimRunner.fastForward, never via the real-time loop. */
function bootSandbox() {
  const els = new Map();
  const el = (id) => {
    if (!els.has(id)) els.set(id, new FakeEl(id));
    return els.get(id);
  };
  const document = {
    getElementById: (id) => el(id),
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (t) => new FakeEl('created-' + t),
    createElementNS: (ns, t) => new FakeEl('created-ns-' + t),
    addEventListener: () => {},
    body: new FakeEl('body'),
    documentElement: new FakeEl('html'),
    hidden: false
  };
  const sandbox = {
    console,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
    Math, Date, JSON, Object, Array, String, Number, Boolean, Set, Map, Error,
    isNaN, parseInt, parseFloat, Infinity, NaN, undefined,
    fetch: (p) => {
      const file = path.join(REPO_ROOT, String(p));
      if (!fs.existsSync(file)) return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(fs.readFileSync(file, 'utf8'))) });
    },
    performance: { now: () => Date.now() },
    Chart: function () { return { destroy() {}, update() {}, data: { labels: [], datasets: [{ data: [] }] }, options: {} }; },
    Phaser: undefined
  };
  sandbox.document = document;
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);

  const combined = FILES.map(f => fs.readFileSync(path.join(JS_ROOT, f), 'utf8')).join('\n;\n');
  vm.runInContext(combined, ctx, { filename: 'fraud-watch-combined.js' });

  return { window: sandbox, document, evalIn: (code) => vm.runInContext(code, ctx, { filename: 'evalIn.js' }) };
}

module.exports = { bootSandbox, FILES, JS_ROOT, REPO_ROOT };
