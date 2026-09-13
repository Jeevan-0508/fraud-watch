/* simulation/moEngine.js — correlates weighted signals into a Mode of
   Operation (MO), the structured case object the player eventually
   investigates. This is the one module allowed to say "this might be
   something" — and even then it must clear two bars: enough distinct
   *kinds* of signal (a chain, not one repeated blip) AND enough
   combined weight. A single strong signal alone does not create an MO
   -- that's the "signal != proof" principle enforced structurally,
   not just as a design note.

   Pattern matching against the real freight-fraud-taxonomy is a
   simulation-layer HEURISTIC: it picks the existing taxonomy pattern
   whose name/category/aliases best resemble the kinds of signals
   observed. It never invents a new pattern and never claims the
   simulated signal literally IS a documented indicator -- the MO's
   falsePositives and patternCountermeasures are always pulled
   verbatim from that matched pattern's real taxonomy data, and are scoped on
   screen as facts about the pattern rather than recommendations about the
   case. If nothing shares a keyword, that is stated as a gap in the
   taxonomy's vocabulary, not as a finding about the behaviour.

   DISCOVERY / NOVELTY: every MO's "signature" (its sorted distinct
   signal types) is tallied across the whole run in engine.signatures.
   The first time a signature appears, and how strongly it resembles
   an existing taxonomy pattern, decides its classification:
     KNOWN_MO          - recurring signature, seen many times before
     MO_VARIANT        - strongly resembles a known pattern, but this
                          exact signal combination hasn't recurred yet
     POTENTIAL_NEW_MO  - some resemblance to a known pattern, rare/new
     EMERGING_BEHAVIOR - no confident resemblance to anything known
   This never invents a new taxonomy pattern -- it only says "this
   combination of already-real signal types hasn't been seen (much)
   before," which is a claim about the simulation's own history, not
   about the real world. */
const FWMoEngine = (() => {
  const CREATE_THRESHOLD = 3.5;      // combined weight*reliability needed to open an MO
  const MIN_SIGNAL_TYPES = 2;        // require a chain of >=2 distinct signal kinds
  /* How long an unresolved case stays open with no new signal before the
     engine fades it. It was 3600 -- one sim-hour -- and measured over 336
     sim-hours that left a case open for a median of 2.5 hours and the case
     list empty for about 95% of the run. An hour of quiet is not a stale
     case: a real queue holds an unresolved case for at least a shift, and
     the case can only be reviewed by someone who is looking at the time it
     happens to exist. Raising this does NOT change how many cases open, only
     how long an unreviewed one stays visible before it lapses unjudged. */
  const DISMISS_IDLE_SECONDS = 28800; // 8 sim-hours -- one shift of quiet

  const OPEN_STATUSES = new Set(['NEW', 'MONITORING', 'INVESTIGATING', 'ESCALATED']);
  const CLOSED_STATUSES = new Set(['CONFIRMED', 'DISMISSED', 'FALSE_POSITIVE', 'RESOLVED']);

  // Loose keyword associations used only to pick which real pattern an
  // MO resembles -- not a claim of equivalence.
  //
  // A row is allowed to be EMPTY only if the same type is declared in
  // TYPES_WITHOUT_VOCABULARY below with a reason. An empty row and a missing
  // row are the same thing to `PATTERN_KEYWORDS[t] || []` and they are not the
  // same fact (see that declaration).
  const PATTERN_KEYWORDS = {
    GPS_SIGNAL_LOST: ['gps', 'spoof', 'telemat', 'geofenc'],
    ROUTE_DEVIATION: ['gps', 'route', 'spoof', 'geofenc'],
    SEAL_MISMATCH: ['seal', 'trailer', 'cargo', 'pilferage'],
    TRAILER_SWAPPED: ['trailer', 'swap', 'cargo'],
    DRIVER_CHANGED: ['insider', 'collusion', 'driver', 'identity'],
    MANIFEST_CHANGED: ['manifest', 'document', 'phantom', 'broker'],
    UNEXPECTED_STOP: [],
    FALSE_MILESTONE_STAMP: ['document', 'consignment', 'proof of delivery', 'forgery', 'falsif'],
    CARRIER_UNRESPONSIVE: ['phantom', 'ghost', 'fictitious', 'carrier', 'non-existent'],
    EQUIPMENT_CARRIER_MISMATCH: ['impersonation', 'identity', 'takeover', 'hijack', 'operator'],
    DUPLICATE_ASSET_ID: ['spoof', 'telemat', 'position', 'gnss', 'tracker'],
    HANDOVER_GAP: ['pickup', 'collection', 'load theft', 'deception'],
    STAGED_BREAKDOWN: ['parking', 'roadside', 'curtain', 'truck stop']
  };

  /* CONVENTION 30, IN THE TABLE THAT DECIDES WHAT A CASE RESEMBLES.
     `PATTERN_KEYWORDS[s.type] || []` made three different things
     indistinguishable: a signal type this engine deliberately declines to vote
     on, a type nobody has written keywords for yet, and a typo. All three came
     out of `rankPatterns` as zero votes, which the panel renders as "No
     taxonomy pattern shares any keyword with this signal combination" and
     `classifyDiscovery` turns into EMERGING_BEHAVIOR, labelled "Unmatched by
     the taxonomy" -- an assertion about the taxonomy, made without consulting
     it, out of a gap in this engine's own vocabulary table.

     UNEXPECTED_STOP is the live one. Measured over five seeded 60-day runs, 3
     of 79 cases carry an UNEXPECTED_STOP signal, and every one of those had
     its resemblance voted over FEWER signal types than it holds, with nothing
     said (a subset figure must show its basis). The row is deliberate, so it
     is now declared as deliberate, with the reason, and the coverage is
     reported per case instead of vanishing. */
  const TYPES_WITHOUT_VOCABULARY = {
    UNEXPECTED_STOP: 'A stop is not distinctive vocabulary: every pattern in the taxonomy involves a vehicle ' +
      'stopping somewhere, so a keyword for it would vote for everything, which says the same as voting for nothing. ' +
      'This engine therefore declines to look this signal type up at all -- which is not the same as looking it up ' +
      'and finding nothing, and a case carrying one has its resemblance voted over fewer signal types than it holds.'
  };

  /* Throwing, both directions, at this module's load: every signal type the
     catalogue can issue must have a keyword row, no row may name a type the
     catalogue cannot issue, an empty row must be declared empty, and a
     declared-empty type must not also carry keywords. Without this the failure
     mode is silent and points the wrong way -- at the taxonomy. */
  function assertKeywordVocabularyDeclared(catalogTypes) {
    const rows = Object.keys(PATTERN_KEYWORDS);
    const declined = Object.keys(TYPES_WITHOUT_VOCABULARY);
    const missing = catalogTypes.filter(t => !Object.prototype.hasOwnProperty.call(PATTERN_KEYWORDS, t));
    if (missing.length) {
      throw new Error('moEngine.assertKeywordVocabularyDeclared: signal type(s) ' + missing.join(', ') +
        ' can be issued by the signal catalogue but have no keyword row here. They would fall through to an ' +
        'empty keyword list, contribute no vote, and be reported as the taxonomy documenting nothing like them');
    }
    const orphaned = rows.filter(t => catalogTypes.indexOf(t) < 0);
    if (orphaned.length) {
      throw new Error('moEngine.assertKeywordVocabularyDeclared: keyword row(s) for ' + orphaned.join(', ') +
        ' name signal types the catalogue cannot issue; dead vocabulary reads as coverage this engine does not have');
    }
    const undeclaredEmpty = rows.filter(t => !(PATTERN_KEYWORDS[t] || []).length && !TYPES_WITHOUT_VOCABULARY[t]);
    if (undeclaredEmpty.length) {
      throw new Error('moEngine.assertKeywordVocabularyDeclared: keyword row(s) for ' + undeclaredEmpty.join(', ') +
        ' are empty without being declared in TYPES_WITHOUT_VOCABULARY; an undeclared empty row is indistinguishable ' +
        'from an oversight and produces a claim about the taxonomy either way');
    }
    const contradicted = declined.filter(t => (PATTERN_KEYWORDS[t] || []).length);
    if (contradicted.length) {
      throw new Error('moEngine.assertKeywordVocabularyDeclared: type(s) ' + contradicted.join(', ') +
        ' are declared vocabulary-free and also carry keywords');
    }
    const declinedUnissuable = declined.filter(t => catalogTypes.indexOf(t) < 0);
    if (declinedUnissuable.length) {
      throw new Error('moEngine.assertKeywordVocabularyDeclared: type(s) ' + declinedUnissuable.join(', ') +
        ' are declared vocabulary-free but the catalogue cannot issue them');
    }
    return {
      catalogTypes: catalogTypes.length,
      withVocabulary: rows.filter(t => (PATTERN_KEYWORDS[t] || []).length).length,
      declinedTypes: declined.slice().sort()
    };
  }

  /* How much of a case's own signal vocabulary the resemblance vote was
     actually able to look up. Reported per case, so a resemblance derived from
     2 of a case's 3 signal types cannot read as one derived from all 3. */
  function vocabularyCoverage(signals) {
    const types = Array.from(new Set((signals || []).map(s => s.type))).sort();
    const unknown = types.filter(t => !Object.prototype.hasOwnProperty.call(PATTERN_KEYWORDS, t) && !TYPES_WITHOUT_VOCABULARY[t]);
    if (unknown.length) {
      throw new Error('moEngine.vocabularyCoverage: signal type(s) ' + unknown.join(', ') +
        ' have neither a keyword row nor a declared reason for having none; voting over them would report ' +
        'a gap in the taxonomy that is a gap in this engine');
    }
    const lookedUp = types.filter(t => (PATTERN_KEYWORDS[t] || []).length);
    const declined = types.filter(t => TYPES_WITHOUT_VOCABULARY[t]);
    return {
      types: types.length,
      lookedUp: lookedUp.length,
      lookedUpTypes: lookedUp,
      declined: declined.length,
      declinedTypes: declined,
      note: declined.length
        ? 'Resemblance is voted over ' + lookedUp.length + ' of the ' + types.length + ' signal type' +
          (types.length === 1 ? '' : 's') + ' on this case. ' +
          declined.map(t => TYPES_WITHOUT_VOCABULARY[t]).join(' ')
        : 'Voted over all ' + types.length + ' signal type' + (types.length === 1 ? '' : 's') +
          ' on this case; none was skipped.'
    };
  }

  function scoreSignals(signals) {
    return signals.reduce((sum, s) => sum + s.weight * s.reliability, 0);
  }

  /* THE NUMBER THIS WHOLE PANEL IS BUILT AROUND, AND IT USED TO WEAR A
     PERCENT SIGN. `rawScore` is a SUM of weight * reliability over the
     signals currently active on a case. Multiplying a sum by 12 and clamping
     it to 1-100 does not divide anything by anything, so there is no base and
     no denominator -- and rendered as `Confidence 78%` it reads as a
     probability that fraud occurred, which is the one claim this entire
     project exists to refuse. A percent sign is a denominator claim
     (rate/denominator discipline), and this number has none to make.

     So: same number, declared unit. It is an INDEX on a scale this engine
     defines, the multiplier is disclosed as calibration rather than a
     conversion into any real quantity, and both ends of the clamp are stated
     because past them the figure stops tracking the sum it comes from.

     The old comment here claimed "2 mid-weight signals should land WATCH/
     ELEVATED, a genuine chain of 4-5 should reach HIGH/CRITICAL". Three
     problems, all measurable: HIGH and CRITICAL stopped being bands in
     Slice 41 and are the taxonomy's harm classes; two mid-weight signals sum
     to about 2.7 and never clear CREATE_THRESHOLD at all, so no such case
     exists; and the lowest a case can OPEN is CREATE_THRESHOLD * the
     multiplier, which is mid-scale. The reachable range is computed below
     instead of described here, so it cannot drift again. */
  const INDEX_MIN = 1;
  const INDEX_MAX = 100;
  const INDEX_MULTIPLIER = 12;

  const CONFIDENCE_INDEX = {
    kind: 'PARAMETER',
    unit: 'index points on a declared ' + INDEX_MIN + '-' + INDEX_MAX + ' scale, not a percentage',
    displayLabel: 'Correlation index',
    scope: 'one case\'s currently-active signal set, within moEngine',
    derivedFrom: 'moEngine.scoreSignals -- the sum of weight * reliability over the signals still active on the case',
    model: 'that sum multiplied by ' + INDEX_MULTIPLIER + ', rounded, clamped to ' + INDEX_MIN + '-' + INDEX_MAX +
      '. The multiplier is calibration chosen so a case that just clears CREATE_THRESHOLD opens mid-scale; it converts the sum into nothing real.',
    means: 'how much active correlated signal weight this case currently carries, on a scale this engine defines and owns.',
    doesNotMean: 'a probability that fraud occurred, a percentage of anything, a share of any population, ' +
      'how much harm the resembled pattern would do, and not a finding that anything happened.',
    storedAs: 'mo.confidence -- the field name is historical; the quantity is this index, and mo.confidenceBand is the same number banded.',
    basis: 'the signals CURRENTLY ACTIVE on the case, not every signal the case was ever opened on. ' +
      'Signals decay out of the active set, so this index falls on its own with no analyst having checked anything ' +
      'and with nothing having been ruled out -- and it can fall below the sum that would open the case at all. ' +
      'A case whose index has fallen that way is resting on its evidence record, which only ever grows.',
    divides: null,
    denominator: 'none. The index divides nothing, so there is no rate here and no percent sign is warranted.',
    // Computed from the multiplier, never restated: the sum at which each end
    // of the clamp is reached. Past these the index is no longer a function of
    // its own source.
    saturatesAtRaw: INDEX_MAX / INDEX_MULTIPLIER,
    floorsAtRaw: INDEX_MIN / INDEX_MULTIPLIER,
    /* The bounds were named in three sentences above and declared as fields
       nowhere, so a reader of the declaration could not check a value against
       the scale it describes, and neither could formatIndex. Read from the
       constants, never typed in. */
    min: INDEX_MIN,
    max: INDEX_MAX
  };

  function confidenceFromScore(rawScore) {
    if (typeof rawScore !== 'number' || !isFinite(rawScore) || rawScore < 0) {
      throw new Error('moEngine.confidenceFromScore: no usable signal sum (' + rawScore +
        '); an index without a sum behind it would state support nobody derived');
    }
    return Math.max(INDEX_MIN, Math.min(INDEX_MAX, Math.round(rawScore * INDEX_MULTIPLIER)));
  }

  /* Both ends of the clamp are the Slice 42 shape: a derived figure that has
     stopped tracking its source and is still displayed. Signal sums of 8.4 and
     16.6 both print 100, so at the ceiling the index no longer distinguishes
     two cases that differ by a factor of two. Stated at the point of display,
     with the figure that DOES still distinguish them named, rather than
     printing a confident-looking 100 as if it were measured there. */
  function indexNote(rawScore) {
    const value = confidenceFromScore(rawScore);
    if (rawScore >= CONFIDENCE_INDEX.saturatesAtRaw) {
      return {
        value: value, saturated: true, floored: false,
        reason: 'at the ceiling of the scale: every signal sum at or above ' +
          CONFIDENCE_INDEX.saturatesAtRaw.toFixed(2) + ' prints ' + INDEX_MAX +
          ', so above it this index stops distinguishing cases. The active signal sum (' +
          rawScore.toFixed(2) + ') is the figure that still does.'
      };
    }
    if (rawScore <= CONFIDENCE_INDEX.floorsAtRaw) {
      return {
        value: value, saturated: false, floored: true,
        reason: 'at the floor of the scale: every signal sum at or below ' +
          CONFIDENCE_INDEX.floorsAtRaw.toFixed(2) + ' prints ' + INDEX_MIN +
          ', so below it this index stops distinguishing cases. The active signal sum (' +
          rawScore.toFixed(2) + ') is the figure that still does.'
      };
    }
    return { value: value, saturated: false, floored: false, reason: null };
  }

  // One canonical rendering of the index, so three panels cannot drift into
  // three units. The maximum is read from the declared scale, not typed in.
  function formatIndex(value) {
    if (typeof value !== 'number' || !isFinite(value)) {
      throw new Error('moEngine.formatIndex: nothing to format');
    }
    /* The output is "x / 100", and that slash is a claim: it says 100 is the
       scale x sits on. Checking only that x exists let formatIndex(250) print
       250 / 100, a figure over a denominator it had just violated, in the one
       function that exists so three panels cannot drift into three units. The
       clamp lives in confidenceFromScore, so no app caller could reach this --
       which is the reason it went unnoticed, not a reason to leave it. */
    if (value < INDEX_MIN || value > INDEX_MAX) {
      throw new Error('moEngine.formatIndex: ' + value + ' is off the declared ' + INDEX_MIN + '-' + INDEX_MAX +
        ' index scale, and this rendering prints ' + INDEX_MAX + ' as its denominator; a figure over a scale it ' +
        'is not on states a reading nobody derived');
    }
    return Math.round(value) + ' / ' + INDEX_MAX;
  }

  /* What the index scale can actually reach, measured rather than claimed. A
     case cannot open below CREATE_THRESHOLD * the multiplier, so some bands
     are unreachable at creation and are only reached by investigation findings
     moving the number DOWN. That is worth stating: it means a low band on a
     case is a result of record checks, not of a weak correlation. */
  function indexReach() {
    const openingFloor = confidenceFromScore(CREATE_THRESHOLD);
    const notAtCreation = CONFIDENCE_BAND.tokens.filter(b => {
      for (let v = openingFloor; v <= INDEX_MAX; v++) if (confidenceLabel(v) === b) return false;
      return true;
    });
    const unreachable = CONFIDENCE_BAND.tokens.filter(b => {
      for (let v = INDEX_MIN; v <= INDEX_MAX; v++) if (confidenceLabel(v) === b) return false;
      return true;
    });
    return {
      openingFloor: openingFloor,
      openingFloorBand: confidenceLabel(openingFloor),
      bandsNotReachableAtCreation: notAtCreation,
      bandsUnreachableAnywhere: unreachable,
      note: 'A case cannot open below index ' + openingFloor + ' (' + formatIndex(openingFloor) +
        '), because correlation will not open one below a signal sum of ' + CREATE_THRESHOLD +
        '. ' + (notAtCreation.length
          ? 'The band' + (notAtCreation.length === 1 ? ' ' : 's ') + notAtCreation.join(' and ') +
            ' are never reached by a newly opened case. They are reached afterwards, two ways that mean ' +
            'opposite things: an investigation finding that lowered the index, or the case\'s signals simply ' +
            'ageing out of the active set with nothing checked and nothing ruled out.'
          : 'Every band is reachable at creation.')
    };
  }

  /* WHAT THE INDEX IS COMPUTED OVER, which is not what the case holds. The
     evidence record only ever grows (mergeEvidence) while the index is
     recomputed from the signals still ACTIVE, so on the seeded run every open
     case reads a band BELOW the lowest a case can open at -- with zero record
     checks run and nothing ruled out. Read off the badge alone that looks like
     a weak case. It is a quiet case: the weight aged out.

     Those are opposite facts and the panels had no way to tell them apart, so
     the index now carries the count it was computed over against the count the
     case holds -- the same n / N discipline every rate in this app obeys, owed
     equally by a figure computed over a subset. */
  function indexBasis(mo) {
    const everCount = (mo.evidence || []).length;
    const activeCount = (mo.activeSignals || []).length;
    const sum = typeof mo.baseSignalSum === 'number' ? mo.baseSignalSum : null;
    const belowOpening = sum != null && sum < CREATE_THRESHOLD;
    const decayed = everCount - activeCount;
    return {
      activeCount: activeCount,
      everCount: everCount,
      decayedCount: decayed,
      signalSum: sum,
      belowOpeningSum: belowOpening,
      note: 'Computed over ' + activeCount + ' of the ' + everCount + ' signal' +
        (everCount === 1 ? '' : 's') + ' this case holds' +
        (decayed > 0
          ? ' \u2014 ' + decayed + ' ' + (decayed === 1 ? 'has' : 'have') +
            ' decayed out of the active set. A signal decaying stopped it counting toward the index; it did not stop it happening.'
          : '; none has decayed yet.') +
        (belowOpening
          ? ' The active sum (' + sum.toFixed(2) + ') is now below the ' + CREATE_THRESHOLD +
            ' that opens a case, so correlation would not open this one today. It stays open on its record, and a low index here is signals ageing out, not anything checked or ruled out.'
          : '')
    };
  }

  /* Declared in both directions, the Slice 39 pattern. A band nothing on the
     scale can reach would be dead vocabulary; a ceiling that is not the
     multiplier's own ceiling would mean the disclosed model and the code had
     parted company; and the investigation adjustment is added straight to this
     number, so its bounds have to be in the same unit and inside the same
     span or the two are not commensurable. */
  /* `index` exists so this guard can be pointed at a DOCTORED declaration. It
     read only module-private constants, so no caller could plant a violation
     and nothing had ever shown it capable of firing -- and a guard that has
     never fired is indistinguishable from a guard that cannot. Convention 34.
     Every caller in the app passes nothing and gets the real declaration. */
  function assertIndexScaleDeclared(index) {
    const CI = index || CONFIDENCE_INDEX;
    if (CI.saturatesAtRaw * INDEX_MULTIPLIER !== INDEX_MAX) {
      throw new Error('moEngine: the declared saturation sum does not multiply back to the scale maximum');
    }
    if (CI.floorsAtRaw * INDEX_MULTIPLIER !== INDEX_MIN) {
      throw new Error('moEngine: the declared floor sum does not multiply back to the scale minimum');
    }
    if (/%/.test(CI.unit)) {
      throw new Error('moEngine: the index unit must not be a percentage; nothing is divided');
    }
    if (!/CURRENTLY ACTIVE/.test(CI.basis)) {
      throw new Error('moEngine: the index must declare the signal set it is computed over, ' +
        'or a figure over a decayed subset reads as a figure over the whole case');
    }
    const reach = indexReach();
    if (reach.bandsUnreachableAnywhere.length) {
      throw new Error('moEngine: confidence band(s) ' + reach.bandsUnreachableAnywhere.join(', ') +
        ' cannot be reached anywhere on the index scale, so the vocabulary claims a distinction the number cannot make');
    }
    if (reach.openingFloorBand !== confidenceLabel(reach.openingFloor)) {
      throw new Error('moEngine: the stated opening band does not match the opening floor');
    }
    if (typeof window !== 'undefined' && window.FWInvestigationEngine) {
      const up = window.FWInvestigationEngine.MAX_UPWARD_ADJUSTMENT;
      const down = window.FWInvestigationEngine.MAX_DOWNWARD_ADJUSTMENT;
      const span = INDEX_MAX - INDEX_MIN;
      if (typeof up !== 'number' || typeof down !== 'number') {
        throw new Error('moEngine: the investigation adjustment bounds are not numbers, so their unit is undeclared');
      }
      if (up > span || Math.abs(down) > span) {
        throw new Error('moEngine: an investigation adjustment can move the index further than the whole scale spans, ' +
          'so the two are not on the same scale');
      }
    }
    return true;
  }

  /* A band over the confidence number, and nothing else. It used to be stored
     on the case as `severity` and printed beside the percentage as a second
     fact -- "Confidence 20%, severity LOW" -- when it is the same number said
     twice. Worse, three of its five tokens (LOW / HIGH / CRITICAL) were the
     taxonomy's own harm classes verbatim, so a case whose resembled pattern
     the taxonomy assesses as HIGH harm displayed "severity LOW" because the
     correlation was thin. How sure we are is not how bad it is; the field is
     `confidenceBand` and none of its tokens is a harm word.

     Tone stops at amber on purpose. A band is informational either way -- it
     says how much the signal sum supports opening the case, not that anything
     was established -- and red is this app's verdict colour. */
  const CONFIDENCE_BAND = {
    kind: 'PARAMETER',
    scope: 'band over this case\'s confidence number, within moEngine',
    means: 'how much the correlated signal sum supports keeping this case open.',
    doesNotMean: 'how much harm the pattern would do, the taxonomy severity of the pattern it resembles, and not a finding that anything occurred.',
    tokens: ['MINIMAL', 'WATCH', 'ELEVATED', 'SUBSTANTIAL', 'STRONG'],
    tone: {
      MINIMAL:     'bg-slate-700 text-slate-200',
      WATCH:       'bg-sky-900 text-sky-300',
      ELEVATED:    'bg-sky-800 text-sky-200',
      SUBSTANTIAL: 'bg-amber-900 text-amber-300',
      STRONG:      'bg-amber-800 text-amber-200'
    }
  };

  function confidenceLabel(score) {
    if (typeof score !== 'number' || !isFinite(score)) {
      throw new Error('moEngine.confidenceLabel: no numeric confidence to band; a band would state support nobody derived');
    }
    /* The bands are an ordered chain of absolute thresholds over the declared
       index scale, so anything above the last threshold used to receive STRONG
       and anything below the first used to receive MINIMAL -- by falling off
       the end of the chain, not by being on the scale. A band is read as a
       statement about a case; a band assigned to a figure that is not on the
       scale the bands partition is that statement made about nothing. */
    if (score < INDEX_MIN || score > INDEX_MAX) {
      throw new Error('moEngine.confidenceLabel: ' + score + ' is off the declared ' + INDEX_MIN + '-' + INDEX_MAX +
        ' index scale these bands partition; the chain of thresholds would band it anyway, which would state ' +
        'support nobody derived');
    }
    if (score <= 20) return 'MINIMAL';
    if (score <= 40) return 'WATCH';
    if (score <= 60) return 'ELEVATED';
    if (score <= 80) return 'SUBSTANTIAL';
    return 'STRONG';
  }

  /* Measured in Slice 62: every band confidenceLabel can return has a declared
     tone, and both call sites pass mo.confidenceBand, which only confidenceLabel
     ever writes. So no value existing at run time can reach this throw. It is
     not a run-time guard and must not be counted as one -- it is a detector for
     a future edit that adds a sixth band and forgets its colour, which is a real
     thing to catch and a different claim. Registered as CHANGE_DETECTOR in
     FWRenderGuards. */
  function bandTone(band) {
    const tone = CONFIDENCE_BAND.tone[band];
    if (!tone) {
      throw new Error('moEngine.bandTone: no tone declared for band "' + band + '"');
    }
    return tone;
  }

  /* Both directions, the Slice 39 pattern: a confidence band that is also a
     taxonomy harm class would be read as harm, and a harm class this app has
     no colour for would reach a badge unstyled. Runs once, the first time a
     case is created with the taxonomy present -- the taxonomy arrives async,
     so a load-time IIFE here would check nothing. */
  let scopesChecked = false;
  function assertBandScopeDistinct(severityTokens) {
    const harm = (severityTokens || []).map(t => String(t).toUpperCase());
    CONFIDENCE_BAND.tokens.forEach(b => {
      if (harm.indexOf(b) >= 0) {
        throw new Error('moEngine: confidence band "' + b + '" is also a taxonomy harm class; ' +
          'the same word for how sure and how bad is how "severity LOW" came to be printed on a HIGH-harm pattern');
      }
      if (!CONFIDENCE_BAND.tone[b]) {
        throw new Error('moEngine: band "' + b + '" has no declared tone');
      }
    });
    Object.keys(CONFIDENCE_BAND.tone).forEach(b => {
      if (CONFIDENCE_BAND.tokens.indexOf(b) < 0) {
        throw new Error('moEngine: tone declared for "' + b + '", which is not a confidence band');
      }
    });
    return true;
  }

  function checkScopesOnce() {
    if (scopesChecked) return;
    if (typeof FW === 'undefined' || !FW.severityScale) return;
    const scale = FW.severityScale();
    if (!scale) return;
    assertBandScopeDistinct(scale.tokens);
    assertIndexScaleDeclared();
    scopesChecked = true;
  }

  // Returns every taxonomy pattern with at least one keyword vote,
  // sorted strongest match first, so buildMo can pick the best while
  // also keeping runners-up for "related historical patterns."
  /* A "KEYWORD VOTE" THAT COUNTED SIGNALS, NOT KEYWORDS. The loop ran over
     every signal INSTANCE, so two copies of one signal type voted twice for the
     same keywords and the panel printed the doubled figure verbatim as
     "N keyword votes" beside a pattern name. A vote count labelled by keyword
     has to be a count of keywords.

     Measured over five seeded 60-day runs: 4 of 79 cases rendered a top vote
     count above their own distinct vocabulary overlap, worst case printing 11
     where 6 keywords were shared, the other 5 being one signal type observed
     twice. It also moved cases across a classification boundary -- one
     SEAL_MISMATCH scores 2 and classifies POTENTIAL_NEW_MO, two copies of that
     same signal scored 4 and classified MO_VARIANT, whose declared meaning is
     "shares several keywords with a documented pattern". Nothing extra was
     shared; the blip repeated. This module's own header says a repeated blip is
     not a chain and the creation gate enforces it -- the classifier did not.

     Votes are now distinct keywords of the case's distinct signal types, so the
     figure is stable under repetition and the label is true. The keywords
     themselves are returned, so the count can be checked against the thing it
     counts rather than trusted. */
  const VOTE_BASIS = {
    kind: 'PARAMETER',
    unit: 'distinct keywords shared, counted once each',
    scope: 'the distinct signal types on the case, voted against each pattern\'s name, category and aliases',
    means: 'how much vocabulary this pattern shares with the kinds of signal observed.',
    doesNotMean: 'a number of signals, a similarity score, a probability, a share of anything, and not a count of ' +
      'matching documented indicators -- this engine never reads a pattern\'s indicators.',
    countsRepeatedSignals: false
  };

  /* Checked once, from the program's own path, against the catalogue this engine
     votes on -- both directions. Slice 55 put the same shape in behaviorEngine
     for the cause catalogue; the reason is identical, the failure is silent and
     it points at the wrong artefact.

     Done lazily rather than at load, because a module that throws when a sibling
     is absent cannot be loaded on its own and three suites do exactly that. But
     a check that can be skipped is a check nobody can rely on, so being skipped
     is RECORDED and readable: `vocabularyCheckState()` distinguishes "checked
     and clean" from "never ran because the catalogue was not there", which is
     the difference between an assurance and the absence of one. Called from
     rankPatterns, so nothing can vote on a keyword table that was never
     reconciled. */
  let vocabularyChecked = false;

  function checkVocabularyOnce() {
    if (vocabularyChecked) return true;
    if (typeof FWSignalEngine === 'undefined' || !FWSignalEngine || !FWSignalEngine.SIGNAL_CATALOG) return false;
    assertKeywordVocabularyDeclared(Object.keys(FWSignalEngine.SIGNAL_CATALOG));
    vocabularyChecked = true;
    return true;
  }

  function vocabularyCheckState() {
    return vocabularyChecked
      ? { state: 'CHECKED', note: 'The keyword table has been reconciled against the signal catalogue, both directions.' }
      : { state: 'NOT_CHECKED_CATALOGUE_ABSENT', note: 'The keyword table has NOT been reconciled: the signal ' +
          'catalogue was not available when this engine last tried. That is the absence of a check, not a clean one.' };
  }

  function rankPatterns(signals) {
    if (typeof FW === 'undefined' || !FW.patterns) return [];
    const patterns = FW.patterns();
    if (!patterns || !patterns.length) return [];

    checkVocabularyOnce();
    const types = Array.from(new Set((signals || []).map(s => s.type)));
    // Not `PATTERN_KEYWORDS[t] || []`. That fallback is what made an undeclared
    // type indistinguishable from a deliberately vocabulary-free one, and both
    // came out as the taxonomy documenting nothing like this case.
    const undeclared = types.filter(t => !Object.prototype.hasOwnProperty.call(PATTERN_KEYWORDS, t) && !TYPES_WITHOUT_VOCABULARY[t]);
    if (undeclared.length) {
      throw new Error('moEngine.rankPatterns: signal type(s) ' + undeclared.join(', ') +
        ' have no declared keyword row and are not declared vocabulary-free. Voting over them silently would ' +
        'return no resemblance, which this engine reports as a gap in the taxonomy when it is a gap here');
    }
    const hits = new Map();   // pattern id -> Set of distinct keywords matched
    types.forEach(t => {
      (PATTERN_KEYWORDS[t] || []).forEach(kw => {
        patterns.forEach(p => {
          const hay = `${p.name} ${p.category} ${(p.aliases || []).join(' ')}`.toLowerCase();
          if (hay.includes(kw)) {
            if (!hits.has(p.id)) hits.set(p.id, new Set());
            hits.get(p.id).add(kw);
          }
        });
      });
    });
    return Array.from(hits.entries())
      .map(([id, kws]) => ({ pattern: patterns.find(p => p.id === id), votes: kws.size, keywords: Array.from(kws).sort() }))
      .filter(r => r.pattern)
      // Ties were broken by Map insertion order, i.e. by which signal arrived
      // first -- an arrival accident deciding which pattern a case is titled
      // after. Broken by pattern id instead, so it is at least declared.
      .sort((a, b) => b.votes - a.votes || a.pattern.id.localeCompare(b.pattern.id));
  }

  function matchPattern(signals) {
    const ranked = rankPatterns(signals);
    return ranked.length ? ranked[0].pattern : null;
  }

  // Sorted, de-duplicated signal-type fingerprint -- the unit the
  // discovery engine tracks recurrence/novelty against.
  function signalSignature(signals) {
    return Array.from(new Set(signals.map(s => s.type))).sort().join('+');
  }

  /* One table, owned here, for the four discovery classes. Both panels kept
     their own copy of the label map AND the colour map, each falling back
     silently on an unknown class -- the Slice 33/35/39 shape twice over.

     EMERGING_BEHAVIOR was rose (this app's alarm family) because the case
     resembles nothing documented. Resembling nothing is a gap in the
     taxonomy's coverage, not a worse case, so it is coloured like the other
     structural facts and says so. */
  const CLASSIFICATION = {
    KNOWN_MO: {
      label: 'Known MO',
      tally: 'resembling a documented pattern that has recurred',
      tone: 'bg-slate-700 text-slate-300',
      means: 'this signal combination has recurred enough times to be familiar in this simulation.'
    },
    MO_VARIANT: {
      label: 'New Variant',
      tally: 'resembling a documented pattern, first sighting of this combination',
      tone: 'bg-indigo-900 text-indigo-300',
      means: 'first sighting of this combination, but it shares several keywords with a documented pattern.'
    },
    POTENTIAL_NEW_MO: {
      label: 'Potential New MO',
      tally: 'seen too few times for the count to say either way',
      tone: 'bg-fuchsia-900 text-fuchsia-300',
      means: 'seen too few times for the recurrence count to say anything either way.'
    },
    EMERGING_BEHAVIOR: {
      label: 'Unmatched by the taxonomy',
      tally: 'matching no documented pattern',
      tone: 'bg-slate-700 text-slate-300',
      means: 'no documented pattern shares a keyword with this combination. That is the extent of the taxonomy here, not a finding that this is worse.'
    }
  };
  const CLASSIFICATIONS = Object.keys(CLASSIFICATION);

  function classificationEntry(cls) {
    const e = CLASSIFICATION[cls];
    if (!e) {
      throw new Error('moEngine: no declared discovery class "' + cls + '"; a label and a colour would have to be invented for it');
    }
    return e;
  }
  function classificationLabel(cls) { return classificationEntry(cls).label; }
  function classificationTone(cls) { return classificationEntry(cls).tone; }
  /* Wording used when COUNTING cases, kept separate from the badge label so a
     tally can never assert that a case is the pattern it resembles. */
  function classificationTally(cls) { return classificationEntry(cls).tally; }

  /* THE BADGE ON EVERY CASE RESTED ON TWO BARE 3s OF DIFFERENT UNITS, AND ONE
     OF THE FOUR CLASSES MEANT TWO UNRELATED THINGS.

     `classifyDiscovery` read `topVotes >= 3` and `priorCount < 3`. The first 3
     is a count of distinct shared KEYWORDS, the second a count of prior
     SIGHTINGS; they are not the same unit, neither is derived from the other,
     and nothing said either number out loud. Slice 56 declared what a vote IS
     while leaving the thresholds ON it undeclared, which is half a
     declaration.

     Measured over 87 cases across five seeded 60-day runs, the open-time top
     vote took only the values 2, 5 and 6 -- never 3 and never 4. A floor of 3,
     4 or 5 therefore issues exactly the same badges (38 variant / 11 potential
     on first sightings), a floor of 1 makes the thin-vocabulary branch
     unreachable outright -- a ranked pattern always shares at least one keyword
     -- a floor of 2 empties it across every case observed, and 6 flips 25 of
     the 38. The number is calibration sitting
     in a gap in the OBSERVED distribution, not a boundary anything measured.
     Both populations are computed live rather than restated from this comment:
     `voteFloorEquivalence()` over every combination the catalogue allows, where
     the floor does separate because every vote value from 1 to 6 is reachable,
     and `observedVoteFloorEquivalence(engine)` over the cases actually in hand,
     where it does not. Those two answers disagree, which is exactly why naming
     the population is not optional.

     The sharper defect: POTENTIAL_NEW_MO was issued for TWO different reasons
     -- a first sighting whose vocabulary overlap fell below the vote floor (11
     of 87) and a combination seen once or twice before regardless of its
     overlap (34 of 87) -- and its declared meaning only ever described the
     second ("seen too few times for the recurrence count to say anything
     either way"). 27 of 87 cases carried that label while sharing 5 or 6
     keywords with a documented pattern, i.e. while satisfying the variant
     branch on vocabulary alone. Same badge, two incompatible facts, no way for
     a reader to tell which one they were looking at. The class distribution is
     deliberately unchanged; what is added is the REASON, declared and
     rendered, so the two are distinguishable in the panel and not only in the
     code. */
  const DISCOVERY_THRESHOLDS = {
    kind: 'PARAMETER',
    scope: 'the discovery class badge, within moEngine',
    variantVoteFloor: 3,
    variantVoteUnit: VOTE_BASIS.unit,
    variantVoteMeans: 'at or above this many distinct keywords shared with the top-ranked documented pattern, a ' +
      'first sighting is called a variant of that pattern rather than left unplaced.',
    variantVoteAppliesWhen: 'the first sighting of a combination only. A combination seen before is classified by ' +
      'its sighting count, not by its vocabulary, so this floor is not consulted at all on those cases.',
    familiarSightings: 3,
    familiarSightingsUnit: 'prior sightings of the same signal-type combination, as the case opened',
    familiarSightingsMeans: 'at or above this many prior sightings, the combination is called familiar in this ' +
      'simulation run.',
    doesNotMean: 'neither number is a probability, a score, a share, a significance level or a minimum sample ' +
      'size; "familiar" is not a claim the combination is understood, and a variant is a resemblance in ' +
      'vocabulary, not a finding of relatedness.',
    sharedLiteral: 'Both thresholds are the number 3 by coincidence. They count different things -- keywords and ' +
      'sightings -- and changing one says nothing about the other. They are declared separately so the ' +
      'coincidence cannot be read as one calibration.',
    calibratedBy: 'ASSUMED. Neither floor was fitted to anything. The vote floor was chosen inside a gap in the ' +
      'observed vote distribution, so a range of values behaves identically; the sighting floor is the smallest ' +
      'count at which "recurred" reads as more than a repeat.'
  };

  /* Which fact produced the badge. A class is not a reason: two of these
     issue the same class from opposite evidence, and a panel that prints only
     the class cannot say which. Declared as a table so a reason can never be
     invented at a call site, and reconciled against CLASSIFICATION below. */
  const CLASSIFICATION_REASONS = {
    NO_RESEMBLANCE: {
      issues: 'EMERGING_BEHAVIOR',
      note: 'no documented pattern shares a single keyword with any of this case\u2019s signal types.'
    },
    VOCABULARY_SHARED_AT_FIRST_SIGHTING: {
      issues: 'MO_VARIANT',
      note: 'first sighting of this combination, and its vocabulary overlap with the top-ranked pattern is at or ' +
        'above the declared floor.'
    },
    VOCABULARY_THIN_AT_FIRST_SIGHTING: {
      issues: 'POTENTIAL_NEW_MO',
      note: 'first sighting of this combination, and its vocabulary overlap with the top-ranked pattern is below ' +
        'the declared floor. This is a statement about shared words, not about how often it has been seen.'
    },
    TOO_FEW_SIGHTINGS: {
      issues: 'POTENTIAL_NEW_MO',
      note: 'seen before but fewer times than the familiarity floor, so the sighting count says nothing either ' +
        'way. Its vocabulary overlap may be wide; on this branch it was not consulted.'
    },
    SIGHTINGS_AT_OR_ABOVE_FLOOR: {
      issues: 'KNOWN_MO',
      note: 'this combination has recurred at or above the familiarity floor in this run. Familiar, which is not ' +
        'the same as understood.'
    }
  };
  const CLASSIFICATION_REASON_KEYS = Object.keys(CLASSIFICATION_REASONS);

  /* Reconciled at load: this table has no dependency outside the module, so it
     cannot make moEngine unloadable on its own (Slice 56's lesson). Both
     directions -- a reason issuing an undeclared class, and a class no reason
     can issue, which would be a badge nothing produces. */
  function assertClassificationReasonsDeclared(reasons, classes) {
    const R = reasons || CLASSIFICATION_REASONS;
    const RK = Object.keys(R);
    const CLS = classes || CLASSIFICATION;
    const CLSK = Object.keys(CLS);
    RK.forEach(r => {
      const cls = R[r].issues;
      if (!CLS[cls]) {
        throw new Error('moEngine: classification reason ' + r + ' issues "' + cls + '", which is not a declared ' +
          'discovery class; the badge would have no label and no colour');
      }
    });
    const unreasoned = CLSK.filter(c => !RK.some(r => R[r].issues === c));
    if (unreasoned.length) {
      throw new Error('moEngine: discovery class(es) ' + unreasoned.join(', ') + ' can be issued by no declared ' +
        'reason; a class no branch produces is a bucket that can only ever read zero');
    }
    return true;
  }
  assertClassificationReasonsDeclared();

  function classificationReasonEntry(reason) {
    const e = CLASSIFICATION_REASONS[reason];
    if (!e) {
      throw new Error('moEngine: no declared classification reason "' + reason + '"; the badge would state a fact ' +
        'nothing here defines');
    }
    return e;
  }

  /* The class AND the fact that produced it, with the thresholds that were
     actually consulted on this case -- `voteFloorConsulted` is false on every
     recurrence branch, because the floor genuinely plays no part there and a
     panel that showed it would imply otherwise. */
  function classifyDiscoveryDetail(ranked, priorCount) {
    if (typeof priorCount !== 'number' || !isFinite(priorCount) || priorCount < 0) {
      throw new Error('moEngine.classifyDiscoveryDetail: no prior-sighting count to classify against');
    }
    const list = ranked || [];
    const topVotes = list.length ? list[0].votes : 0;
    const keywords = list.length ? (list[0].keywords || []) : [];
    let reason;
    if (!list.length) reason = 'NO_RESEMBLANCE';
    else if (priorCount === 0) {
      reason = topVotes >= DISCOVERY_THRESHOLDS.variantVoteFloor
        ? 'VOCABULARY_SHARED_AT_FIRST_SIGHTING'
        : 'VOCABULARY_THIN_AT_FIRST_SIGHTING';
    } else if (priorCount < DISCOVERY_THRESHOLDS.familiarSightings) reason = 'TOO_FEW_SIGHTINGS';
    else reason = 'SIGHTINGS_AT_OR_ABOVE_FLOOR';
    const entry = classificationReasonEntry(reason);
    const voteConsulted = reason === 'VOCABULARY_SHARED_AT_FIRST_SIGHTING' || reason === 'VOCABULARY_THIN_AT_FIRST_SIGHTING';
    return {
      classification: entry.issues,
      reason: reason,
      reasonNote: entry.note,
      topVotes: topVotes,
      topKeywords: keywords.slice(),
      priorCount: priorCount,
      voteFloorConsulted: voteConsulted,
      voteFloor: voteConsulted ? DISCOVERY_THRESHOLDS.variantVoteFloor : null,
      voteFloorUnit: voteConsulted ? DISCOVERY_THRESHOLDS.variantVoteUnit : null,
      sightingFloorConsulted: !voteConsulted && reason !== 'NO_RESEMBLANCE',
      sightingFloor: DISCOVERY_THRESHOLDS.familiarSightings,
      declaredBy: 'moEngine.DISCOVERY_THRESHOLDS'
    };
  }

  function classifyDiscovery(ranked, priorCount) {
    return classifyDiscoveryDetail(ranked, priorCount).classification;
  }

  /* How much work the vote floor is doing, computed from the live tables
     instead of from the paragraph above. Every combination of
     MIN_SIGNAL_TYPES catalogued types is ranked, and the floors that would
     partition those combinations identically to the declared one are listed:
     if that list has more than one member, the exact value is arbitrary
     within it, and saying so is the difference between a calibration and a
     number that looks measured. */
  function voteFloorEquivalence() {
    const catalog = (typeof FWSignalEngine !== 'undefined' && FWSignalEngine && FWSignalEngine.SIGNAL_CATALOG)
      ? Object.keys(FWSignalEngine.SIGNAL_CATALOG)
      : null;
    if (!catalog || typeof FW === 'undefined' || !FW.patterns || !(FW.patterns() || []).length) {
      return {
        known: false,
        note: 'How much the vote floor discriminates is not computable here: it needs the signal catalogue and the ' +
          'loaded taxonomy. Not knowing is reported rather than assumed.'
      };
    }
    const seen = [];
    for (let i = 0; i < catalog.length; i++) {
      for (let j = i + 1; j < catalog.length; j++) {
        const r = rankPatterns([{ type: catalog[i] }, { type: catalog[j] }]);
        seen.push(r.length ? r[0].votes : 0);
      }
    }
    const floor = DISCOVERY_THRESHOLDS.variantVoteFloor;
    const above = seen.filter(v => v >= floor).length;
    const equivalent = [];
    const maxSeen = seen.length ? Math.max.apply(null, seen) : 0;
    for (let f = 1; f <= maxSeen + 1; f++) {
      if (seen.filter(v => v >= f).length === above) equivalent.push(f);
    }
    return {
      known: true,
      combinationsTested: seen.length,
      combinationSize: MIN_SIGNAL_TYPES,
      votesObserved: Array.from(new Set(seen)).sort((a, b) => a - b),
      floor: floor,
      atOrAboveFloor: above,
      belowFloor: seen.length - above,
      equivalentFloors: equivalent,
      population: 'every combination of ' + MIN_SIGNAL_TYPES + ' catalogued signal types \u2014 the space a case ' +
        'could open on, not the cases that have actually opened',
      note: 'Over the ' + seen.length + ' combination' + (seen.length === 1 ? '' : 's') + ' of ' + MIN_SIGNAL_TYPES +
        ' catalogued signal types \u2014 the reachable space, not the observed cases \u2014 ' + above +
        ' reach the vote floor of ' + floor + ' and ' + (seen.length - above) + ' do not. ' +
        (equivalent.length > 1
          ? 'Any floor in {' + equivalent.join(', ') + '} partitions them identically, so within that range the ' +
            'exact value changes nothing: it is a declared choice, not a boundary in the data.'
          : 'No other floor partitions them the same way, so on this population the value does discriminate. ' +
            'That is a fact about the reachable space; whether it discriminates among the cases actually opened ' +
            'is a different question, answered over that population.')
    };
  }

  /* The same question asked of the cases that actually opened, which is a
     different population from the reachable space above and can give the
     opposite answer -- and did: every pair of catalogued types is separated by
     the floor, while the top vote of a real case has only ever come out 2, 5
     or 6, so 3, 4 and 5 issue identical badges. A threshold that discriminates
     in principle and not in practice is still a declared choice, and both
     populations have to be visible for that to be readable. Computed from the
     cases in hand rather than from the paragraph. */
  function observedVoteFloorEquivalence(engine) {
    const mos = engine && engine.mos ? Array.from(engine.mos.values()) : [];
    const votes = mos
      .filter(mo => mo.classificationDetail && typeof mo.classificationDetail.topVotes === 'number')
      .map(mo => mo.classificationDetail.topVotes);
    if (!votes.length) {
      return {
        known: false,
        cases: mos.length,
        note: 'How much the vote floor separates the cases in hand is not computable: none of the ' + mos.length +
          ' case' + (mos.length === 1 ? '' : 's') + ' carries a recorded vote. Not knowing is reported, not assumed.'
      };
    }
    const floor = DISCOVERY_THRESHOLDS.variantVoteFloor;
    const above = votes.filter(v => v >= floor).length;
    const maxSeen = Math.max.apply(null, votes);
    const equivalent = [];
    for (let f = 1; f <= maxSeen + 1; f++) {
      if (votes.filter(v => v >= f).length === above) equivalent.push(f);
    }
    const observed = Array.from(new Set(votes)).sort((a, b) => a - b);
    return {
      known: true,
      cases: votes.length,
      population: 'the cases open in this run that carry a recorded vote',
      votesObserved: observed,
      floor: floor,
      atOrAboveFloor: above,
      belowFloor: votes.length - above,
      equivalentFloors: equivalent,
      note: 'Across the ' + votes.length + ' case' + (votes.length === 1 ? '' : 's') + ' in hand the top vote has ' +
        'taken the value' + (observed.length === 1 ? ' ' : 's ') + observed.join(', ') + ', and ' + above + ' of them ' +
        'reach the floor of ' + floor + '. ' +
        (equivalent.length > 1
          ? 'Any floor in {' + equivalent.join(', ') + '} would put exactly the same cases on each side, so on this ' +
            'population the exact value separates nothing further.'
          : 'No other floor separates these cases the same way.')
    };
  }

  /* THE ONE CLASS THAT ADMITS THE TAXONOMY DOES NOT COVER A CASE, AND NO CASE
     COULD EVER CARRY IT. `classifyDiscovery` returns EMERGING_BEHAVIOR only
     when `ranked.length === 0`, i.e. when NOT ONE of the case's signal types
     produces a keyword vote. Exactly one of the catalogue's 13 signal types
     does that (UNEXPECTED_STOP, the declared vocabulary-free row), and a case
     cannot open below MIN_SIGNAL_TYPES distinct types -- so an all-silent case
     is arithmetically impossible. Measured: 79 cases over five seeded 60-day
     runs, EMERGING_BEHAVIOR issued 0 times, every single case told it resembles
     something documented.

     That is the humility branch of this engine. Its bucket read 0 in the
     discovery panel next to three populated ones, which reads as "no such case
     has come up yet" -- an observation. It is not an observation, it is a
     structural impossibility, and those are opposite facts about the same zero
     (a zero that cannot happen is not a zero that has not happened).

     Computed from the live tables rather than asserted from a count, so it
     cannot go stale: add keywords to UNEXPECTED_STOP, or a second
     vocabulary-free type, and this answer changes on its own. It is REPORTED,
     not thrown, because an unreachable humility class is a fact about the
     current tables that the panel must state -- suppressing it by throwing
     would hide it. */
  function classificationReach() {
    const catalog = (typeof FWSignalEngine !== 'undefined' && FWSignalEngine && FWSignalEngine.SIGNAL_CATALOG)
      ? Object.keys(FWSignalEngine.SIGNAL_CATALOG)
      : null;
    if (!catalog || typeof FW === 'undefined' || !FW.patterns || !(FW.patterns() || []).length) {
      return {
        known: false,
        unissuable: [],
        note: 'Which discovery classes can be issued is not computable here: it depends on the signal catalogue and ' +
          'the loaded taxonomy, and one of them is not available. Not knowing is being reported rather than guessed.'
      };
    }
    const silent = catalog.filter(t => rankPatterns([{ type: t }]).length === 0).sort();
    const emergingIssuable = silent.length >= MIN_SIGNAL_TYPES;
    const unissuable = emergingIssuable ? [] : ['EMERGING_BEHAVIOR'];
    return {
      known: true,
      catalogTypes: catalog.length,
      silentTypes: silent,
      minSignalTypes: MIN_SIGNAL_TYPES,
      unissuable: unissuable,
      note: emergingIssuable
        ? 'All ' + CLASSIFICATIONS.length + ' discovery classes can be issued: ' + silent.length +
          ' signal type' + (silent.length === 1 ? '' : 's') + ' share no keyword with anything documented, and a case needs ' +
          MIN_SIGNAL_TYPES + ' distinct types, so a case with no resemblance at all is reachable.'
        : '\u201c' + CLASSIFICATION.EMERGING_BEHAVIOR.label + '\u201d cannot be issued at all under the current tables. ' +
          'It requires every signal type on the case to share no keyword with any documented pattern, and only ' + silent.length +
          ' of the ' + catalog.length + ' catalogued type' + (catalog.length === 1 ? '' : 's') + ' does (' +
          (silent.join(', ') || 'none') + '), while a case cannot open on fewer than ' + MIN_SIGNAL_TYPES +
          ' distinct types. So its count is zero because no case can carry it, not because none has been seen ' +
          '\u2014 and every case in this run is therefore told it resembles a documented pattern.'
    };
  }

  /* This is `recurrenceCount` restated on a 0-100 axis and nothing else -- the
     same collapse Slice 41 found in `severity`. Two panels printed it beside
     the count as a second fact, one of them as "novelty 100/100", which is
     share-shaped: nothing was divided, there is no base, and the 18-per-
     sighting step and the floor are calibration, not measurement.

     The floor matters most. From FLOOR_FROM prior sightings on, the number is
     pinned and a combination seen 6 times reads identically to one seen 40.
     Past that point the number has stopped tracking what it is derived from,
     so `noveltyNote` REFUSES it rather than letting a stale 5 keep being
     displayed as if it still distinguished anything. */
  const RECURRENCE_NOVELTY = {
    kind: 'PARAMETER',
    scope: 'restatement of recurrenceCount, within moEngine',
    derivedFrom: 'recurrenceCount',
    means: 'the prior-sighting count, mapped onto a 0-100 axis; it carries no information the count does not.',
    doesNotMean: 'a share of anything, a probability, and not a second measurement alongside the count.',
    step: 18,
    floor: 5,
    max: 100
  };
  RECURRENCE_NOVELTY.FLOOR_FROM = Math.ceil((RECURRENCE_NOVELTY.max - RECURRENCE_NOVELTY.floor) / RECURRENCE_NOVELTY.step);

  function noveltyFromRecurrence(priorCount) {
    if (typeof priorCount !== 'number' || !isFinite(priorCount) || priorCount < 0) {
      throw new Error('moEngine.noveltyFromRecurrence: no prior-sighting count to restate');
    }
    return Math.max(RECURRENCE_NOVELTY.floor, RECURRENCE_NOVELTY.max - priorCount * RECURRENCE_NOVELTY.step);
  }

  function noveltyIsFloored(priorCount) {
    return priorCount >= RECURRENCE_NOVELTY.FLOOR_FROM;
  }

  /* What a panel prints instead of a bare number. `value` is null once the
     figure has stopped distinguishing sightings -- a refusal, not a gap. */
  function noveltyNote(priorCount) {
    if (noveltyIsFloored(priorCount)) {
      return {
        value: null,
        note: 'Novelty is not reported: at ' + RECURRENCE_NOVELTY.FLOOR_FROM + ' or more prior sightings this figure is ' +
          'pinned at its floor and no longer distinguishes ' + RECURRENCE_NOVELTY.FLOOR_FROM + ' from any larger count. ' +
          'The sighting count itself is the figure that still means something.'
      };
    }
    return {
      value: noveltyFromRecurrence(priorCount),
      note: 'the sighting count restated on a 0-' + RECURRENCE_NOVELTY.max + ' axis, not a second measurement'
    };
  }

  /* THE HEADING SAID DIFFERENCES AND THE LIST STATED RESEMBLANCE. This
     function fed a panel section titled "What makes this different", and
     every sentence it produced was a resemblance sentence -- "Resembles
     Double Brokering but this exact combination hasn't recurred (yet)". No
     difference between the case and the pattern was computed, because nothing
     in this engine compares the case's signal types against the pattern's
     documented indicators; matching is a keyword vote over the pattern's
     name, category and aliases. Two claims under one heading.

     Worse, a KNOWN_MO returned an empty array, and the panel drops an empty
     section entirely -- so the case most strongly associated with a documented
     pattern was the one with NOTHING said about how it differs from it, and
     silence there reads as "no differences", which is identity. That is the
     Slice 40 shape: an absent record rendered as an absence of the thing.

     So the notes say what they are, the refusal below owns the difference
     question, and no classification gets silence. */
  const RESEMBLANCE_NOTES = {
    kind: 'PARAMETER',
    scope: 'how this case relates to documented taxonomy patterns, within moEngine',
    derivedFrom: 'rankPatterns -- one vote per DISTINCT keyword shared with each pattern\'s name, category and aliases, ' +
      'counted over the case\'s distinct signal types, so a signal type observed twice does not vote twice',
    means: 'which documented patterns share vocabulary with the kinds of signal observed, strongest first.',
    doesNotMean: 'that the case is an instance of any of them, that its signals are the pattern\'s documented indicators, and not a difference between the two.',
    REFUSED: {
      figure: 'How this case differs from the pattern it resembles',
      why: 'Nothing here compares the case\'s signal types against the pattern\'s documented indicators. ' +
        'Resemblance is a keyword vote over the pattern\'s name, category and aliases, and a vote count cannot ' +
        'produce a difference. A section headed "What makes this different" listing resemblance sentences stated ' +
        'a comparison nobody made.'
    }
  };

  function resemblanceNotes(ranked, classification) {
    if (!ranked || !ranked.length) {
      return ['No documented pattern shares a keyword with this signal combination \u2014 zero votes, ' +
        'which is a gap in what the taxonomy\'s vocabulary covers, not a finding that the behaviour is new. ' +
        RESEMBLANCE_NOTES.REFUSED.why];
    }
    const top = ranked[0];
    const names = ranked.slice(1, 3).map(r => r.pattern.name);
    const notes = [];
    if (classification === 'KNOWN_MO') {
      notes.push('This signal combination has recurred, and shares most vocabulary with ' + top.pattern.name +
        ' (' + top.votes + ' shared keyword' + (top.votes === 1 ? '' : 's') + '). Recurrence is a fact about this simulation\'s own history, ' +
        'not about the pattern.');
    } else {
      notes.push('Shares most vocabulary with ' + top.pattern.name + ' (' + top.votes + ' shared keyword' +
        (top.votes === 1 ? '' : 's') + '). This exact combination of signal types has not recurred in this simulation.');
    }
    if (names.length) notes.push('Shares some vocabulary with: ' + names.join(', ') + '.');
    // Stated for every classification, so no case is left in silence where
    // silence would read as "there are no differences".
    notes.push(RESEMBLANCE_NOTES.REFUSED.why);
    return notes;
  }

  /* THE ONE LIST IN THIS APP THAT MUST NOT BE TRUNCATED, AND IT WAS.
     `pattern.false_positives.slice(0, 2)` dropped a documented legitimate
     explanation on 8 of the taxonomy's 12 patterns and said nothing -- while
     the countermeasures beside it were also truncated, so the case showed two
     reasons to act and two reasons to doubt from unequal pools, with neither
     pool's size stated. This project's whole position is that a false positive
     is first-class content, weighted equally, not a caveat: silently keeping
     the first two is the equal-weighting rule failing quietly. Nothing is
     dropped now, and the count is stated either way.

     A pattern documenting none is a gap in the taxonomy's coverage, not a
     finding that there are no innocent explanations -- the Slice 40 wording,
     owed here too. */
  const FALSE_POSITIVE_SCOPE = {
    kind: 'PARAMETER',
    scope: 'legitimate explanations the taxonomy documents for the resembled pattern',
    means: 'ways this pattern is known to be mistaken for fraud, quoted verbatim, all of them.',
    doesNotMean: 'an exhaustive list of every innocent explanation, a ranking, and not a finding that this case is or is not one of them.',
    neverTruncated: true
  };

  function falsePositivesFor(pattern) {
    if (!pattern) {
      return {
        patternId: null, patternName: null, items: [], documented: 0,
        note: 'This case resembles no documented pattern, so no documented legitimate explanations are quoted here. ' +
          'That is an absence of a documented pattern, not a finding that there is no innocent explanation \u2014 ' +
          'a case nothing in the taxonomy matches is the one an innocent explanation is hardest to look up.'
      };
    }
    const items = (pattern.false_positives || []).slice();
    if (!items.length) {
      return {
        patternId: pattern.id, patternName: pattern.name, items: [], documented: 0,
        note: 'The taxonomy documents no legitimate explanations for ' + pattern.name +
          '. That is a gap in its coverage, not a finding that there are none.'
      };
    }
    return {
      patternId: pattern.id,
      patternName: pattern.name,
      items: items,
      documented: items.length,
      note: 'All ' + items.length + ' legitimate explanation' + (items.length === 1 ? '' : 's') +
        ' the taxonomy documents for ' + pattern.name + ', none withheld. ' +
        'They are ' + FALSE_POSITIVE_SCOPE.means + ' They are not ' + FALSE_POSITIVE_SCOPE.doesNotMean
    };
  }

  /* The panel credited each vote to "indicator-keyword" matching. rankPatterns
     votes over a pattern's name, category and aliases and never reads an
     indicator -- the same false attribution to indicator data that Slice 40
     found in signalEngine's header. And only the top 3 of however many patterns
     scored were kept, with the number dropped never stated. */
  const RESEMBLANCE_SHOWN = 3;

  function resemblanceCoverage(ranked, signals) {
    const voted = (ranked || []).length;
    const shown = Math.min(voted, RESEMBLANCE_SHOWN);
    // The types the vote could actually be taken over, when the caller has them.
    // A resemblance derived from 2 of a case's 3 signal types must not read as
    // one derived from all 3, and only the caller knows the case's types.
    const vocab = signals ? vocabularyCoverage(signals) : null;
    const out = {
      voted: voted,
      shown: shown,
      withheld: voted - shown,
      votedOver: 'each pattern\'s name, category and aliases',
      voteUnit: VOTE_BASIS.unit,
      vocabulary: vocab,
      note: voted === 0
        ? 'No documented pattern shares a keyword with this signal combination.'
        : 'Showing the ' + shown + ' strongest of ' + voted + ' documented pattern' + (voted === 1 ? ' that shares' : 's that share') +
          ' a keyword with this combination' + (voted - shown > 0 ? ' (' + (voted - shown) + ' not shown)' : '') +
          '. A vote is one ' + VOTE_BASIS.unit.replace(', counted once each', '') +
          ', counted over ' + 'each pattern\'s name, category and aliases' +
          ' \u2014 not over its documented indicators, which this engine never reads, and not once per signal: ' +
          'the same signal type observed twice does not share more vocabulary than it shared once.'
    };
    if (vocab) out.note += ' ' + vocab.note;
    return out;
  }

  /* Printed as a bare "contribution 1.7" on every evidence row. It is the
     per-signal term of the sum the index is built from -- weight * reliability
     -- so once the index declared its unit (Slice 43) this number was the same
     quantity one step upstream, still unlabelled and on a different scale.
     And the rows cover EVERY signal the case holds while the index covers only
     the active ones, so the contributions on screen sum to something the index
     was not computed from: 3.70 against a baseSignalSum of 1.65 on the seeded
     run, two figures of one quantity at two scopes, neither labelled. */
  const EVIDENCE_CONTRIBUTION = {
    kind: 'PARAMETER',
    unit: 'signal-sum points, the input to the correlation index before its x' + INDEX_MULTIPLIER + ' multiplier',
    scope: 'one signal, listed for every signal the case holds including decayed ones',
    derivedFrom: 'signal weight x signal reliability, the term moEngine.scoreSignals adds up',
    means: 'how much this one signal adds to the sum the index is built from, while it is active.',
    doesNotMean: 'index points, a percentage, a likelihood this signal indicates fraud, and not a figure comparable across scopes without saying which scope.'
  };

  /* The two sums of one quantity, disjoint and summed at the point of display
     rather than left to be read as one number twice (reconciled-totals
     discipline). */
  /* The tolerance in contributionScopes, declared rather than left as a bare
     0.011 in a comparison. Its unit is the contribution unit, inherited from
     EVIDENCE_CONTRIBUTION and not restated. */
  const CONTRIBUTION_SCOPE_DRIFT = {
    tolerance: 0.011,
    unit: 'inherited from EVIDENCE_CONTRIBUTION',
    canDetect: 'a rounding step between the two rounded scope sums and the rounding of their unrounded total. One 0.01 step is the widest such gap arithmetically possible, so even that is outside this tolerance.',
    cannotDetect: 'an evidence row counted in both scopes or in neither, which is the failure the message names. Both sides of the comparison are built from the same two addends.',
    disjointnessBasis: 'STRUCTURAL: the loop assigns each row to the active scope or, in its only other branch, to the decayed one. Nothing is checked, and nothing needs to be.'
  };

  function contributionScopes(mo) {
    const active = new Set(mo.activeSignals || mo.signals || []);
    const rows = mo.evidence || [];
    let activeSum = 0, decayedSum = 0;
    rows.forEach(e => {
      if (active.has(e.signalId)) activeSum += e.contribution; else decayedSum += e.contribution;
    });
    const round = (v) => Math.round(v * 100) / 100;
    const scopes = {
      activeSum: round(activeSum),
      decayedSum: round(decayedSum),
      recordSum: round(activeSum + decayedSum),
      rows: rows.length
    };
    /* THIS COMPARISON CANNOT FAIL, AND SAYING SO IS THE POINT.
       `recordSum` is a rounding of the same two addends the left side is a
       rounding of, so the widest disagreement possible is one 0.01 step --
       and because buildEvidence already rounds every contribution to one
       decimal, the sums are exact multiples of 0.1 and the drift is zero.
       The undeclared 0.011 was therefore never a tolerance on anything
       observed; it is now declared, with what it can and cannot detect.
       The question it appears to ask -- is every evidence row counted in
       exactly one scope -- is settled by the if/else above, which has no
       third branch, and is not asked here. Presenting an identity as a
       reconciliation is what FWReconcile.KINDS.ROUNDING_DRIFT_ONLY exists
       to name. */
    if (Math.abs(scopes.activeSum + scopes.decayedSum - scopes.recordSum) > CONTRIBUTION_SCOPE_DRIFT.tolerance) {
      throw new Error('moEngine.contributionScopes: the two scopes do not sum to the record total');
    }
    scopes.reconciliation = {
      kind: 'ROUNDING_DRIFT_ONLY',
      tolerance: CONTRIBUTION_SCOPE_DRIFT.tolerance,
      canDetect: CONTRIBUTION_SCOPE_DRIFT.canDetect,
      cannotDetect: CONTRIBUTION_SCOPE_DRIFT.cannotDetect,
      disjointnessBasis: CONTRIBUTION_SCOPE_DRIFT.disjointnessBasis
    };
    scopes.note = 'Contributions listed for all ' + scopes.rows + ' signal' + (scopes.rows === 1 ? '' : 's') +
      ' this case holds sum to ' + scopes.recordSum.toFixed(2) + ' ' + EVIDENCE_CONTRIBUTION.unit +
      ', of which ' + scopes.activeSum.toFixed(2) + ' is still active and ' + scopes.decayedSum.toFixed(2) +
      ' has decayed out. The correlation index is built from the active figure alone, so the rows above do not add up to it.';
    return scopes;
  }

  function buildEvidence(signals) {
    return signals
      .map(s => ({ signalId: s.id, signalType: s.type, contribution: Math.round(s.weight * s.reliability * 10) / 10, reliability: s.reliability, at: s.createdAt,
        facilityId: s.facilityId || null, facilityName: s.facilityName || null }))
      .sort((a, b) => a.at - b.at);
  }

  // WHERE a case happened (Phase 5). A case is a chain of signals over
  // time, and a truck moves, so those signals can easily have been
  // observed at three different sites and on the open road in between.
  // Collapsing that to one location would invent a fact, so the case
  // carries the whole breakdown and says how spread out it is. A case
  // gets a single site in mo.entities ONLY when every one of its signals
  // was observed at that one site.
  function siteBreakdown(evidence) {
    const counts = new Map();
    let unsited = 0;
    const names = new Map();
    (evidence || []).forEach(e => {
      if (e.facilityId) {
        counts.set(e.facilityId, (counts.get(e.facilityId) || 0) + 1);
        if (e.facilityName) names.set(e.facilityId, e.facilityName);
      } else {
        unsited += 1;
      }
    });
    const sites = Array.from(counts.entries())
      .map(([facilityId, signalCount]) => ({ facilityId, facilityName: names.get(facilityId) || facilityId, signalCount }))
      .sort((a, b) => b.signalCount - a.signalCount || a.facilityId.localeCompare(b.facilityId));

    let siteSpread;
    if (!sites.length) siteSpread = 'UNSITED';
    else if (sites.length === 1) siteSpread = unsited ? 'PARTLY_UNSITED' : 'SINGLE_SITE';
    else siteSpread = unsited ? 'MULTI_SITE_PARTLY_UNSITED' : 'MULTI_SITE';

    return {
      sites,
      unsitedSignalCount: unsited,
      siteSpread,
      soleFacilityId: siteSpread === 'SINGLE_SITE' ? sites[0].facilityId : null
    };
  }

  const SITE_SPREAD_NOTE = {
    UNSITED: 'Every signal in this case was observed on the open road, so no site is attributable to it. That is an absence of location, not an unknown one.',
    SINGLE_SITE: 'Every signal in this case was observed at one site. That makes the site a fact about the case and still says nothing about the site itself -- a well-watched site records more.',
    PARTLY_UNSITED: 'Some signals here were observed at one site and the rest on the open road. The site is where the recording happened, not necessarily where the behaviour did.',
    MULTI_SITE: 'The signals in this case were observed at more than one site. The case has no single location, and the sites listed are where records exist, not a route.',
    MULTI_SITE_PARTLY_UNSITED: 'The signals here are spread across several sites and the open road. There is no single location for this case and the list below is not a route.'
  };

  // An MO's evidence record only ever GROWS. A signal decaying means it
  // stops counting toward confidence, not that it never happened -- so
  // scoring uses the currently-active set while the case keeps the full
  // history of every signal it was ever built on. (Before this, refresh
  // overwrote the list, and a case opened on a three-signal chain could
  // later show one signal, which also made its own past uninvestigable.)
  function mergeEvidence(mo, signals) {
    const seen = new Set((mo.evidence || []).map(e => e.signalId));
    const added = buildEvidence(signals).filter(e => !seen.has(e.signalId));
    mo.evidence = (mo.evidence || []).concat(added).sort((a, b) => a.at - b.at);
    mo.signals = mo.evidence.map(e => e.signalId);
    mo.timeline = mo.evidence.map(e => ({ t: e.at, type: e.signalType }));
    mo.activeSignals = signals.map(s => s.id);
    applySites(mo);
  }

  // Recomputed whenever evidence grows: a case that started at one site
  // and picked up a second signal elsewhere must stop claiming a single
  // location the moment that happens.
  function applySites(mo) {
    const b = siteBreakdown(mo.evidence);
    mo.sites = b.sites;
    mo.unsitedSignalCount = b.unsitedSignalCount;
    mo.siteSpread = b.siteSpread;
    if (mo.entities) mo.entities.facilityId = b.soleFacilityId;
    return b;
  }

  /* PRINTED UNDER A BARE HEADING READING "Recommended". These are
     countermeasures the taxonomy documents for a pattern this case merely
     shares vocabulary with, and one of the two picked is always from the
     RESPONSIVE bucket -- on the seeded run that is "Suspend further tendering
     to the entity immediately and freeze open invoices pending
     reconciliation", recommended, unscoped, on a case at index 20/100 with no
     record source checked and nothing ruled out. An action against a party is
     not a thing a resemblance can recommend.

     It also read exactly two of the three documented buckets and never said
     so: the preventive bucket, four entries deep on the seeded pattern, was
     silently unread, and 2 of 12 documented countermeasures were shown as if
     they were the set. Scope, coverage and the buckets not read are now
     returned with the picks, and the caller states them. */
  const COUNTERMEASURE_BUCKETS = ['preventive', 'detective', 'responsive'];
  const COUNTERMEASURE_SCOPE = {
    kind: 'PARAMETER',
    scope: 'countermeasures the taxonomy documents for the resembled pattern',
    means: 'what the taxonomy recommends against that pattern, quoted verbatim.',
    doesNotMean: 'a recommendation about this case, an action this case justifies, and not a step any finding here supports.',
    readBuckets: ['detective', 'responsive'],
    unreadBuckets: ['preventive'],
    unreadWhy: 'A preventive control is a change to how the operation runs. It is not a response to one case, ' +
      'and quoting one here would read as a step this case justifies.'
  };

  function recommendedActionsFor(pattern) {
    if (!pattern) {
      return {
        patternId: null, patternName: null, picks: [],
        coverage: { shown: 0, documented: 0, byBucket: {} },
        note: 'This case resembles no documented pattern, so the taxonomy documents no countermeasures for it. ' +
          'That is an absence of a documented pattern, not a finding that nothing should be done.'
      };
    }
    const cm = pattern.countermeasures || {};
    const picks = [];
    COUNTERMEASURE_SCOPE.readBuckets.forEach(b => {
      if (cm[b] && cm[b].length) picks.push({ bucket: b, text: cm[b][0] });
    });
    const byBucket = {};
    let documented = 0;
    COUNTERMEASURE_BUCKETS.forEach(b => {
      const have = (cm[b] || []).length;
      documented += have;
      byBucket[b] = {
        documented: have,
        shown: picks.filter(x => x.bucket === b).length,
        read: COUNTERMEASURE_SCOPE.readBuckets.indexOf(b) >= 0
      };
    });
    const unread = COUNTERMEASURE_BUCKETS.filter(b => byBucket[b].documented && !byBucket[b].read);
    return {
      patternId: pattern.id,
      patternName: pattern.name,
      picks: picks,
      coverage: { shown: picks.length, documented: documented, byBucket: byBucket },
      note: 'Documented by the taxonomy against ' + pattern.name + ', a pattern this case shares vocabulary with. ' +
        'Showing ' + picks.length + ' of ' + documented + ' documented countermeasures' +
        (unread.length ? ' \u2014 the ' + unread.join(' and ') + ' bucket is not read here. ' +
          COUNTERMEASURE_SCOPE.unreadWhy : '.') +
        ' None of this is a step this case has established a basis for.'
    };
  }

  /* THE CASE'S TITLE, ITS CATEGORY, ITS DOCUMENTED LEGITIMATE EXPLANATIONS AND
     ITS COUNTERMEASURES WERE ALL FROZEN AT THE INSTANT IT OPENED. `mergeEvidence`
     grows a case's signal record for the whole life of the case -- that is the
     point of it -- and nothing ever re-derived the resemblance from the grown
     record. Measured over five seeded 60-day runs: 14 of 79 cases acquired a
     signal type they did not open with, and for 5 of them the documented pattern
     their record most resembles is a DIFFERENT pattern from the one on the card.
     Those five were titled "Possible X", categorised as X, and shown X's
     documented false positives and X's countermeasures, while their own evidence
     resembled Y. The false-positive list is the one list in this app that must
     not be truncated (Slice 45) and on those cases it was the wrong pattern's
     list entirely, which is worse than truncated.

     Two decisions here, both deliberate:

     BASIS is the case's evidence RECORD, not its active signal set. The record
     only grows, so the resemblance can only ever become better informed, and an
     observation does not stop having happened because its weight decayed. This
     is a different basis from the correlation index on the same card, which is
     computed over the ACTIVE set and therefore falls on its own -- so the basis
     is named in what this returns rather than left for a reader to assume the
     two figures share one.

     EVERY CHANGE IS RECORDED. A case whose title silently changes from
     "Possible Double Brokering" to "Possible Cargo Theft" between two glances is
     its own defect: an analyst would read the second as what it always said.
     `resemblanceRevisions` keeps from/to/when/why, so a revision is visible as a
     revision. */
  /* THE BADGE WAS STILL FROZEN AT THE MOMENT THE CASE OPENED. Slice 56 caught
     the title, the category, the related pattern and the false-positive list
     being derived once and never again -- and left the discovery class, which
     is derived from the SAME `ranked` list, doing exactly that one field away.
     Measured over 87 cases across five seeded 60-day runs: 13 cases hold a
     signal type their opening combination did not have, and 2 of them carry a
     badge that disagrees with their own re-derived resemblance -- labelled
     "Potential New MO" beside a title voted from 5 and 6 shared keywords.

     Only the VOCABULARY half is re-derived. The sighting count is deliberately
     the count of the combination AS THE CASE OPENED: recurrence was counted
     against that combination at that moment, and re-signaturing the case later
     would mean re-counting a history that already happened. So the two halves
     of this badge have different bases, and `classificationBasis` says which is
     which rather than letting a reader assume one. Every change is recorded
     from/to/when/why, for the same reason a silently changed title is read as
     what it always said. */
  function applyClassification(mo, ranked, now, reason) {
    const priorCount = Math.max(0, (mo.recurrenceCount || 1) - 1);
    const previous = mo.classification !== undefined ? mo.classification : null;
    const detail = classifyDiscoveryDetail(ranked, priorCount);
    mo.classification = detail.classification;
    mo.classificationReason = detail.reason;
    mo.classificationReasonNote = detail.reasonNote;
    mo.classificationDetail = detail;
    mo.classificationDerivedAt = now;
    mo.classificationBasis = {
      vocabularyOver: 'the case\'s whole evidence record, re-derived whenever the record gains a signal type',
      sightingsOver: 'the signal-type combination the case OPENED with, counted at that moment',
      note: 'The two halves of this badge do not share a basis. What the case resembles is re-voted over its ' +
        'growing record; how often the combination has been seen is the count taken when it opened, because ' +
        're-signaturing a case later would re-count a history that already happened.'
    };
    if (reason && previous !== null && previous !== detail.classification) {
      mo.classificationRevisions = (mo.classificationRevisions || []).concat([{
        at: now, from: previous, to: detail.classification, reason: reason
      }]);
    }
    return detail;
  }

  function applyResemblance(mo, typeBearing, now, reason) {
    const ranked = rankPatterns(typeBearing);
    // Before resemblanceNotes, which reads mo.classification: the note and the
    // badge have to be derived from the same vote in the same pass.
    applyClassification(mo, ranked, now, reason);
    const pattern = ranked.length ? ranked[0].pattern : null;
    const previous = mo.relatedPattern !== undefined ? mo.relatedPattern : null;
    mo.title = pattern ? 'Possible ' + pattern.name : 'Unclassified correlated anomaly';
    mo.category = pattern ? pattern.category : 'unclassified';
    mo.relatedPattern = pattern ? pattern.id : null;
    mo.relatedHistoricalPatterns = ranked.slice(0, RESEMBLANCE_SHOWN)
      .map(r => ({ id: r.pattern.id, name: r.pattern.name, votes: r.votes, keywords: r.keywords }));
    mo.resemblanceCoverage = resemblanceCoverage(ranked, typeBearing);
    mo.resemblanceNotes = resemblanceNotes(ranked, mo.classification);
    mo.falsePositives = falsePositivesFor(pattern);
    mo.patternCountermeasures = recommendedActionsFor(pattern);
    mo.resemblanceBasis = {
      types: Array.from(new Set(typeBearing.map(s => s.type))).sort(),
      over: 'the case\'s whole evidence record, including signals whose weight has decayed out of the correlation index',
      note: 'What this case resembles is voted over every signal type its record holds. The correlation index beside ' +
        'it is computed over the signals still ACTIVE, so the two figures do not share a basis and a decayed signal ' +
        'still counts here.'
    };
    mo.resemblanceRevisedAt = now;
    if (reason && previous !== mo.relatedPattern) {
      mo.resemblanceRevisions = (mo.resemblanceRevisions || []).concat([{
        at: now, from: previous, to: mo.relatedPattern, reason: reason
      }]);
    }
    return ranked;
  }

  // The unit the resemblance is re-derived against: the distinct signal types on
  // the record, in one place, so buildMo and refreshMo cannot disagree about it.
  function recordTypeKey(mo) {
    return Array.from(new Set((mo.evidence || []).map(e => e.signalType))).sort().join('+');
  }

  function buildMo(engine, truck, signals, now) {
    const id = 'MO-' + String(engine.nextMoId++).padStart(4, '0');
    const rawScore = scoreSignals(signals);
    const confidence = confidenceFromScore(rawScore);
    // The sum was computed and thrown away, which is why nothing could say
    // what a clamped 100 was hiding. Kept, so the ceiling caveat has a figure.
    const indexNoteAtOpen = indexNote(rawScore);
    const ranked = rankPatterns(signals);
    const pattern = ranked.length ? ranked[0].pattern : null;

    const signature = signalSignature(signals);
    const priorCount = engine.signatures.get(signature) || 0;
    engine.signatures.set(signature, priorCount + 1);
    // Set here so the object literal below declares the field, then re-derived
    // (identically, from the same ranked list) by applyClassification at the
    // end of buildMo -- one owner, no second formula.
    const classification = classifyDiscovery(ranked, priorCount);
    const noveltyScore = noveltyFromRecurrence(priorCount);

    checkScopesOnce();
    const siteInfo = siteBreakdown(buildEvidence(signals));

    const mo = {
      id,
      confidence,
      baseConfidence: confidence,
      baseSignalSum: rawScore,
      indexScaleNote: indexNoteAtOpen,
      investigationAdjustment: 0,
      investigation: { findings: [], completed: [], effortSeconds: 0 },
      confidenceBand: confidenceLabel(confidence),
      status: 'NEW',
      classification,
      noveltyScore,
      recurrenceCount: priorCount + 1,
      signature,
      entities: { truckId: truck.id, driverId: truck.driverId, trailerId: truck.trailerId, carrierId: truck.carrierId, facilityId: siteInfo.soleFacilityId },
      sites: siteInfo.sites,
      unsitedSignalCount: siteInfo.unsitedSignalCount,
      siteSpread: siteInfo.siteSpread,
      signals: signals.map(s => s.id),
      activeSignals: signals.map(s => s.id),
      timeline: buildEvidence(signals).map(e => ({ t: e.at, type: e.signalType })),
      // title, category, relatedPattern, relatedHistoricalPatterns,
      // resemblanceCoverage, resemblanceNotes, falsePositives and
      // patternCountermeasures are all set by applyResemblance below, from one
      // place, because they are all one derivation and used to be re-derived
      // nowhere.
      resemblanceRevisions: [],
      classificationRevisions: [],
      evidence: buildEvidence(signals),
      firstObserved: Math.min(...signals.map(s => s.createdAt)),
      // When the case was OPENED, which is not when its first signal was
      // seen: correlation needs a second signal type, so there is always a
      // lag. Two different populations follow from the two timestamps, and
      // a panel counting "new cases in a window" has to say which one it
      // means (awayReport.js reconciles them).
      openedAt: now,
      lastObserved: now,
      autoFaded: false,
      resolutionReason: null
    };
    applyResemblance(mo, mo.evidence.map(e => ({ type: e.signalType })), now, null);
    return mo;
  }

  // Displayed confidence = what the correlation engine derived from the
  // signals, plus whatever the player's own investigative findings have
  // moved it by (investigationEngine, Phases 28-29). Kept as two stored
  // numbers so new signals arriving never silently erase the analyst's
  // gathered evidence, and so the UI can always show which part of the
  // number came from the engine and which from the investigation.
  function recomputeConfidence(mo) {
    const base = mo.baseConfidence != null ? mo.baseConfidence : mo.confidence;
    const adj = mo.investigationAdjustment || 0;
    // Index points added to index points. The base is already clamped, so on a
    // saturated case the adjustment is applied to the ceiling rather than to
    // the sum -- two cases whose signal sums differ by a factor of two come
    // out of an identical finding with an identical number. mo.indexScaleNote says
    // so wherever that has happened; it is not silently smoothed here.
    mo.confidence = Math.max(INDEX_MIN, Math.min(INDEX_MAX, Math.round(base + adj)));
    mo.confidenceBand = confidenceLabel(mo.confidence);
    return mo.confidence;
  }

  function refreshMo(mo, signals, now) {
    const typesBefore = recordTypeKey(mo);
    mergeEvidence(mo, signals);
    const typesAfter = recordTypeKey(mo);
    if (typesAfter !== typesBefore) {
      applyResemblance(mo, mo.evidence.map(e => ({ type: e.signalType })), now,
        'the case\'s evidence record gained a signal type it did not open with (' + (typesBefore || 'none') +
        ' \u2192 ' + typesAfter + '), so what it resembles and the vocabulary half of its badge were re-derived ' +
        'from the record');
    }
    const raw = scoreSignals(signals);
    mo.baseSignalSum = raw;
    mo.indexScaleNote = indexNote(raw);
    mo.baseConfidence = confidenceFromScore(raw);
    recomputeConfidence(mo);
    mo.lastObserved = now;
  }

  function createEngine() {
    return { nextMoId: 1, mos: new Map(), byEntity: new Map(), signatures: new Map() };
  }

  // Snapshot of the discovery engine's own history -- how many
  // distinct signal-combinations it has ever seen, and which are
  // still rare/novel. Useful for a "what's new" summary view.
  /* The old tally read `if (byClass[mo.classification] != null) byClass[...]++`
     -- a case whose class was not one of the four was counted nowhere, and the
     result was returned alongside `totalMos`, which it did not have to equal.
     Both panels then printed the four buckets with no base at all. Declared
     partition, summed at the write, throws on either failure. */
  function discoverySummary(engine) {
    const all = Array.from(engine.mos.values());
    const byClass = {};
    CLASSIFICATIONS.forEach(k => { byClass[k] = 0; });
    all.forEach(mo => {
      if (byClass[mo.classification] === undefined) {
        throw new Error('moEngine.discoverySummary: case ' + (mo.id || '(no id)') + ' carries discovery class "' +
          mo.classification + '", which is not one of ' + CLASSIFICATIONS.join('/') + '; it would be counted in no bucket');
      }
      byClass[mo.classification]++;
    });
    const summed = CLASSIFICATIONS.reduce((n, k) => n + byClass[k], 0);
    if (summed !== all.length) {
      throw new Error('moEngine.discoverySummary: discovery classes sum to ' + summed + ' over ' + all.length +
        ' cases; sharing a base is not adding up to it');
    }
    /* One bucket, two facts: POTENTIAL_NEW_MO is issued both for a first
       sighting whose vocabulary overlap is thin and for a combination seen
       once or twice, and the class tally cannot tell them apart. Counted by
       reason as well, over the same base, declared partition, throwing on
       either failure -- the same shape as the class tally above, for the same
       reason. */
    const byReason = {};
    CLASSIFICATION_REASON_KEYS.forEach(k => { byReason[k] = 0; });
    let reasonless = 0;
    all.forEach(mo => {
      if (mo.classificationReason === undefined || mo.classificationReason === null) { reasonless++; return; }
      if (byReason[mo.classificationReason] === undefined) {
        throw new Error('moEngine.discoverySummary: case ' + (mo.id || '(no id)') + ' carries classification reason "' +
          mo.classificationReason + '", which is not one of ' + CLASSIFICATION_REASON_KEYS.join('/'));
      }
      byReason[mo.classificationReason]++;
    });
    const reasonSummed = CLASSIFICATION_REASON_KEYS.reduce((n, k) => n + byReason[k], 0);
    if (reasonSummed + reasonless !== all.length) {
      throw new Error('moEngine.discoverySummary: classification reasons sum to ' + reasonSummed + ' plus ' +
        reasonless + ' unstated over ' + all.length + ' cases; sharing a base is not adding up to it');
    }
    const reach = classificationReach();
    const voteFloor = voteFloorEquivalence();
    const observedFloor = observedVoteFloorEquivalence(engine);
    return {
      totalSignatures: engine.signatures.size, totalMos: all.length, byClassification: byClass, classifiedTotal: summed,
      byReason: byReason,
      // A case built before this engine recorded reasons has no reason, which
      // is not the same as a reason of "none". Counted separately, never
      // folded into a bucket.
      reasonNotStated: reasonless,
      reasonBase: all.length,
      voteFloorNote: voteFloor.note,
      observedVoteFloorNote: observedFloor.note,
      // A bucket reading 0 because no case can carry it is not the same fact as
      // a bucket reading 0 because none has come up, and the panel had no way
      // to tell them apart.
      unissuableClasses: reach.unissuable,
      reachNote: reach.note
    };
  }

  // Call once per simulation step (or batched) after behaviorEngine +
  // signalEngine have run for that tick.
  function process(engine, registry, now) {
    const created = [], updated = [], faded = [];

    FWEntityEngine.all(registry, 'truck').forEach(truck => {
      const active = FWSignalEngine.getActiveSignals(truck, now);
      const existingId = engine.byEntity.get(truck.id);
      const existing = existingId ? engine.mos.get(existingId) : null;

      if (existing && OPEN_STATUSES.has(existing.status)) {
        const untouched = existing.status === 'INVESTIGATING' || existing.status === 'ESCALATED';
        if (active.length === 0 && !untouched && (now - existing.lastObserved) > DISMISS_IDLE_SECONDS) {
          existing.status = 'DISMISSED';
          // Faded by the engine, not judged by an analyst -- flagged so
          // later modules can tell "nobody ever looked at this" apart
          // from "an analyst closed it", and can still allow record
          // checks on it (investigationEngine, Phases 28-29).
          existing.autoFaded = true;
          existing.resolutionReason = 'Signals faded before correlation was sustained. No analyst reviewed it.';
          faded.push(existing);
        } else if (active.length > 0) {
          refreshMo(existing, active, now);
          updated.push(existing);
        }
        return; // one open MO per entity at a time -- no duplicate spam
      }

      const distinctTypes = new Set(active.map(s => s.type));
      if (distinctTypes.size >= MIN_SIGNAL_TYPES && scoreSignals(active) >= CREATE_THRESHOLD) {
        const mo = buildMo(engine, truck, active, now);
        engine.mos.set(mo.id, mo);
        engine.byEntity.set(truck.id, mo.id);
        created.push(mo);
      }
    });

    return { created, updated, faded };
  }

  /* WHOSE HAND CLOSED IT (Slice 35). `autoFaded` is one boolean and by
     Slice 34 three different modules were reading it directly and wording
     the distinction their own way. The distinction is moEngine's own --
     this is the module that fades a case -- so the rule and its wording
     live here once. A status word is identical whether an analyst reached
     it or whether correlation dropped the case on its own, and those are
     not the same fact about anybody's work.

     OPEN is a third answer, not a missing one: an open case has no closing
     hand yet, and reporting one would invent a decision. */
  const CLOSURE_HAND = ['ANALYST_CLOSED', 'ENGINE_FADE', 'OPEN'];

  const CLOSURE_HAND_NOTE = {
    ANALYST_CLOSED: 'an analyst set this status',
    ENGINE_FADE: 'faded out by the engine when its signals stopped, no analyst review recorded',
    OPEN: 'still open, so no closing hand has been recorded'
  };

  function closureHand(mo) {
    if (!mo || !CLOSED_STATUSES.has(mo.status)) {
      return { hand: 'OPEN', note: CLOSURE_HAND_NOTE.OPEN };
    }
    const hand = mo.autoFaded === true ? 'ENGINE_FADE' : 'ANALYST_CLOSED';
    return { hand: hand, note: CLOSURE_HAND_NOTE[hand] };
  }

  /* WHETHER IT IS STILL LIVE, and the filter that never asked.
     Three modules -- exposureModel.portfolio, analyticsEngine's caseload group
     and exposure-view's own duplicate -- selected open cases with
     `m.status !== 'CLOSED' && !m.verdictOutcome`. There is no status named
     'CLOSED'. This module owns the vocabulary and it is
     CLOSED_STATUSES = CONFIRMED / DISMISSED / FALSE_POSITIVE / RESOLVED, so that
     first clause was true of every case ever raised and the filter reduced to
     "has no verdict recorded". On the seeded run all five cases carry status
     DISMISSED, and all five were reported as OPEN -- with a summed exposure BAND
     attached to them, which is a money figure over cases nobody considers live.
     analyticsEngine even stated the denominator it was not computing: "cases
     with no terminal status set".
     A terminal status reached without a verdict is a real and separate thing
     (Slices 28/35/39), so it gets its own buckets rather than being folded into
     either side, and whose hand closed it comes from closureHand, not a second
     reading of autoFaded. */
  const STANDING = ['OPEN', 'CLOSED_WITH_VERDICT', 'CLOSED_NO_VERDICT_ANALYST', 'CLOSED_NO_VERDICT_ENGINE_FADE'];

  const STANDING_NOTE = {
    OPEN: 'no terminal status has been set, so the case is still live',
    CLOSED_WITH_VERDICT: 'closed with a recorded claim about what the case was',
    CLOSED_NO_VERDICT_ANALYST: 'an analyst set a terminal status without recording a verdict, so the case is not live and nothing was claimed about it',
    CLOSED_NO_VERDICT_ENGINE_FADE: 'the engine faded it out when its signals stopped; no analyst review and no verdict were recorded, so nobody decided anything'
  };

  function caseStanding(mo) {
    if (!mo || !CLOSED_STATUSES.has(mo.status)) {
      return { standing: 'OPEN', note: STANDING_NOTE.OPEN };
    }
    if (mo.verdictOutcome) {
      return { standing: 'CLOSED_WITH_VERDICT', note: STANDING_NOTE.CLOSED_WITH_VERDICT };
    }
    const hand = closureHand(mo).hand;
    const standing = hand === 'ENGINE_FADE' ? 'CLOSED_NO_VERDICT_ENGINE_FADE' : 'CLOSED_NO_VERDICT_ANALYST';
    return { standing: standing, note: STANDING_NOTE[standing] };
  }

  /* Disjoint, exhaustive, and the sum is asserted rather than trusted. Returns
     the case lists as well as the counts so a caller never has to re-derive the
     membership with a filter of its own. */
  /* An undeclared standing used to reach `buckets[k].push(m)` as an
     undefined bucket, so the fault surfaced as "undefined is not an object"
     and the refusal three lines down never ran. The key is now checked
     against STANDING before it is used as an index, which makes the sum
     comparison below an identity rather than the guard -- see
     FWReconcile.KINDS.KEY_DECLARED_THEN_SUMMED. `standingOf` is the
     injection point (convention 37); every app call site passes nothing and
     gets this engine's own rule. */
  function standingPartition(mos, standingOf) {
    const list = Array.isArray(mos) ? mos : Array.from((mos && mos.values && mos.values()) || []);
    const standingFn = standingOf || ((m) => caseStanding(m).standing);
    const buckets = {};
    STANDING.forEach(k => { buckets[k] = []; });
    list.forEach((m, i) => {
      const k = standingFn(m, i);
      if (!buckets[k]) {
        throw new Error('moEngine.standingPartition: case ' + ((m && m.id) || '(no id)') + ' holds standing "' + k +
          '", which is not one of ' + STANDING.join('/') + '. A case with no standing bucket sits in the ' +
          'denominator of every rate and the numerator of none.');
      }
      buckets[k].push(m);
    });
    const counts = {};
    let sum = 0;
    STANDING.forEach(k => { counts[k] = buckets[k].length; sum += counts[k]; });
    /* Retained as the statement of the invariant, not as a check: every case
       has already been proved to increment exactly one declared bucket, so
       this cannot fail. Declared as such rather than left to read as a
       second guard. */
    if (sum !== list.length) {
      throw new Error('moEngine.standingPartition: the ' + STANDING.length + ' buckets hold ' + sum +
        ' of ' + list.length + ' cases; a standing partition that does not cover the population is not one');
    }
    const closedNoVerdict = counts.CLOSED_NO_VERDICT_ANALYST + counts.CLOSED_NO_VERDICT_ENGINE_FADE;
    const out = {
      total: list.length,
      counts: counts,
      cases: buckets,
      open: buckets.OPEN,
      closedNoVerdict: closedNoVerdict
    };
    out.note = list.length === 0
      ? 'No cases have been raised in this run, so there is no standing to report.'
      : counts.OPEN + ' of ' + list.length + ' case' + (list.length === 1 ? '' : 's') + ' still live, ' +
        counts.CLOSED_WITH_VERDICT + ' closed with a verdict recorded and ' + closedNoVerdict +
        ' closed with none' +
        (closedNoVerdict
          ? ' (' + counts.CLOSED_NO_VERDICT_ENGINE_FADE + ' faded out by the engine with no analyst review, ' +
            counts.CLOSED_NO_VERDICT_ANALYST + ' closed by an analyst who recorded no verdict). ' +
            'A case in that third group is not live and nothing was claimed about it, so counting it as either open or decided would be wrong in both directions.'
          : '.');
    return out;
  }

  /* Both directions. A status token compared against but never issued is the
     bug this slice exists to remove, so the phantom is named and refused, and
     the two sets have to stay disjoint and cover what setStatus can produce. */
  (function assertStatusVocabulary() {
    if (CLOSED_STATUSES.has('CLOSED') || OPEN_STATUSES.has('CLOSED')) {
      throw new Error('moEngine: "CLOSED" is not a status this engine issues; it is the phantom token three filters compared against');
    }
    OPEN_STATUSES.forEach(k => {
      if (CLOSED_STATUSES.has(k)) throw new Error('moEngine: status ' + k + ' is declared both open and closed');
    });
    STANDING.forEach(k => {
      if (!STANDING_NOTE[k]) throw new Error('moEngine: standing ' + k + ' has no note, so a panel would print an empty explanation');
    });
    const sample = { status: 'DISMISSED', autoFaded: true };
    if (caseStanding(sample).standing === 'OPEN') {
      throw new Error('moEngine: a terminal status is being classified as open, which is the exact fault Slice 48 removed');
    }
    if (caseStanding({ status: 'NEW' }).standing !== 'OPEN') {
      throw new Error('moEngine: a live case is not being classified as open');
    }
  })();

  function setStatus(mo, status, reason) {
    mo.status = status;
    mo.autoFaded = false; // an analyst has now touched it, whatever it was before
    if (reason) mo.resolutionReason = reason;
  }

  return {
    createEngine, process, setStatus, recomputeConfidence, scoreSignals, mergeEvidence, matchPattern, rankPatterns,
    siteBreakdown, applySites, SITE_SPREAD_NOTE,
    confidenceFromScore, confidenceLabel, buildEvidence, recommendedActionsFor,
    RESEMBLANCE_NOTES, resemblanceNotes, COUNTERMEASURE_SCOPE, COUNTERMEASURE_BUCKETS,
    FALSE_POSITIVE_SCOPE, falsePositivesFor, RESEMBLANCE_SHOWN, resemblanceCoverage,
    PATTERN_KEYWORDS, TYPES_WITHOUT_VOCABULARY, assertKeywordVocabularyDeclared, vocabularyCoverage,
    checkVocabularyOnce, vocabularyCheckState,
    VOTE_BASIS, classificationReach, applyResemblance, applyClassification, observedVoteFloorEquivalence,
    DISCOVERY_THRESHOLDS, CLASSIFICATION_REASONS, CLASSIFICATION_REASON_KEYS,
    classificationReasonEntry, assertClassificationReasonsDeclared,
    classifyDiscoveryDetail, voteFloorEquivalence,
    EVIDENCE_CONTRIBUTION, contributionScopes, CONTRIBUTION_SCOPE_DRIFT,
    CONFIDENCE_BAND, bandTone, assertBandScopeDistinct,
    CONFIDENCE_INDEX, indexNote, formatIndex, indexReach, indexBasis, assertIndexScaleDeclared,
    INDEX_MIN, INDEX_MAX, INDEX_MULTIPLIER,
    signalSignature, classifyDiscovery, noveltyFromRecurrence, discoverySummary,
    CLASSIFICATION, CLASSIFICATIONS, classificationLabel, classificationTone, classificationTally,
    RECURRENCE_NOVELTY, noveltyIsFloored, noveltyNote,
    closureHand, CLOSURE_HAND, CLOSURE_HAND_NOTE,
    STANDING, STANDING_NOTE, caseStanding, standingPartition,
    OPEN_STATUSES, CLOSED_STATUSES, CREATE_THRESHOLD, MIN_SIGNAL_TYPES
  };
})();
