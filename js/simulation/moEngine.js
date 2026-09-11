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

  function confidenceLabel(score) {
    if (score <= 20) return 'LOW';
    if (score <= 40) return 'WATCH';
    if (score <= 60) return 'ELEVATED';
    if (score <= 80) return 'HIGH';
    return 'CRITICAL';
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
      .map(s => ({ signalId: s.id, signalType: s.type, contribution: Math.round(s.weight * s.reliability * 10) / 10, reliability: s.reliability, at: s.createdAt }))
      .sort((a, b) => a.at - b.at);
  }

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

    return {
      id,
      title: pattern ? `Possible ${pattern.name}` : 'Unclassified correlated anomaly',
      category: pattern ? pattern.category : 'unclassified',
      confidence,
      baseConfidence: confidence,
      investigationAdjustment: 0,
      investigation: { findings: [], completed: [], effortSeconds: 0 },
      severity: confidenceLabel(confidence),
      status: 'NEW',
      classification,
      noveltyScore,
      recurrenceCount: priorCount + 1,
      signature,
      entities: { truckId: truck.id, driverId: truck.driverId, trailerId: truck.trailerId, carrierId: truck.carrierId },
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
    mo.severity = confidenceLabel(mo.confidence);
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

  function setStatus(mo, status, reason) {
    mo.status = status;
    mo.autoFaded = false; // an analyst has now touched it, whatever it was before
    if (reason) mo.resolutionReason = reason;
  }

  return {
    createEngine, process, setStatus, recomputeConfidence, scoreSignals, mergeEvidence, matchPattern, rankPatterns,
    confidenceFromScore, confidenceLabel, buildEvidence, recommendedActionsFor,
    signalSignature, classifyDiscovery, noveltyFromRecurrence, discoverySummary,
    OPEN_STATUSES, CLOSED_STATUSES, CREATE_THRESHOLD, MIN_SIGNAL_TYPES
  };
})();
