/* systems/scoring.js — Phase 2: score + persistence for Port Meridian.
   Pure logic, no DOM/Phaser, so it can run and be unit-tested under
   plain Node (same pattern as data.js). Persists to localStorage under
   a dedicated key so it never collides with Classic Watch's own state. */
const FWScoring = (() => {
  const KEY = 'fraudwatch_port_progress';
  const VERSION = 2;

  /* Every way a Port Meridian case can end, and for each one the two facts a
     later reader needs and cannot recover afterwards: whether the player made
     a call, and whether the case carried a pattern.

     Before this slice there were four outcomes, one of them counted nothing,
     and a case whose timer expired was recorded as the same 'cleared' the
     player gets for deliberately waving a clean vehicle through. A record of
     a decision that was never made is the mistake this table exists to stop.
     'decided' is the answer to "did anybody call this", nothing else. */
  const OUTCOMES = {
    caught:         { usesHarmMultiplier: true, decided: true,  carriedPattern: true,  bucket: 'casesSolved',
                      label: 'Intercepted after your call' },
    missed:         { usesHarmMultiplier: false, decided: true,  carriedPattern: true,  bucket: 'casesMissed',
                      label: 'You waved it through and it left' },
    expiredPattern: { usesHarmMultiplier: false, decided: false, carriedPattern: true,  bucket: 'casesUncalledPattern',
                      label: 'Case window closed with no call made' },
    cleared:        { usesHarmMultiplier: false, decided: true,  carriedPattern: false, bucket: 'casesCleared',
                      label: 'You waved a clean vehicle through' },
    overCalled:     { usesHarmMultiplier: false, decided: true,  carriedPattern: false, bucket: 'overCalls',
                      label: 'You called a vehicle that carried no pattern' },
    expiredClean:   { usesHarmMultiplier: false, decided: false, carriedPattern: false, bucket: 'casesUncalledClean',
                      label: 'Case window closed with no call made' }
  };
  const OUTCOME_NAMES = Object.keys(OUTCOMES);
  const BUCKETS = OUTCOME_NAMES.map(n => OUTCOMES[n].bucket);

  /* WHICH OUTCOMES ACTUALLY MULTIPLY BY A HARM CLASS. Exactly one does, and
     that was previously visible only as the shape of an `if` in applyOutcome
     while a harm class was accepted (and defaulted) on every call. A case that
     carried no pattern was handed the class `medium` by the caller and the
     value was then ignored -- an assessment of harm invented for a clean
     vehicle. Declared here so the reachable inputs are the declared ones. */
  const HARM_MULTIPLIER = {
    kind: 'PARAMETER',
    scope: 'how much a solved case is worth, by the assessed harm of the pattern it carried',
    means: 'the score for intercepting a case scales with how much damage the taxonomy assesses that pattern would do.',
    doesNotMean: 'a probability, a share, an amount of money, and NOT the event-severity space -- FWEventEngine.EVENT_SEVERITY is a different vocabulary that happens to use the same field name.',
    tokenOwner: 'FW.severityScale(), the taxonomy module -- these tokens are not declared here, they are reconciled against it',
    multiplier: { low: 1, medium: 1.5, high: 2, critical: 3 },
    usedByOutcomes: OUTCOME_NAMES.filter(n => OUTCOMES[n].usesHarmMultiplier),
    note: 'Every outcome that consumes it carries a pattern by declaration, so on this app\u2019s own path a harm class is always available. A default would only ever fire on a call the app cannot make.',

    /* WHICH OF TWO FACTS THIS TABLE IS RECONCILED AGAINST, now that the
       taxonomy module states both. The reconciliation has always been against
       the declared vocabulary; what was missing is that the code never said so,
       and a reader comparing this table to the loaded data would find one
       multiplier -- `low` -- for a class none of the twelve patterns carries. */
    reconciliation: 'DECLARED_TOKENS',
    reconciliationOwner: 'FW.severityScale().tokens',
    reconciliationWhy: 'complete over the declared harm vocabulary, so a class the taxonomy declares can never reach the score without a declared multiplier. Presence in the loaded data is a separate fact, reported per lookup and never used to drop a multiplier.',
    reconciliationRejected: 'PRESENT_IN_DATA',
    reconciliationRejectedOwner: 'FW.severityScale().presentInData',
    reconciliationRejectedWhy: 'a table complete only over the classes the currently loaded twelve patterns happen to carry would make the score\u2019s vocabulary a function of one data file: a thirteenth pattern carrying an absent class could then only be scored by inventing a multiplier, which is the exact fault assertHarmMultiplierTokens exists to stop.',
    matchesTreatmentOf: 'FW.colorBasis, which keeps the declared colour for a declared-but-absent class and labels the absence DECLARED_ABSENT_IN_DATA rather than unmapping it. Declared-but-absent is a third state in this program, not a synonym for undeclared.',
    presenceOwner: 'FW.severityScale().presentInData / .absentFromData -- measured at load with its denominator, not assumed here',

    /* One declared multiplier is the arithmetic identity, so an interception of
       a `low`-harm pattern scores byte-identically to one that was never scaled
       by harm at all. That is the same shape as the unrecognised-token colour
       being `low`'s declared colour, which Slice 67 fixed by making the
       not-a-class value no class's value. Here the value cannot be moved
       without inventing a harm assessment, so the two are told apart by BASIS
       and never by the number -- and the one path that produced the identity
       without a declared class has been removed rather than annotated. */
    identityValue: 1,
    identityCollision: ['low'],
    identityCollisionMeans: 'the score alone cannot distinguish these classes from no harm scaling. harmMultiplier().basis is the only thing that can, so no caller may read a factor of 1 as evidence that a harm class was assessed.',
    noFallback: 'there is no default factor. An outcome that scales by harm and has no declared class throws in applyOutcome; an outcome that does not scale never asks for a factor.'
  };

  /* The two facts a declared class can carry about the loaded data, kept apart
     from the two refusals in HARM_BASIS: absence is not a refusal, the
     multiplier is the declared one either way. */
  const HARM_PRESENCE = {
    DECLARED_PRESENT: 'declared, and carried by at least one pattern in the loaded taxonomy.',
    DECLARED_ABSENT_IN_DATA: 'declared, and carried by no pattern in the loaded taxonomy -- this multiplier is reachable only from data this taxonomy does not contain.',
    NOT_MEASURED: 'the taxonomy module has not supplied a presence measurement, so this program does not know which and does not guess.',
    NOT_A_DECLARED_CLASS: 'presence in the data is not a question that can be asked about a value the taxonomy does not declare as a harm class.',
    NOT_A_CLASS_AT_ALL: 'no harm class was supplied, so there is nothing whose presence in the data could be looked up.'
  };

  function harmPresence(token) {
    if (!Object.prototype.hasOwnProperty.call(HARM_MULTIPLIER.multiplier, token)) {
      return { presence: 'NOT_A_DECLARED_CLASS', why: HARM_PRESENCE.NOT_A_DECLARED_CLASS };
    }
    const scale = (typeof FW !== 'undefined' && FW.severityScale) ? FW.severityScale() : null;
    if (!scale || !Array.isArray(scale.presentInData)) {
      return { presence: 'NOT_MEASURED', why: HARM_PRESENCE.NOT_MEASURED };
    }
    const present = scale.presentInData.indexOf(token) >= 0;
    return {
      presence: present ? 'DECLARED_PRESENT' : 'DECLARED_ABSENT_IN_DATA',
      why: present ? HARM_PRESENCE.DECLARED_PRESENT : HARM_PRESENCE.DECLARED_ABSENT_IN_DATA
    };
  }

  /* Why a call got the multiplier it got, including the two cases that get no
     multiplier at all. Both refusals used to be silent numbers: an unrecognised
     token fell through `|| 1` and scored identically to `low` -- the one
     declared class the taxonomy carries in none of its patterns -- and a missing
     one was defaulted to `medium` and scored HIGHER than a real low-harm case. */
  const HARM_BASIS = {
    DECLARED_CLASS: 'a harm class the taxonomy module declares. The multiplier is the declared one.',
    NOT_SUPPLIED: 'no harm class was supplied for an outcome that scales by one. There is no multiplier: a default would be an assessment of harm this program invented.',
    UNDECLARED_CLASS: 'a value was supplied that the taxonomy module does not declare as a harm class. There is no multiplier, and it is not treated as the lowest class.'
  };

  /* Raw lookup. Returns the basis and, only for a declared class, a number --
     the refusals are named rather than folded into a value. */
  function harmMultiplier(severity) {
    if (severity === undefined || severity === null || severity === '') {
      return { multiplier: null, basis: 'NOT_SUPPLIED', why: HARM_BASIS.NOT_SUPPLIED, token: severity,
               presence: 'NOT_A_CLASS_AT_ALL', presenceWhy: HARM_PRESENCE.NOT_A_CLASS_AT_ALL };
    }
    if (!Object.prototype.hasOwnProperty.call(HARM_MULTIPLIER.multiplier, severity)) {
      const u = harmPresence(severity);
      return { multiplier: null, basis: 'UNDECLARED_CLASS', why: HARM_BASIS.UNDECLARED_CLASS, token: severity,
               presence: u.presence, presenceWhy: u.why };
    }
    const p = harmPresence(severity);
    return { multiplier: HARM_MULTIPLIER.multiplier[severity], basis: 'DECLARED_CLASS',
             why: HARM_BASIS.DECLARED_CLASS, token: severity,
             presence: p.presence, presenceWhy: p.why };
  }

  /* Both directions against the module that owns the tokens. This table was an
     inline object literal inside applyOutcome for thirty-six phases: a fourth
     copy of the taxonomy's harm vocabulary that nothing compared to it. */
  function assertHarmMultiplierTokens(harmTokens) {
    const declared = harmTokens || [];
    declared.forEach(t => {
      if (!Object.prototype.hasOwnProperty.call(HARM_MULTIPLIER.multiplier, t)) {
        throw new Error('FWScoring: the taxonomy declares harm class "' + t + '" and this record has no ' +
          'multiplier for it, so a case carrying it could only be scored by inventing one');
      }
    });
    Object.keys(HARM_MULTIPLIER.multiplier).forEach(t => {
      if (declared.indexOf(t) < 0) {
        throw new Error('FWScoring: a score multiplier is declared for "' + t + '", which the taxonomy ' +
          'does not declare as a harm class');
      }
    });
    return true;
  }

  /* The two facts this table could have been reconciled against, each naming
     the field on the token owner that states it. A declaration that named a
     fact the owner does not supply would be a choice between one real option
     and one imaginary one. */
  const RECONCILIATION_OPTIONS = {
    DECLARED_TOKENS: { field: 'tokens', means: 'the harm classes the taxonomy module declares, whether or not the loaded data carries them.' },
    PRESENT_IN_DATA: { field: 'presentInData', means: 'the harm classes at least one loaded pattern actually carries.' }
  };

  /* Both directions on the choice itself, not on the tokens: the chosen and the
     rejected option must each be real and each be measurable off the owner, the
     multiplier table must match the chosen one exactly, and it must NOT match
     the rejected one -- otherwise the declaration would be untestable, because
     the two agree whenever every declared class happens to occur. */
  function assertHarmReconciliationDeclared(scale) {
    const chosen = RECONCILIATION_OPTIONS[HARM_MULTIPLIER.reconciliation];
    const rejected = RECONCILIATION_OPTIONS[HARM_MULTIPLIER.reconciliationRejected];
    if (!chosen || !rejected || HARM_MULTIPLIER.reconciliation === HARM_MULTIPLIER.reconciliationRejected) {
      throw new Error('FWScoring: the harm multiplier must declare which of ' +
        Object.keys(RECONCILIATION_OPTIONS).join('/') + ' it is reconciled against and which it is not, ' +
        'and they must differ -- got "' + HARM_MULTIPLIER.reconciliation + '" against "' +
        HARM_MULTIPLIER.reconciliationRejected + '"');
    }
    [['reconciliation', chosen], ['reconciliationRejected', rejected]].forEach(([which, opt]) => {
      if (!Array.isArray(scale[opt.field])) {
        throw new Error('FWScoring: ' + which + ' names "' + opt.field + '" on the token owner and the ' +
          'owner supplies no such list, so the choice is between one real option and one that cannot be checked');
      }
    });
    const keys = Object.keys(HARM_MULTIPLIER.multiplier).slice().sort().join('/');
    if (keys !== scale[chosen.field].slice().sort().join('/')) {
      throw new Error('FWScoring: the multiplier table declares itself reconciled against ' +
        HARM_MULTIPLIER.reconciliation + ' (' + HARM_MULTIPLIER.reconciliationOwner + ') and its keys are ' +
        keys + ' against ' + scale[chosen.field].join('/'));
    }
    /* Whether the choice is observable on THIS data is a fact about the data,
       not a fault in it: the two options agree whenever every declared class
       occurs. Measured and published rather than thrown on, so a reader is never
       told a choice was made that the loaded taxonomy could not have shown. */
    const sameAsRejected = keys === scale[rejected.field].slice().sort().join('/');
    HARM_MULTIPLIER.reconciliationObservable = {
      observable: !sameAsRejected,
      onData: HARM_MULTIPLIER.reconciliationOwner + ' = ' + scale[chosen.field].join('/') + '; ' +
              HARM_MULTIPLIER.reconciliationRejectedOwner + ' = ' + (scale[rejected.field].join('/') || '(none)'),
      why: sameAsRejected
        ? 'every declared harm class is carried by the loaded taxonomy, so reconciling against the declared vocabulary and reconciling against presence in the data would produce the same table here. The choice still holds; this data cannot show it.'
        : 'the two lists differ on the loaded taxonomy, so the table matching the declared vocabulary and not presence-in-data is an observable fact about this build and not only a stated intention.'
    };
    return true;
  }

  /* The identity claim, checked rather than restated: `identityValue` must be
     the value that leaves a score unchanged when multiplied through, and
     `identityCollision` must name exactly the declared classes that carry it.
     A collision list that drifted from the table would be the one place a
     reader is told the score can tell two things apart when it cannot. */
  function assertIdentityCollisionNamed() {
    const iv = HARM_MULTIPLIER.identityValue;
    if (typeof iv !== 'number' || 100 * iv !== 100) {
      throw new Error('FWScoring: identityValue is declared as ' + iv + ', which is not the factor that ' +
        'leaves a score unchanged, so identityCollision would be a list about the wrong number');
    }
    const carry = Object.keys(HARM_MULTIPLIER.multiplier)
      .filter(k => HARM_MULTIPLIER.multiplier[k] === iv).sort().join('/');
    const named = (HARM_MULTIPLIER.identityCollision || []).slice().sort().join('/');
    if (carry !== named) {
      throw new Error('FWScoring: the classes whose multiplier is the identity ' + iv + ' are ' +
        (carry || '(none)') + ' and identityCollision names ' + (named || '(none)') +
        ' -- a score of 100 would then read as an assessed harm class that was never assessed');
    }
    return true;
  }

  let harmTokensChecked = false;
  function checkHarmTokensOnce() {
    if (harmTokensChecked) return;
    if (typeof FW === 'undefined' || !FW.severityScale) return;
    const scale = FW.severityScale();
    if (!scale) return;
    assertHarmMultiplierTokens(scale.tokens);
    assertHarmReconciliationDeclared(scale);
    harmTokensChecked = true;
  }

  // Runs at module load: it needs nothing from the taxonomy.
  assertIdentityCollisionNamed();

  /* The reconciliation measurement is against the taxonomy, so it cannot exist
     before the taxonomy arrives. Returning a named refusal rather than an
     absent field keeps a reader from taking "not yet measured" for "reconciled
     against nothing". */
  function harmReconciliation() {
    checkHarmTokensOnce();
    if (!HARM_MULTIPLIER.reconciliationObservable) {
      return {
        reconciliation: HARM_MULTIPLIER.reconciliation,
        observable: null,
        why: 'REFUSED_TAXONOMY_NOT_LOADED \u2014 the choice is declared, and whether this data could show it is a measurement against the taxonomy module, which has not supplied a harm scale yet.'
      };
    }
    return Object.assign({ reconciliation: HARM_MULTIPLIER.reconciliation },
                         HARM_MULTIPLIER.reconciliationObservable);
  }

  /* Said wherever a legacy record's counts are shown. A record written before
     v2 cannot be repaired: its 'cleared' outcomes were never counted at all
     and its expiries were counted as calls, so the zeroes in those buckets
     mean "never recorded", not "never happened". */
  const LEGACY_NOTE =
    'This record was written before uncalled cases were counted separately. ' +
    'Its buckets are reported as stored: cases waved through were not counted ' +
    'at the time, and a case whose window closed with no call was counted as a ' +
    'call. The missing counts are not reconstructible, so they are not guessed.';

  function defaultState() {
    const s = {
      version: VERSION,
      totalScore: 0,
      bestStreak: 0,
      streak: 0,
      level: 1,
      resolutions: 0,
      legacyUnreconciled: false
    };
    BUCKETS.forEach(b => { s[b] = 0; });
    return s;
  }

  /* A v1 record has no version, no cleared count and no uncalled counts, and
     spells the over-call bucket 'falseAccusations' -- a flag on a clean
     vehicle is an over-call, not an accusation, and the rest of this project
     does not use that word. Carried across, then declared unreconciled. */
  function migrate(parsed) {
    const s = Object.assign(defaultState(), parsed || {});
    if (parsed && parsed.overCalls == null && parsed.falseAccusations != null) {
      s.overCalls = parsed.falseAccusations;
    }
    delete s.falseAccusations;
    if (!parsed || parsed.version !== VERSION) {
      s.legacyUnreconciled = !!(parsed && Object.keys(parsed).length);
      s.resolutions = BUCKETS.reduce((a, b) => a + (s[b] || 0), 0);
      s.version = VERSION;
    }
    return s;
  }

  /* The one place the buckets are read as a set. Throws rather than reports
     if they do not account for every resolution. */
  function tally(state) {
    const cut = {};
    let sum = 0;
    BUCKETS.forEach(b => {
      const v = state[b];
      if (typeof v !== 'number') throw new Error('FWScoring.tally: no count in bucket ' + b);
      cut[b] = v;
      sum += v;
    });
    if (sum !== state.resolutions) {
      throw new Error(
        'FWScoring.tally: buckets sum to ' + sum + ' but ' + state.resolutions +
        ' cases resolved. A resolution in the base and in no bucket is how an ' +
        'expired case came to be counted as a decision.'
      );
    }
    cut.resolutions = sum;
    cut.decided = OUTCOME_NAMES.filter(n => OUTCOMES[n].decided)
      .reduce((a, n) => a + cut[OUTCOMES[n].bucket], 0);
    cut.uncalled = cut.resolutions - cut.decided;
    cut.patternCases = OUTCOME_NAMES.filter(n => OUTCOMES[n].carriedPattern)
      .reduce((a, n) => a + cut[OUTCOMES[n].bucket], 0);
    cut.cleanCases = cut.resolutions - cut.patternCases;
    cut.calledPatternCases = cut.casesSolved + cut.casesMissed;
    cut.legacyUnreconciled = !!state.legacyUnreconciled;
    return cut;
  }

  /* The one rate this record can carry, over the only base it has: pattern
     cases the player actually called. Cases whose window closed are in neither
     part of it. Built through analyticsEngine so it arrives with n / N and the
     same minimum sample as every other rate in this project. */
  function meters(state) {
    const cut = tally(state);
    if (typeof FWAnalyticsEngine === 'undefined') return { cut, interception: null, refusals: REFUSALS };
    const interception = FWAnalyticsEngine.metric({
      id: 'port-interception',
      label: 'Pattern cases you called and intercepted',
      kind: FWAnalyticsEngine.KIND.RATE,
      numerator: cut.casesSolved,
      denominator: cut.calledPatternCases,
      of: 'pattern cases you called (intercepted or waved through)',
      note: 'Measured against the case generator\'s own pattern flag, which is ' +
        'an answer key this trainer has and a real yard does not. Cases whose ' +
        'window closed with no call made are in neither part of this rate.'
    });
    return { cut, interception, refusals: REFUSALS };
  }

  /* Numbers this record is asked for and cannot support. Stated, not omitted. */
  const REFUSALS = [
    {
      id: 'clean-accuracy',
      question: 'How often were you right about the vehicles carrying no pattern?',
      reason: 'Waving a clean vehicle through and calling one are both recorded, so ' +
        'the counts exist -- but a case only becomes clean-or-not through the ' +
        'generator\'s flag, and being right about it is not the same claim as ' +
        'having had grounds to check. This record holds the first and nothing at ' +
        'all about the second.'
    },
    {
      id: 'unscored-harm-class',
      question: 'What is a solved case worth when nobody assessed how bad the pattern was?',
      reason: 'The score for an interception scales by the taxonomy\u2019s assessed harm class. A missing ' +
        'or unrecognised class used to be answered with a number anyway -- the same score as the lowest ' +
        'declared class, or as the middle one -- so the record could not be told apart from a real ' +
        'assessment. It is refused at the write instead.'
    },
    {
      id: 'improvement',
      question: 'Are you getting better?',
      reason: 'Nothing here is timestamped and the difficulty rises with the level, ' +
        'so a later rate is measured on harder cases than an earlier one. A trend ' +
        'over this record would be reading a moving base as a moving skill.'
    }
  ];

  function load() {
    try {
      const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem(KEY) : null;
      if (!raw) return defaultState();
      return migrate(JSON.parse(raw));
    } catch (e) {
      return defaultState();
    }
  }

  function save(state) {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) { /* storage unavailable — non-fatal */ }
    return state;
  }

  function reset() { return save(defaultState()); }

  /* `outcome` must be one of OUTCOMES. An unrecognised one used to fall
     through the switch's default and be saved as a resolution in no bucket,
     which is the silent shape two earlier slices already found elsewhere. */
  function applyOutcome(state, outcome, opts = {}) {
    const spec = OUTCOMES[outcome];
    if (!spec) {
      throw new Error(
        'FWScoring.applyOutcome: unknown outcome "' + outcome + '". Known: ' +
        OUTCOME_NAMES.join(', ') + '. An outcome with no bucket would be counted ' +
        'in the base and nowhere else.'
      );
    }
    checkHarmTokensOnce();
    const s = Object.assign({}, state);
    const harm = harmMultiplier(opts.severity);
    if (spec.usesHarmMultiplier && harm.multiplier === null) {
      throw new Error('FWScoring.applyOutcome: outcome "' + outcome + '" scales by the assessed harm of the ' +
        'pattern it carried, and the harm class given was "' + opts.severity + '" \u2014 ' + harm.why +
        ' Known classes: ' + Object.keys(HARM_MULTIPLIER.multiplier).join('/') + '.');
    }
    /* No fallback factor. A conditional here used to substitute the factor 1
       whenever no harm class had been declared, and 1 is `low`'s declared
       multiplier -- so the value meaning "no harm was assessed" was the one
       harm class the taxonomy carries in none of its patterns. It was also
       dead: the only outcome that reads this factor is the one that throws
       above when there is no declared class, and measuring it confirmed no
       non-scaling outcome's score moves with the severity passed. Removed
       rather than commented, and the null is left null. */
    const sevMult = spec.usesHarmMultiplier ? harm.multiplier : null;

    s.resolutions += 1;
    s[spec.bucket] += 1;

    /* The streak counts calls. An expired case moves the score, because a
       pattern leaving the port is a consequence whether or not anybody looked,
       and leaves the streak alone, because there was no call to continue or
       break. Score and streak answer different questions on purpose. */
    if (outcome === 'caught') {
      s.streak += 1;
      s.bestStreak = Math.max(s.bestStreak, s.streak);
      s.totalScore += Math.round(100 * sevMult) + s.streak * 5;
    } else if (outcome === 'missed') {
      s.streak = 0;
      s.totalScore = Math.max(0, s.totalScore - 40);
    } else if (outcome === 'overCalled') {
      s.streak = 0;
      s.totalScore = Math.max(0, s.totalScore - 25);
    } else if (outcome === 'cleared') {
      s.totalScore += 15;
    } else if (outcome === 'expiredPattern') {
      s.totalScore = Math.max(0, s.totalScore - 40);
    }
    // expiredClean moves nothing: nothing happened and nobody called it.

    s.level = 1 + Math.floor(s.casesSolved / 4);
    tally(s);   // throws here, at the write, rather than later at a render
    return save(s);
  }

  return {
    load, save, reset, applyOutcome, migrate, tally, meters,
    harmMultiplier, assertHarmMultiplierTokens, harmPresence,
    assertHarmReconciliationDeclared, assertIdentityCollisionNamed, harmReconciliation,
    HARM_MULTIPLIER, HARM_BASIS, HARM_PRESENCE, RECONCILIATION_OPTIONS,
    KEY, VERSION, OUTCOMES, OUTCOME_NAMES, BUCKETS, LEGACY_NOTE, REFUSALS
  };
})();
