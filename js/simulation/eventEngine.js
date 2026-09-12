/* simulation/eventEngine.js — the deterministic event stream.
   Slice 1 scope only: NORMAL logistics events, tied to sim time, not
   render frames. No suspicious/fraud events yet — those depend on the
   behavior + signal engines (later slices) that give events cause and
   correlation instead of being pure noise. Emitting fraud here would
   just be random flagging, which the product spec explicitly rejects. */
const FWEventEngine = (() => {
  const NORMAL_EVENT_TYPES = [
    'SHIP_ARRIVED', 'SHIP_DEPARTED', 'CONTAINER_MOVED',
    'TRUCK_ARRIVED', 'TRUCK_DEPARTED', 'WAREHOUSE_LOADED', 'WAREHOUSE_UNLOADED',
    'DEPOT_TRANSFER', 'ROUTE_ASSIGNED', 'ROUTE_COMPLETED',
    'DRIVER_CHECKED_IN', 'DRIVER_CHECKED_OUT', 'CHECKPOINT_INSPECTION'
  ];

  /* The log is a bounded ring buffer. That bound is not a performance detail:
     it is the size of the population every later reader of `engine.log` is
     measuring over, so it is named and exported rather than left as a literal
     inside emit(). See FWFalsePositiveEngine.POPULATIONS, which needs it to
     state whether its own minimum sample is reachable at all. */
  const LOG_CAP = 5000;

  /* THE SECOND THING IN THIS PROGRAM CALLED `severity`.
     Every event carries a field named `severity`, and it is not the taxonomy's
     `severity` -- that one is an assessed HARM class for a fraud pattern, whose
     tokens are owned and declared by FW.severityScale() and are deliberately
     not restated anywhere in this module, here or in a comment. This one is a
     two-token record of whether anything was disrupted when it was written down.
     The two spaces share a field name, share no token, and are on the record
     here as different spaces on purpose, the way moEngine's confidence band is
     on the record as not being a harm class.

     Until this slice the space was undeclared: `emit` defaulted every event to
     'info', behaviorEngine wrote 'warn' on a disruption, and nothing anywhere
     said those were the only two values or what either meant. One bare
     comparison against it (sim-debug's event feed) decided both a row's tone
     and whether the per-event answer key was shown at all, so a value outside
     the space rendered a disruption as ordinary traffic with its note dropped
     and nothing to complain to. */
  const EVENT_SEVERITY = {
    kind: 'VOCABULARY',
    scope: 'whether the recorded event is a disruption to the normal course of a trip',
    means: 'that something departed from the normal lifecycle at the moment this event was written down.',
    doesNotMean: 'how much harm anything would do, that fraud occurred, and NOT the taxonomy harm class of any pattern -- the shared field name is a collision, not a relationship.',
    owner: 'FWEventEngine.emit, which stamps every event in this program',
    tokens: ['info', 'warn'],
    DEFAULT: 'info',
    disruption: 'warn',
    token: {
      info: { means: 'a normal-course event: an arrival, a stage advance, a completed route.',
              producedBy: 'FWEventEngine.step and FWBehaviorEngine.advanceStage, and the default for any caller that names no severity.' },
      warn: { means: 'a disruption was recorded against the entity.',
              producedBy: 'FWBehaviorEngine.applyDisruption, the only writer of this token.' }
    }
  };

  /* Two spaces, one field name. Stated as two rows rather than left implicit,
     so a later reader cannot take a token from one as a value of the other. */
  const SEVERITY_SPACES = {
    EVENT_SEVERITY: {
      owner: 'FWEventEngine (this module)',
      field: 'event.severity',
      tokens: EVENT_SEVERITY.tokens,
      answers: 'was anything disrupted when this was written down'
    },
    TAXONOMY_HARM: {
      owner: 'FW.severityScale() (data.js, from freight-fraud-taxonomy)',
      field: 'pattern.severity',
      tokens: null,
      tokensNote: 'read from the taxonomy module at runtime, never restated here',
      answers: 'how much damage this pattern of fraud does when it happens'
    },
    sharedFieldName: 'severity',
    sharedTokens: 'none, asserted in both directions by assertSeveritySpacesDistinct',
    note: 'A field name is not a type. These two spaces are unrelated and neither is convertible into the other.'
  };

  function assertEventSeverityDeclared() {
    const t = EVENT_SEVERITY.tokens;
    if (!t.length) throw new Error('eventEngine: the event severity space declares no tokens');
    t.forEach(tok => {
      if (!EVENT_SEVERITY.token[tok] || !EVENT_SEVERITY.token[tok].means) {
        throw new Error('eventEngine: event severity "' + tok + '" is declared with no meaning, ' +
          'so a reader cannot tell what the value on an event says');
      }
    });
    Object.keys(EVENT_SEVERITY.token).forEach(tok => {
      if (t.indexOf(tok) < 0) {
        throw new Error('eventEngine: a meaning is declared for event severity "' + tok +
          '", which is not one of the declared tokens ' + t.join('/'));
      }
    });
    if (t.indexOf(EVENT_SEVERITY.DEFAULT) < 0) {
      throw new Error('eventEngine: the default event severity "' + EVENT_SEVERITY.DEFAULT +
        '" is not one of the declared tokens ' + t.join('/'));
    }
    if (t.indexOf(EVENT_SEVERITY.disruption) < 0) {
      throw new Error('eventEngine: the disruption event severity "' + EVENT_SEVERITY.disruption +
        '" is not one of the declared tokens ' + t.join('/'));
    }
    return true;
  }
  assertEventSeverityDeclared();

  /* Both directions, and the harm tokens come from the module that owns them
     rather than being restated here. Runs lazily on the first emit with the
     taxonomy present: the taxonomy arrives async, so a load-time call here
     would check an empty list and report clean. */
  function assertSeveritySpacesDistinct(harmTokens) {
    const harm = (harmTokens || []).map(t => String(t));
    EVENT_SEVERITY.tokens.forEach(tok => {
      if (harm.indexOf(tok) >= 0) {
        throw new Error('eventEngine: "' + tok + '" is both an event severity and a taxonomy harm class; ' +
          'one field name over two spaces is already a collision, and a shared token would make an ' +
          'event\u2019s disruption record readable as an assessment of harm');
      }
    });
    harm.forEach(tok => {
      if (EVENT_SEVERITY.tokens.indexOf(tok) >= 0) {
        throw new Error('eventEngine: taxonomy harm class "' + tok + '" is also an event severity token');
      }
    });
    return true;
  }

  let spacesChecked = false;
  function checkSpacesOnce() {
    if (spacesChecked) return;
    if (typeof FW === 'undefined' || !FW.severityScale) return;
    const scale = FW.severityScale();
    if (!scale) return;
    assertSeveritySpacesDistinct(scale.tokens);
    spacesChecked = true;
  }

  function isEventSeverity(v) { return EVENT_SEVERITY.tokens.indexOf(v) >= 0; }
  function isDisruptionSeverity(v) { return v === EVENT_SEVERITY.disruption; }

  /* What a reader may do with the value it found, including the case the value
     is not one this program declares -- the case that used to have no name and
     therefore rendered as the routine one. */
  const SEVERITY_BASIS = {
    DISRUPTION: 'the declared disruption token: something departed from the normal course.',
    ROUTINE: 'a declared token that is not the disruption token: normal-course traffic.',
    UNDECLARED: 'not a token this program declares. It says nothing about disruption either way, and must not be shown as routine traffic -- an event stamped by emit() cannot carry this, so a value here came from somewhere else.'
  };

  function severityBasis(v) {
    if (isDisruptionSeverity(v)) return { basis: 'DISRUPTION', why: SEVERITY_BASIS.DISRUPTION };
    if (isEventSeverity(v)) return { basis: 'ROUTINE', why: SEVERITY_BASIS.ROUTINE };
    return { basis: 'UNDECLARED', why: SEVERITY_BASIS.UNDECLARED };
  }

  function createEngine(seed) {
    return { rng: FWRng.createRng(seed), log: [], nextEventId: 1 };
  }

  function emit(engine, { type, entityId, relatedEntities = [], severity = EVENT_SEVERITY.DEFAULT, metadata = {} }, timestamp) {
    /* Refused at the point of production, not at the point of rendering. A
       value outside the space cannot be repaired downstream: every later
       reader has to guess whether it meant disruption or not, and the one
       reader that guessed chose "not" silently. */
    if (!isEventSeverity(severity)) {
      throw new Error('FWEventEngine.emit: severity "' + severity + '" is not one of the declared event ' +
        'severities ' + EVENT_SEVERITY.tokens.join('/') + ' (type ' + type + '). The taxonomy harm classes ' +
        'are a different space with the same field name and are not values of this one.');
    }
    checkSpacesOnce();
    const ev = {
      id: 'EV-' + String(engine.nextEventId++).padStart(6, '0'),
      timestamp, type, entityId, relatedEntities, severity,
      source: 'simulation', metadata
    };
    engine.log.push(ev);
    if (engine.log.length > LOG_CAP) engine.log.shift();
    return ev;
  }

  // Advances the event stream by dtSeconds of simulated time. Call
  // volume is independent of frame rate: a large dt (fast-forward /
  // background catch-up) proportionally rolls for more events instead
  // of needing to be called once per rendered frame.
  // ctx (optional): { shift } — normal traffic volume follows the shift's
  // throughput multiplier (Phase 37), so 03:00 is genuinely quieter than
  // 14:00 instead of the port running flat around the clock.
  function step(engine, registry, timestamp, dtSeconds, ctx = {}) {
    const emitted = [];
    const throughput = (ctx.shift && window.FWShiftEngine)
      ? FWShiftEngine.throughputMultiplier(ctx.shift) : 1;
    const rollBudget = Math.max(1, Math.round(dtSeconds / 30)); // ~1 roll per 30 sim-seconds
    const chance = Math.min(0.9, dtSeconds > 0 ? 0.35 * throughput : 0);

    for (let i = 0; i < rollBudget; i++) {
      if (!engine.rng.chance(chance)) continue;
      const trucks = FWEntityEngine.all(registry, 'truck');
      if (!trucks.length) continue;
      const truck = engine.rng.pick(trucks);
      const type = engine.rng.pick(NORMAL_EVENT_TYPES);
      const metadata = { summary: type.replace(/_/g, ' ').toLowerCase() };
      if (ctx.shift) metadata.shift = ctx.shift;
      const ev = emit(engine, {
        type, entityId: truck.id,
        relatedEntities: [truck.driverId, truck.trailerId].filter(Boolean),
        severity: 'info', metadata
      }, timestamp);
      FWEntityEngine.recordHistory(truck, ev);
      emitted.push(ev);
    }
    return emitted;
  }

  return { createEngine, emit, step, NORMAL_EVENT_TYPES, LOG_CAP,
    EVENT_SEVERITY, SEVERITY_SPACES, SEVERITY_BASIS, severityBasis,
    isEventSeverity, isDisruptionSeverity,
    assertEventSeverityDeclared, assertSeveritySpacesDistinct };
})();
