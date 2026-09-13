/* simulation/simRunner.js — wires clock + entity/event/behavior/signal/MO
   engines into one running loop and exposes a read-only snapshot for a
   UI to poll. This is the first slice that actually runs continuously
   in the browser; everything before it only ran inside test harnesses. */
const FWSimRunner = (() => {
  const TICK_MS = 1000;      // real ms between loop ticks
  const FF_CHUNK = 300;      // sim-seconds per step during fast-forward

  let state = null;
  let intervalHandle = null;
  let lastRestore = null;
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
    const outcomeEngine = FWOutcomeEngine.createEngine();
    const shiftTracker = window.FWShiftEngine ? FWShiftEngine.createTracker() : null;
    const facilityTracker = window.FWFacilityEngine ? FWFacilityEngine.createTracker() : null;
    // Phase C: how far the trucks actually travelled, and how often the place
    // they were standing at disagreed with what their lifecycle stage said.
    const journeyTracker = window.FWJourneyEngine ? FWJourneyEngine.createTracker() : null;
    /* Slice 74: three of the thirteen disruption primitives leave two records
       instead of one, and how many companion records were actually written --
       against how many composite acts happened -- is a number this build has to
       be able to state with its denominator. */
    const actTracker = window.FWActEngine ? FWActEngine.createTracker() : null;
    /* Phase F: SOME ACTORS HAVE A PLAN. Drawn once, here, from a stream offset
       from this seed (intentEngine.PLAN_SEED_OFFSET) so choosing the actors
       spends none of the randomness the run itself uses. The book is GROUND
       TRUTH -- intentEngine.GROUND_TRUTH names this module and behaviorEngine as
       its only readers, no view may render it, and it is reachable from state on
       exactly the terms a signal's answer key already is. */
    const intentBook = window.FWIntentEngine
      ? FWIntentEngine.createBook(registry, seed, FWBehaviorEngine.LIFECYCLE,
        [...FWBehaviorEngine.DISRUPTION_ELIGIBLE_STAGES], { sampleSeconds: FF_CHUNK })
      : null;
    state = {
      seed, rng, clock, registry, eventEngine, signalEngine, moEngine, outcomeEngine,
      shiftTracker, facilityTracker, journeyTracker, intentBook, actTracker,
      recentEvents: [], lastResult: null, totalEvents: 0
    };
    return state;
  }

  // One deterministic simulation step of dtSeconds sim-time. Shared by
  // the real-time loop and fast-forward so both paths behave identically.
  function stepOnce(dtSeconds) {
    if (!state || dtSeconds <= 0) return null;
    const { clock, registry, rng, eventEngine, signalEngine, moEngine,
      shiftTracker, facilityTracker, journeyTracker, intentBook, actTracker } = state;
    const now = absoluteNow(clock);
    // Phase 37: the shift the port is actually in drives normal traffic
    // volume, which disruption types are plausible, and how much of what
    // happens gets observed at all.
    const shift = clock.shift();
    // Phase 5: where a movement is also drives whether what happens to
    // it gets recorded, so the site tracker rides along with the shift one.
    // Phase F: the plan book rides along with the trackers, because a plan is
    // a fact about who is driving that behaviorEngine has to consult when it
    // decides what a granted disruption opportunity is spent on.
    const ctx = { shift, shiftTracker, facilityTracker, journeyTracker, intentBook, actTracker };

    const normalEvents = FWEventEngine.step(eventEngine, registry, now, dtSeconds, ctx);
    const disruptions = FWBehaviorEngine.step(registry, rng, eventEngine, now, dtSeconds, ctx).filter(Boolean);
    FWSignalEngine.process(signalEngine, registry, disruptions);
    FWSignalEngine.pruneExpired(registry, now);
    const moResult = FWMoEngine.process(moEngine, registry, now);

    const combined = normalEvents.concat(disruptions);
    state.recentEvents = combined.concat(state.recentEvents).slice(0, 40);
    state.totalEvents += combined.length;
    state.lastResult = { now, shift, normalEvents, disruptions, moResult };
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

  /* RESTORING A SAVED RUN. Two steps, in this order and no other: the runner
     creates a run from the saved seed exactly as a fresh boot does, and then the
     store writes the saved fields into it. That order is the point. boot() is
     what builds the world, including the parts of it that only this module and
     behaviorEngine are allowed to consult; the store fills the containers boot
     just made and never makes any of its own, so nothing it read out of storage
     can arrive as a structure some later reader could mistake for the run's own.

     A failed restore is a fresh run, not a broken one: if the snapshot is
     refused, or applying it throws, this re-boots from scratch and returns null
     so the caller can take its normal first-run path (warm start included). */
  function restore(snapshot) {
    if (!snapshot || !window.FWLiveSimStore) return null;
    const compat = FWLiveSimStore.compatible(snapshot);
    if (!compat.ok) return null;
    try {
      boot(snapshot.seed);
      const applied = FWLiveSimStore.applyTo(state, snapshot);
      if (!applied.ok) { state = null; boot(); return null; }
      lastRestore = applied;
      return state;
    } catch (e) {
      state = null;
      boot();
      lastRestore = { ok: false, why: String((e && e.message) || e) };
      return null;
    }
  }

  function restoreReport() { return lastRestore; }

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

  /* FF_CHUNK is exported because it is the interval the world is SAMPLED at,
     and Slice 73 made that a fact another module depends on: a plan step waiting
     for a position a truck passes through in less than one chunk may never be
     observed in it. intentEngine quotes the figure and the suite reconciles the
     quote against this one. */
  return { boot, restore, restoreReport, start, stop, tick, fastForward, onTick, getState, absoluteNow, TICK_MS, FF_CHUNK };
})();
