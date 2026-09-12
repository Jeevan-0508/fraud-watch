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
    note: 'Every outcome that consumes it carries a pattern by declaration, so on this app\u2019s own path a harm class is always available. A default would only ever fire on a call the app cannot make.'
  };

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
      return { multiplier: null, basis: 'NOT_SUPPLIED', why: HARM_BASIS.NOT_SUPPLIED, token: severity };
    }
    if (!Object.prototype.hasOwnProperty.call(HARM_MULTIPLIER.multiplier, severity)) {
      return { multiplier: null, basis: 'UNDECLARED_CLASS', why: HARM_BASIS.UNDECLARED_CLASS, token: severity };
    }
    return { multiplier: HARM_MULTIPLIER.multiplier[severity], basis: 'DECLARED_CLASS',
             why: HARM_BASIS.DECLARED_CLASS, token: severity };
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

  let harmTokensChecked = false;
  function checkHarmTokensOnce() {
    if (harmTokensChecked) return;
    if (typeof FW === 'undefined' || !FW.severityScale) return;
    const scale = FW.severityScale();
    if (!scale) return;
    assertHarmMultiplierTokens(scale.tokens);
    harmTokensChecked = true;
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
    const sevMult = harm.multiplier === null ? 1 : harm.multiplier;

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
    harmMultiplier, assertHarmMultiplierTokens,
    HARM_MULTIPLIER, HARM_BASIS,
    KEY, VERSION, OUTCOMES, OUTCOME_NAMES, BUCKETS, LEGACY_NOTE, REFUSALS
  };
})();
