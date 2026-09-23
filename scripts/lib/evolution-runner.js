/* scripts/lib/evolution-runner.js -- RUNS A GENERATED CANDIDATE THROUGH ITS OWN
   DISPOSABLE WORLD (Slice 96).

   evolutionEngine.js can mutate a known plan and feasibility-check the
   result, but it is pure JS with no vm and no Node `require`, so it has no
   way to actually run a candidate through a world and see what a candidate
   is observed doing -- that is what its own doc comment names this file as
   the answer to. This module is that answer, and it is node-only for the
   same reason app-sandbox.js's bootSandbox() is: only Node's `vm` module can
   create the second, fully independent global a scratch simulation needs
   without disturbing the live one. It is never loaded by index.html and
   never appears in js/globals.js's MODULE_NAMES -- scripts/lib/summarize.js
   sets that precedent already.

   ONE CANDIDATE, ONE DISPOSABLE WORLD. simulateCandidate() boots a fresh,
   fully independent sandbox (a fresh vm.createContext, via bootSandbox()) and
   boots FWSimRunner inside it from candidate.seed -- the exact seed
   evolutionEngine.mutate() already stamped on the record as
   candidateSeed(worldSeed, generation, indexInGeneration), so the candidate's
   own content and the scratch world it is judged in are both reproducible
   from the same three numbers. Nothing here ever touches the live world:
   the sandbox this boots is garbage-collected the moment simulateCandidate
   returns, and no reference to it survives the call.

   PLANTING. intentEngine.plantCandidateActor (Slice 95) is the seam: the
   first planless driver in the scratch world's own book, sorted by id for a
   deterministic pick, is given the candidate's plan. Which driver is
   available is itself a function of the scratch world's own seed, so this
   stays fully deterministic without this module needing to choose a
   specific driver id.

   THE BUDGET. MAX_SIMULATION_SIM_SECONDS_PER_CANDIDATE (evolutionEngine.js,
   section 21 -- 30 scratch sim-days) is read off the booted sandbox's own
   FWEvolutionEngine rather than copied here, so the two files can never
   drift apart on what the budget is.

   WHAT GETS MEASURED, AND WHAT DOES NOT. observability and detection latency
   are read from signalEngine's log for the candidate's own truck --
   exactly what a real investigator could see, never intentBook. recurrence
   is read from intentEngine's own plan.laps (Slice 89 already keeps this
   count for the identical reason: "a systematic MO is systematic"), never a
   moEngine case count -- moEngine opens a case only after correlation
   conditions this scratch budget is not guaranteed to reach, and a candidate
   this module cannot correlate into a case within budget is not the same
   claim as a candidate that never did anything observable. feasibility is
   scored 1 for every candidate reaching this function, because
   evolutionEngine.checkFeasibility already gated entry to the GENERATED
   state this function requires -- the structural question is already
   answered by the time a candidate is simulated; what this function adds is
   the behavioral one.

   NOMINATION_SCORE_FLOOR below is ASSUMED, the same convention
   evolutionEngine.DIVERSITY_FLOOR and discovery-lab.js's
   MIN_RESOLVED_FOR_RATE already use for a chosen threshold, not a fitted
   one. */

const { bootSandbox } = require('./app-sandbox.js');

/* ASSUMED (section 8/23): a scratch-simulated candidate scoring at or above
   this unweighted mean is nominated for an analyst's attention; below it, it
   is discarded with its score kept on the record as the stated reason.
   Chosen to sit above a candidate that only ever managed one weak component
   (0.2 apiece would average 0.2), not fitted to any measured nomination
   rate -- there is no historical rate to fit to yet, since nothing has
   reached this floor before this slice existed. */
const NOMINATION_SCORE_FLOOR = 0.5;

/* Categorical -> numeric, so evolutionEngine.score()'s required [0,1]
   `observability` component has something to read. Declared once, here,
   because observabilityClass() itself deliberately returns a name, never a
   number (section 6) -- this mapping is this module's own business, not
   evolutionEngine's. ASSUMED: evenly spaced, not fitted. */
const OBSERVABILITY_SCORE = { INVISIBLE: 0, PARTIALLY_OBSERVABLE: 0.5, OBSERVABLE: 1 };

/* ASSUMED (section 8): laps is an unbounded count (Slice 89's CYCLED state
   already keeps it for exactly this reason), so it needs a cap to become a
   [0,1] score component. Three full laps within one scratch budget scoring
   the same as ten is the chosen ceiling, not a fitted one -- recurrence
   above three laps says nothing evolutionEngine.score does not already say
   at three. */
const RECURRENCE_LAP_CAP = 3;

/* Runs exactly one GENERATED, feasibility-checked candidate through its own
   disposable scratch world. Returns { candidateId, simulated: false, why }
   for the two ordinary search outcomes -- no planless driver left in this
   particular scratch world, or the candidate's own target/feasibility check
   failing inside that world's topology even though evolutionEngine's own
   pre-check (against the LIVE world's lifecycle/eligibleStages) passed --
   and { candidateId, simulated: true, ...metrics, score } otherwise. Throws
   only for a caller bug: a candidate not in the GENERATED state, a candidate
   with no numeric seed, or a candidate with no novelty classification
   (proposeGeneration always sets one before a candidate reaches GENERATED). */
function simulateCandidate(candidate) {
  if (!candidate || candidate.state !== 'GENERATED') {
    throw new Error('evolution-runner.simulateCandidate: candidate must be in the GENERATED state (mutated and ' +
      'feasibility-checked, not yet simulated); got ' + (candidate && candidate.state));
  }
  if (typeof candidate.seed !== 'number') {
    throw new Error('evolution-runner.simulateCandidate: candidate carries no numeric seed. Every record ' +
      'evolutionEngine.mutate() produces has one; this candidate did not come from mutate().');
  }
  if (!candidate.novelty || !candidate.novelty.classification) {
    throw new Error('evolution-runner.simulateCandidate: candidate carries no novelty classification. ' +
      'proposeGeneration() classifies every candidate that survives feasibility before it reaches GENERATED.');
  }

  const sb = bootSandbox();
  const M = sb.window;
  const ie = M.FWIntentEngine;
  const ee = M.FWEvolutionEngine;
  if (!ie || !ee || !M.FWSimRunner || !M.FWBehaviorEngine || !M.FWEntityEngine) {
    throw new Error('evolution-runner.simulateCandidate: the scratch sandbox booted without one of ' +
      'FWIntentEngine, FWEvolutionEngine, FWSimRunner, FWBehaviorEngine, FWEntityEngine -- check ' +
      'scripts/lib/app-sandbox.js\'s FILES list.');
  }

  M.FWSimRunner.boot(candidate.seed);
  const startState = M.FWSimRunner.getState();
  const startAt = M.FWSimRunner.absoluteNow(startState.clock);
  const book = startState.intentBook;

  const allDrivers = M.FWEntityEngine.all(startState.registry, 'driver').filter(d => d.assignedTruckId);
  const planless = allDrivers.filter(d => !book.plans.has(d.id)).sort((a, b) => (a.id < b.id ? -1 : 1));
  if (!planless.length) {
    return { candidateId: candidate.candidateId, simulated: false, why: 'NO_PLANLESS_DRIVER' };
  }
  const driver = planless[0];

  const plantResult = ie.plantCandidateActor(
    book, driver.id, candidate.candidateId, candidate,
    M.FWBehaviorEngine.LIFECYCLE, [...M.FWBehaviorEngine.DISRUPTION_ELIGIBLE_STAGES]
  );
  if (!plantResult.ok) {
    return {
      candidateId: candidate.candidateId, simulated: false, why: plantResult.why,
      detail: plantResult.detail || null
    };
  }

  /* Captured now, not after fastForward: an IDENTITY_SWAP disruption
     elsewhere in this same scratch run can reassign this driver off a
     truck entirely (behaviorEngine.js sets assignedTruckId to null on the
     old driver), so a post-run read can go stale. Every signal this plan's
     own steps ever produce is tied to whichever truck the driver was
     actually driving at plant time -- applyDisruption always stamps the
     truck, never the driver -- so this is the one id that stays correct
     for the whole run even if the driver is later reassigned away from it. */
  const truckId = driver.assignedTruckId;

  const budgetSeconds = ee.MAX_SIMULATION_SIM_SECONDS_PER_CANDIDATE;
  M.FWSimRunner.fastForward(budgetSeconds);

  const endState = M.FWSimRunner.getState();
  const plan = endState.intentBook.plans.get(driver.id);

  const distinctStepTypesPlanned = ee.stepTypeSet(candidate.steps).size;
  const signalTypesSeen = new Set();
  endState.signalEngine.log.forEach(sig => {
    if (sig.entityId === truckId) signalTypesSeen.add(sig.type);
  });

  const observability = ee.observabilityClass(signalTypesSeen.size, distinctStepTypesPlanned);
  const firstFire = plan.fired.length ? plan.fired[0].at : null;
  const detectionLatencySeconds = firstFire === null ? null : (firstFire - startAt);
  const detectionLatencyScore = firstFire === null
    ? 0
    : Math.max(0, 1 - (detectionLatencySeconds / budgetSeconds));
  const recurrence = Math.min(1, plan.laps / RECURRENCE_LAP_CAP);
  const noveltyScore = ee.NOVELTY_SCORE_BY_CLASS[candidate.novelty.classification];

  const scored = ee.score({
    feasibility: 1,
    observability: OBSERVABILITY_SCORE[observability],
    novelty: noveltyScore,
    recurrence: recurrence,
    detectionLatencyScore: detectionLatencyScore
  });

  return {
    candidateId: candidate.candidateId, simulated: true,
    driverId: driver.id, truckId: truckId, scratchSeed: candidate.seed, budgetSeconds: budgetSeconds,
    planState: plan.state, laps: plan.laps, stepsFired: plan.fired.length,
    distinctStepTypesPlanned: distinctStepTypesPlanned, distinctSignalTypesSeen: signalTypesSeen.size,
    observability: observability, detectionLatencySeconds: detectionLatencySeconds,
    score: scored
  };
}

/* Runs every GENERATED candidate currently in `store` (evolutionEngine's
   createStore()/proposeGeneration() shape) through simulateCandidate(), then
   moves each one on: INFEASIBLE if this particular scratch world could not
   host it (rare -- proposeGeneration already checked against the live
   world's own lifecycle/eligibleStages; a second, different scratch world
   failing where the live one passed is a topology coincidence, not a
   contradiction), otherwise NOMINATED or DISCARDED against
   NOMINATION_SCORE_FLOOR. `ee` is the caller's own FWEvolutionEngine
   reference (from whichever sandbox built `store`) rather than one this
   module boots itself, on the same explicit-dependency terms
   intentEngine.createBook already takes lifecycle/eligibleStages from its
   caller instead of assuming a global. */
function runGeneration(ee, store, opts) {
  const o = opts || {};
  const now = o.now != null ? o.now : null;
  const generated = ee.listByState(store, 'GENERATED');
  const results = generated.map(record => {
    const result = simulateCandidate(record);
    if (!result.simulated) {
      ee.moveState(store, record.candidateId, 'INFEASIBLE', now,
        'scratch runner: ' + result.why + (result.detail ? ' -- ' + result.detail : ''));
      return result;
    }
    record.simulationResult = result;
    const nominated = result.score.total >= NOMINATION_SCORE_FLOOR;
    ee.moveState(store, record.candidateId, nominated ? 'NOMINATED' : 'DISCARDED', now,
      'scratch-simulated: score ' + result.score.total.toFixed(3) + (nominated ? ' >= ' : ' < ') +
      NOMINATION_SCORE_FLOOR + ' floor');
    return result;
  });
  return { count: generated.length, results };
}

module.exports = { simulateCandidate, runGeneration, NOMINATION_SCORE_FLOOR, OBSERVABILITY_SCORE, RECURRENCE_LAP_CAP };
