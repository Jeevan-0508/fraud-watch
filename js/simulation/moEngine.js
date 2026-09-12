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

  function confidenceFromScore(rawScore) {
    // Calibrated, not precise: 2 mid-weight signals should land WATCH/
    // ELEVATED, a genuine chain of 4-5 should reach HIGH/CRITICAL.
    return Math.max(1, Math.min(100, Math.round(rawScore * 12)));
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

  function classifyDiscovery(ranked, priorCount) {
    const topVotes = ranked.length ? ranked[0].votes : 0;
    if (!ranked.length) return 'EMERGING_BEHAVIOR';       // no resemblance to anything known
    if (priorCount === 0) return topVotes >= 3 ? 'MO_VARIANT' : 'POTENTIAL_NEW_MO';
    if (priorCount < 3) return 'POTENTIAL_NEW_MO';
    return 'KNOWN_MO';                                     // recurring combination, well understood by now
  }

  function noveltyFromRecurrence(priorCount) {
    return Math.max(5, 100 - priorCount * 18);
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
    mo.confidence = Math.max(1, Math.min(100, Math.round(base + adj)));
    mo.confidenceBand = confidenceLabel(mo.confidence);
    return mo.confidence;
  }

  function refreshMo(mo, signals, now) {
    mergeEvidence(mo, signals);
    mo.baseConfidence = confidenceFromScore(scoreSignals(signals));
    recomputeConfidence(mo);
    mo.lastObserved = now;
  }

  function createEngine() {
    return { nextMoId: 1, mos: new Map(), byEntity: new Map(), signatures: new Map() };
  }

  // Snapshot of the discovery engine's own history -- how many
  // distinct signal-combinations it has ever seen, and which are
  // still rare/novel. Useful for a "what's new" summary view.
  function discoverySummary(engine) {
    const all = Array.from(engine.mos.values());
    const byClass = { KNOWN_MO: 0, MO_VARIANT: 0, POTENTIAL_NEW_MO: 0, EMERGING_BEHAVIOR: 0 };
    all.forEach(mo => { if (byClass[mo.classification] != null) byClass[mo.classification]++; });
    return { totalSignatures: engine.signatures.size, totalMos: all.length, byClassification: byClass };
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
    signalSignature, classifyDiscovery, noveltyFromRecurrence, discoverySummary,
    closureHand, CLOSURE_HAND, CLOSURE_HAND_NOTE,
    OPEN_STATUSES, CLOSED_STATUSES, CREATE_THRESHOLD, MIN_SIGNAL_TYPES
  };
})();
