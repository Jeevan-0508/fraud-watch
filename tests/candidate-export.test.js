/* Candidate-MO exporter contract tests. Run with `node tests/candidate-export.test.js`.
   These tests exercise the production exporter in the same browser-like sandbox
   used by the autonomous simulation, then check the evidence and refusal rules. */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { bootSandbox, REPO_ROOT } = require('../scripts/lib/app-sandbox');

const EXPORTED_AT = '2026-09-29T14:00:00.000Z';
const SCHEMA_REVISION = 'd8fa1399d849c125a91f9ea5128f1fbad40186d2';
let checks = 0;

function check(condition, message) {
  assert.ok(condition, message);
  checks++;
}

function throws(fn, messagePart, label) {
  assert.throws(fn, new RegExp(messagePart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  checks++;
  if (label) console.log('PASS ' + label);
}

async function fixture() {
  const app = bootSandbox();
  await app.evalIn('FW.load()');
  const state = app.evalIn('FWSimRunner.boot(424242)');
  state.clock.day = 2;
  state.clock.simSeconds = 3600.5;

  state.moEngine.mos.set('MO-0012', {
    id: 'MO-0012', classification: 'POTENTIAL_NEW_MO',
    classificationReasonNote: 'Repeated seal discrepancy signals.',
    evidence: [{ signalType: 'SEAL_MISMATCH' }, { signalType: 'SEAL_REPLACED' }],
    confidence: 38, relatedPattern: 'FFT-007', openedAt: 72000,
    firstObserved: 71400
  });
  state.moEngine.mos.set('MO-0013', {
    id: 'MO-0013', classification: 'KNOWN_MO',
    classificationReasonNote: null,
    evidence: [{ signalType: 'SEAL_REPLACED' }, { signalType: 'SEAL_MISMATCH' }],
    confidence: 42, relatedPattern: 'FFT-007', openedAt: 82800,
    firstObserved: 82200
  });

  const record = {
    signature: 'SEAL_MISMATCH+SEAL_REPLACED', state: 'CANDIDATE',
    firstSeenAt: 72000, promotedAt: 81000, reviewStartedAt: null,
    resolvedAt: null, resolutionNote: null,
    provenance: [
      { moId: 'MO-0013', classification: 'EMERGING_BEHAVIOR', at: 88000 },
      { moId: 'MO-0012', classification: 'POTENTIAL_NEW_MO', at: 87000 }
    ]
  };
  state.candidateStore.records.set(record.signature, record);
  return { app, state, record };
}

async function main() {
  const { app, state, record } = await fixture();
  const exporter = app.evalIn('FWCandidateExport');
  check(exporter.SCHEMA_SOURCE_REVISION === SCHEMA_REVISION, 'exporter pins the exact candidate contract revision');

  const before = JSON.stringify(record);
  const payload = exporter.build(record, state, { exportedAt: EXPORTED_AT });
  const expectedHash = crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(REPO_ROOT, 'data', 'fraud-data.json'))).digest('hex');
  check(payload.schema_version === 'candidate-mo.v1', 'uses candidate-mo.v1');
  check(payload.data_class === 'synthetic_simulation' && payload.source.authenticity === 'unverified_export', 'labels data synthetic and export unverified');
  check(payload.exported_at === EXPORTED_AT, 'preserves timezone-qualified export time');
  check(payload.simulation.seed === 424242 && payload.simulation.sim_time_seconds_from_genesis === 90000.5, 'preserves seed and fractional simulation time');
  check(payload.source.revision === null && payload.taxonomy.source_commit === null, 'leaves unavailable source commits unknown');
  check(payload.taxonomy.version === '1.0.0' && payload.taxonomy.snapshot_sha256 === expectedHash, 'uses loaded taxonomy version and exact-byte digest');
  check(payload.candidate.id === 'fraud-watch:' + record.signature, 'namespaces candidate id from signature');
  check(payload.candidate.lifecycle_state === 'DISCOVERED' && payload.candidate.source_state === 'CANDIDATE', 'maps candidate state without promotion');
  check(payload.candidate.supporting_cases[0].case_id === 'MO-0012' && payload.candidate.supporting_cases[1].case_id === 'MO-0013', 'sorts provenance deterministically by case id');
  check(payload.candidate.supporting_cases[1].classification === 'EMERGING_BEHAVIOR' && payload.candidate.supporting_cases[1].current_classification === 'KNOWN_MO', 'keeps recorded and current classifications distinct');
  check(payload.candidate.supporting_cases[1].classification_reason === null, 'keeps unavailable reason null');
  check(payload.candidate.supporting_cases[0].correlation_index === 38 && payload.candidate.supporting_cases[0].correlation_index_semantics === 'synthetic_signal_index_not_probability', 'labels the simulator index as non-probabilistic');
  check(JSON.stringify(record) === before, 'export leaves candidate state unchanged');
  console.log('PASS valid synthetic candidate handoff and evidence provenance');

  for (const [stateName, reviewStartedAt, resolvedAt, expected] of [
    ['REVIEW', 85000, null, 'UNDER_REVIEW'],
    ['VALIDATED', 85000, 88000, 'VALIDATED'],
    ['REJECTED', 85000, 88000, 'REJECTED']
  ]) {
    const f = await fixture();
    f.record.state = stateName;
    f.record.reviewStartedAt = reviewStartedAt;
    f.record.resolvedAt = resolvedAt;
    if (resolvedAt !== null) f.record.resolutionNote = 'Analyst-reviewed simulator example.';
    const value = f.app.evalIn('FWCandidateExport').build(f.record, f.state, { exportedAt: EXPORTED_AT });
    check(value.candidate.lifecycle_state === expected, 'maps ' + stateName + ' lifecycle');
  }
  console.log('PASS review and terminal lifecycle mapping');

  const missing = await fixture();
  missing.state.moEngine.mos.delete('MO-0012');
  throws(() => missing.app.evalIn('FWCandidateExport').build(missing.record, missing.state, { exportedAt: EXPORTED_AT }), 'partial exports are refused', 'missing linked case is refused');

  const duplicate = await fixture();
  duplicate.record.provenance[1].moId = 'MO-0013';
  throws(() => duplicate.app.evalIn('FWCandidateExport').build(duplicate.record, duplicate.state, { exportedAt: EXPORTED_AT }), 'duplicate case ids', 'duplicate provenance is refused');

  const future = await fixture();
  future.record.promotedAt = 90001;
  throws(() => future.app.evalIn('FWCandidateExport').build(future.record, future.state, { exportedAt: EXPORTED_AT }), 'timestamps are inconsistent', 'future candidate timestamp is refused');

  const badTaxonomy = await fixture();
  badTaxonomy.state.moEngine.mos.get('MO-0012').relatedPattern = 'FFT-999';
  throws(() => badTaxonomy.app.evalIn('FWCandidateExport').build(badTaxonomy.record, badTaxonomy.state, { exportedAt: EXPORTED_AT }), 'outside the loaded taxonomy snapshot', 'unknown taxonomy reference is refused');

  const badConfidence = await fixture();
  badConfidence.state.moEngine.mos.get('MO-0012').confidence = 101;
  throws(() => badConfidence.app.evalIn('FWCandidateExport').build(badConfidence.record, badConfidence.state, { exportedAt: EXPORTED_AT }), 'valid simulator correlation index', 'invalid simulator index is refused');

  const badResolutionNote = await fixture();
  badResolutionNote.record.resolutionNote = { claim: 'invented' };
  throws(() => badResolutionNote.app.evalIn('FWCandidateExport').build(badResolutionNote.record, badResolutionNote.state, { exportedAt: EXPORTED_AT }), 'invalid type', 'malformed note is not coerced');

  const longReason = await fixture();
  longReason.state.moEngine.mos.get('MO-0012').classificationReasonNote = 'x'.repeat(501);
  throws(() => longReason.app.evalIn('FWCandidateExport').build(longReason.record, longReason.state, { exportedAt: EXPORTED_AT }), 'invalid classification reason', 'overlong reason is refused');

  console.log('All ' + checks + ' candidate-export assertions passed.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
