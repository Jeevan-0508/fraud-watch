/* simulation/mo-export.js -- loss-aware export of one Fraud Watch MO record.
   These records are simulator observations, not real-world evidence. The
   exported schema keeps the engine's labels and index semantics explicit and
   never emits evidence ids, probabilities or analyst assertions. */
const FWMoExport = (() => {
  const SCHEMA_SOURCE_REVISION = 'd8fa1399d849c125a91f9ea5128f1fbad40186d2';
  const CLASSIFICATIONS = ['KNOWN_MO', 'MO_VARIANT', 'POTENTIAL_NEW_MO', 'EMERGING_BEHAVIOR'];
  const STATUSES = ['NEW', 'MONITORING', 'INVESTIGATING', 'ESCALATED', 'CONFIRMED', 'FALSE_POSITIVE', 'DISMISSED', 'RESOLVED'];

  function finiteNonnegative(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(label + ' is missing or is not a finite non-negative number');
    return value;
  }

  function textOrNull(value, label, max) {
    if (value == null) return null;
    if (typeof value !== 'string' || value.length > max) throw new Error(label + ' is invalid');
    return value;
  }

  function build(mo, state, options = {}) {
    if (!mo || typeof mo.id !== 'string' || !/^MO-[0-9]+$/.test(mo.id)) throw new Error('MO id is missing or malformed');
    if (!state || !state.moEngine || !state.moEngine.mos || state.moEngine.mos.get(mo.id) !== mo) throw new Error('MO is no longer present in the active simulation');
    if (!CLASSIFICATIONS.includes(mo.classification)) throw new Error('MO classification is unknown');
    if (!STATUSES.includes(mo.status)) throw new Error('MO status is unknown');
    if (!Number.isInteger(mo.confidence) || mo.confidence < 0 || mo.confidence > 100) throw new Error('MO correlation index is invalid');
    if (!Array.isArray(mo.evidence) || mo.evidence.length === 0 || mo.evidence.some((e) => !e || typeof e.signalType !== 'string' || e.signalType.length === 0)) throw new Error('MO has no complete signal-type record');
    if (!Number.isSafeInteger(state.seed)) throw new Error('simulation seed is missing or not an integer');
    if (typeof FW === 'undefined' || !FW.loaded() || !FW.meta() || typeof FW.meta().version !== 'string') throw new Error('taxonomy is not loaded');

    const exportedAt = options.exportedAt || new Date().toISOString();
    if (typeof exportedAt !== 'string' || !Number.isFinite(Date.parse(exportedAt)) || !/[zZ]|[+-][0-9]{2}:[0-9]{2}$/.test(exportedAt)) throw new Error('export time must be an ISO date-time with a timezone');
    const simTime = finiteNonnegative(FWSimRunner.absoluteNow(state.clock), 'simulation time at export');
    const firstObservedAt = finiteNonnegative(mo.firstObserved, 'MO first-observed time');
    const openedAt = finiteNonnegative(mo.openedAt, 'MO opened time');
    const lastObservedAt = finiteNonnegative(mo.lastObserved, 'MO last-observed time');
    if (firstObservedAt > openedAt || openedAt > lastObservedAt || lastObservedAt > simTime) throw new Error('MO observation timestamps are inconsistent');
    if (!Number.isInteger(mo.recurrenceCount) || mo.recurrenceCount < 1) throw new Error('MO recurrence count is invalid');

    const taxonomyIds = new Set((FW.patterns() || []).map((pattern) => pattern && pattern.id).filter((id) => typeof id === 'string'));
    const relatedPattern = mo.relatedPattern == null ? null : mo.relatedPattern;
    if (relatedPattern !== null && !taxonomyIds.has(relatedPattern)) throw new Error('MO references a pattern outside the loaded taxonomy snapshot');
    const signalTypes = Array.from(new Set(mo.evidence.map((e) => e.signalType))).sort();
    const entityIds = mo.entities && typeof mo.entities === 'object' ? {
      truck_id: textOrNull(mo.entities.truckId, 'truck id', 128),
      driver_id: textOrNull(mo.entities.driverId, 'driver id', 128),
      trailer_id: textOrNull(mo.entities.trailerId, 'trailer id', 128),
      carrier_id: textOrNull(mo.entities.carrierId, 'carrier id', 128),
      facility_id: textOrNull(mo.entities.facilityId, 'facility id', 128)
    } : { truck_id: null, driver_id: null, trailer_id: null, carrier_id: null, facility_id: null };

    return {
      schema_version: 'mo-observation.v1',
      kind: 'mo_observation',
      data_class: 'synthetic_simulation',
      exported_at: exportedAt,
      simulation: { seed: state.seed, sim_time_seconds_from_genesis: simTime },
      source: {
        repository: 'Jeevan-0508/fraud-watch',
        repository_url: 'https://github.com/Jeevan-0508/fraud-watch',
        revision: null,
        authenticity: 'unverified_export'
      },
      taxonomy: {
        repository: 'Jeevan-0508/freight-fraud-taxonomy',
        version: FW.meta().version,
        source_commit: null,
        snapshot_sha256: typeof FW.snapshotSha256 === 'function' ? FW.snapshotSha256() : null
      },
      observation: {
        id: mo.id,
        status: mo.status,
        classification: mo.classification,
        title: textOrNull(mo.title, 'MO title', 512),
        signature: textOrNull(mo.signature, 'MO signature', 2048),
        correlation_index: mo.confidence,
        correlation_index_semantics: 'synthetic_signal_index_not_probability',
        confidence_band: textOrNull(mo.confidenceBand, 'MO confidence band', 64),
        recurrence_count: mo.recurrenceCount,
        first_observed_at: firstObservedAt,
        opened_at: openedAt,
        last_observed_at: lastObservedAt,
        related_pattern_id: relatedPattern,
        signal_types: signalTypes,
        signal_count: mo.evidence.length,
        entity_ids: entityIds,
        classification_reason: textOrNull(mo.classificationReason, 'classification reason', 256),
        classification_reason_note: textOrNull(mo.classificationReasonNote, 'classification reason note', 2000)
      }
    };
  }

  return { SCHEMA_SOURCE_REVISION, build };
})();
