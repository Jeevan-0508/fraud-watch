/* simulation/actEngine.js -- ONE ACT, MORE THAN ONE RECORD (Slice 74, Phase F).

   WHAT THIS MODULE EXISTS TO FIX, with the number that named it.

   Slice 73 gave a fraud actor a plan and then measured why a case still never
   survives. The answer had nothing to do with intent. On a 20-day seeded run
   (seed 12345) there are 315 signals on 8 trucks -- 307 consecutive pairs on
   the same truck -- and the MEDIAN gap between two consecutive signals on one
   truck is 31,500 sim-seconds, roughly 8.75 hours. The longest lifetime any
   signal has in signalEngine.SIGNAL_CATALOG is 10,800 seconds. Measured against
   the rule the engine actually applies -- moEngine reads
   signalEngine.getActiveSignals, so an earlier signal has to still be alive when
   a later one is created -- only 39 of those 307 pairs are ever co-active at
   all, and only 28 of them are co-active AND of two distinct types, which is
   what moEngine.MIN_SIGNAL_TYPES requires. A case cannot be built out of
   evidence that is never in the room together.

   THE TWO HONEST FIXES, AND WHY THIS IS THE ONE.

   (a) An act emits its records close enough together to be one act.
   (b) Decay stops being a property of the signal type and becomes a property of
       the case, so an open case keeps what it has already seen.

   This module is (a), and (b) was rejected on this ground: (b) does not change
   what the world does, it changes how much slack the correlation engine is
   given to reach across a silence that is still there. That is the same move as
   lengthening a decay window, spelled differently, and Slice 66 in this codebase
   already found a decay window whose behaviour had never actually been shown to
   work. The mismatch is not that the correlation engine is too strict. It is
   that this simulation modelled every disruption as ONE record, and the
   provenance note for three of its thirteen primitives does not describe one
   record. It describes an action with two observable halves.

   WHAT THE SOURCE ACTUALLY SAYS. docs/real-world-mo-ingestion.md, verbatim:

     STAGED_BREAKDOWN -- "a driver reports a mechanical issue AND detaches the
       trailer at an undocumented, off-site location."
     EQUIPMENT_CARRIER_MISMATCH -- "a pickup is performed with a tractor/trailer
       registered to a different carrier THAN THE ONE ASSIGNED TO THE RUN."
     FALSE_MILESTONE_STAMP -- "a system delivery/arrival stamp fires with NO
       CONFIRMED PHYSICAL ARRIVAL at the destination."

   Each of those sentences names two things a record system can see, not one.
   A staged breakdown is a claim plus a vehicle standing somewhere it should not
   be. An equipment mismatch is only observable as a disagreement between the
   equipment that showed up and the run paperwork that says something else, and
   the operation resolves that disagreement by amending the paperwork to whatever
   actually arrived. A false milestone is a stamp claiming an arrival plus a
   receiving end that never confirmed the load. The taxonomy shipped in
   data/fraud-data.json says the same thing a second way: FFT-007 lists
   "Driver identity document does not match the dispatch confirmation" and
   "Tractor or trailer plate does not match the dispatch record" as two separate
   indicators, both at phase in_transit, both weight 5 -- two observations of one
   gate check.

   So the fix is not a constant. It is that three of the thirteen primitives were
   modelled as half of what the source says they are, and the missing half is the
   thing that would have been correlatable.

   WHY THIS IS NOT PLANNED-ONLY, WHICH IS WHAT SESSION 31 SUGGESTED FIRST.
   Session 31 proposed "a plan step with a window rather than one trace per
   granted opportunity". If only a PLANNED act emitted a second record, then the
   presence of a second record would BE ground truth, readable by every engine
   downstream of behaviorEngine and by every panel. That is exactly the leak
   intentEngine.GROUND_TRUTH exists to prevent. A composite act is composite
   because of what KIND of act it is, never because of who did it, so this table
   is keyed by disruption type and knows nothing about plans, drivers or intent.
   An unplanned staged breakdown emits its second record too.

   WHAT WAS NOT TOUCHED, because touching it would be hiding the mismatch rather
   than fixing it: DISRUPTION_CHANCE_PER_TICK is still 0.015, CREATE_THRESHOLD is
   still 3.5, MIN_SIGNAL_TYPES is still 2, LEGITIMATE_CHANCE is still 0.65 and
   every decaySeconds in SIGNAL_CATALOG is the value it has been since Slice 5.
   The number of ACTS in a run is unchanged -- this module adds no opportunity
   and cannot: it is only ever called after behaviorEngine has already granted
   one and already applied it. What changes is how many records one act leaves.

   AND THE GUARD THAT KEEPS THAT HONEST: assertNoCompositeOpensACaseAlone.
   If one composite act could clear CREATE_THRESHOLD on its own, this module
   would have quietly become a case generator, which is the forbidden shortcut
   wearing a provenance citation. It cannot: the three pairs score 1.60, 3.40 and
   2.75 against a threshold of 3.50, and that is asserted at load against
   moEngine's own exported constant rather than restated here. A case still
   requires two acts to coincide. What this slice changes is that two acts
   coinciding is now reachable, because each of them is in the room for its own
   full lifetime with two types instead of one. */
const FWActEngine = (() => {
  /* THE CEILING ON HOW FAR APART TWO RECORDS OF ONE ACT MAY LAND.

     It is a separation, not an ordering claim. This module does not model which
     half of an act was written down first -- for a staged breakdown the stop
     precedes the report, for a false milestone the missing confirmation is
     noticed after the stamp -- so it declares a separation and refuses to
     pretend it knows the sequence.

     The companion record is stamped EARLIER than the act, never later, for a
     mechanical reason: simRunner advances its clock and then samples, so
     `timestamp` is the END of the interval the act was drawn in. A record
     stamped after it would be a record from a moment the world has not been
     sampled at yet.

     Two things bound the separation and only one of them binds in practice.
     This constant is the declared ceiling; the sampled interval (simRunner's
     FF_CHUNK, 300 sim-seconds, handed in as dtSeconds) is smaller and is what
     actually binds on a fast-forwarded run. Both are reported by summary() with
     the observed maximum, because a constant that never binds anything is the
     kind of thing this project has twice found pretending to be a control. It
     is asserted below to be shorter than the SHORTEST lifetime in the signal
     catalog, which is the whole point: whichever bound binds, both records of
     one act are guaranteed co-active, by construction, without any decay
     constant being changed. */
  const SAME_ACT_SECONDS = 900;

  /* Three of thirteen. Each row quotes the sentence from
     docs/real-world-mo-ingestion.md it is derived from, because a companion
     record with no source is this module inventing evidence. `companion` is
     always a type behaviorEngine already declares -- asserted, handed in, never
     read from a private copy -- and always a DIFFERENT type from the primary,
     because two records of the same type cannot satisfy MIN_SIGNAL_TYPES and a
     row that could not help would be decoration. */
  const COMPOSITE_ACTS = {
    STAGED_BREAKDOWN: {
      companion: 'UNEXPECTED_STOP',
      source: 'docs/real-world-mo-ingestion.md',
      quote: 'a driver reports a mechanical issue and detaches the trailer at an undocumented, off-site location',
      halves: ['the reported mechanical issue', 'the vehicle standing at an undocumented location'],
      why: 'The report is a claim made to a system. The stop is a physical fact a tracker sees. The sentence names both and the engine recorded only the claim.'
    },
    EQUIPMENT_CARRIER_MISMATCH: {
      companion: 'MANIFEST_CHANGED',
      source: 'docs/real-world-mo-ingestion.md',
      quote: 'a pickup is performed with a tractor/trailer registered to a different carrier than the one assigned to the run',
      halves: ['the equipment that arrived', 'the run paperwork amended to what arrived'],
      why: 'A mismatch is not observable as one fact. It is a disagreement between the equipment and the record of the run, and the operation closes that disagreement by amending the record at the gate.'
    },
    FALSE_MILESTONE_STAMP: {
      companion: 'HANDOVER_GAP',
      source: 'docs/real-world-mo-ingestion.md',
      quote: 'a system delivery/arrival stamp fires with no confirmed physical arrival at the destination',
      halves: ['the stamp that claims the arrival', 'the receiving end that never confirmed the load'],
      why: 'The stamp is the claim. "No confirmed physical arrival" is the second, separately recorded fact: the load is unconfirmed at the point it should have been received.'
    }
  };

  /* THE OTHER TEN, EACH WITH THE REASON IT GETS NOTHING. A table of three
     exceptions and a silent remainder is a table that will grow by guesswork.
     Ten of thirteen primitives are single observable facts and this slice
     deliberately leaves them that way -- adding a companion to a type whose
     source does not describe one would be manufacturing correlatable evidence,
     which is the same fault as raising the disruption rate, only harder to see. */
  const SINGLE_FACT = {
    UNEXPECTED_STOP: 'A stop is one observation. Nothing else is implied by a vehicle standing still.',
    ROUTE_DEVIATION: 'A deviation is one observation, and nothing in this build physically deviates anyway (intentEngine.NOT_MODELLED).',
    DRIVER_CHANGED: 'A crew change is one recorded fact and a legitimate one most of the time. It is also the mutation that makes a planned driver dormant, so giving it a second record would change how intent decays for a reason that has nothing to do with evidence.',
    TRAILER_SWAPPED: 'A swap is one recorded fact. The seal-and-swap PATTERN pairs it with a seal check, but the taxonomy is a pattern over acts, not a description of one act, and pairing them here would assert that a swap is always accompanied by a mismatched seal.',
    MANIFEST_CHANGED: 'A manifest amendment is one record. It is also a companion above, and a companion may not have a companion.',
    SEAL_MISMATCH: 'A seal that does not match its record is one observation. The physical-defeat evidence FFT-007 lists is a later inspection finding, not a second record of the same moment.',
    GPS_SIGNAL_LOST: 'A telemetry gap is the absence of records, so a second record of it is a contradiction.',
    CARRIER_UNRESPONSIVE: 'The source sentence is "a carrier stops responding ... escalation stalls on silence rather than evidence". Silence is precisely what leaves no second record.',
    DUPLICATE_ASSET_ID: 'The source DOES describe two observations -- "the same identifier appears active in two places at once" -- but the second place is ANOTHER TRUCK, and moEngine correlates per entity, so that record belongs on a different case. Writing it against this truck would be a lie about where it was seen. Named here rather than skipped: it is the one row this slice leaves on the table, and it is Phase D work because it needs the other entity.',
    HANDOVER_GAP: 'An unconfirmed load is one absence at one handover point. It is also a companion above.'
  };

  const RECORD_SCOPE = {
    kind: 'MODEL',
    scope: 'how many records ONE act leaves behind',
    means: 'three of thirteen disruption primitives are described by their own provenance note as two observable halves, so they now write two records, separated by less than one sampled interval.',
    doesNotMean: 'that more acts happen, that acts happen more often, or that an act is more likely to be fraudulent. The act rate is DISRUPTION_CHANCE_PER_TICK and this module is never consulted until an act has already been granted and applied.'
  };

  /* GROUND TRUTH IS A PROPERTY OF THE ACT, NOT OF THE RECORD.

     falsePositiveEngine.annotate draws `legitimate` at LEGITIMATE_CHANCE per
     EVENT. Left alone, two records of one act would be labelled independently,
     and roughly one act in three would be simultaneously "a genuine mechanical
     failure with a repair receipt on file" and fraudulent -- one act with two
     contradictory answers in the answer key that outcomeEngine resolves cases
     from. So the companion INHERITS the act legitimacy and draws only its own
     innocent cause, from its own catalog, because a benign explanation for a
     stop is not a benign explanation for a breakdown report.

     This does not change LEGITIMATE_CHANCE and does not change the share of
     ACTS that are fraudulent: the draw still happens exactly once per act, at
     0.65, in falsePositiveEngine, from the same stream. It changes only that one
     act now carries one answer. */
  const GROUND_TRUTH_INHERITANCE = {
    rule: 'the companion record carries the act legitimacy, and draws its own innocent cause from its own catalog',
    why: 'one act cannot be both benign and not benign; two independent draws for one act would put two answers in the answer key',
    unchanged: ['FWFalsePositiveEngine.LEGITIMATE_CHANCE', 'the number of draws per act', 'the fraudulent share of acts']
  };

  function isComposite(type) {
    return Object.prototype.hasOwnProperty.call(COMPOSITE_ACTS, type);
  }

  function compositeTypes() { return Object.keys(COMPOSITE_ACTS); }

  function entryFor(type) { return COMPOSITE_ACTS[type] || null; }

  /* Returns the second record this act should leave, or null if the act is one
     of the ten that leaves one. `sampleSeconds` is the interval the caller
     sampled the world over (simRunner's dtSeconds); the separation is drawn
     inside whichever of it and SAME_ACT_SECONDS is smaller, and never zero,
     because two records at the identical timestamp would make the separation
     unmeasurable and the co-activity claim untestable.

     The draw is made HERE and only for a composite type, so the seeded stream
     is untouched for the ten types that have no companion. */
  function companionFor(type, rng, sampleSeconds) {
    const entry = entryFor(type);
    if (!entry) return null;
    if (!rng || typeof rng.int !== 'function') {
      throw new Error('FWActEngine.companionFor: a companion record needs the seeded rng that produced the act, ' +
        'so that the separation between two records of one act is part of the same deterministic run.');
    }
    /* A zero-length sample clamps to one second, it does NOT fall back to the
       ceiling. `sampleSeconds || SAME_ACT_SECONDS` was the first version of this
       line and it silently widened a zero-length interval to the full 900 s,
       which is the one case where the separation could have landed outside the
       interval it was supposed to be inside. */
    const asked = (sampleSeconds === undefined || sampleSeconds === null) ? SAME_ACT_SECONDS : Math.floor(sampleSeconds);
    const bound = Math.max(1, Math.min(SAME_ACT_SECONDS, asked));
    const separation = rng.int(1, bound);
    return {
      type: entry.companion,
      primaryType: type,
      separationSeconds: separation,
      bound: bound,
      boundedBy: bound < SAME_ACT_SECONDS ? 'SAMPLED_INTERVAL' : 'SAME_ACT_SECONDS',
      why: entry.why,
      quote: entry.quote
    };
  }

  function createTracker() {
    return {
      compositeActs: 0, companionsRecorded: 0, companionsRefused: 0, companionsUnobserved: 0,
      byPrimary: {}, maxSeparation: 0, sumSeparation: 0, separationSamples: 0,
      boundedBy: { SAMPLED_INTERVAL: 0, SAME_ACT_SECONDS: 0 }
    };
  }

  /* `outcome` is the event applyDisruption returned for the companion: an event,
     an { unrecorded: true } stand-in, or null. All three are counted, because a
     companion applyDisruption REFUSED (no spare trailer, no other active
     carrier) is not the same fact as one that happened unobserved, and neither
     is the same fact as one that was written down. A tracker that counted only
     the third would report a hit rate with no denominator. */
  function record(tracker, primaryType, companion, outcome) {
    if (!tracker) return tracker;
    tracker.compositeActs += 1;
    const key = primaryType + '->' + (companion ? companion.type : 'NONE');
    tracker.byPrimary[key] = (tracker.byPrimary[key] || 0) + 1;
    if (companion) {
      tracker.separationSamples += 1;
      tracker.sumSeparation += companion.separationSeconds;
      if (companion.separationSeconds > tracker.maxSeparation) tracker.maxSeparation = companion.separationSeconds;
      tracker.boundedBy[companion.boundedBy] += 1;
    }
    if (!outcome) tracker.companionsRefused += 1;
    else if (outcome.unrecorded) tracker.companionsUnobserved += 1;
    else tracker.companionsRecorded += 1;
    return tracker;
  }

  function summary(tracker) {
    const t = tracker || createTracker();
    const denom = t.compositeActs;
    return {
      compositeActs: denom,
      companionsRecorded: t.companionsRecorded,
      companionsRefused: t.companionsRefused,
      companionsUnobserved: t.companionsUnobserved,
      recordedShare: denom ? t.companionsRecorded / denom : null,
      shareBasis: 'companion records written down, over composite acts applied. Null means no composite act happened, which is not a rate of zero.',
      byPrimary: t.byPrimary,
      maxSeparationSeconds: t.separationSamples ? t.maxSeparation : null,
      meanSeparationSeconds: t.separationSamples ? Math.round(t.sumSeparation / t.separationSamples) : null,
      declaredCeilingSeconds: SAME_ACT_SECONDS,
      boundedBy: t.boundedBy,
      ceilingNote: t.boundedBy.SAME_ACT_SECONDS === 0 && t.separationSamples > 0
        ? 'SAME_ACT_SECONDS (' + SAME_ACT_SECONDS + ' s) bound nothing on this run: the sampled interval was shorter every time, so it is a declared ceiling and not the constant in force.'
        : 'SAME_ACT_SECONDS bound the separation on ' + t.boundedBy.SAME_ACT_SECONDS + ' of ' + t.separationSamples + ' companion records.',
    };
  }

  /* Handed the caller's list rather than reading a private copy, so a planted
     list makes the guard fire (convention 34). Every primary and every companion
     must be a type behaviorEngine can actually apply; a companion naming a type
     that does not exist would silently produce no record at all, for every act,
     forever, and the only symptom would be a number that did not move. */
  function assertTypesDeclared(disruptionTypes) {
    const declared = new Set(disruptionTypes || []);
    if (!declared.size) {
      throw new Error('FWActEngine.assertTypesDeclared: no disruption-type list was handed in, so nothing was checked.');
    }
    Object.keys(COMPOSITE_ACTS).forEach(primary => {
      const entry = COMPOSITE_ACTS[primary];
      if (!declared.has(primary)) {
        throw new Error('FWActEngine: composite act "' + primary + '" is not a disruption type this build applies.');
      }
      if (!declared.has(entry.companion)) {
        throw new Error('FWActEngine: composite act "' + primary + '" names companion "' + entry.companion +
          '", which is not a disruption type this build applies, so the second half of the act would never be recorded.');
      }
      if (entry.companion === primary) {
        throw new Error('FWActEngine: composite act "' + primary + '" is its own companion. Two records of one type ' +
          'cannot satisfy moEngine.MIN_SIGNAL_TYPES, so the row could not help a case and would only add volume.');
      }
      if (isComposite(entry.companion)) {
        throw new Error('FWActEngine: companion "' + entry.companion + '" is itself a composite act, which would make ' +
          'one granted opportunity emit a chain of records. An act has halves, not descendants.');
      }
    });
    // Every type is either composite or declared single-fact, with a reason.
    const missing = [...declared].filter(t => !isComposite(t) && !SINGLE_FACT[t]);
    if (missing.length) {
      throw new Error('FWActEngine: disruption type(s) ' + missing.join(', ') + ' are neither composite nor declared ' +
        'single-fact. A type with no row is indistinguishable from a type nobody thought about.');
    }
    const stale = Object.keys(SINGLE_FACT).filter(t => !declared.has(t));
    if (stale.length) {
      throw new Error('FWActEngine: SINGLE_FACT names ' + stale.join(', ') + ', which this build does not apply.');
    }
    return { declared: declared.size, composite: Object.keys(COMPOSITE_ACTS).length, singleFact: Object.keys(SINGLE_FACT).length };
  }

  /* THE GUARD THIS SLICE IS FOR. Both records of one act have to be co-active,
     or the module has done nothing. That is not hoped for: SAME_ACT_SECONDS is
     asserted shorter than the SHORTEST lifetime in the catalog, so the earlier
     record is still alive when the later one is created no matter which type
     pair fires and no matter which bound binds the separation. Slice 66 found a
     decay window in this codebase that had never been shown to work; this is the
     version of that claim that cannot rot, because it is arithmetic over the
     shipped catalog rather than an observation of one run. */
  function assertCompanionsCoActive(catalog) {
    if (!catalog) throw new Error('FWActEngine.assertCompanionsCoActive: no signal catalog handed in.');
    const decayOf = (t) => {
      const key = Object.keys(catalog).find(k => catalog[k].signalType === t);
      return key ? catalog[key].decaySeconds : null;
    };
    const rows = [];
    Object.keys(COMPOSITE_ACTS).forEach(primary => {
      const companion = COMPOSITE_ACTS[primary].companion;
      const a = decayOf(primary), b = decayOf(companion);
      if (a == null || b == null) {
        throw new Error('FWActEngine: ' + primary + '/' + companion + ' -- one half of this act derives no signal at ' +
          'all, so the pair can never be correlated and the row is a record with no consequence.');
      }
      const shortest = Math.min(a, b);
      if (SAME_ACT_SECONDS >= shortest) {
        throw new Error('FWActEngine: SAME_ACT_SECONDS is ' + SAME_ACT_SECONDS + ' but ' + primary + '/' + companion +
          ' has a shortest lifetime of ' + shortest + ' s, so two records of one act could expire apart. The point of ' +
          'this module is that they cannot.');
      }
      rows.push({ primary, companion, primaryDecay: a, companionDecay: b, marginSeconds: shortest - SAME_ACT_SECONDS });
    });
    return { rows, worstMarginSeconds: Math.min.apply(null, rows.map(r => r.marginSeconds)) };
  }

  /* THE GUARD AGAINST THIS MODULE BECOMING A CASE GENERATOR. If one composite
     act cleared moEngine's own CREATE_THRESHOLD by itself, then every staged
     breakdown would raise a case and this slice would have replaced a measured
     mismatch with a manufactured hit rate -- the forbidden shortcut, arrived at
     by a different road. The threshold and the scoring rule are moEngine's and
     are handed in, never restated here. */
  function assertNoCompositeOpensACaseAlone(catalog, threshold, minTypes, scoreFn) {
    if (!catalog || typeof threshold !== 'number' || typeof scoreFn !== 'function') {
      throw new Error('FWActEngine.assertNoCompositeOpensACaseAlone: needs the signal catalog, moEngine.CREATE_THRESHOLD ' +
        'and moEngine.scoreSignals. Restating any of them here would let the two drift apart silently.');
    }
    const defOf = (t) => {
      const key = Object.keys(catalog).find(k => catalog[k].signalType === t);
      return key ? catalog[key] : null;
    };
    const rows = [];
    Object.keys(COMPOSITE_ACTS).forEach(primary => {
      const companion = COMPOSITE_ACTS[primary].companion;
      const pair = [defOf(primary), defOf(companion)];
      const score = scoreFn(pair.map(d => ({ weight: d.weight, reliability: d.reliability })));
      if (score >= threshold) {
        throw new Error('FWActEngine: ' + primary + ' + ' + companion + ' scores ' + score.toFixed(2) +
          ' against CREATE_THRESHOLD ' + threshold + ', so one act would open a case on its own. This module exists ' +
          'to make two acts correlatable, not to make one act sufficient.');
      }
      rows.push({ pair: primary + ' + ' + companion, distinctTypes: 2, score: Math.round(score * 100) / 100,
        threshold: threshold, shortfall: Math.round((threshold - score) * 100) / 100 });
    });
    return {
      rows,
      minTypesMet: minTypes <= 2,
      note: 'Each composite act supplies ' + minTypes + ' distinct co-active types, which meets MIN_SIGNAL_TYPES, and ' +
        'still scores below CREATE_THRESHOLD. A case therefore still needs a second act to coincide with the first.'
    };
  }

  /* LOAD-TIME RECONCILIATION. This module is loaded AFTER behaviorEngine,
     signalEngine and moEngine precisely so that all three vocabularies exist
     here and none of them has to be copied. behaviorEngine consults this module
     at step time through `window.FWActEngine`, the same optional-module shape it
     already uses for shiftEngine and facilityEngine, so a suite that boots
     behaviour alone still gets the pre-Slice-74 world.

     Every one of these is a reconciliation between two vocabularies that would
     otherwise fail silently, hours into a run, on one seed and not another. */
  const TYPE_RECONCILIATION = assertTypesDeclared(FWBehaviorEngine.DISRUPTION_TYPES);
  const CO_ACTIVITY = assertCompanionsCoActive(FWSignalEngine.SIGNAL_CATALOG);
  const CASE_FLOOR = assertNoCompositeOpensACaseAlone(
    FWSignalEngine.SIGNAL_CATALOG, FWMoEngine.CREATE_THRESHOLD, FWMoEngine.MIN_SIGNAL_TYPES, FWMoEngine.scoreSignals);

  return {
    SAME_ACT_SECONDS, COMPOSITE_ACTS, SINGLE_FACT, RECORD_SCOPE, GROUND_TRUTH_INHERITANCE,
    isComposite, compositeTypes, entryFor, companionFor,
    createTracker, record, summary,
    assertTypesDeclared, assertCompanionsCoActive, assertNoCompositeOpensACaseAlone,
    TYPE_RECONCILIATION, CO_ACTIVITY, CASE_FLOOR
  };
})();
