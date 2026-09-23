/* simulation/candidateEngine.js — the CANDIDATE -> REVIEW -> {VALIDATED,
   REJECTED} lifecycle for a signature the discovery engine has flagged as
   still-novel (mega-spec: candidate-MO structure, defender review/
   validation). Until this module, moEngine's own POTENTIAL_NEW_MO and
   EMERGING_BEHAVIOR badges were the end of the story: a case carried the
   label for its own lifetime and nothing ever asked "does this recurring
   shape deserve to be treated as a pattern, or is it coincidence." This
   module is the analyst-facing answer to that question, and it answers it
   the same way investigationEngine answers "is this case fraud" -- with a
   state machine an analyst drives, never one the engine advances on its
   own past the first, purely observational, step.

   SIGNAL != PROOF, ONE LEVEL UP. moEngine's classification is itself only a
   signal that a signature MIGHT be worth naming: it is derived from
   recurrence counts and keyword overlap, and it changes if either does.
   Treating that badge alone as "a new MO has been found" would repeat, at
   the pattern level, the exact mistake this app spends every other engine
   refusing to make at the case level. So CANDIDATE is auto-derived and
   purely informational -- it names what moEngine's own numbers already
   support -- but REVIEW, VALIDATED and REJECTED only ever move because an
   analyst moved them. Nothing here ever assigns VALIDATED or REJECTED on
   its own, and nothing here ever skips REVIEW.

   PROVENANCE, NOT A LIVE FILTER. A candidate's provenance list is
   append-only: every case that was classified POTENTIAL_NEW_MO or
   EMERGING_BEHAVIOR at the moment this module last looked is added once and
   never removed, even if that same signature later recurs enough times for
   moEngine to call it KNOWN_MO. The record is "here is why this was first
   flagged," not "here is what still qualifies right now" -- a chain that
   could shrink on a later sync would not be a chain, it would be a snapshot
   wearing a chain's name.

   GROUND-TRUTH BOUNDARY. This module reads only moEngine's own case objects
   (classification, signature, id, openedAt) -- never intentEngine's plan
   book. It is exactly as downstream of behaviorEngine as investigationEngine
   already is, and belongs beside it on intentEngine's own forbidden-readers
   list for the same reason: a case is supposed to be built out of what was
   written down, and a candidate is supposed to be built out of what the
   case-building already decided, not out of the plan that produced it. */
const FWCandidateEngine = (() => {
  // A case counts toward a candidate only while moEngine itself is still
  // calling the signature novel. KNOWN_MO and MO_VARIANT already resemble
  // something documented, in moEngine's own terms, so a case carrying either
  // is not evidence that a NEW pattern exists -- it is the opposite finding.
  const ELIGIBLE_CLASSIFICATIONS = ['POTENTIAL_NEW_MO', 'EMERGING_BEHAVIOR'];

  /* CALIBRATION, ASSUMED, NOT FITTED. One eligible sighting is a single odd
     case; nothing about a single case says it will ever happen again. Two is
     the smallest count at which "this shape recurred" is a fact about the
     signature rather than a fact about one truck's one bad day -- the same
     reasoning moEngine's own MIN_SIGNAL_TYPES=2 applies to signal types
     within a case, spent here on sightings of a signature across cases. */
  const CANDIDATE_SIGHTING_FLOOR = 2;

  const STATES = ['CANDIDATE', 'REVIEW', 'VALIDATED', 'REJECTED'];
  const TERMINAL_STATES = ['VALIDATED', 'REJECTED'];

  /* THE ONLY PATHS A RECORD MAY TAKE. Declared as a table, not scattered
     across the functions that move a record, so "can X go straight to
     VALIDATED" has one place to answer no. CANDIDATE is reachable only from
     nothing (sync() creates a record already in this state); REVIEW is
     reachable only from CANDIDATE; VALIDATED and REJECTED are reachable
     only from REVIEW. Skipping REVIEW is not a shortcut, it is the missing
     step this module exists to require. */
  const TRANSITIONS = [
    { from: 'CANDIDATE', to: 'REVIEW', note: 'analyst opened formal review' },
    { from: 'REVIEW', to: 'VALIDATED', note: 'analyst validated this as a genuinely new pattern' },
    { from: 'REVIEW', to: 'REJECTED', note: 'analyst rejected this as coincidence or an existing pattern by another name' }
  ];

  // Both directions: a transition naming a state this module never declared,
  // or a declared state no transition can ever reach or leave (other than
  // CANDIDATE, which is reached only by sync(), not by a transition here).
  function assertTransitionsDeclared() {
    TRANSITIONS.forEach(t => {
      if (STATES.indexOf(t.from) < 0) {
        throw new Error('candidateEngine: a transition names "' + t.from + '" as a from-state, which is not one of ' + STATES.join(', '));
      }
      if (STATES.indexOf(t.to) < 0) {
        throw new Error('candidateEngine: a transition names "' + t.to + '" as a to-state, which is not one of ' + STATES.join(', '));
      }
    });
    const reachable = new Set(['CANDIDATE'].concat(TRANSITIONS.map(t => t.to)));
    STATES.forEach(s => {
      if (!reachable.has(s)) {
        throw new Error('candidateEngine: state "' + s + '" is declared but no transition and no creation path ever reaches it');
      }
    });
  }
  assertTransitionsDeclared();

  // Guarded: in a headless context that has not loaded moEngine yet (a unit
  // test targeting this module alone), there is nothing to reconcile against
  // and this quietly does nothing rather than making load order a hard
  // dependency this module does not otherwise have.
  function assertEligibleClassificationsAreReal() {
    if (typeof FWMoEngine === 'undefined' || !FWMoEngine.CLASSIFICATIONS) return;
    ELIGIBLE_CLASSIFICATIONS.forEach(c => {
      if (FWMoEngine.CLASSIFICATIONS.indexOf(c) < 0) {
        throw new Error('candidateEngine: "' + c + '" is not one of moEngine\'s own declared classifications (' +
          FWMoEngine.CLASSIFICATIONS.join(', ') + '); a candidate floor cannot be set on a class that cannot occur');
      }
    });
  }
  assertEligibleClassificationsAreReal();

  function transitionEntry(from, to) {
    return TRANSITIONS.find(t => t.from === from && t.to === to) || null;
  }

  function createStore() {
    return { records: new Map() };
  }

  /* THE ONLY AUTOMATIC STEP. Groups moEngine's current cases by signature,
     and for any signature that has never been recorded here and has reached
     the sighting floor on still-eligible cases, opens a CANDIDATE record.
     For a signature already recorded, appends any eligible case not already
     in its provenance -- append-only, per the header note, regardless of
     the record's current state (a REVIEW or even a resolved record still
     gets its provenance extended, because provenance is a history of why
     this was flagged, not a queue of what is still actionable). Never
     touches a record's state; that is exclusively startReview()/resolve(). */
  function sync(store, engine, now) {
    const bySignature = new Map();
    Array.from(engine.mos.values()).forEach(mo => {
      if (ELIGIBLE_CLASSIFICATIONS.indexOf(mo.classification) < 0) return;
      if (!bySignature.has(mo.signature)) bySignature.set(mo.signature, []);
      bySignature.get(mo.signature).push(mo);
    });
    const createdSignatures = [];
    bySignature.forEach((mos, signature) => {
      let record = store.records.get(signature);
      if (!record) {
        if (mos.length < CANDIDATE_SIGHTING_FLOOR) return;
        record = {
          signature,
          state: 'CANDIDATE',
          firstSeenAt: Math.min.apply(null, mos.map(m => m.openedAt)),
          promotedAt: now,
          reviewStartedAt: null,
          resolvedAt: null,
          resolutionNote: null,
          provenance: [],
          history: [{ at: now, from: null, to: 'CANDIDATE',
            note: 'reached the sighting floor of ' + CANDIDATE_SIGHTING_FLOOR + ' with a still-novel classification' }]
        };
        store.records.set(signature, record);
        createdSignatures.push(signature);
      }
      const known = new Set(record.provenance.map(p => p.moId));
      mos.forEach(mo => {
        if (known.has(mo.id)) return;
        record.provenance.push({ moId: mo.id, classification: mo.classification, at: now });
        known.add(mo.id);
      });
    });
    return { createdSignatures, totalRecords: store.records.size };
  }

  function get(store, signature) {
    return store.records.get(signature) || null;
  }

  function listByState(store, state) {
    if (STATES.indexOf(state) < 0) {
      throw new Error('candidateEngine.listByState: "' + state + '" is not one of ' + STATES.join(', '));
    }
    return Array.from(store.records.values()).filter(r => r.state === state);
  }

  /* THE FIRST ANALYST ACTION. Only legal from CANDIDATE, matching the one
     transition TRANSITIONS declares out of it. Refuses rather than throws on
     a bad call (wrong signature, wrong state) because a UI button offered on
     a record already moved past this step is a stale render, not a logic
     error worth stopping the module for -- the caller decides what to do
     with `ok: false`. */
  function startReview(store, signature, now) {
    const record = store.records.get(signature);
    if (!record) return { ok: false, why: 'NO_SUCH_CANDIDATE', signature };
    const entry = transitionEntry(record.state, 'REVIEW');
    if (!entry) return { ok: false, why: 'WRONG_STATE', from: record.state, signature };
    record.state = 'REVIEW';
    record.reviewStartedAt = now;
    record.history.push({ at: now, from: 'CANDIDATE', to: 'REVIEW', note: entry.note });
    return { ok: true, record };
  }

  /* THE TERMINAL ANALYST ACTION. Only legal from REVIEW, into whichever of
     the two terminal states TRANSITIONS declares reachable from it. `note`
     is the analyst's own stated reason, kept beside the transition rather
     than only in a free-text field elsewhere, so a resolved record's history
     entry and its headline reason are never two different places that can
     disagree about why. */
  function resolve(store, signature, verdict, now, note) {
    if (TERMINAL_STATES.indexOf(verdict) < 0) {
      throw new Error('candidateEngine.resolve: "' + verdict + '" is not one of ' + TERMINAL_STATES.join(', '));
    }
    const record = store.records.get(signature);
    if (!record) return { ok: false, why: 'NO_SUCH_CANDIDATE', signature };
    const entry = transitionEntry(record.state, verdict);
    if (!entry) return { ok: false, why: 'WRONG_STATE', from: record.state, signature };
    record.state = verdict;
    record.resolvedAt = now;
    record.resolutionNote = note || null;
    record.history.push({ at: now, from: 'REVIEW', to: verdict, note: note || entry.note });
    return { ok: true, record };
  }

  /* Reconciled tally, the same discipline discoverySummary()/tallyOutcomes()
     already apply to their own partitions: every record sorts into exactly
     one bucket, and the buckets sum to the whole. */
  function summary(store) {
    const all = Array.from(store.records.values());
    const byState = {};
    STATES.forEach(s => { byState[s] = 0; });
    all.forEach(r => {
      if (byState[r.state] === undefined) {
        throw new Error('candidateEngine.summary: record ' + (r.signature || '(no signature)') + ' carries state "' +
          r.state + '", which is not one of ' + STATES.join(', '));
      }
      byState[r.state]++;
    });
    const summed = STATES.reduce((n, k) => n + byState[k], 0);
    if (summed !== all.length) {
      throw new Error('candidateEngine.summary: states sum to ' + summed + ' over ' + all.length + ' records');
    }
    return { total: all.length, byState, records: all };
  }

  return {
    ELIGIBLE_CLASSIFICATIONS, CANDIDATE_SIGHTING_FLOOR, STATES, TERMINAL_STATES, TRANSITIONS,
    assertTransitionsDeclared, assertEligibleClassificationsAreReal, transitionEntry,
    createStore, sync, get, listByState, startReview, resolve, summary
  };
})();
