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
   falsePositivePossibilities and recommendedActions are always pulled
   verbatim from that matched pattern's real taxonomy data, or left
   generic if nothing matches confidently.

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
  const DISMISS_IDLE_SECONDS = 3600; // unresolved + quiet this long -> fades on its own

  const OPEN_STATUSES = new Set(['NEW', 'MONITORING', 'INVESTIGATING', 'ESCALATED']);
  const CLOSED_STATUSES = new Set(['CONFIRMED', 'DISMISSED', 'FALSE_POSITIVE', 'RESOLVED']);

  // Loose keyword associations used only to pick which real pattern an
  // MO resembles -- not a claim of equivalence.
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
    floorsAtRaw: INDEX_MIN / INDEX_MULTIPLIER
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
  function assertIndexScaleDeclared() {
    if (CONFIDENCE_INDEX.saturatesAtRaw * INDEX_MULTIPLIER !== INDEX_MAX) {
      throw new Error('moEngine: the declared saturation sum does not multiply back to the scale maximum');
    }
    if (CONFIDENCE_INDEX.floorsAtRaw * INDEX_MULTIPLIER !== INDEX_MIN) {
      throw new Error('moEngine: the declared floor sum does not multiply back to the scale minimum');
    }
    if (/%/.test(CONFIDENCE_INDEX.unit)) {
      throw new Error('moEngine: the index unit must not be a percentage; nothing is divided');
    }
    if (!/CURRENTLY ACTIVE/.test(CONFIDENCE_INDEX.basis)) {
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
    if (score <= 20) return 'MINIMAL';
    if (score <= 40) return 'WATCH';
    if (score <= 60) return 'ELEVATED';
    if (score <= 80) return 'SUBSTANTIAL';
    return 'STRONG';
  }

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
  function rankPatterns(signals) {
    if (typeof FW === 'undefined' || !FW.patterns) return [];
    const patterns = FW.patterns();
    if (!patterns || !patterns.length) return [];

    const votes = new Map();
    signals.forEach(s => {
      const keywords = PATTERN_KEYWORDS[s.type] || [];
      keywords.forEach(kw => {
        patterns.forEach(p => {
          const hay = `${p.name} ${p.category} ${(p.aliases || []).join(' ')}`.toLowerCase();
          if (hay.includes(kw)) votes.set(p.id, (votes.get(p.id) || 0) + 1);
        });
      });
    });
    return Array.from(votes.entries())
      .map(([id, votes]) => ({ pattern: patterns.find(p => p.id === id), votes }))
      .filter(r => r.pattern)
      .sort((a, b) => b.votes - a.votes);
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

  function classifyDiscovery(ranked, priorCount) {
    const topVotes = ranked.length ? ranked[0].votes : 0;
    if (!ranked.length) return 'EMERGING_BEHAVIOR';       // no resemblance to anything known
    if (priorCount === 0) return topVotes >= 3 ? 'MO_VARIANT' : 'POTENTIAL_NEW_MO';
    if (priorCount < 3) return 'POTENTIAL_NEW_MO';
    return 'KNOWN_MO';                                     // recurring combination, well understood by now
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

  function differencesFromKnown(ranked, classification) {
    if (classification === 'KNOWN_MO') return [];
    if (!ranked.length) {
      return ['This signal combination has no confident resemblance to any documented pattern in the taxonomy.'];
    }
    const names = ranked.slice(1, 3).map(r => r.pattern.name);
    const base = [`Resembles ${ranked[0].pattern.name} but this exact combination of signal types hasn't recurred (yet) in this simulation.`];
    if (names.length) base.push(`Also shares partial characteristics with: ${names.join(', ')}.`);
    return base;
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

  function recommendedActionsFor(pattern) {
    if (!pattern) return ['Monitor for additional correlated signals before escalating.'];
    const cm = pattern.countermeasures || {};
    const picks = [];
    if (cm.detective && cm.detective.length) picks.push(cm.detective[0]);
    if (cm.responsive && cm.responsive.length) picks.push(cm.responsive[0]);
    return picks.length ? picks : ['Monitor for additional correlated signals before escalating.'];
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
    const classification = classifyDiscovery(ranked, priorCount);
    const noveltyScore = noveltyFromRecurrence(priorCount);

    checkScopesOnce();
    const siteInfo = siteBreakdown(buildEvidence(signals));

    return {
      id,
      title: pattern ? `Possible ${pattern.name}` : 'Unclassified correlated anomaly',
      category: pattern ? pattern.category : 'unclassified',
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
      relatedPattern: pattern ? pattern.id : null,
      relatedHistoricalPatterns: ranked.slice(0, 3).map(r => ({ id: r.pattern.id, name: r.pattern.name, votes: r.votes })),
      differencesFromKnownPatterns: differencesFromKnown(ranked, classification),
      falsePositivePossibilities: pattern ? pattern.false_positives.slice(0, 2) : [],
      recommendedActions: recommendedActionsFor(pattern),
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
    mergeEvidence(mo, signals);
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
    return { totalSignatures: engine.signatures.size, totalMos: all.length, byClassification: byClass, classifiedTotal: summed };
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

  function setStatus(mo, status, reason) {
    mo.status = status;
    mo.autoFaded = false; // an analyst has now touched it, whatever it was before
    if (reason) mo.resolutionReason = reason;
  }

  return {
    createEngine, process, setStatus, recomputeConfidence, scoreSignals, mergeEvidence, matchPattern, rankPatterns,
    siteBreakdown, applySites, SITE_SPREAD_NOTE,
    confidenceFromScore, confidenceLabel, buildEvidence, recommendedActionsFor,
    CONFIDENCE_BAND, bandTone, assertBandScopeDistinct,
    CONFIDENCE_INDEX, indexNote, formatIndex, indexReach, indexBasis, assertIndexScaleDeclared,
    INDEX_MIN, INDEX_MAX, INDEX_MULTIPLIER,
    signalSignature, classifyDiscovery, noveltyFromRecurrence, discoverySummary,
    CLASSIFICATION, CLASSIFICATIONS, classificationLabel, classificationTone, classificationTally,
    RECURRENCE_NOVELTY, noveltyIsFloored, noveltyNote,
    closureHand, CLOSURE_HAND, CLOSURE_HAND_NOTE,
    OPEN_STATUSES, CLOSED_STATUSES, CREATE_THRESHOLD, MIN_SIGNAL_TYPES
  };
})();
