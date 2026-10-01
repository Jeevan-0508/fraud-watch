/* Potential-MO export contract tests. */
const assert = require('assert');
const { bootSandbox } = require('../scripts/lib/app-sandbox');

async function main() {
const app = bootSandbox();
await app.evalIn('FW.load()');
const state = app.evalIn('FWSimRunner.boot(424242)');
state.clock.day = 2;
state.clock.simSeconds = 3600.5;
const mo = {
  id: 'MO-0018', status: 'NEW', classification: 'POTENTIAL_NEW_MO', confidence: 45,
  confidenceBand: 'ELEVATED', recurrenceCount: 1,
  signature: 'ACCOUNT_TAKEOVER+SEAL_MISMATCH', title: 'Possible Carrier Identity Takeover',
  firstObserved: 72000, openedAt: 72600, lastObserved: 73000, relatedPattern: null,
  classificationReason: 'LOW_VOCABULARY_RESEMBLANCE', classificationReasonNote: 'Synthetic classifier label.',
  entities: { truckId: 'TRU-013', driverId: 'DRI-013', trailerId: 'TRA-013', carrierId: 'CAR-001', facilityId: null },
  evidence: [
    { signalId: 'SIG-1', signalType: 'ACCOUNT_TAKEOVER', contribution: 1.8, reliability: 0.6, at: 72000 },
    { signalId: 'SIG-2', signalType: 'SEAL_MISMATCH', contribution: 2.3, reliability: 0.75, at: 72600 }
  ]
};
state.moEngine.mos.set(mo.id, mo);
const payload = app.evalIn('FWMoExport').build(mo, state, { exportedAt: '2026-10-01T12:00:00.000Z' });
assert.equal(payload.schema_version, 'mo-observation.v1');
assert.equal(payload.data_class, 'synthetic_simulation');
assert.equal(payload.source.authenticity, 'unverified_export');
assert.equal(payload.observation.classification, 'POTENTIAL_NEW_MO');
assert.equal(payload.observation.correlation_index, 45);
assert.equal(payload.observation.correlation_index_semantics, 'synthetic_signal_index_not_probability');
assert.deepEqual(payload.observation.signal_types, ['ACCOUNT_TAKEOVER', 'SEAL_MISMATCH']);
assert.equal(payload.observation.entity_ids.truck_id, 'TRU-013');
assert.equal(payload.observation.related_pattern_id, null);
assert.equal(Object.prototype.hasOwnProperty.call(payload.observation, 'evidence_ids'), false);
assert.equal(Object.prototype.hasOwnProperty.call(payload.observation, 'probability'), false);
assert.equal(Object.prototype.hasOwnProperty.call(payload.observation, 'confidence'), false);
assert.equal(payload.simulation.seed, 424242);
console.log('Potential-MO export contract passed.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
