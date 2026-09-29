/* tests/intent-feedback.test.js -- regression checks for the synthetic
   adversary's correlation-feedback response. Run with plain Node:
   node tests/intent-feedback.test.js

   The test boots the production app files in the same sandbox as tick.js and
   calls the production intentEngine. A MO_VARIANT/KNOWN_MO class is a
   synthetic correlation result here; it is not a confirmed fraud verdict,
   calibrated probability, or evidence that a real actor knew an investigation
   was underway. */
const { bootSandbox } = require('../scripts/lib/app-sandbox.js');

let pass = 0;
const fail = [];
function ok(cond, msg) { if (cond) pass++; else fail.push(msg); }
function eq(actual, expected, msg) {
  ok(actual === expected, `${msg} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
}

const WORLD_SEED = 424242;

function fixture(variant, seed) {
  const M = bootSandbox().window;
  const actualSeed = seed === undefined ? WORLD_SEED : seed;
  M.FWSimRunner.boot(actualSeed);
  const state = M.FWSimRunner.getState();
  const IE = M.FWIntentEngine;
  const kind = IE.PLAN_KIND_NAMES.find(name => {
    const available = IE.availableVariants(IE.PLAN_KINDS[name]);
    return available.includes('ABBREVIATED') && available.includes(variant);
  });
  if (!kind) throw new Error('intent-feedback.test.js: no plan kind supports ' + variant + ' and ABBREVIATED');
  const book = IE.createBook(state.registry, actualSeed, M.FWBehaviorEngine.LIFECYCLE,
    [...M.FWBehaviorEngine.DISRUPTION_ELIGIBLE_STAGES], {
      actorCount: 1,
      compositeCount: 0,
      kind,
      variant,
      sampleSeconds: state.intentBook.sampleSeconds
    });
  return { M, IE, registry: state.registry, book, driverId: book.actorIds[0], plan: book.plans.get(book.actorIds[0]) };
}

// 1. A weak or unmatched synthetic class, and a class for another actor, do
//    not cause the named plan to change.
(function test1() {
  const f = fixture('BASE');
  const before = JSON.stringify({ variant: f.plan.variant, steps: f.plan.steps, adapted: f.plan.adapted });
  const result = f.IE.adapt(f.book, 1000, [
    { driverId: f.driverId, classification: 'POTENTIAL_NEW_MO', caseId: 'MO-0001' },
    { driverId: 'DRI-NOT-PLANNED', classification: 'KNOWN_MO', caseId: 'MO-0002' }
  ]);
  eq(result.length, 0, 'test1: no eligible classification for the planned actor produces no response');
  eq(JSON.stringify({ variant: f.plan.variant, steps: f.plan.steps, adapted: f.plan.adapted }), before,
    'test1: irrelevant cases leave the plan unchanged');
})();

// 2. A traceable recognition class makes one bounded change, keeps the past
//    fired history intact, and records which case caused it.
(function test2() {
  const f = fixture('BASE');
  f.plan.fired.push({ stepIndex: 0, lap: 0, type: f.plan.steps[0].type, at: 75, substituted: false });
  const firedBefore = JSON.stringify(f.plan.fired);
  const result = f.IE.adapt(f.book, 1200, [
    { driverId: f.driverId, classification: 'MO_VARIANT', caseId: 'MO-0007' }
  ]);
  eq(JSON.stringify(result), JSON.stringify([f.driverId]), 'test2: the matching actor is the one response');
  eq(f.plan.variant, 'ABBREVIATED', 'test2: a longer plan changes to its declared quieter variant');
  eq(f.plan.adaptedAt, 1200, 'test2: response time is recorded');
  eq(JSON.stringify(f.plan.adaptedTrigger), JSON.stringify({ caseId: 'MO-0007', classification: 'MO_VARIANT' }),
    'test2: response retains the triggering case and classification');
  eq(JSON.stringify(f.plan.fired), firedBefore, 'test2: earlier attempted behavior is immutable');
  const repeated = f.IE.adapt(f.book, 1500, [
    { driverId: f.driverId, classification: 'KNOWN_MO', caseId: 'MO-0008' }
  ]);
  eq(repeated.length, 0, 'test2: a second classification cannot silently change the plan again');
  eq(f.plan.adaptedTrigger.caseId, 'MO-0007', 'test2: the first response provenance is retained');
})();

// 3. When an actor is already on ABBREVIATED, the response is recorded but the
//    summary must not claim a behavior change that did not happen.
(function test3() {
  const f = fixture('ABBREVIATED');
  const stepsBefore = JSON.stringify(f.plan.steps);
  f.IE.adapt(f.book, 2000, [
    { driverId: f.driverId, classification: 'KNOWN_MO', caseId: 'MO-0011' }
  ]);
  eq(f.plan.adapted, true, 'test3: the recognition response is remembered');
  eq(f.plan.adaptedToQuieter, false, 'test3: no nonexistent shorter variant is claimed');
  eq(JSON.stringify(f.plan.steps), stepsBefore, 'test3: already-shortest plan steps do not change');
  const summary = f.IE.summary(f.book, f.registry);
  eq(JSON.stringify(summary.adaptedActorIds), JSON.stringify([f.driverId]),
    'test3: response count still includes the actor');
  eq(summary.steppedDownActorIds.length, 0, 'test3: no actor is counted as changed to a quieter variant');
  eq(JSON.stringify(summary.noQuieterVariantActorIds), JSON.stringify([f.driverId]),
    'test3: the no-change response is named separately');
  ok(summary.adaptedNote.includes('0 changed to ABBREVIATED'),
    'test3: summary states zero actual variant changes');
  ok(summary.adaptedNote.includes('not confirmed fraud findings'),
    'test3: summary does not promote correlation class to a fraud verdict');
})();

// 4. If several cases qualify, the recorded representative case is selected
//    canonically, independent of input order. Identical seeds reproduce steps.
(function test4() {
  const a = fixture('BASE');
  const b = fixture('BASE');
  const high = { driverId: a.driverId, classification: 'MO_VARIANT', caseId: 'MO-0009' };
  const low = { driverId: a.driverId, classification: 'KNOWN_MO', caseId: 'MO-0002' };
  a.IE.adapt(a.book, 3000, [high, low]);
  b.IE.adapt(b.book, 3000, [low, high]);
  eq(a.plan.adaptedTrigger.caseId, 'MO-0002', 'test4: representative case uses canonical case-id order');
  eq(a.plan.adaptedTrigger.classification, 'KNOWN_MO', 'test4: chosen case keeps its own classification');
  eq(JSON.stringify(a.plan.steps), JSON.stringify(b.plan.steps),
    'test4: input order does not change the seeded behavior variant');
  eq(JSON.stringify(a.plan.adaptedTrigger), JSON.stringify(b.plan.adaptedTrigger),
    'test4: input order does not change recorded trigger provenance');
})();

// 5. A triggering classification without a case identifier cannot mutate a
//    plan because the change would have no auditable source.
(function test5() {
  const f = fixture('BASE');
  let threw = false;
  try {
    f.IE.adapt(f.book, 4000, [{ driverId: f.driverId, classification: 'KNOWN_MO' }]);
  } catch (e) { threw = /caseId/.test(e.message); }
  ok(threw, 'test5: missing trigger provenance is rejected');
  eq(f.plan.adapted, false, 'test5: malformed trigger leaves the plan unchanged');
})();

const total = pass + fail.length;
if (fail.length) {
  console.log(`FAIL intent-feedback.test.js: ${pass}/${total} passed`);
  fail.forEach(f => console.log('   - ' + f));
  process.exitCode = 1;
} else {
  console.log(`PASS intent-feedback.test.js: ${pass}/${total} checks`);
}
