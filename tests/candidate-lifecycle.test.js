'use strict';

const { bootSandbox } = require('../scripts/lib/app-sandbox.js');
const candidateEngine = bootSandbox().window.FWCandidateEngine;
let pass = 0;
const failures = [];
function ok(condition, message) { if (condition) pass++; else failures.push(message); }

const store = candidateEngine.createStore();
const one = { id: 'MO-001', signature: 'SIGNATURE-A', classification: 'POTENTIAL_NEW_MO', openedAt: 100 };
const two = { id: 'MO-002', signature: 'SIGNATURE-A', classification: 'EMERGING_BEHAVIOR', openedAt: 200 };
const engine = { mos: new Map([[one.id, one], [two.id, two]]) };
const synced = candidateEngine.sync(store, engine, 500);
const record = candidateEngine.get(store, 'SIGNATURE-A');
ok(synced.createdSignatures.length === 1, 'two eligible synthetic sightings surface one candidate');
ok(record.state === 'CANDIDATE', 'discovery leaves the record in its informational candidate state');
ok(record.discoveredAt === 500, 'new records record when they were surfaced');
ok(!Object.prototype.hasOwnProperty.call(record, 'promotedAt'), 'new records do not describe discovery as promotion');
ok(record.provenance.length === 2, 'candidate provenance contains both eligible case IDs');
ok(!candidateEngine.STATES.includes('PROMOTED'), 'simulated analyst review cannot promote the shared taxonomy');

candidateEngine.sync(store, engine, 600);
ok(record.provenance.length === 2, 'repeated sync does not duplicate append-only provenance');
ok(candidateEngine.startReview(store, record.signature, 700).ok, 'candidate enters review only through the analyst transition');
ok(candidateEngine.resolve(store, record.signature, 'VALIDATED', 800, 'Reviewed in simulation').ok,
  'analyst can record a review outcome');
ok(record.state === 'VALIDATED' && record.history.at(-1).to === 'VALIDATED',
  'validation is recorded as an analyst state transition');

console.log(failures.length === 0
  ? 'PASS candidate-lifecycle.test.js: ' + pass + '/' + pass + ' checks'
  : 'FAIL candidate-lifecycle.test.js: ' + pass + '/' + (pass + failures.length) + ' checks');
if (failures.length) {
  failures.forEach(message => console.log('  - ' + message));
  process.exitCode = 1;
}
