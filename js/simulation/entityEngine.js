/* simulation/entityEngine.js — a lightweight registry/population for
   simulation entities. No Phaser/DOM. This is the source-of-truth
   store the event/behavior/signal engines (next slices) will read and
   mutate; the Phaser render layer stays a separate downstream consumer. */
const FWEntityEngine = (() => {
  const KINDS = ['truck', 'driver', 'trailer', 'shipment', 'carrier', 'facility'];

  // Registry keys and UI labels are just kind + 's' for every kind that
  // pluralizes that way; 'facility' does not, and printing "9 facilitys"
  // in an analyst panel is the kind of small sloppiness that makes the
  // careful parts look less trustworthy than they are.
  const PLURALS = { facility: 'facilities' };

  function plural(kind) {
    return PLURALS[kind] || kind + 's';
  }

  /* ---- Lifecycle status vocabulary ------------------------------------

     Every entity carries a `status`, and each entity file declares the
     permitted values in a trailing comment. Nothing ever checked those
     comments against the simulation, and they do not agree with it: of the
     21 values declared across driver/trailer/shipment/carrier/facility,
     13 are never written by any line in this codebase (30 declared and the
     same 13 unreachable once truck's fully exercised 9 are counted in --
     vocabularyCoverage() measures both rather than restating this comment).
     `facility` is the extreme case -- three declared states, one issued --
     and it was read by a filter (`f.status !== 'CLOSED'` in facilityEngine)
     that therefore excluded nothing while reading as an eligibility rule.
     That is Slice 48's fault shape with a literal that IS in the
     vocabulary: real word, unreachable value, silently true of every row.

     Three different facts, deliberately kept apart:
       declared -- values the vocabulary permits
       writable -- values some line of this codebase actually assigns
       held     -- values entities in a given registry carry right now
     declared is a superset of writable, which is a superset of held. A
     status is only an observation about the world inside `writable`.
     Outside it the value on screen is a default nothing can change, and it
     must not be read as "we looked, and the site is open". `held` narrower
     than `writable` is a different and legitimate thing -- a state no
     entity happens to be in at this moment (truck stages cycle) -- so the
     two gaps are reported separately and never merged. */
  const LIFECYCLE_VOCABULARY = {
    facility: {
      declaredIn: 'entities/facility.js',
      declared: ['OPERATING', 'REDUCED', 'CLOSED'],
      spawnValue: 'OPERATING',
      writable: ['OPERATING'],
      means: 'the site is part of the population this run was seeded with',
      doesNotMean: 'that the site was checked and found open. No code path here ever sets REDUCED or CLOSED (they are declared and never issued), so every site is created OPERATING and keeps it; site coverage figures are computed over a population that is fully operating by construction, not on the day.'
    },
    carrier: {
      declaredIn: 'entities/carrier.js',
      declared: ['ACTIVE', 'SUSPENDED', 'UNDER_REVIEW'],
      spawnValue: 'ACTIVE',
      writable: ['ACTIVE'],
      means: 'the carrier is part of the seeded population',
      doesNotMean: 'that the carrier is in good standing. Nothing in this simulation ever sets SUSPENDED or UNDER_REVIEW, however many cases close against a carrier, so ACTIVE is the value it was created with and the absence of a mark against it is not a clean record.'
    },
    driver: {
      declaredIn: 'entities/driver.js',
      declared: ['OFF_SHIFT', 'CHECKED_IN', 'DRIVING', 'CHECKED_OUT'],
      spawnValue: 'OFF_SHIFT',
      writable: ['OFF_SHIFT', 'CHECKED_IN', 'DRIVING'],
      means: 'whether this driver is currently attached to a movement',
      doesNotMean: 'a completed shift. CHECKED_OUT is declared and never issued: a driver taken off a truck is set back to OFF_SHIFT, so a driver who finished a run and a driver who never started one hold the same value.'
    },
    trailer: {
      declaredIn: 'entities/trailer.js',
      declared: ['IN_STORAGE', 'ASSIGNED', 'IN_TRANSIT', 'SWAPPED'],
      spawnValue: 'IN_STORAGE',
      writable: ['IN_STORAGE', 'ASSIGNED'],
      means: 'whether this trailer is currently attached to a truck',
      doesNotMean: 'that a trailer taken off a movement can be told apart afterwards. SWAPPED and IN_TRANSIT are declared and never issued -- a trailer swapped out mid-run is set back to IN_STORAGE -- so a trailer that was swapped away from a movement and one that has been sitting idle hold the same value. The swap is recorded on the movement, as a signal and a history entry on the truck; the trailer itself carries no record of it.'
    },
    shipment: {
      declaredIn: 'entities/shipment.js',
      declared: ['BOOKED', 'ASSIGNED', 'LOADED', 'IN_TRANSIT', 'DELIVERED', 'DELAYED', 'CANCELLED'],
      spawnValue: 'ASSIGNED',
      writable: ['ASSIGNED'],
      factoryDefault: 'BOOKED',
      means: 'the consignment exists and is attached to a truck',
      doesNotMean: 'a position in a delivery lifecycle. Five of the seven declared states are never issued and the factory default BOOKED is overridden at the only call site, so no consignment here is ever delivered, delayed or cancelled: a cargo exposure band is never settled and never retired, and ASSIGNED on a band is not a live-versus-closed distinction.'
    },
    truck: {
      declaredIn: 'entities/truck.js (FWEntityTruck.STATUSES) and mirrored in behaviorEngine.LIFECYCLE',
      declaredVia: 'FWEntityTruck.STATUSES',
      spawnValue: 'DISPATCHED',
      writableIsWholeVocabulary: true,
      means: 'which lifecycle stage the movement has reached',
      doesNotMean: 'anything about risk. This is the one status field whose whole declared vocabulary is reachable -- behaviorEngine walks the list in order -- so a stage not present in a registry is a stage nothing is in right now, not a stage that cannot happen.'
    }
  };

  function declaredStatuses(kind) {
    const v = LIFECYCLE_VOCABULARY[kind];
    if (!v) throw new Error('entityEngine: no status vocabulary declared for kind ' + kind);
    if (v.declared) return v.declared.slice();
    if (v.declaredVia === 'FWEntityTruck.STATUSES') {
      // Top-level `const` bindings are not properties of window, so this
      // is a bare-identifier check on purpose: it has to work during load
      // order as well as after it.
      if (typeof FWEntityTruck === 'undefined' || !Array.isArray(FWEntityTruck.STATUSES)) {
        throw new Error('entityEngine: truck status vocabulary is owned by FWEntityTruck.STATUSES and it is not loaded');
      }
      return FWEntityTruck.STATUSES.slice();
    }
    throw new Error('entityEngine: status vocabulary for ' + kind + ' declares neither a list nor a source');
  }

  function writableStatuses(kind) {
    const v = LIFECYCLE_VOCABULARY[kind];
    if (!v) throw new Error('entityEngine: no status vocabulary declared for kind ' + kind);
    return v.writableIsWholeVocabulary ? declaredStatuses(kind) : v.writable.slice();
  }

  // Declared but unreachable: the part of the vocabulary no line of this
  // codebase can produce. A filter testing one of these is a no-op.
  function neverWritten(kind) {
    const w = writableStatuses(kind);
    return declaredStatuses(kind).filter(s => w.indexOf(s) < 0);
  }

  function statusVocabulary(kind) {
    const v = LIFECYCLE_VOCABULARY[kind];
    if (!v) throw new Error('entityEngine: no status vocabulary declared for kind ' + kind);
    return Object.assign({}, v, {
      kind,
      declared: declaredStatuses(kind),
      writable: writableStatuses(kind),
      neverWritten: neverWritten(kind)
    });
  }

  // MEASURED, per registry: which values entities actually hold now.
  function heldStatuses(reg, kind) {
    const list = all(reg, kind);
    const byStatus = {};
    list.forEach(e => { byStatus[e.status] = (byStatus[e.status] || 0) + 1; });
    const held = Object.keys(byStatus);
    const declared = declaredStatuses(kind);
    const undeclared = held.filter(s => declared.indexOf(s) < 0);
    if (undeclared.length) {
      throw new Error('entityEngine: ' + kind + ' holds status ' + undeclared.join(', ') +
        ' which is not in its declared vocabulary (' + declared.join('|') + ')');
    }
    const writable = writableStatuses(kind);
    return {
      kind, n: list.length, byStatus, held,
      declared, writable,
      neverWritten: neverWritten(kind),
      writableNotHeld: writable.filter(s => held.indexOf(s) < 0)
    };
  }

  // Whole-population rollup. Two gaps, never added together: what the
  // codebase cannot produce, and what nothing happens to be in.
  function vocabularyCoverage(reg) {
    const rows = KINDS.map(k => heldStatuses(reg, k));
    const declaredTotal = rows.reduce((a, r) => a + r.declared.length, 0);
    const writableTotal = rows.reduce((a, r) => a + r.writable.length, 0);
    const neverWrittenTotal = rows.reduce((a, r) => a + r.neverWritten.length, 0);
    return {
      rows, declaredTotal, writableTotal, neverWrittenTotal,
      heldTotal: rows.reduce((a, r) => a + r.held.length, 0),
      note: writableTotal + ' of ' + declaredTotal + ' declared status values are reachable in this build; ' +
        neverWrittenTotal + ' of ' + declaredTotal + ' are declared and never issued by any code path, so a status reading one of the reachable values is not evidence the unreachable ones were ruled out.'
    };
  }

  // Display string. Carries its own n/N so a constant cannot be read as a
  // finding, and never a % because nothing here is divided.
  function formatStatus(kind, status) {
    const v = statusVocabulary(kind);
    if (typeof status !== 'string' || !status) {
      throw new Error('entityEngine.formatStatus: no status given for ' + kind);
    }
    if (v.declared.indexOf(status) < 0) {
      throw new Error('entityEngine.formatStatus: ' + status + ' is not a declared ' + kind + ' status');
    }
    const human = status.replace(/_/g, ' ').toLowerCase();
    if (v.writable.length === 1) {
      return human + ' — the only reachable of ' + v.declared.length + ' declared ' + kind + ' states';
    }
    if (v.neverWritten.length) {
      return human + ' — one of ' + v.writable.length + ' reachable of ' + v.declared.length + ' declared ' + kind + ' states';
    }
    return human + ' — one of ' + v.declared.length + ' declared ' + kind + ' stages, all reachable';
  }

  function statusNote(kind) {
    const v = statusVocabulary(kind);
    const gap = v.neverWritten.length
      ? 'Declared and never issued: ' + v.neverWritten.join(', ') + '. '
      : 'Every declared value is reachable. ';
    return gap + 'This field means ' + v.means + '. It does not mean ' + v.doesNotMean;
  }

  // Convention 21, executable: before trusting a status literal in a
  // filter, check it against the vocabulary that owns the field. Returns
  // whether the literal can ever match, so the caller can say so on screen
  // instead of presenting a no-op as a selection rule.
  function assertStatusLiteral(kind, literal, where) {
    const v = statusVocabulary(kind);
    if (v.declared.indexOf(literal) < 0) {
      throw new Error('entityEngine: ' + where + ' compares ' + kind + '.status against ' +
        JSON.stringify(literal) + ', which is not a declared ' + kind + ' status (' + v.declared.join('|') + ')');
    }
    return { kind, literal, declared: true, reachable: v.writable.indexOf(literal) >= 0 };
  }

  function assertLifecycleVocabulary() {
    KINDS.forEach(kind => {
      const v = LIFECYCLE_VOCABULARY[kind];
      if (!v) throw new Error('entityEngine: kind ' + kind + ' has no status vocabulary');
      const declared = declaredStatuses(kind);
      if (!declared.length) throw new Error('entityEngine: ' + kind + ' declares an empty status vocabulary');
      if (new Set(declared).size !== declared.length) {
        throw new Error('entityEngine: ' + kind + ' declares a duplicate status');
      }
      const writable = writableStatuses(kind);
      writable.forEach(s => {
        if (declared.indexOf(s) < 0) {
          throw new Error('entityEngine: ' + kind + ' lists ' + s + ' as writable but does not declare it');
        }
      });
      if (writable.indexOf(v.spawnValue) < 0) {
        throw new Error('entityEngine: ' + kind + ' spawn value ' + v.spawnValue + ' is not writable');
      }
      if (!v.means || !v.doesNotMean) {
        throw new Error('entityEngine: ' + kind + ' status vocabulary needs both means and doesNotMean');
      }
      if (/%/.test(v.means + v.doesNotMean)) {
        throw new Error('entityEngine: ' + kind + ' status note carries a % and nothing about a status is divided');
      }
      // A declaration that states a contingent fact has to be checked
      // against the fact: prose may only claim a value is never issued
      // when one actually is. The reverse direction is not left to prose at
      // all -- statusNote() enumerates the unreachable values from the
      // derived list, so a gap cannot go unmentioned by omission.
      const gap = neverWritten(kind);
      const claimsGap = /never issued|never sets|never written|never suspends/.test(v.doesNotMean);
      if (claimsGap && !gap.length) {
        throw new Error('entityEngine: ' + kind + ' note claims a value is never issued but every declared value is writable');
      }
      const note = statusNote(kind);
      gap.forEach(u => {
        if (note.indexOf(u) < 0) {
          throw new Error('entityEngine: ' + kind + ' note does not name unreachable status ' + u);
        }
      });
    });
    // truck's vocabulary exists twice -- FWEntityTruck.STATUSES and
    // behaviorEngine.LIFECYCLE -- and a state machine walking one list
    // while the display validates against the other would disagree
    // silently, so the two copies are held equal.
    // behaviorEngine is declared after this module, so at load time the
    // binding is still in its temporal dead zone and `typeof` throws
    // rather than returning 'undefined'. The mirror check therefore runs
    // whenever it can -- on any later call, and from the test suite -- and
    // is skipped, not faked, when it cannot.
    let lifecycle = null;
    try { lifecycle = FWBehaviorEngine.LIFECYCLE; } catch (e) { lifecycle = null; }
    if (Array.isArray(lifecycle)) {
      const a = declaredStatuses('truck').join('|');
      const b = lifecycle.join('|');
      if (a !== b) {
        throw new Error('entityEngine: FWEntityTruck.STATUSES and FWBehaviorEngine.LIFECYCLE disagree (' + a + ' vs ' + b + ')');
      }
    }
    return true;
  }

  function createRegistry() {
    const reg = { nextId: {} };
    KINDS.forEach(k => { reg[plural(k)] = new Map(); reg.nextId[k] = 1; });
    return reg;
  }

  function nextId(reg, kind) {
    const n = reg.nextId[kind]++;
    return kind.slice(0, 3).toUpperCase() + '-' + String(n).padStart(3, '0');
  }

  function add(reg, kind, entity) {
    reg[plural(kind)].set(entity.id, entity);
    return entity;
  }

  function get(reg, kind, id) {
    return reg[plural(kind)].get(id);
  }

  function all(reg, kind) {
    return Array.from(reg[plural(kind)].values());
  }

  // record a bounded history entry on an entity (used by the event engine)
  function recordHistory(entity, event) {
    if (!entity) return;
    entity.history.push({ t: event.timestamp, type: event.type, summary: (event.metadata && event.metadata.summary) || event.type });
    if (entity.history.length > 50) entity.history.shift();
  }

  // Seeds a starter population deterministically from an FWRng instance.
  // Counts are intentionally small for Slice 1 — this is the substrate,
  // not the full port population from the product spec.
  function seedPort(rng, opts = {}) {
    const reg = createRegistry();
    const nCarriers = opts.carriers || 6;
    const nDrivers = opts.drivers || 10;
    const nTrailers = opts.trailers || 10;
    const nTrucks = opts.trucks || 8;
    const nShipments = opts.shipments || 6;

    const carrierNames = ['NordTransit', 'BalticFreight Ltd', 'Meridian Cargo Co', 'Continental Haul',
      'Elbe Logistics', 'Vantage Road Freight', 'Solaris Intermodal', 'Harbourline Transport'];

    for (let i = 0; i < nCarriers; i++) {
      const id = nextId(reg, 'carrier');
      add(reg, 'carrier', FWEntityCarrier.createCarrier(id, {
        name: carrierNames[i % carrierNames.length],
        scac: 'SC' + rng.int(1000, 9999)
      }));
    }
    for (let i = 0; i < nDrivers; i++) {
      const id = nextId(reg, 'driver');
      add(reg, 'driver', FWEntityDriver.createDriver(id, { name: 'Driver ' + id }));
    }
    for (let i = 0; i < nTrailers; i++) {
      const id = nextId(reg, 'trailer');
      add(reg, 'trailer', FWEntityTrailer.createTrailer(id, { sealId: 'SEAL-' + rng.int(10000, 99999) }));
    }

    // Facilities exist before trucks do, because a truck's very first
    // lifecycle stage already has to be somewhere.
    const facilitySpec = opts.facilities || [
      { kind: 'GATEHOUSE', name: 'North Gate' },
      { kind: 'GATEHOUSE', name: 'South Gate' },
      { kind: 'CROSS_DOCK', name: 'Cross-dock A' },
      { kind: 'CROSS_DOCK', name: 'Cross-dock B' },
      { kind: 'YARD', name: 'Yard 1 (quayside)' },
      { kind: 'YARD', name: 'Yard 2 (empties)' },
      { kind: 'YARD', name: 'Yard 3 (overflow)' },
      { kind: 'REMOTE_DEPOT', name: 'Inland Depot Ost' },
      { kind: 'REMOTE_DEPOT', name: 'Inland Depot Sud' }
    ];
    facilitySpec.forEach(spec => {
      const id = nextId(reg, 'facility');
      add(reg, 'facility', FWEntityFacility.createFacility(id, { kind: spec.kind, name: spec.name }));
    });

    const carriers = all(reg, 'carrier');
    const drivers = all(reg, 'driver');
    const trailers = all(reg, 'trailer');

    for (let i = 0; i < nTrucks; i++) {
      const id = nextId(reg, 'truck');
      const carrier = rng.pick(carriers);
      const driver = drivers[i % drivers.length];
      const trailer = trailers[i % trailers.length];
      const truck = FWEntityTruck.createTruck(id, {
        carrierId: carrier.id, driverId: driver.id, trailerId: trailer.id
      });
      add(reg, 'truck', truck);
      driver.assignedTruckId = id;
      driver.status = 'CHECKED_IN';
      trailer.assignedTruckId = id;
      trailer.status = 'ASSIGNED';
    }

    const cargoTypes = ['Consumer Electronics', 'Machine Parts', 'Pharmaceuticals', 'Textiles',
      'Packaged Foodstuffs', 'Automotive Components'];
    const trucks = all(reg, 'truck');
    for (let i = 0; i < nShipments; i++) {
      const id = nextId(reg, 'shipment');
      const truck = trucks[i % trucks.length];
      const shipment = FWEntityShipment.createShipment(id, {
        carrierId: truck.carrierId,
        assignedTruckId: truck.id,
        trailerId: truck.trailerId,
        cargo: rng.pick(cargoTypes),
        sealId: 'SEAL-' + rng.int(10000, 99999),
        status: 'ASSIGNED'
      });
      add(reg, 'shipment', shipment);
      truck.assignedShipmentId = id;
    }

    return reg;
  }

  assertLifecycleVocabulary();

  return { createRegistry, nextId, add, get, all, recordHistory, seedPort, plural, KINDS, PLURALS,
    LIFECYCLE_VOCABULARY, declaredStatuses, writableStatuses, neverWritten, statusVocabulary,
    heldStatuses, vocabularyCoverage, formatStatus, statusNote, assertStatusLiteral,
    assertLifecycleVocabulary };
})();
