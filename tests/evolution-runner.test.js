/* tests/evolution-runner.test.js -- the node-only scratch runner's contract
   (Slice 96), run with plain Node (`node tests/evolution-runner.test.js`), no
   framework, the same Checks-style convention tick.test.js and
   evolution.test.js already use.

   Boots real candidates through evolutionEngine.proposeGeneration() and runs
   them through the real scripts/lib/evolution-runner.js -- never a
   re-implementation of either -- so what is under test is exactly what a
   future tick.js wiring would call. */
const path = require('path');
const { bootSandbox } = require('../scripts/lib/app-sandbox.js');
const runner = require('../scripts/lib/evolution-runner.js');
const { simulateCandidate, runGeneration, NOMINATION_SCORE_FLOOR, OBSERVABILITY_SCORE, RECURRENCE_LAP_CAP } = runner;

let pass = 0;
const fail = [];
function ok(cond, msg) { if (cond) pass++; else fail.push(msg); }
function eq(a, b, msg) { ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

const WORLD_SEED = 424242;

function freshLiveShapedDeps() {
  const sb = bootSandbox();
  const M = sb.window;
  M.FWSimRunner.boot(WORLD_SEED);
  const state = M.FWSimRunner.getState();
  return {
    ee: M.FWEvolutionEngine,
    lifecycle: M.FWBehaviorEngine.LIFECYCLE,
    eligibleStages: [...M.FWBehaviorEngine.DISRUPTION_ELIGIBLE_STAGES],
    sampleSeconds: state.intentBook.sampleSeconds
  };
}

// 1. Module surface.
(function test1() {
  ok(typeof simulateCandidate === 'function', 'test1: simulateCandidate exported');
  ok(typeof runGeneration === 'function', 'test1: runGeneration exported');
  ok(typeof NOMINATION_SCORE_FLOOR === 'number', 'test1: NOMINATION_SCORE_FLOOR exported');
  ok(NOMINATION_SCORE_FLOOR >= 0 && NOMINATION_SCORE_FLOOR <= 1, 'test1: NOMINATION_SCORE_FLOOR is in [0,1]');
  ok(typeof OBSERVABILITY_SCORE === 'object', 'test1: OBSERVABILITY_SCORE exported');
  ['INVISIBLE', 'PARTIALLY_OBSERVABLE', 'OBSERVABLE'].forEach(k => {
    ok(typeof OBSERVABILITY_SCORE[k] === 'number', 'test1: OBSERVABILITY_SCORE names ' + k);
  });
  ok(typeof RECURRENCE_LAP_CAP === 'number' && RECURRENCE_LAP_CAP > 0, 'test1: RECURRENCE_LAP_CAP exported, positive');
})();

// 2. simulateCandidate refuses (throws) three caller bugs, never a search outcome.
(function test2() {
  let threw = false;
  try { simulateCandidate({ state: 'INFEASIBLE', seed: 1, novelty: { classification: 'KNOWN' } }); }
  catch (e) { threw = true; }
  ok(threw, 'test2: throws on a non-GENERATED candidate');

  threw = false;
  try { simulateCandidate({ state: 'GENERATED', novelty: { classification: 'KNOWN' } }); }
  catch (e) { threw = true; }
  ok(threw, 'test2: throws on a candidate with no numeric seed');

  threw = false;
  try { simulateCandidate({ state: 'GENERATED', seed: 1, steps: [], novelty: null }); }
  catch (e) { threw = true; }
  ok(threw, 'test2: throws on a candidate with no novelty classification');
})();

// 3. A real, feasible candidate simulates: fires steps, produces a real
//    driverId/truckId, and returns every score component named, not collapsed.
(function test3() {
  const { ee, lifecycle, eligibleStages, sampleSeconds } = freshLiveShapedDeps();
  const store = ee.createStore();
  ee.proposeGeneration(store, WORLD_SEED, lifecycle, eligibleStages, sampleSeconds, { now: 1000, candidateCount: 1, operator: 'PARTIAL_EXECUTION', parentKind: 'DOUBLE_TENDER' });
  const generated = ee.listByState(store, 'GENERATED');
  ok(generated.length === 1, 'test3: proposeGeneration produced one GENERATED candidate to simulate');
  const record = generated[0];

  const result = simulateCandidate(record);
  ok(result.simulated === true, 'test3: a feasible candidate against a real driver simulates');
  ok(typeof result.driverId === 'string' && result.driverId.indexOf('DRI-') === 0, 'test3: result names a real driver');
  ok(typeof result.truckId === 'string' && result.truckId.indexOf('TRU-') === 0, 'test3: result names a real truck');
  eq(result.scratchSeed, record.seed, 'test3: scratchSeed is the candidate\'s own stamped seed');
  ok(result.stepsFired >= 0, 'test3: stepsFired is a count');
  ['feasibility', 'observability', 'novelty', 'recurrence', 'detectionLatencyScore'].forEach(k => {
    ok(typeof result.score[k] === 'number' && result.score[k] >= 0 && result.score[k] <= 1,
      'test3: score keeps named component ' + k + ' in [0,1]');
  });
  ok(result.score.total >= 0 && result.score.total <= 1, 'test3: score.total is in [0,1]');
  eq(result.score.observability, OBSERVABILITY_SCORE[result.observability],
    'test3: score.observability matches OBSERVABILITY_SCORE[result.observability]');
})();

// 4. Determinism: the identical candidate record, simulated twice
//    independently (two separate scratch worlds, same seed), produces the
//    identical observable result.
(function test4() {
  const { ee, lifecycle, eligibleStages, sampleSeconds } = freshLiveShapedDeps();
  const store = ee.createStore();
  ee.proposeGeneration(store, WORLD_SEED, lifecycle, eligibleStages, sampleSeconds, { now: 1000, candidateCount: 1, operator: 'STEP_REORDER', parentKind: 'SPOOFED_APPROACH' });
  const record = ee.listByState(store, 'GENERATED')[0];

  const a = simulateCandidate(record);
  const b = simulateCandidate(record);
  eq(JSON.stringify(a), JSON.stringify(b), 'test4: simulating the same candidate twice reproduces the identical result');
})();

// 5. A candidate the scratch world's own topology cannot host at all (no
//    node of the required type exists) is refused, not thrown: NO_FEASIBLE_TARGET.
(function test5() {
  const impossible = {
    candidateId: 'EVO-TEST-IMPOSSIBLE', parentPlanIds: ['SPOOFED_APPROACH'],
    mutations: [{ operator: 'TARGET_TYPE_SHIFT' }], generation: 1, indexInGeneration: 0,
    seed: 123456, createdAt: null, state: 'GENERATED', discardedReason: null,
    steps: [{ type: 'FICTIONAL_TYPE', test: 'AT_NODE_TYPE', nodeType: 'NONEXISTENT_NODE_TYPE' }],
    targetNodeTypes: ['NONEXISTENT_NODE_TYPE'], resembles: null,
    novelty: { classification: 'VARIANT' }
  };
  const result = simulateCandidate(impossible);
  ok(result.simulated === false, 'test5: a candidate targeting a node type that does not exist is refused, not thrown');
  eq(result.why, 'NO_FEASIBLE_TARGET', 'test5: refusal reason is NO_FEASIBLE_TARGET');
})();

// 6. runGeneration moves every GENERATED candidate on to a terminal-for-this-
//    pass state, and NOMINATED/DISCARDED agrees with the score/floor it recorded.
(function test6() {
  const { ee, lifecycle, eligibleStages, sampleSeconds } = freshLiveShapedDeps();
  const store = ee.createStore();
  ee.proposeGeneration(store, WORLD_SEED, lifecycle, eligibleStages, sampleSeconds, { now: 1000 });
  const beforeCount = ee.listByState(store, 'GENERATED').length;
  ok(beforeCount > 0, 'test6: proposeGeneration left at least one GENERATED candidate to run');

  const runResult = runGeneration(ee, store, { now: 2000 });
  eq(runResult.count, beforeCount, 'test6: runGeneration ran exactly the GENERATED candidates that existed');
  eq(ee.listByState(store, 'GENERATED').length, 0, 'test6: no candidate is left GENERATED after runGeneration');

  runResult.results.forEach(r => {
    if (!r.simulated) return;
    const record = store.records.get(r.candidateId);
    if (r.score.total >= NOMINATION_SCORE_FLOOR) {
      eq(record.state, 'NOMINATED', 'test6: ' + r.candidateId + ' scored >= floor and was nominated');
    } else {
      eq(record.state, 'DISCARDED', 'test6: ' + r.candidateId + ' scored < floor and was discarded');
    }
    ok(record.history[record.history.length - 1].note.indexOf('scratch-simulated') === 0,
      'test6: ' + r.candidateId + ' history note states the scratch-simulated reason');
  });
})();

// 7. This module never touches the filesystem -- it is a pure in-memory
//    scratch runner, never a second writer of world-state.json.
(function test7() {
  const src = require('fs').readFileSync(path.join(__dirname, '..', 'scripts', 'lib', 'evolution-runner.js'), 'utf8');
  ok(src.indexOf("require('fs')") === -1 && src.indexOf('require("fs")') === -1,
    'test7: evolution-runner.js never requires fs -- it never persists anything itself');
})();

console.log(fail.length === 0 ? `PASS evolution-runner.test.js: ${pass}/${pass} checks` : `FAIL evolution-runner.test.js: ${pass}/${pass + fail.length} checks`);
if (fail.length) { fail.forEach(m => console.log('  - ' + m)); process.exitCode = 1; }
