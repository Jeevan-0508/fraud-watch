/* simulation/candidate-export.js -- explicit, reviewable handoff of one
   synthetic candidate-MO record. This is a download only: it does not send
   data to another service, change candidate state, or promote taxonomy data.

   Contract: candidate-mo.v1 from freight-fraud-taxonomy, pinned at the
   schema source revision below. A missing runtime source revision stays null.
   Only fields held by the candidate store, MO record, simulation clock, or
   loaded taxonomy snapshot are exported. Missing linked cases fail closed. */
const FWCandidateExport = (() => {
  const SCHEMA_SOURCE_REVISION = 'd8fa1399d849c125a91f9ea5128f1fbad40186d2';
  const REPOSITORY = 'Jeevan-0508/fraud-watch';
  const TAXONOMY_REPOSITORY = 'Jeevan-0508/freight-fraud-taxonomy';
  const CLASSIFICATIONS = ['KNOWN_MO', 'MO_VARIANT', 'POTENTIAL_NEW_MO', 'EMERGING_BEHAVIOR'];
  const SOURCE_TO_LIFECYCLE = {
    CANDIDATE: 'DISCOVERED',
    REVIEW: 'UNDER_REVIEW',
    VALIDATED: 'VALIDATED',
    REJECTED: 'REJECTED'
  };

  function finiteNonnegative(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new Error(label + ' is missing or is not a finite non-negative number');
    }
    return value;
  }

  function linkedCase(provenance, state, taxonomyIds, exportedAt) {
    if (!provenance || typeof provenance.moId !== 'string' || !/^MO-[0-9]+$/.test(provenance.moId)) {
      throw new Error('candidate provenance contains an invalid case id');
    }
    if (!CLASSIFICATIONS.includes(provenance.classification)) {
      throw new Error('candidate provenance for ' + provenance.moId + ' has an unknown classification');
    }
    const mo = state.moEngine && state.moEngine.mos && state.moEngine.mos.get(provenance.moId);
    if (!mo) throw new Error('linked case ' + provenance.moId + ' is unavailable; partial exports are refused');
    if (!CLASSIFICATIONS.includes(mo.classification)) {
      throw new Error('linked case ' + provenance.moId + ' has no current classification');
    }
    if (mo.classificationReasonNote != null && (typeof mo.classificationReasonNote !== 'string' || mo.classificationReasonNote.length > 500)) {
      throw new Error('linked case ' + provenance.moId + ' has an invalid classification reason');
    }
    if (!Array.isArray(mo.evidence) || mo.evidence.length === 0 ||
        mo.evidence.some(e => !e || typeof e.signalType !== 'string' || e.signalType.length === 0)) {
      throw new Error('linked case ' + provenance.moId + ' has no complete signal-type record');
    }
    const signalTypes = Array.from(new Set(mo.evidence.map(e => e.signalType))).sort();
    const correlationIndex = mo.confidence;
    if (!Number.isInteger(correlationIndex) || correlationIndex < 0 || correlationIndex > 100) {
      throw new Error('linked case ' + provenance.moId + ' has no valid simulator correlation index');
    }
    const relatedPatternId = mo.relatedPattern == null ? null : mo.relatedPattern;
    if (relatedPatternId !== null && (!taxonomyIds.has(relatedPatternId))) {
      throw new Error('linked case ' + provenance.moId + ' references a pattern outside the loaded taxonomy snapshot');
    }

    const recordedAt = finiteNonnegative(provenance.at, 'provenance time for ' + provenance.moId);
    const openedAt = finiteNonnegative(mo.openedAt, 'opened time for ' + provenance.moId);
    const firstObservedAt = finiteNonnegative(mo.firstObserved, 'first-observed time for ' + provenance.moId);
    if (firstObservedAt > openedAt || openedAt > recordedAt || recordedAt > exportedAt) {
      throw new Error('linked case ' + provenance.moId + ' has inconsistent observation/provenance times');
    }

    return {
      case_id: provenance.moId,
      classification: provenance.classification,
      current_classification: mo.classification,
      classification_reason: mo.classificationReasonNote == null ? null : mo.classificationReasonNote,
      recorded_at: recordedAt,
      case_opened_at: openedAt,
      first_observed_at: firstObservedAt,
      signal_types: signalTypes,
      related_pattern_id: relatedPatternId,
      correlation_index: correlationIndex,
      correlation_index_semantics: 'synthetic_signal_index_not_probability'
    };
  }

  function build(record, state, options = {}) {
    if (!record || typeof record.signature !== 'string' || record.signature.length === 0) {
      throw new Error('candidate signature is missing');
    }
    if (!state || !state.candidateStore || !state.candidateStore.records ||
        state.candidateStore.records.get(record.signature) !== record) {
      throw new Error('candidate is no longer present in the active simulation; refresh before export');
    }
    if (!SOURCE_TO_LIFECYCLE[record.state]) throw new Error('candidate has an unknown lifecycle state');
    if (!Array.isArray(record.provenance) || record.provenance.length === 0) {
      throw new Error('candidate has no recorded supporting cases');
    }
    if (!Number.isSafeInteger(state.seed)) throw new Error('simulation seed is missing or not an integer');
    if (typeof FW === 'undefined' || !FW.loaded() || !FW.meta() || typeof FW.meta().version !== 'string' || FW.meta().version.length === 0) {
      throw new Error('the taxonomy version is not loaded; export is refused');
    }

    const exportedAt = options.exportedAt || new Date().toISOString();
    const exportedMs = Date.parse(exportedAt);
    if (typeof exportedAt !== 'string' || !Number.isFinite(exportedMs) || !/[zZ]|[+-][0-9]{2}:[0-9]{2}$/.test(exportedAt)) {
      throw new Error('export time must be an ISO date-time with a timezone');
    }
    const simTime = finiteNonnegative(FWSimRunner.absoluteNow(state.clock), 'simulation time at export');
    const firstSeenAt = finiteNonnegative(record.firstSeenAt, 'candidate first-seen time');
    const candidateSince = finiteNonnegative(record.promotedAt, 'candidate creation time');
    if (firstSeenAt > candidateSince || candidateSince > simTime) {
      throw new Error('candidate timestamps are inconsistent with the simulation clock');
    }
    const reviewStartedAt = record.reviewStartedAt == null ? null : finiteNonnegative(record.reviewStartedAt, 'candidate review time');
    const resolvedAt = record.resolvedAt == null ? null : finiteNonnegative(record.resolvedAt, 'candidate resolution time');
    if ((reviewStartedAt !== null && reviewStartedAt < candidateSince) ||
        (resolvedAt !== null && (reviewStartedAt === null || resolvedAt < reviewStartedAt)) ||
        (reviewStartedAt !== null && reviewStartedAt > simTime) || (resolvedAt !== null && resolvedAt > simTime)) {
      throw new Error('candidate lifecycle timestamps are inconsistent');
    }
    if ((record.state === 'CANDIDATE' && (reviewStartedAt !== null || resolvedAt !== null)) ||
        (record.state === 'REVIEW' && (reviewStartedAt === null || resolvedAt !== null)) ||
        ((record.state === 'VALIDATED' || record.state === 'REJECTED') && (reviewStartedAt === null || resolvedAt === null))) {
      throw new Error('candidate state and lifecycle timestamps disagree');
    }

    const taxonomy = FW.meta();
    const patterns = FW.patterns();
    if (!Array.isArray(patterns) || patterns.length === 0) throw new Error('loaded taxonomy has no patterns');
    const taxonomyIds = new Set(patterns.map(pattern => pattern && pattern.id).filter(id => typeof id === 'string'));
    const taxonomyHash = typeof FW.snapshotSha256 === 'function' ? FW.snapshotSha256() : null;
    if (taxonomyHash !== null && !/^[0-9a-f]{64}$/.test(taxonomyHash)) {
      throw new Error('loaded taxonomy snapshot hash is malformed');
    }

    const provenanceIds = record.provenance.map(p => p && p.moId);
    if (provenanceIds.some(id => typeof id !== 'string') || new Set(provenanceIds).size !== provenanceIds.length) {
      throw new Error('candidate provenance contains missing or duplicate case ids');
    }
    const supportingCases = record.provenance.slice()
      .sort((a, b) => String(a.moId).localeCompare(String(b.moId)))
      .map(p => linkedCase(p, state, taxonomyIds, simTime));

    const resolutionNote = record.resolutionNote == null ? null : record.resolutionNote;
    if (typeof resolutionNote !== 'string' && resolutionNote !== null) {
      throw new Error('candidate resolution note has an invalid type; it is not coerced');
    }
    if (typeof resolutionNote === 'string' && resolutionNote.length > 2000) {
      throw new Error('candidate resolution note exceeds the contract limit; it is not truncated');
    }

    return {
      schema_version: 'candidate-mo.v1',
      kind: 'candidate_mo',
      data_class: 'synthetic_simulation',
      exported_at: exportedAt,
      simulation: {
        seed: state.seed,
        sim_time_seconds_from_genesis: simTime
      },
      source: {
        repository: REPOSITORY,
        repository_url: 'https://github.com/Jeevan-0508/fraud-watch',
        revision: null,
        authenticity: 'unverified_export'
      },
      taxonomy: {
        repository: TAXONOMY_REPOSITORY,
        version: taxonomy.version,
        source_commit: null,
        snapshot_sha256: taxonomyHash
      },
      candidate: {
        id: 'fraud-watch:' + record.signature,
        signature: record.signature,
        lifecycle_state: SOURCE_TO_LIFECYCLE[record.state],
        source_state: record.state,
        time_basis: 'simulation_seconds_from_genesis',
        first_seen_at: firstSeenAt,
        candidate_since: candidateSince,
        review_started_at: reviewStartedAt,
        resolved_at: resolvedAt,
        resolution_note: resolutionNote,
        supporting_cases: supportingCases
        ,context: {
          kind: 'fraud-watch-candidate.v1',
          disclaimer: 'Synthetic simulation context only. This candidate groups simulator observations; it is not real-world evidence, a probability, a finding, or an accepted risk.',
          status: null,
          classification: null,
          title: null,
          signature: record.signature,
          correlationIndex: null,
          correlationIndexSemantics: 'synthetic_signal_index_not_probability',
          confidenceBand: null,
          recurrenceCount: null,
          firstObservedAt: firstSeenAt,
          openedAt: candidateSince,
          lastObservedAt: null,
          relatedPatternId: null,
          signalTypes: [...new Set(supportingCases.flatMap((item) => item.signal_types))].sort(),
          entityIds: {},
          timeline: supportingCases.map((item) => ({ at: item.recorded_at, signalType: item.signal_types.join(' + ') })),
          signals: [],
          sites: [],
          unsitedSignalCount: null,
          siteSpread: null,
          classificationReason: null,
          classificationReasonNote: null,
          relatedPatterns: [],
          resemblanceNotes: [],
          legitimateExplanations: [],
          countermeasures: []
        }
      }
    };
  }

  return { SCHEMA_SOURCE_REVISION, build };
})();
