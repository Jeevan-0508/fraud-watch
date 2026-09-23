/* tests/evolution.test.js -- the evolution engine's contract (Slice 94), run
   with plain Node (`node tests/evolution.test.js`), no framework, the same
   Checks-style convention tick.test.js already uses.

   Loads the real app files through scripts/lib/app-sandbox.js -- the exact
   sandbox scripts/tick.js boots -- so what is under test is FWEvolutionEngine
   as the browser and the autonomous tick will actually load it, not a
   re-implementation of it. */
const path = require('path');
const { bootSandbox } = require('../scripts/lib/app-sandbox.js');

let pass = 0;
const fail = [];
function ok(cond, msg) { if (cond) pass++; else fail.push(msg); }
function eq(a, b, msg) { ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

const M = bootSandbox().window;
const IE = M.FWIntentEngine;
const EE = M.FWEvolutionEngine;
const LIFECYCLE = M.FWBehaviorEngine.LIFECYCLE;
const STAGES = [...M.FWBehaviorEngine.DISRUPTION_ELIGIBLE_STAGES];
const SAMPLE = 300;
const WORLD_SEED = 424242;

// 1. Every module the boot needs actually published (guards against the
//    three-registration-lists convention silently going stale for this file).
(function test1() {
  ok(typeof EE === 'object', 'test1: FWEvolutionEngine published to window');
  ok(M.FWGlobals.published.indexOf('FWEvolutionEngine') > -1, 'test1: FWGlobals published FWEvolutionEngine by name');
})();

// 2. Determinism: same seed, generation and index -> the identical candidate,
//    twice, independently mutated.
(function test2() {
  const a = EE.mutate('SPOOFED_APPROACH', 'STEP_REORDER', 5, 2, WORLD_SEED);
  const b = EE.mutate('SPOOFED_APPROACH', 'STEP_REORDER', 5, 2, WORLD_SEED);
  eq(JSON.stringify(a.steps), JSON.stringify(b.steps), 'test2: same seed/generation/index reproduces the same candidate steps');
  eq(a.candidateId, b.candidateId, 'test2: same generation/index reproduces the same candidateId');
})();

// 3. Provenance is mandatory on every candidate, feasible or not.
(function test3() {
  IE.PLAN_KIND_NAMES.forEach(kind => {
    EE.MUTATION_OPERATOR_NAMES.forEach(op => {
      if (EE.MUTATION_OPERATORS[op].arity === 2) return;
      const c = EE.mutate(kind, op, 1, 0, WORLD_SEED);
      ok(Array.isArray(c.parentPlanIds) && c.parentPlanIds.length > 0,
        `test3: ${kind}/${op} candidate carries non-empty parentPlanIds`);
      ok(Array.isArray(c.mutations) && c.mutations.length > 0,
        `test3: ${kind}/${op} candidate carries non-empty mutations`);
    });
  });
})();

// 4. STEP_REORDER never silently returns the identity permutation as GENERATED.
(function test4() {
  IE.PLAN_KIND_NAMES.forEach(kind => {
    for (let i = 0; i < 5; i++) {
      const c = EE.mutate(kind, 'STEP_REORDER', 100 + i, 0, WORLD_SEED);
      if (c.state === 'GENERATED') {
        const sameOrder = JSON.stringify(c.steps) === JSON.stringify(IE.PLAN_KINDS[kind].steps);
        ok(!sameOrder, `test4: ${kind} STEP_REORDER draw ${i} is not a no-op identity permutation when GENERATED`);
      }
    }
  });
})();

// 5. STEP_DROP respects MIN_CORRELATABLE_TYPES: a 2-step kind's drop is refused.
(function test5() {
  const twoStepKind = IE.PLAN_KIND_NAMES.find(k => IE.PLAN_KINDS[k].steps.length === IE.MIN_CORRELATABLE_TYPES);
  ok(!!twoStepKind, 'test5: at least one declared kind sits exactly at MIN_CORRELATABLE_TYPES (fixture assumption)');
  if (twoStepKind) {
    const c = EE.mutate(twoStepKind, 'STEP_DROP', 1, 0, WORLD_SEED);
    eq(c.state, 'DISCARDED', `test5: STEP_DROP on ${twoStepKind} (exactly at the floor) is discarded, not generated`);
    eq(c.discardedReason, 'BELOW_CORRELATION_FLOOR', 'test5: discard reason names the floor, not a generic failure');
  }
})();

// 6. PLAN_BLEND refuses the same kind twice, directly on the operator.
(function test6() {
  const r = EE.MUTATION_OPERATORS.PLAN_BLEND.apply('SPOOFED_APPROACH', 'SPOOFED_APPROACH', IE.combineKinds);
  eq(r.ok, false, 'test6: PLAN_BLEND refuses to blend a kind with itself');
  eq(r.why, 'SAME_KIND_TWICE', 'test6: refusal names the reason');
})();

// 7. checkFeasibility never throws, even fed a deliberately impossible candidate.
(function test7() {
  const impossible = { candidateId: 'TEST-IMPOSSIBLE', state: 'GENERATED', discardedReason: null,
    steps: [{ type: 'GPS_SIGNAL_LOST', test: 'AT_NODE_TYPE', nodeType: 'NOT_A_REAL_NODE_TYPE' }], targetNodeTypes: null };
  let threw = false, result = null;
  try { result = EE.checkFeasibility(impossible, LIFECYCLE, STAGES, SAMPLE); } catch (e) { threw = true; }
  ok(!threw, 'test7: checkFeasibility does not throw on an impossible candidate');
  ok(result && result.feasible === false, 'test7: an impossible candidate is reported infeasible, not fed to assertPlanFeasible unguarded');
})();

// 8. classifyNovelty names the right class with a stated reason: KNOWN for an
//    unmutated kind, VARIANT for a subset, COMPOSITE for a real blend,
//    NOVEL_CANDIDATE for a set that reduces to none of the above.
(function test8() {
  const known = { candidateId: 'T', parentPlanIds: ['CURTAIN_STOP'], state: 'GENERATED',
    steps: IE.PLAN_KINDS.CURTAIN_STOP.steps.slice() };
  eq(EE.classifyNovelty(known, IE.PLAN_KINDS).classification, 'KNOWN', 'test8: unmutated steps classify KNOWN');

  const variant = EE.mutate('GHOST_ONBOARD', 'STEP_DROP', 1, 0, WORLD_SEED);
  if (variant.state !== 'DISCARDED') {
    eq(EE.classifyNovelty(variant, IE.PLAN_KINDS).classification, 'VARIANT', 'test8: a dropped-step subset classifies VARIANT');
  }

  const blend = EE.mutate(['SPOOFED_APPROACH', 'SEAL_AND_SWAP'], 'PLAN_BLEND', 1, 1, WORLD_SEED);
  eq(EE.classifyNovelty(blend, IE.PLAN_KINDS).classification, 'COMPOSITE', 'test8: a real two-kind union classifies COMPOSITE');

  const novel = { candidateId: 'T2', parentPlanIds: ['SPOOFED_APPROACH'], state: 'GENERATED',
    steps: [{ type: 'ACCOUNT_TAKEOVER', test: 'AT_NODE' }, { type: 'STAGED_BREAKDOWN', test: 'AT_NODE' }] };
  const novelResult = EE.classifyNovelty(novel, IE.PLAN_KINDS);
  eq(novelResult.classification, 'NOVEL_CANDIDATE', 'test8: a step-type set matching no declared kind classifies NOVEL_CANDIDATE');
  ok(novelResult.reason && novelResult.reason.length > 0, 'test8: NOVEL_CANDIDATE still carries a stated reason, never a bare label');
})();

// 9. diversityIndex: identical candidates score low, disjoint candidates score high.
(function test9() {
  const same = [
    { steps: IE.PLAN_KINDS.SPOOFED_APPROACH.steps },
    { steps: IE.PLAN_KINDS.SPOOFED_APPROACH.steps }
  ];
  eq(EE.diversityIndex(same).index, 0, 'test9: two identical step-type sets have a diversity index of exactly 0');

  const disjoint = [
    { steps: [{ type: 'ACCOUNT_TAKEOVER', test: 'AT_NODE' }] },
    { steps: [{ type: 'STAGED_BREAKDOWN', test: 'AT_NODE' }] }
  ];
  eq(EE.diversityIndex(disjoint).index, 1, 'test9: two disjoint step-type sets have a diversity index of exactly 1');
})();

// 10. score() validates its inputs rather than silently coercing them.
(function test10() {
  let threw = false;
  try { EE.score({ feasibility: 1, observability: 0.5, novelty: 1, recurrence: 0.2 }); } catch (e) { threw = true; }
  ok(threw, 'test10: score() throws when a required component (detectionLatencyScore) is missing');

  let threw2 = false;
  try { EE.score({ feasibility: 1.5, observability: 0.5, novelty: 1, recurrence: 0.2, detectionLatencyScore: 0.5 }); } catch (e) { threw2 = true; }
  ok(threw2, 'test10: score() throws when a component is out of [0,1]');

  const s = EE.score({ feasibility: 1, observability: 1, novelty: 1, recurrence: 1, detectionLatencyScore: 1 });
  eq(s.total, 1, 'test10: all-1.0 components score a total of exactly 1');
  ok(typeof s.formula === 'string' && s.formula.length > 0, 'test10: score() states its formula, never a bare number');
})();

// 11. proposeGeneration respects the declared budget and never exceeds it,
//     summary() reconciles (byState sums to total), and re-running against a
//     fresh store with the same world seed reproduces the same population.
(function test11() {
  const storeA = EE.createStore();
  const genA = EE.proposeGeneration(storeA, WORLD_SEED, LIFECYCLE, STAGES, SAMPLE, {});
  ok(genA.produced.length <= EE.MAX_CANDIDATES_PER_TICK, 'test11: one generation never exceeds MAX_CANDIDATES_PER_TICK');
  eq(storeA.generation, 1, 'test11: the store\'s generation counter advances to 1 after the first proposeGeneration');

  const sum = EE.summary(storeA);
  const summed = Object.keys(sum.byState).reduce((n, k) => n + sum.byState[k], 0);
  eq(summed, sum.total, 'test11: summary() byState sums to total, the same reconciliation candidateEngine.summary() applies');

  const storeB = EE.createStore();
  const genB = EE.proposeGeneration(storeB, WORLD_SEED, LIFECYCLE, STAGES, SAMPLE, {});
  eq(JSON.stringify(genA.produced), JSON.stringify(genB.produced),
    'test11: the same world seed reproduces the same generation-1 candidateIds on a fresh store');
})();

// 12. NOT_YET_BUILT_OPERATORS and MUTATION_OPERATOR_NAMES never overlap, and
//     mutate() names which bucket an unknown operator falls into.
(function test12() {
  EE.NOT_YET_BUILT_OPERATORS.forEach(name => {
    ok(EE.MUTATION_OPERATOR_NAMES.indexOf(name) < 0, `test12: declared-not-built operator ${name} is not also actually built`);
  });
  let msg = '';
  try { EE.mutate('SPOOFED_APPROACH', 'TEMPORAL_GAP', 1, 0, WORLD_SEED); } catch (e) { msg = e.message; }
  ok(msg.indexOf('future work') > -1, 'test12: mutate() on a declared-not-built operator says so, not a generic "unknown operator"');
})();

const total = pass + fail.length;
if (fail.length) {
  console.log(`FAIL evolution.test.js: ${pass}/${total} passed`);
  fail.forEach(f => console.log('   - ' + f));
  process.exitCode = 1;
} else {
  console.log(`PASS evolution.test.js: ${pass}/${total} checks`);
}

