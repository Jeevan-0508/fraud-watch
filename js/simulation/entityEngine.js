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

  return { createRegistry, nextId, add, get, all, recordHistory, seedPort, plural, KINDS, PLURALS };
})();
