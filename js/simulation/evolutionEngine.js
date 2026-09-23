/* simulation/evolutionEngine.js -- MUTATE WHAT IS ALREADY KNOWN, AND SEE IF IT SURVIVES (Slice 94).

   THE GAP THIS CLOSES. Every actor before this slice runs one of the eleven
   hand-authored PLAN_KINDS, or a composite of exactly two of them
   (intentEngine.combineKinds). The population of shapes an actor could ever
   be assigned is therefore fixed at load time -- wide, but closed. Nothing in
   this build had ever proposed a shape nobody wrote down. This module is the
   proposal step: it mutates a declared kind (or blends two) into a CANDIDATE
   plan, checks whether the world could actually host it, and says, with a
   stated reason, whether the result still looks like something already known
   or looks like something new.

   WHAT THIS MODULE IS NOT.

   1. It is not a second disruption system, for the same reason intentEngine
      itself is not one. Every mutation operator below rearranges, drops,
      truncates, retargets or unions steps that are already {type, test}
      pairs drawn from behaviorEngine.DISRUPTION_TYPES and
      intentEngine.POSITION_TESTS. No operator invents a disruption type, a
      position test or a place; MUTATION_OPERATORS below either calls
      intentEngine's own combineKinds/stepsForVariant machinery directly, or
      restricts itself to the same declared vocabulary those functions use.
   2. It is not a live actor. mutate() returns a plain candidate record --
      steps, targets, provenance -- and nothing here ever touches an
      intentBook, assigns a driver, or spends a disruption opportunity. A
      candidate this module produces is inert until something else (the
      node-only scratch runner in scripts/lib/evolution-runner.js, or a later
      slice's live-promotion path) chooses to test or run it.
   3. It is not a fitted model. classifyNovelty() below answers with a named
      structural reason -- which known kind(s) the candidate's step-type set
      reduces to, or fails to -- never a bare number. score() breaks its
      total into named, documented components and never collapses them
      before storing them. Every threshold here is declared ASSUMED, the
      same convention discovery-lab.js and calibration-view.js already use
      for a number that was chosen, not fitted.

   PROVENANCE IS MANDATORY. A candidate record with no parentPlanIds and no
   mutations list is an anonymous behavior, and section 4 of the brief this
   slice answers is explicit that this module may never produce one. Every
   function that builds a candidate stamps both fields; there is no code path
   that omits them.

   GROUND TRUTH, RESTATED FOR THIS FILE. This module reads intentEngine's
   PLAN_KINDS, PLAN_KIND_NAMES, MIN_CORRELATABLE_TYPES, candidateTargets,
   assertPlanFeasible and combineKinds -- all of them declared, load-time
   vocabulary, not runtime state. It never reads intentBook (an actor's live
   plan, which step it is on, what it has fired) and is not on
   intentEngine.GROUND_TRUTH's reader list because it has no need to be: a
   proposal is evaluated against the graph and the taxonomy, never against
   what any other actor happens to be doing right now. */
const FWEvolutionEngine = (() => {
  const IE = (() => { try { return FWIntentEngine; } catch (e) { return null; } })();
  const WG = (() => { try { return FWWorldGraph; } catch (e) { return null; } })();

  function requireIntentEngine(what) {
    if (!IE) {
      throw new Error('evolutionEngine: ' + what + ' needs FWIntentEngine loaded first -- a mutation over a ' +
        'taxonomy this module cannot read would have to invent the taxonomy, which is exactly what it exists to refuse.');
    }
    return IE;
  }

  /* THE SEEDED STREAM. Offset from intentEngine's own PLAN_SEED_OFFSET (977)
     and ADAPT_SEED_OFFSET (4133) by a third arbitrary constant, so choosing
     mutations spends none of the randomness either of those streams uses.
     Same world seed + same generation + same index in that generation ->
     same candidate, on every run and every machine -- the same guarantee
     intentEngine.createBook already makes for the eleven declared kinds. */
  const EVOLUTION_SEED_OFFSET = 8221;

  function candidateSeed(worldSeed, generation, indexInGeneration) {
    return (((worldSeed | 0) + EVOLUTION_SEED_OFFSET + (generation | 0) * 104729 + (indexInGeneration | 0) * 97) >>> 0);
  }

  function stepTypeSet(steps) { return new Set((steps || []).map(s => s.type)); }

  /* THE MUTATION VOCABULARY.

     Five operators, not the brief's full thirteen. The five here are every
     one that can be built from intentEngine's own declared machinery without
     inventing a sixth kind of fact (a temporal gap, a cross-plan handoff and
     an opportunity shift all need a notion of elapsed sim-time between steps
     that this module does not yet have a source of truth for). Naming that
     rather than quietly shipping a fake one is the same discipline
     intentEngine.PLAN_KINDS applies to FFT-011: eight declared, the rest
     documented as not yet buildable, not silently skipped. */
  const MUTATION_OPERATORS = {
    STEP_REORDER: {
      name: 'STEP_REORDER',
      means: 'every step the parent declares still fires; the order changes. The same permutation ' +
        'intentEngine.stepsForVariant draws for the REORDERED variant, generalized to any parent, not only ' +
        'a hand-authored PLAN_KINDS entry.',
      arity: 1,
      apply(parent, rng) {
        if (parent.steps.length < 2) return { ok: false, why: 'FEWER_THAN_TWO_STEPS_NOTHING_TO_REORDER' };
        const order = parent.steps.map((s, i) => i);
        for (let i = order.length - 1; i > 0; i--) {
          const j = rng.int(0, i);
          const tmp = order[i]; order[i] = order[j]; order[j] = tmp;
        }
        const steps = order.map(i => parent.steps[i]);
        if (steps.every((s, i) => s === parent.steps[i])) return { ok: false, why: 'PERMUTATION_WAS_IDENTITY' };
        return { ok: true, steps, targetNodeTypes: parent.targetNodeTypes ? parent.targetNodeTypes.slice() : null };
      }
    },
    STEP_DROP: {
      name: 'STEP_DROP',
      means: 'one step the parent declares never fires. The same construction ABBREVIATED already uses, ' +
        'generalized to any parent and gated the same way: only offered when the drop still clears ' +
        'MIN_CORRELATABLE_TYPES.',
      arity: 1,
      apply(parent, rng, minCorrelatable) {
        if (parent.steps.length - 1 < minCorrelatable) return { ok: false, why: 'BELOW_CORRELATION_FLOOR' };
        const dropIndex = rng.int(0, parent.steps.length - 1);
        const steps = parent.steps.filter((s, i) => i !== dropIndex);
        if (stepTypeSet(steps).size < minCorrelatable) return { ok: false, why: 'BELOW_CORRELATION_FLOOR' };
        return { ok: true, steps, targetNodeTypes: parent.targetNodeTypes ? parent.targetNodeTypes.slice() : null };
      }
    },
    PARTIAL_EXECUTION: {
      name: 'PARTIAL_EXECUTION',
      means: 'only a PREFIX of the parent\'s declared steps ever fires -- the act stops partway, distinct ' +
        'from STEP_DROP (which can remove any one step and still finish the rest of the sequence). Narrows ' +
        'to a random prefix length that still clears MIN_CORRELATABLE_TYPES.',
      arity: 1,
      apply(parent, rng, minCorrelatable) {
        if (parent.steps.length <= minCorrelatable) return { ok: false, why: 'TOO_SHORT_TO_TRUNCATE' };
        const maxKeep = parent.steps.length - 1;
        const keep = rng.int(minCorrelatable, maxKeep);
        const steps = parent.steps.slice(0, keep);
        if (stepTypeSet(steps).size < minCorrelatable) return { ok: false, why: 'BELOW_CORRELATION_FLOOR' };
        return { ok: true, steps, targetNodeTypes: parent.targetNodeTypes ? parent.targetNodeTypes.slice() : null };
      }
    },
    TARGET_TYPE_SHIFT: {
      name: 'TARGET_TYPE_SHIFT',
      means: 'the act stages itself at a different KIND of place than the parent declares. Every step\'s ' +
        'own type and test are untouched; only an AT_NODE_TYPE step\'s accepted node type, and the ' +
        'whole plan\'s targetNodeTypes restriction (which narrows candidateTargets for every step, not ' +
        'only an AT_NODE_TYPE one), change -- feasibility is checked against the graph afterward.',
      arity: 1,
      apply(parent, rng, nodeTypes) {
                const alternates = (nodeTypes || []).filter(t => !parent.targetNodeTypes || parent.targetNodeTypes.indexOf(t) < 0);
        if (!alternates.length) return { ok: false, why: 'NO_ALTERNATE_NODE_TYPE_DECLARED' };
        const shiftedType = rng.pick(alternates);
        const steps = parent.steps.map(s => s.test === 'AT_NODE_TYPE' ? Object.assign({}, s, { nodeType: shiftedType }) : s);
        // Narrowing targetNodeTypes has a real effect even with no AT_NODE_TYPE step: intentEngine.candidateTargets
        // filters every step's candidate node by targetNodeTypes, not only an AT_NODE_TYPE step's own test.
        return { ok: true, steps, targetNodeTypes: [shiftedType] };
      }
    },
    PLAN_BLEND: {
      name: 'PLAN_BLEND',
      means: 'two declared kinds merged into one staged act -- intentEngine.combineKinds itself, called ' +
        'here rather than reimplemented, so a blend proposed by this module and a hand-drawn composite ' +
        'actor are built by the exact same function.',
      arity: 2,
      apply(parentAName, parentBName, combineKindsFn) {
        if (parentAName === parentBName) return { ok: false, why: 'SAME_KIND_TWICE' };
        const composed = combineKindsFn(parentAName, parentBName);
        if (composed.targetNodeTypes && !composed.targetNodeTypes.length) return { ok: false, why: 'NO_OVERLAPPING_NODE_TYPE' };
        return { ok: true, steps: composed.steps, targetNodeTypes: composed.targetNodeTypes, resembles: composed.resembles };
      }
    }
  };
  const MUTATION_OPERATOR_NAMES = Object.keys(MUTATION_OPERATORS);

  /* DECLARED, NOT YET BUILT. Named per the brief's own section 3 vocabulary so
     a later slice extending this table is completing a documented gap, not
     inventing a new one. Each needs a notion of elapsed sim-time between two
     steps that this module does not source yet: journeyEngine reports a
     truck's instantaneous position, not a schedule a plan could hold a gap
     against. */
  const NOT_YET_BUILT_OPERATORS = ['STEP_DUPLICATE', 'STEP_INSERT', 'STEP_SUBSTITUTE', 'TARGET_SHIFT',
    'CROSS_PLAN_HANDOFF', 'TEMPORAL_GAP', 'STEP_DELAY', 'OPPORTUNITY_SHIFT'];

  function assertNoOverlapBetweenBuiltAndDeclared() {
    NOT_YET_BUILT_OPERATORS.forEach(name => {
      if (MUTATION_OPERATOR_NAMES.indexOf(name) > -1) {
        throw new Error('evolutionEngine: "' + name + '" is listed as not-yet-built and also actually built; ' +
          'one list is stale.');
      }
    });
  }
  assertNoOverlapBetweenBuiltAndDeclared();

  /* THE CANDIDATE GRAMMAR. Every field the brief's section 4 asks for, plus
     `steps`/`targetNodeTypes`/`resembles` so a candidate carries everything
     checkFeasibility and a future scratch-runner need without going back to
     the parent(s). `state` starts at GENERATED and only ever moves forward
     through the table SLICE_94_STATES declares below -- never backward, and
     never skipped, the same discipline candidateEngine.TRANSITIONS already
     applies to CANDIDATE/REVIEW/VALIDATED/REJECTED. */
  const CANDIDATE_STATES = ['GENERATED', 'INFEASIBLE', 'SIMULATED', 'NOMINATED', 'DISCARDED'];

  function mutate(parentSpec, operatorName, generation, indexInGeneration, worldSeed) {
    const ie = requireIntentEngine('mutate()');
    const op = MUTATION_OPERATORS[operatorName];
    if (!op) {
      throw new Error('evolutionEngine.mutate: "' + operatorName + '" is not one of the declared mutation ' +
        'operators (' + MUTATION_OPERATOR_NAMES.join(', ') + '). ' +
        (NOT_YET_BUILT_OPERATORS.indexOf(operatorName) > -1
          ? 'It is named in NOT_YET_BUILT_OPERATORS -- declared as future work, not built yet.'
          : 'It has never been declared at all.'));
    }
    const seed = candidateSeed(worldSeed, generation, indexInGeneration);
    const rng = FWRng.createRng(seed);
    const candidateId = 'EVO-G' + generation + '-' + indexInGeneration;
    let parentPlanIds, result;
    if (op.arity === 2) {
      parentPlanIds = parentSpec.slice(0, 2);
      const [a, b] = parentPlanIds;
      if (!ie.PLAN_KINDS[a] || !ie.PLAN_KINDS[b]) {
        throw new Error('evolutionEngine.mutate: PLAN_BLEND needs two declared PLAN_KINDS names, got ' +
          JSON.stringify(parentPlanIds));
      }
      result = op.apply(a, b, ie.combineKinds);
    } else {
      const parentName = Array.isArray(parentSpec) ? parentSpec[0] : parentSpec;
      const parent = ie.PLAN_KINDS[parentName];
      if (!parent) {
        throw new Error('evolutionEngine.mutate: "' + parentName + '" is not one of the declared plan kinds (' +
          ie.PLAN_KIND_NAMES.join(', ') + ').');
      }
      parentPlanIds = [parentName];
      if (operatorName === 'TARGET_TYPE_SHIFT') {
        if (!WG) throw new Error('evolutionEngine.mutate: TARGET_TYPE_SHIFT needs FWWorldGraph.NODE_TYPES loaded.');
        result = op.apply(parent, rng, WG.NODE_TYPES);
      } else if (operatorName === 'STEP_DROP' || operatorName === 'PARTIAL_EXECUTION') {
        result = op.apply(parent, rng, ie.MIN_CORRELATABLE_TYPES);
      } else {
        result = op.apply(parent, rng);
      }
    }
    const base = {
      candidateId, parentPlanIds, mutations: [{ operator: operatorName }],
      generation, indexInGeneration, seed, createdAt: null
    };
    if (!result.ok) {
      return Object.assign({}, base, {
        state: 'DISCARDED', discardedReason: result.why, steps: null, targetNodeTypes: null, resembles: null
      });
    }
    const resembles = result.resembles || (ie.PLAN_KINDS[parentPlanIds[0]] ? ie.PLAN_KINDS[parentPlanIds[0]].resembles : null);
    return Object.assign({}, base, {
      state: 'GENERATED', discardedReason: null,
      steps: result.steps, targetNodeTypes: result.targetNodeTypes || null, resembles: resembles
    });
  }

  /* NON-THROWING, DELIBERATELY. intentEngine.assertPlanFeasible throws,
     because a hand-authored PLAN_KINDS entry that fails it is a bug in this
     codebase. A generated mutation failing it is the EXPECTED, common case
     (section 5: "if it cannot actually happen in the world, DISCARD") --
     so this wraps the same check and turns the throw into a stated reason
     instead of a crash, exactly the same shape checkFeasibility's own callers
     already expect from mutate() above for an operator that could not apply.
     candidateTargets is called first, and only when it returns at least one
     node, so assertPlanFeasible is never asked to explain a plan that could
     never have had a target at all -- that failure mode gets its own
     clearer reason (NO_FEASIBLE_TARGET) instead of reusing whatever the
     first candidate node's own rejection happened to say. */
  function checkFeasibility(candidate, lifecycle, eligibleStages, sampleSeconds) {
    const ie = requireIntentEngine('checkFeasibility()');
    if (candidate.state === 'DISCARDED') return { feasible: false, reason: candidate.discardedReason, candidateTargetsCount: 0 };
    const kindLike = { steps: candidate.steps, targetNodeTypes: candidate.targetNodeTypes };
    const affordances = ie.nodeAffordances(lifecycle, eligibleStages, sampleSeconds);
    const targets = ie.candidateTargets(kindLike, affordances);
    if (!targets.length) {
      return { feasible: false, reason: 'NO_FEASIBLE_TARGET', candidateTargetsCount: 0 };
    }
    const targetNodeId = targets[0];
    const plan = {
      kind: candidate.candidateId, targetNodeId,
      steps: candidate.steps.map(s => s.test === 'AT_NODE_TYPE' ? s : Object.assign({}, s, { nodeId: targetNodeId }))
    };
    try {
      ie.assertPlanFeasible(plan, lifecycle, eligibleStages, sampleSeconds);
    } catch (e) {
      return { feasible: false, reason: 'FEASIBILITY_CHECK_FAILED', detail: String(e && e.message || e), candidateTargetsCount: targets.length };
    }
    return { feasible: true, reason: null, candidateTargetsCount: targets.length, exampleTargetNodeId: targetNodeId };
  }

  /* NOVELTY, WITH A STATED REASON (section 7). Reuses vocabulary this
     codebase already has rather than inventing a fifth bucket: COMPOSITE and
     VARIANT are not new ideas here, they are the exact words intentEngine
     already uses for an actor whose plan unions two kinds or abbreviates/
     reorders one. This function asks the same question at the PROPOSAL stage,
     structurally, off the step-type SET alone -- before any actor has ever
     run the candidate -- so a mutation that degenerates back into something
     already declared is named as that, not scored as if it were new. */
  const NOVELTY_CLASSES = ['KNOWN', 'VARIANT', 'COMPOSITE', 'NOVEL_CANDIDATE'];

  function classifyNovelty(candidate, knownKinds) {
    if (candidate.state === 'DISCARDED') {
      return { classification: null, reason: 'DISCARDED_BEFORE_CLASSIFICATION', comparedAgainst: [] };
    }
    const mySet = stepTypeSet(candidate.steps);
    const compared = [];
    let known = null, variantOf = null;
    Object.keys(knownKinds).forEach(name => {
      const theirSet = stepTypeSet(knownKinds[name].steps);
      const sameSet = mySet.size === theirSet.size && Array.from(mySet).every(t => theirSet.has(t));
      const isSubset = Array.from(mySet).every(t => theirSet.has(t));
      compared.push({ kind: name, sameSet, isProperSubset: isSubset && !sameSet });
      if (sameSet) known = name;
      else if (isSubset && mySet.size > 0) variantOf = variantOf || name;
    });
    if (known) {
      return { classification: 'KNOWN', reason: 'Candidate\'s step-type set is identical to declared kind ' + known + '.',
        comparedAgainst: compared, matchedKind: known };
    }
    if (candidate.parentPlanIds.length === 2) {
      const [a, b] = candidate.parentPlanIds;
      const unionSet = new Set([...stepTypeSet(knownKinds[a] ? knownKinds[a].steps : []),
        ...stepTypeSet(knownKinds[b] ? knownKinds[b].steps : [])]);
      const isUnion = mySet.size === unionSet.size && Array.from(mySet).every(t => unionSet.has(t));
      if (isUnion) {
        return { classification: 'COMPOSITE',
          reason: 'Candidate\'s step-type set is exactly the union of declared kinds ' + a + ' and ' + b + '.',
          comparedAgainst: compared, blendOf: [a, b] };
      }
    }
    if (variantOf) {
      return { classification: 'VARIANT',
        reason: 'Candidate shares steps with ' + variantOf + ' but is a proper subset of its step-type set ' +
          '(dropped or truncated, never added).', comparedAgainst: compared, variantOf: variantOf };
    }
    const nearest = compared.slice().sort((x, y) => {
      const overlap = (name) => Array.from(stepTypeSet(knownKinds[name].steps)).filter(t => mySet.has(t)).length;
      return overlap(y.kind) - overlap(x.kind);
    })[0];
    return { classification: 'NOVEL_CANDIDATE',
      reason: nearest
        ? 'Candidate\'s step-type set is neither identical to, a subset of, nor a clean union of any declared ' +
          'kind; the closest by shared types is ' + nearest.kind + '.'
        : 'Candidate has no step-type overlap with any declared kind at all.',
      comparedAgainst: compared, nearestKind: nearest ? nearest.kind : null };
  }

  /* DIVERSITY (section 12). Jaccard similarity of two step-type sets, and a
     population-level index that is 1 minus the mean pairwise similarity --
     0 means every candidate in the population is the same set, 1 means no
     two candidates share a single step type. DIVERSITY_FLOOR is ASSUMED, not
     fitted: below it, a population is flagged LOW_DIVERSITY rather than the
     panel silently keeping quiet about a collapsed search. */
  const DIVERSITY_FLOOR = 0.3;

  function jaccardSimilarity(stepsA, stepsB) {
    const a = stepTypeSet(stepsA), b = stepTypeSet(stepsB);
    if (!a.size && !b.size) return 1;
    const intersection = Array.from(a).filter(t => b.has(t)).length;
    const union = new Set([...a, ...b]).size;
    return union === 0 ? 1 : intersection / union;
  }

  function diversityIndex(candidates) {
    const live = candidates.filter(c => c.steps && c.steps.length);
    if (live.length < 2) return { index: 1, pairs: 0, note: 'fewer than two live candidates; diversity is vacuous.' };
    let sum = 0, pairs = 0;
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        sum += jaccardSimilarity(live[i].steps, live[j].steps);
        pairs++;
      }
    }
    const meanSimilarity = sum / pairs;
    const index = 1 - meanSimilarity;
    return { index, pairs, meanSimilarity, low: index < DIVERSITY_FLOOR, floor: DIVERSITY_FLOOR };
  }

  /* THE EVOLUTIONARY BUDGET (section 21). Declared here, once, so the
     node-only scratch runner (scripts/lib/evolution-runner.js) and any panel
     summarising what ran against it read the same numbers rather than two
     copies that can drift. All four are ASSUMED -- chosen to keep one tick's
     scratch simulation bounded and finishable, not fitted to a measured
     runtime target. */
  const MAX_CANDIDATES_PER_TICK = 3;
  const MAX_GENERATIONS_PER_TICK = 1;
  const MAX_SIMULATION_SIM_SECONDS_PER_CANDIDATE = 30 * 86400; // 30 scratch sim-days
  const MAX_MUTATIONS_PER_CANDIDATE = 1;

  /* SCORE, WITH EVERY COMPONENT KEPT (section 8). `components` is produced by
     the caller -- here, or by the scratch runner once a candidate has
     actually been simulated -- and this function only combines and stores
     them, never invents one. The formula is an unweighted mean, stated as
     ASSUMED for the same reason MIN_RESOLVED_FOR_RATE in discovery-lab.js is:
     a chosen threshold, not a fitted one, and said so instead of dressed up
     as a measurement. */
  const SCORE_FORMULA = 'unweighted mean of feasibility, observability, novelty, recurrence and ' +
    'detectionLatencyScore -- each already in [0,1]. ASSUMED, not fitted.';

  const NOVELTY_SCORE_BY_CLASS = { KNOWN: 0, VARIANT: 0.25, COMPOSITE: 0.5, NOVEL_CANDIDATE: 1 };

  function score(components) {
    const required = ['feasibility', 'observability', 'novelty', 'recurrence', 'detectionLatencyScore'];
    required.forEach(k => {
      if (typeof components[k] !== 'number' || components[k] < 0 || components[k] > 1) {
        throw new Error('evolutionEngine.score: component "' + k + '" must be a number in [0,1], got ' +
          JSON.stringify(components[k]));
      }
    });
    const total = required.reduce((sum, k) => sum + components[k], 0) / required.length;
    const out = { total, formula: SCORE_FORMULA };
    required.forEach(k => { out[k] = components[k]; });
    return out;
  }

  /* Observable-trace categorisation (section 6). Purely a function of how
     many of the candidate's own distinct step types were ever actually
     recorded as a signal during its scratch run -- never a judgement about
     whether the behavior counted as "successful fraud", which section 6
     explicitly separates from this. */
  function observabilityClass(distinctSignalTypesSeen, distinctStepTypesPlanned) {
    if (!distinctStepTypesPlanned) return 'INVISIBLE';
    if (distinctSignalTypesSeen <= 0) return 'INVISIBLE';
    if (distinctSignalTypesSeen >= distinctStepTypesPlanned) return 'OBSERVABLE';
    return 'PARTIALLY_OBSERVABLE';
  }

  /* THE STORE. One Map keyed by candidateId, plus a generation counter --
     the same shape candidateEngine.createStore()/summary() already use for
     an analyst-facing record, so a later Discovery Lab extension can read
     this store the same way it already reads that one. */
  function createStore() {
    return { records: new Map(), generation: 0, promoted: [] };
  }

  function addCandidate(store, candidate, now) {
    if (store.records.has(candidate.candidateId)) {
      throw new Error('evolutionEngine.addCandidate: "' + candidate.candidateId + '" is already recorded; ' +
        'candidateId must be unique within a store.');
    }
    const record = Object.assign({}, candidate, { createdAt: now,
      history: [{ at: now, from: null, to: candidate.state, note: 'generated' }] });
    store.records.set(candidate.candidateId, record);
    return record;
  }

  function moveState(store, candidateId, toState, now, note) {
    if (CANDIDATE_STATES.indexOf(toState) < 0) {
      throw new Error('evolutionEngine.moveState: "' + toState + '" is not one of ' + CANDIDATE_STATES.join(', '));
    }
    const record = store.records.get(candidateId);
    if (!record) return { ok: false, why: 'NO_SUCH_CANDIDATE', candidateId };
    const from = record.state;
    record.state = toState;
    record.history.push({ at: now, from, to: toState, note: note || null });
    return { ok: true, record };
  }

  function listByState(store, state) {
    if (CANDIDATE_STATES.indexOf(state) < 0) {
      throw new Error('evolutionEngine.listByState: "' + state + '" is not one of ' + CANDIDATE_STATES.join(', '));
    }
    return Array.from(store.records.values()).filter(r => r.state === state);
  }

  function summary(store) {
    const all = Array.from(store.records.values());
    const byState = {};
    CANDIDATE_STATES.forEach(s => { byState[s] = 0; });
    all.forEach(r => {
      if (byState[r.state] === undefined) {
        throw new Error('evolutionEngine.summary: record ' + r.candidateId + ' carries state "' + r.state +
          '", which is not one of ' + CANDIDATE_STATES.join(', '));
      }
      byState[r.state]++;
    });
    const summed = CANDIDATE_STATES.reduce((n, k) => n + byState[k], 0);
    if (summed !== all.length) {
      throw new Error('evolutionEngine.summary: states sum to ' + summed + ' over ' + all.length + ' records');
    }
    return { total: all.length, byState, generation: store.generation,
      diversity: diversityIndex(all), records: all };
  }

  /* ONE BOUNDED GENERATION OF PROPOSALS (sections 5 and 21), computed here so
     it is testable without a scratch simulation: mutate up to
     MAX_CANDIDATES_PER_TICK proposals off the declared taxonomy, feasibility-
     check every one, classify novelty on every one that survives, and record
     all of them (feasible and not) with a stated reason either way. Actually
     running a surviving candidate through the world -- section 2's
     SIMULATION/OBSERVABILITY/DETECTION steps -- needs a scratch simulation
     this pure-JS module has no way to boot (no vm, no Node `require`, and
     the browser has no second, isolated global to boot one into); that step
     is scripts/lib/evolution-runner.js, which calls back into GENERATED
     records this function already produced and stored. */
  function proposeGeneration(store, worldSeed, lifecycle, eligibleStages, sampleSeconds, opts) {
    const ie = requireIntentEngine('proposeGeneration()');
    const o = opts || {};
    const now = o.now != null ? o.now : null;
    const budget = Math.min(o.candidateCount || MAX_CANDIDATES_PER_TICK, MAX_CANDIDATES_PER_TICK);
    const generation = store.generation + 1;
    const pool = MUTATION_OPERATOR_NAMES;
    const rng = FWRng.createRng(candidateSeed(worldSeed, generation, 0));
    const produced = [];
    let budgetExhausted = false;
    for (let i = 0; i < budget; i++) {
      const operatorName = o.operator || rng.pick(pool);
      let parentSpec;
      if (operatorName === 'PLAN_BLEND') {
        const a = rng.pick(ie.PLAN_KIND_NAMES);
        let b; do { b = rng.pick(ie.PLAN_KIND_NAMES); } while (b === a);
        parentSpec = [a, b];
      } else {
        parentSpec = o.parentKind || rng.pick(ie.PLAN_KIND_NAMES);
      }
      const candidate = mutate(parentSpec, operatorName, generation, i, worldSeed);
      if (candidate.state !== 'DISCARDED') {
        const feas = checkFeasibility(candidate, lifecycle, eligibleStages, sampleSeconds);
        if (!feas.feasible) {
          candidate.state = 'INFEASIBLE';
          candidate.discardedReason = feas.reason;
        } else {
          candidate.feasibility = feas;
          candidate.novelty = classifyNovelty(candidate, ie.PLAN_KINDS);
        }
      }
      addCandidate(store, candidate, now);
      produced.push(candidate.candidateId);
    }
    store.generation = generation;
    if (budget < (o.candidateCount || MAX_CANDIDATES_PER_TICK)) budgetExhausted = true;
    return { generation, produced, budgetExhausted, budget };
  }

  return {
    EVOLUTION_SEED_OFFSET, candidateSeed, stepTypeSet,
    MUTATION_OPERATORS, MUTATION_OPERATOR_NAMES, NOT_YET_BUILT_OPERATORS,
    CANDIDATE_STATES, NOVELTY_CLASSES, NOVELTY_SCORE_BY_CLASS,
    MAX_CANDIDATES_PER_TICK, MAX_GENERATIONS_PER_TICK, MAX_SIMULATION_SIM_SECONDS_PER_CANDIDATE, MAX_MUTATIONS_PER_CANDIDATE,
    DIVERSITY_FLOOR, SCORE_FORMULA,
    mutate, checkFeasibility, classifyNovelty, jaccardSimilarity, diversityIndex, score, observabilityClass,
    createStore, addCandidate, moveState, listByState, summary, proposeGeneration
  };
})();

