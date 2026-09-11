/* simulation/simRunner.js — wires clock + entity/event/behavior/signal/MO
   engines into one running loop and exposes a read-only snapshot for a
   UI to poll. This is the first slice that actually runs continuously
   in the browser; everything before it only ran inside test harnesses. */
const FWSimRunner = (() => {
  const TICK_MS = 1000;      // real ms between loop ticks
  const FF_CHUNK = 300;      // sim-seconds per step during fast-forward

  let state = null;
  let intervalHandle = null;
  const listeners = [];

  function absoluteNow(clock) {
    return (clock.day - 1) * FWSimClock.SECONDS_PER_DAY + clock.simSeconds;
  }

  function boot(seed) {
    seed = seed != null ? seed : Math.floor(Math.random() * 1e6);
    const rng = FWRng.createRng(seed);
    const clock = new FWSimClock.SimClock({ speed: 5, startSimSeconds: 6 * 3600 });
    const registry = FWEntityEngine.seedPort(rng);
    const eventEngine = FWEventEngine.createEngine(seed + 1);
    const signalEngine = FWSignalEngine.createEngine();
    const moEngine = FWMoEngine.createEngine();
    state = {
      seed, rng, clock, registry, eventEngine, signalEngine, moEngine,
      recentEvents: [], lastResult: null, totalEvents: 0
    };
    return state;
  }

  // One deterministic simulation step of dtSeconds sim-time. Shared by
  // the real-time loop and fast-forward so both paths behave identically.
  function stepOnce(dtSeconds) {
    if (!state || dtSeconds <= 0) return null;
    const { clock, registry, rng, eventEngine, signalEngine, moEngine } = state;
    const now = absoluteNow(clock);

    const normalEvents = FWEventEngine.step(eventEngine, registry, now, dtSeconds);
    const disruptions = FWBehaviorEngine.step(registry, rng, eventEngine, now, dtSeconds).filter(Boolean);
    FWSignalEngine.process(signalEngine, registry, disruptions);
    FWSignalEngine.pruneExpired(registry, now);
    const moResult = FWMoEngine.process(moEngine, registry, now);

    const combined = normalEvents.concat(disruptions);
    state.recentEvents = combined.concat(state.recentEvents).slice(0, 40);
    state.totalEvents += combined.length;
    state.lastResult = { now, normalEvents, disruptions, moResult };
    return state.lastResult;
  }

  function tick(realDeltaMs) {
    if (!state) return null;
    const dt = state.clock.tick(realDeltaMs);
    return dt > 0 ? stepOnce(dt) : null;
  }

  // Advances sim time without waiting for it in real time (Phase 8's
  // "while you were away"), stepping in small chunks so behavior/event
  // volume and signal decay stay correct instead of one giant jump.
  function fastForward(simSecondsAmount) {
    if (!state) return;
    let remaining = simSecondsAmount;
    while (remaining > 0) {
      const step = Math.min(FF_CHUNK, remaining);
      state.clock.advanceBy(step);
      stepOnce(step);
      remaining -= step;
    }
  }

  function start() {
    if (intervalHandle || !state) return;
    let last = Date.now();
    intervalHandle = setInterval(() => {
      const now = Date.now();
      const delta = now - last;
      last = now;
      tick(delta);
      listeners.forEach(fn => fn(state));
    }, TICK_MS);
  }

  function stop() {
    if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
  }

  function onTick(fn) { listeners.push(fn); }
  function getState() { return state; }

  return { boot, start, stop, tick, fastForward, onTick, getState, absoluteNow };
})();
