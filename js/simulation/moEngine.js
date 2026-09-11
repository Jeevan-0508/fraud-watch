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
   generic if nothing matches confidently. */
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
    UNEXPECTED_STOP: []
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

  function matchPattern(signals) {
    if (typeof FW === 'undefined' || !FW.patterns) return null;
    const patterns = FW.patterns();
    if (!patterns || !patterns.length) return null;

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
    if (!votes.size) return null;

    let bestId = null, bestVotes = 0;
    votes.forEach((v, id) => { if (v > bestVotes) { bestVotes = v; bestId = id; } });
    return patterns.find(p => p.id === bestId) || null;
  }

  function buildEvidence(signals) {
    return signals
      .map(s => ({ signalType: s.type, contribution: Math.round(s.weight * s.reliability * 10) / 10, reliability: s.reliability, at: s.createdAt }))
      .sort((a, b) => a.at - b.at);
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
    const pattern = matchPattern(signals);

    return {
      id,
      title: pattern ? `Possible ${pattern.name}` : 'Unclassified correlated anomaly',
      category: pattern ? pattern.category : 'unclassified',
      confidence,
      severity: confidenceLabel(confidence),
      status: 'NEW',
      entities: { truckId: truck.id, driverId: truck.driverId, trailerId: truck.trailerId, carrierId: truck.carrierId },
      signals: signals.map(s => s.id),
      timeline: signals.map(s => ({ t: s.createdAt, type: s.type })).sort((a, b) => a.t - b.t),
      relatedPattern: pattern ? pattern.id : null,
      falsePositivePossibilities: pattern ? pattern.false_positives.slice(0, 2) : [],
      recommendedActions: recommendedActionsFor(pattern),
      evidence: buildEvidence(signals),
      firstObserved: Math.min(...signals.map(s => s.createdAt)),
      lastObserved: now,
      resolutionReason: null
    };
  }

  function refreshMo(mo, signals, now) {
    mo.signals = signals.map(s => s.id);
    mo.timeline = signals.map(s => ({ t: s.createdAt, type: s.type })).sort((a, b) => a.t - b.t);
    mo.evidence = buildEvidence(signals);
    const confidence = confidenceFromScore(scoreSignals(signals));
    mo.confidence = confidence;
    mo.severity = confidenceLabel(confidence);
    mo.lastObserved = now;
  }

  function createEngine() {
    return { nextMoId: 1, mos: new Map(), byEntity: new Map() };
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
          existing.resolutionReason = 'Signals faded before correlation was sustained.';
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
    if (reason) mo.resolutionReason = reason;
  }

  return {
    createEngine, process, setStatus, scoreSignals, matchPattern,
    confidenceFromScore, confidenceLabel, buildEvidence, recommendedActionsFor,
    OPEN_STATUSES, CLOSED_STATUSES, CREATE_THRESHOLD, MIN_SIGNAL_TYPES
  };
})();
