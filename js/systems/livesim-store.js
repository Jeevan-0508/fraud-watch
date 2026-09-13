/* systems/livesim-store.js — save and restore the Live Sim run.

   Until this file the whole app persisted exactly one thing: Port Meridian's
   score (systems/scoring.js, its own key, its own version, load/save/migrate).
   The Live Sim -- the world the page now opens on -- persisted nothing, so a
   refresh on day 3 opened day 1 with no cases and no discovered patterns. This
   is scoring.js's pattern applied to the run: a dedicated key, a version, a
   migration door, and every read and write inside a try/catch so a browser that
   refuses storage (private mode, a full quota, a file:// origin) degrades to
   "start fresh" instead of throwing on load.

   WHAT IS HARD HERE IS NOT THE STORAGE, IT IS THE SHAPE. The run holds Maps
   (the entity registry keeps one per kind, the case engine keeps three, the
   verdict engine keeps one), two random streams that are closures over a
   counter, a clock instance with methods, and records that are shared by
   reference between two collections at once. JSON.stringify on the run object
   would write an empty object for every Map, drop both streams, and split each
   shared record into independent copies -- silently, and only visibly wrong a
   session later. So every conversion this file performs is named in CONVERSIONS
   below and performed by a function that only does that one conversion.

   WHAT THIS FILE IS NOT A READER OF. The run also carries hidden bookkeeping
   that the simulation keeps for itself and no view is allowed to draw. This
   module never names those fields and never reaches for them: what it writes is
   the list in PERSISTED and nothing else, so a field that is not on that list
   cannot reach storage, and cannot come back out of storage into a later
   session where some panel might render it. Those fields are re-created by the
   runner's own boot from the same seed on restore, by the module that owns
   them, which is the only module allowed to. That is a deliberate reduction and
   it is stated in REDUCTIONS. */
const FWLiveSimStore = (() => {
  const KEY = 'fraudwatch_livesim_state';
  const VERSION = 1;

  /* SAVE CADENCE, decided rather than left to the caller.

     Throttled periodic save plus a flush when the page goes away. The run ticks
     once a real second and a save is a full serialisation of the world, so
     saving every tick would spend that work sixty times a minute to protect
     against losing at most one second of a simulation that can be
     fast-forwarded. Ten seconds is the throttle; the flush on unload is what
     makes the last ten seconds not the thing you lose. A save that fails
     (quota, refused storage) is reported, never thrown, and never retried in a
     tighter loop. */
  const SAVE_INTERVAL_MS = 10000;
  const CADENCE = {
    kind: 'THROTTLED_PLUS_FLUSH',
    throttleMs: SAVE_INTERVAL_MS,
    flushOn: ['pagehide', 'beforeunload'],
    means: 'a periodic save at most once every ten real seconds, and one final save when the page is being left.',
    doesNotMean: 'a save on every tick, and not a save only on unload -- a tab killed by the OS never gets its unload handler.'
  };

  /* EVERY FIELD OF THE RUN THIS FILE WRITES, and how each one is converted.
     A field absent from this list is absent from storage. `how` is the name of
     the conversion in CONVERSIONS, so the table and the code cannot drift into
     disagreeing about which of them is a Map. */
  const PERSISTED = [
    { field: 'seed', how: 'PLAIN', why: 'the run is re-created from it, so it is restored before anything else.' },
    { field: 'clock', how: 'CLOCK', why: 'day, time of day, speed and whether it is running.' },
    { field: 'registry', how: 'REGISTRY', why: 'one Map per entity kind, plus the per-kind id counters.' },
    { field: 'eventEngine', how: 'EVENT_ENGINE', why: 'the recorded event log as declared rows, its id counter and its own random stream.' },
    { field: 'signalEngine', how: 'PLAIN', why: 'an id counter and a log of flat rows.' },
    { field: 'moEngine', how: 'MO_ENGINE', why: 'three Maps: the cases themselves, entity-to-case, and the combination tally.' },
    { field: 'outcomeEngine', how: 'OUTCOME_ENGINE', why: 'a ledger plus a Map into it -- the same records, twice.' },
    { field: 'shiftTracker', how: 'PLAIN_OR_NULL', why: 'nested counters, no Maps. null when the module was not loaded.' },
    { field: 'facilityTracker', how: 'PLAIN_OR_NULL', why: 'nested counters keyed by site id.' },
    { field: 'journeyTracker', how: 'PLAIN_OR_NULL', why: 'travel and agreement counters.' },
    { field: 'recentEvents', how: 'EVENT_ROWS', why: 'the published recent-event list the panels read, as declared rows.' },
    { field: 'totalEvents', how: 'PLAIN', why: 'the run total, which the recent list is only a window onto.' },
    { field: 'rngState', how: 'RNG_STATE', why: 'the run stream position, so a restored world continues rather than repeating.' }
  ];
  const PERSISTED_FIELDS = PERSISTED.map(p => p.field);

  /* Named conversions. Each says what the live shape is and what the stored
     shape is, so a reader can check the pair without reading the functions. */
  const CONVERSIONS = {
    PLAIN: 'already JSON: numbers, strings, arrays of flat records. Copied.',
    PLAIN_OR_NULL: 'as PLAIN, except null is a real value meaning the optional module was not loaded, and is stored as null rather than as an empty object.',
    CLOCK: 'a class instance with methods -> its own four declared fields -> the same instance, mutated in place so every holder of the clock keeps the object it already has.',
    REGISTRY: 'one Map per entity kind -> an array of entries per kind -> the same Maps, cleared and refilled in place.',
    EVENT_ENGINE: 'a log, a counter and a closure over a random counter -> the log as EVENT_ROWS, the counter and the stream position -> all three restored, the stream by position and not by re-seeding.',
    EVENT_ROWS: 'a recorded event -> its declared fields only, listed in EVENT_ROW_FIELDS -> the same fields. What a row carries beside them is not written, so it cannot be read back out.',
    MO_ENGINE: 'three Maps -> three arrays of entries -> three Maps, refilled in place.',
    OUTCOME_ENGINE: 'a ledger array and a Map whose values are the SAME objects as the ledger rows -> the ledger only -> the ledger, with the Map rebuilt from it by reference so the aliasing that existed before the save exists after it.',
    RNG_STATE: 'a closure counter, readable only because rng.js exposes its position -> an integer -> the counter, set back.'
  };

  /* WHAT A RESTORED RUN DOES NOT GET BACK, stated so nobody reads the restore
     as lossless. Both are deliberate. */
  /* WHICH FIELDS OF A RECORDED EVENT ARE WRITTEN, and why this is a list rather
     than the row itself.

     An event row has its own declared fields and, beside them, a side channel the
     simulation uses to hand itself notes -- and measured on a four-day run, that
     channel is where the great majority of the bytes of a naive snapshot came
     from. Two things are true of it: no view is allowed to draw what is in it,
     and this module is not allowed to know what is in it. Storing the row whole
     would have broken both at once: it would have copied the simulation's private
     notes into a browser's localStorage, where the next session reads them back
     as ordinary data and any later panel that renders "the event" renders them.

     So the projection is a whitelist, and it is a whitelist for the same reason
     PERSISTED is one: naming what may be written is the only version of this that
     stays correct when a field nobody here has heard of is added upstream. The
     cost is stated in REDUCTIONS and it is real -- the annotations the declared
     answer-key panel reads do not survive a refresh, and that panel says so in
     its own words, because it already has a named state for "not enough
     annotated events to say". */
  const EVENT_ROW_FIELDS = ['id', 'timestamp', 'type', 'entityId', 'relatedEntities', 'severity', 'source'];

  const REDUCTIONS = [
    { what: 'the last tick result object', why: 'a transient produced by the step that just ran and overwritten by the next one. Nothing outlives one tick by reading it.' },
    { what: 'everything a recorded event carries beside its declared fields', why: 'only EVENT_ROW_FIELDS are written. The simulation\u2019s notes to itself are not storage-shaped and must not become readable data in a later session; the panels allowed to read them do so live, while the run that emitted them is still in memory. After a refresh the restored rows carry their declared fields and nothing else.' },
    { what: 'the run hidden bookkeeping', why: 'not on the PERSISTED list, so it never reaches storage. The runner re-creates it from the saved seed through the module that owns it, which is the only module allowed to touch it. What it had accumulated over the saved run is therefore not carried across a refresh.' }
  ];

  /* Refusals, named. A saved run is not restored on a hope. */
  const REFUSALS = {
    NO_SAVE: 'nothing is stored under this key.',
    UNAVAILABLE: 'this browser would not let the app read storage at all.',
    UNREADABLE: 'something is stored but it is not JSON.',
    WRONG_VERSION: 'the stored run was written by a version this build has no migration from.',
    INCOMPLETE: 'the stored run is missing a field the restore needs, so half of it would be this session and half the last one.'
  };

  function mapToEntries(map) {
    return map instanceof Map ? Array.from(map.entries()) : [];
  }
  function fillMap(map, entries) {
    if (!(map instanceof Map)) return map;
    map.clear();
    (entries || []).forEach(pair => { map.set(pair[0], pair[1]); });
    return map;
  }
  /* Leaves are copied through JSON deliberately: an entity, an event row and a
     case are flat data by construction (their factories return object and array
     literals), and a copy is what stops a restored run from sharing mutable
     objects with the snapshot it was read from. The containers above are what
     JSON cannot carry, and none of them reaches this function. */
  function copyPlain(value) {
    return value === undefined ? null : JSON.parse(JSON.stringify(value));
  }

  function eventRow(ev) {
    const row = {};
    EVENT_ROW_FIELDS.forEach(f => { if (ev[f] !== undefined) row[f] = ev[f]; });
    return copyPlain(row);
  }
  function eventRows(list) {
    return (list || []).map(eventRow);
  }

  function captureRegistry(reg) {
    const kinds = {};
    const KINDS = (typeof FWEntityEngine !== 'undefined' && FWEntityEngine.KINDS) || [];
    KINDS.forEach(kind => {
      const key = FWEntityEngine.plural(kind);
      kinds[key] = mapToEntries(reg[key]).map(pair => [pair[0], copyPlain(pair[1])]);
    });
    return { nextId: copyPlain(reg.nextId), kinds };
  }

  function applyRegistry(reg, stored) {
    Object.keys(stored.kinds || {}).forEach(key => {
      if (reg[key] instanceof Map) fillMap(reg[key], stored.kinds[key]);
    });
    if (stored.nextId) Object.assign(reg.nextId, stored.nextId);
    return reg;
  }

  function captureMoEngine(engine) {
    return {
      nextMoId: engine.nextMoId,
      mos: mapToEntries(engine.mos).map(pair => [pair[0], copyPlain(pair[1])]),
      byEntity: mapToEntries(engine.byEntity),
      signatures: mapToEntries(engine.signatures)
    };
  }

  function applyMoEngine(engine, stored) {
    engine.nextMoId = stored.nextMoId;
    fillMap(engine.mos, stored.mos);
    fillMap(engine.byEntity, stored.byEntity);
    fillMap(engine.signatures, stored.signatures);
    return engine;
  }

  /* The one place where the save is not a copy of the shape it found. Before a
     save, one verdict record is three references to one object: a row of the
     ledger, a value in the by-case Map, and a field on the case it closed.
     Stored three times it would come back as three objects that agree today and
     can disagree tomorrow. So only the ledger is stored, and the other two are
     re-pointed at its rows. */
  function captureOutcomeEngine(engine) {
    return { ledger: copyPlain(engine.ledger || []) };
  }

  function applyOutcomeEngine(engine, stored, mos) {
    engine.ledger = stored.ledger || [];
    fillMap(engine.byMo, engine.ledger.map(entry => [entry.moId, entry]));
    let relinked = 0;
    engine.ledger.forEach(entry => {
      const mo = (mos && typeof mos.get === 'function') ? mos.get(entry.moId) : null;
      if (mo) { mo.verdictOutcome = entry; relinked++; }
    });
    return { relinked: relinked, ledger: engine.ledger.length };
  }

  function captureClock(clock) {
    return typeof clock.toJSON === 'function'
      ? clock.toJSON()
      : { speed: clock.speed, running: clock.running, day: clock.day, simSeconds: clock.simSeconds };
  }

  function applyClock(clock, stored) {
    clock.speed = stored.speed;
    clock.running = stored.running;
    clock.day = stored.day;
    clock.simSeconds = stored.simSeconds;
    return clock;
  }

  function streamPosition(rng) {
    return (rng && typeof rng.position === 'function') ? rng.position() : null;
  }
  function setStreamPosition(rng, position) {
    if (rng && typeof rng.setPosition === 'function' && position != null) { rng.setPosition(position); return true; }
    return false;
  }

  /* THE SNAPSHOT. Reads only the fields on the PERSISTED list off the object it
     is handed. It is handed the run by the runner, which is already an allowed
     reader of everything it holds; this function does not go looking for the
     run and does not reach past the list. */
  function capture(run) {
    if (!run) return null;
    return {
      version: VERSION,
      savedAtRealMs: Date.now(),
      seed: run.seed,
      clock: captureClock(run.clock),
      registry: captureRegistry(run.registry),
      eventEngine: {
        log: eventRows(run.eventEngine.log),
        nextEventId: run.eventEngine.nextEventId,
        rngState: streamPosition(run.eventEngine.rng)
      },
      signalEngine: copyPlain(run.signalEngine),
      moEngine: captureMoEngine(run.moEngine),
      outcomeEngine: captureOutcomeEngine(run.outcomeEngine),
      shiftTracker: run.shiftTracker ? copyPlain(run.shiftTracker) : null,
      facilityTracker: run.facilityTracker ? copyPlain(run.facilityTracker) : null,
      journeyTracker: run.journeyTracker ? copyPlain(run.journeyTracker) : null,
      recentEvents: eventRows(run.recentEvents),
      totalEvents: run.totalEvents,
      rngState: streamPosition(run.rng)
    };
  }

  /* Is this snapshot one this build can put back? Version, and the presence of
     every field the apply step writes -- a partial restore is worse than none,
     because half a world reads as a bug in the simulation rather than as a
     failed load. */
  function compatible(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return { ok: false, refusal: 'UNREADABLE', why: REFUSALS.UNREADABLE };
    if (snapshot.version !== VERSION) return { ok: false, refusal: 'WRONG_VERSION', why: REFUSALS.WRONG_VERSION, storedVersion: snapshot.version };
    const missing = PERSISTED_FIELDS.filter(f => snapshot[f] === undefined);
    if (missing.length) return { ok: false, refusal: 'INCOMPLETE', why: REFUSALS.INCOMPLETE, missing: missing };
    return { ok: true };
  }

  /* The door a version 2 of this shape would come through. Nothing to migrate
     yet, and a snapshot from an unknown version is refused rather than
     coerced -- scoring.js can merge an old save into a default state because its
     state is a flat bag of counters; a world cannot be half-merged. */
  function migrate(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return null;
    if (snapshot.version === VERSION) return snapshot;
    return null;
  }

  /* Writes the saved fields into a run that already exists. The run must have
     been created from the saved seed by its own module first, so every
     container this fills is the container that module made. */
  function applyTo(run, snapshot) {
    const compat = compatible(snapshot);
    if (!compat.ok) return compat;
    applyClock(run.clock, snapshot.clock);
    applyRegistry(run.registry, snapshot.registry);
    run.eventEngine.log = snapshot.eventEngine.log || [];
    run.eventEngine.nextEventId = snapshot.eventEngine.nextEventId;
    setStreamPosition(run.eventEngine.rng, snapshot.eventEngine.rngState);
    run.signalEngine.nextSignalId = snapshot.signalEngine.nextSignalId;
    run.signalEngine.log = snapshot.signalEngine.log || [];
    applyMoEngine(run.moEngine, snapshot.moEngine);
    const outcome = applyOutcomeEngine(run.outcomeEngine, snapshot.outcomeEngine, run.moEngine.mos);
    if (run.shiftTracker && snapshot.shiftTracker) Object.assign(run.shiftTracker, snapshot.shiftTracker);
    if (run.facilityTracker && snapshot.facilityTracker) Object.assign(run.facilityTracker, snapshot.facilityTracker);
    if (run.journeyTracker && snapshot.journeyTracker) Object.assign(run.journeyTracker, snapshot.journeyTracker);
    run.recentEvents = snapshot.recentEvents || [];
    run.totalEvents = snapshot.totalEvents;
    setStreamPosition(run.rng, snapshot.rngState);
    return { ok: true, relinkedVerdicts: outcome.relinked, cases: run.moEngine.mos.size, day: run.clock.day };
  }

  function storage() {
    try {
      if (typeof localStorage === 'undefined' || !localStorage) return null;
      return localStorage;
    } catch (e) { return null; }
  }

  function load() {
    const store = storage();
    if (!store) return { ok: false, refusal: 'UNAVAILABLE', why: REFUSALS.UNAVAILABLE, snapshot: null };
    let raw = null;
    try { raw = store.getItem(KEY); } catch (e) {
      return { ok: false, refusal: 'UNAVAILABLE', why: REFUSALS.UNAVAILABLE, snapshot: null };
    }
    if (!raw) return { ok: false, refusal: 'NO_SAVE', why: REFUSALS.NO_SAVE, snapshot: null };
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) {
      return { ok: false, refusal: 'UNREADABLE', why: REFUSALS.UNREADABLE, snapshot: null };
    }
    const migrated = migrate(parsed);
    if (!migrated) return { ok: false, refusal: 'WRONG_VERSION', why: REFUSALS.WRONG_VERSION, snapshot: null, storedVersion: parsed && parsed.version };
    const compat = compatible(migrated);
    if (!compat.ok) return Object.assign({ snapshot: null }, compat);
    return { ok: true, snapshot: migrated };
  }

  let lastSaveRealMs = 0;
  let saves = 0, skipped = 0, failures = 0;

  function save(run) {
    const store = storage();
    if (!store) { failures++; return { ok: false, refusal: 'UNAVAILABLE', why: REFUSALS.UNAVAILABLE }; }
    try {
      const snapshot = capture(run);
      if (!snapshot) { failures++; return { ok: false, refusal: 'NO_RUN', why: 'there is no run to save.' }; }
      store.setItem(KEY, JSON.stringify(snapshot));
      lastSaveRealMs = Date.now();
      saves++;
      return { ok: true, cases: snapshot.moEngine.mos.length, day: snapshot.clock.day, at: lastSaveRealMs };
    } catch (e) {
      failures++;
      return { ok: false, refusal: 'WRITE_FAILED', why: String((e && e.message) || e) };
    }
  }

  // The throttled half of the cadence. Safe to call on every tick.
  function maybeSave(run) {
    const now = Date.now();
    if (now - lastSaveRealMs < SAVE_INTERVAL_MS) {
      skipped++;
      return { ok: false, refusal: 'THROTTLED', nextInMs: SAVE_INTERVAL_MS - (now - lastSaveRealMs) };
    }
    return save(run);
  }

  // The flush half. Ignores the throttle; used when the page is going away.
  function flush(run) { return save(run); }

  function clear() {
    const store = storage();
    if (!store) return { ok: false, refusal: 'UNAVAILABLE', why: REFUSALS.UNAVAILABLE };
    try { store.removeItem(KEY); return { ok: true }; }
    catch (e) { return { ok: false, refusal: 'WRITE_FAILED', why: String((e && e.message) || e) }; }
  }

  function hasSave() { return load().ok; }
  function stats() { return { saves: saves, skipped: skipped, failures: failures, lastSaveRealMs: lastSaveRealMs }; }

  return {
    KEY, VERSION, SAVE_INTERVAL_MS, CADENCE, PERSISTED, PERSISTED_FIELDS, EVENT_ROW_FIELDS, CONVERSIONS, REDUCTIONS, REFUSALS,
    capture, applyTo, compatible, migrate, load, save, maybeSave, flush, clear, hasSave, stats,
    mapToEntries, fillMap
  };
})();
