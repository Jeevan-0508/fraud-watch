/* simulation/outcomeEngine.js — scores the analyst's own closing verdicts
   against what the simulation actually recorded (mega-spec Phases 30/58).
   This only became possible in Slice 11: before investigative actions
   existed there was no honest way to check a verdict, because nothing
   connected the player's decision to the falsePositiveEngine answer key.

   WHAT THE ANSWER KEY ACTUALLY SAYS -- this is the whole reason the
   vocabulary below is careful. Each signal on a case either has a
   documented benign cause on record, or it does not. So a case's recorded
   state is one of:
     FULLY_EXPLAINED       - every signal has a documented benign cause
     PARTIALLY_UNEXPLAINED - some do, some don't
     UNEXPLAINED           - none do
   "UNEXPLAINED" is NOT "fraud". It means the simulation holds no innocent
   explanation for it, which is an absence in the records, not a proven
   act. Nothing in this module ever labels a case fraudulent, and nothing
   calls the analyst "right" or "wrong" -- verdicts are scored as ALIGNED
   / OVERCALLED / UNDERCALLED / AMBIGUOUS with respect to the record, and
   a PARTIALLY_UNEXPLAINED case is AMBIGUOUS by construction because
   neither closing verdict is unreasonable on that evidence.

   This is a calibration mirror, not a score. It reports tendencies (how
   often you closed a case without checking any records first, how often
   you called it before the evidence was in) and it reports them against
   the SIMULATION's own answer key, never as a real-world base rate. No
   monetary figure is produced here. The effort each closed case consumed
   is recorded on its ledger entry in seconds, and exposureModel.js
   (Phase 50) is the only module allowed to price it.

   ONE MORE DISTINCTION, added once record checks could come back
   structurally empty (Slice 18's NO_RECORD_EXISTS): a case closed after
   checks that ALL returned "there was nothing to fetch" is neither blind
   nor informed. The analyst looked, spent the effort, and the port's
   coverage meant there was nothing to look at. Its alignment is still
   scored -- the answer key exists whether or not the analyst could reach
   it -- but that alignment measures this port's coverage as much as the
   judgement, so it is counted and reported separately.

   Those cases are deliberately NOT excluded from the rates the way
   AMBIGUOUS ones are. AMBIGUOUS is excluded because neither verdict was
   unreasonable on the evidence; this is different -- the record is
   unmixed, and dropping these cases would measure calibration only over
   the cases the port happened to be able to see, which flatters the
   analyst by shrinking the denominator wherever watching is thin. */
const FWOutcomeEngine = (() => {
  const MIN_SAMPLE_FOR_RATES = 5; // below this, report counts only, no percentages

  // Only these are a claim about what the case WAS. RESOLVED/DISMISSED
  // are process outcomes ("handled", "not worth pursuing") and are logged
  // without being scored, because they assert nothing to be checked.
  const VERDICT_STATUSES = new Set(['CONFIRMED', 'FALSE_POSITIVE']);
  const PROCESS_STATUSES = new Set(['RESOLVED', 'DISMISSED']);

  function createEngine() {
    return { ledger: [], byMo: new Map() };
  }

  // Reads the hidden per-signal answer key for every signal the case was
  // ever built on (the accumulated record, not just the active set).
  function recordedState(state, mo) {
    const signals = FWInvestigationEngine.signalsForMo(state, mo);
    const known = signals.filter(s => s.groundTruth);
    if (!known.length) return { state: 'NO_RECORD', explained: 0, total: signals.length, causes: [] };
    const explained = known.filter(s => s.groundTruth.legitimate);
    const causes = Array.from(new Set(explained.map(s => s.groundTruth.cause).filter(Boolean)));
    let label;
    if (explained.length === known.length) label = 'FULLY_EXPLAINED';
    else if (explained.length === 0) label = 'UNEXPLAINED';
    else label = 'PARTIALLY_UNEXPLAINED';
    return { state: label, explained: explained.length, total: known.length, causes };
  }

  function scoreVerdict(verdict, recorded) {
    if (recorded.state === 'NO_RECORD') return 'UNSCORABLE';
    if (recorded.state === 'PARTIALLY_UNEXPLAINED') return 'AMBIGUOUS';
    if (verdict === 'CONFIRMED') {
      return recorded.state === 'UNEXPLAINED' ? 'ALIGNED' : 'OVERCALLED';
    }
    if (verdict === 'FALSE_POSITIVE') {
      return recorded.state === 'FULLY_EXPLAINED' ? 'ALIGNED' : 'UNDERCALLED';
    }
    return 'UNSCORABLE';
  }

  function narrate(verdict, recorded, alignment, checksRun, noRecordChecks) {
    const blind = checksRun === 0 ? ' Closed without checking any record source first.' : '';
    const unseeable = (checksRun > 0 && noRecordChecks === checksRun)
      ? ` All ${checksRun} record check${checksRun === 1 ? '' : 's'} run on this case came back with nothing to fetch, so the record this verdict is checked against was never available to the analyst.`
      : '';
    if (alignment === 'UNSCORABLE') {
      return `No answer key is held for this case's signals, so this verdict cannot be checked against anything.${blind}${unseeable}`;
    }
    if (alignment === 'AMBIGUOUS') {
      return `The records account for ${recorded.explained} of ${recorded.total} signals on this case and leave the rest unaccounted for. Neither closing verdict is unreasonable on that evidence, so this one is not scored either way.${blind}${unseeable}`;
    }
    if (verdict === 'CONFIRMED' && alignment === 'ALIGNED') {
      return `No documented benign cause exists for any of the ${recorded.total} signals on this case. That is consistent with the call, though an absence of explanation is still not proof of an act.${blind}${unseeable}`;
    }
    if (verdict === 'CONFIRMED' && alignment === 'OVERCALLED') {
      return `The simulation held a documented benign cause for all ${recorded.total} signals on this case (${recorded.causes.join('; ')}). Escalating it was an over-call against the record.${blind}${unseeable}`;
    }
    if (verdict === 'FALSE_POSITIVE' && alignment === 'ALIGNED') {
      return `Every signal on this case had a documented benign cause on record (${recorded.causes.join('; ')}), consistent with clearing it.${blind}${unseeable}`;
    }
    return `No documented benign cause existed for any of the ${recorded.total} signals on this case, yet it was cleared. That is an under-call against the record — which is not the same as saying something happened.${blind}${unseeable}`;
  }

  // Called when an analyst sets a terminal status on a case. Returns the
  // ledger entry, or null if the status asserts nothing checkable.
  function recordVerdict(state, mo, status) {
    if (!state || !state.outcomeEngine || !mo) return null;
    const engine = state.outcomeEngine;
    const isVerdict = VERDICT_STATUSES.has(status);
    if (!isVerdict && !PROCESS_STATUSES.has(status)) return null;

    const inv = FWInvestigationEngine.summary(mo);
    const recorded = recordedState(state, mo);
    const alignment = isVerdict ? scoreVerdict(status, recorded) : 'NOT_A_CLAIM';
    const entry = {
      moId: mo.id,
      verdict: status,
      scored: isVerdict,
      alignment,
      recordedState: recorded.state,
      explainedSignals: recorded.explained,
      totalSignals: recorded.total,
      checksRun: inv.checksRun,
      noRecordChecks: inv.noRecordChecks,
      // Looked, and there was structurally nothing to look at. Kept as its
      // own flag so it can never be read as "did not look".
      checksAllUnseeable: inv.checksRun > 0 && inv.noRecordChecks === inv.checksRun,
      effortSeconds: inv.effortSeconds,
      confidenceAtClose: mo.confidence,
      at: FWSimRunner.absoluteNow(state.clock),
      narrative: isVerdict
        ? narrate(status, recorded, alignment, inv.checksRun, inv.noRecordChecks)
        : `Closed as ${status.replace(/_/g, ' ').toLowerCase()} — a process outcome, which makes no claim about what the case was, so nothing is scored.`
    };

    const previous = engine.byMo.get(mo.id);
    if (previous) engine.ledger = engine.ledger.filter(e => e.moId !== mo.id); // one live verdict per case
    engine.ledger.push(entry);
    engine.byMo.set(mo.id, entry);
    mo.verdictOutcome = entry;
    return entry;
  }

  function calibration(engine) {
    const scored = engine.ledger.filter(e => e.scored && e.alignment !== 'UNSCORABLE');
    const counts = { ALIGNED: 0, OVERCALLED: 0, UNDERCALLED: 0, AMBIGUOUS: 0 };
    scored.forEach(e => { if (counts[e.alignment] != null) counts[e.alignment]++; });
    const decisive = scored.filter(e => e.alignment !== 'AMBIGUOUS');
    const blind = scored.filter(e => e.checksRun === 0);
    // See the header: counted, reported, and NOT removed from the rates.
    const unseeable = decisive.filter(e => e.checksAllUnseeable);
    const effort = scored.reduce((sum, e) => sum + e.effortSeconds, 0);
    const enough = decisive.length >= MIN_SAMPLE_FOR_RATES;
    return {
      totalClosed: engine.ledger.length,
      scoredCount: scored.length,
      decisiveCount: decisive.length,
      counts,
      blindCount: blind.length,
      unseeableCount: unseeable.length,
      totalEffortSeconds: effort,
      // Rates are withheld below the minimum sample rather than shown as
      // a noisy single-digit percentage that would read as a measurement.
      rates: enough ? {
        aligned: counts.ALIGNED / decisive.length,
        overcalled: counts.OVERCALLED / decisive.length,
        undercalled: counts.UNDERCALLED / decisive.length,
        blind: blind.length / scored.length
      } : null,
      minSample: MIN_SAMPLE_FOR_RATES,
      tendency: enough ? (counts.OVERCALLED === counts.UNDERCALLED ? 'BALANCED'
        : counts.OVERCALLED > counts.UNDERCALLED ? 'LEANS_OVERCALL' : 'LEANS_UNDERCALL') : null
    };
  }

  return {
    createEngine, recordVerdict, recordedState, scoreVerdict, calibration,
    VERDICT_STATUSES, PROCESS_STATUSES, MIN_SAMPLE_FOR_RATES
  };
})();
