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
   analyst by shrinking the denominator wherever watching is thin.

   SLICE 28 -- WHAT THAT DISTINCTION MISSED. The two facts above (closed
   with no check at all, closed after checks that ALL came back with
   nothing to fetch) were the only examination facts this ledger recorded,
   and they were written before investigationEngine gained the shared
   four-class vocabulary. Between them they leave two kinds of closure
   uncounted, and both read as an informed one:
     - every check came back INCONCLUSIVE (the source could not be
       reached). Not blind, not structurally empty, and nothing was ever
       answered.
     - a mix of empty and unreachable checks, none of which answered.
       Not "all unseeable", so it fell through both flags.
   The error only ever ran one way: it could overstate how far the closed
   caseload had been taken, never understate it. Every closure now carries
   the shared examinationClass, sorted by investigationEngine's own
   precedence rule, so the panel can report the four disjoint classes over
   one base instead of two overlapping flags over two.

   What does NOT follow from that, and is refused in NOT_MODELLED below: a
   comparison of alignment between the cases that got an answer and the
   cases that did not. Which cases get checked is chosen by the analyst,
   and which cases have records to pull is a property of where the port
   watches -- both correlated with what the answer key holds. A split like
   that would read as "looking harder makes the calls better" from a
   simulation that cannot support the claim. */
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

  // One sentence about how far the case was taken, keyed on the shared
  // examination class so each of the three ways of learning nothing gets
  // its own words. None of them says the verdict was wrong.
  function examinationSentence(ex) {
    const n = ex.checksRun;
    const plural = n === 1 ? '' : 's';
    if (ex.examinationClass === 'NEVER_LOOKED') {
      return ' Closed without checking any record source first.';
    }
    if (ex.examinationClass === 'NOTHING_TO_FETCH') {
      return ` ${n} record check${plural} were run on this case and none of them answered; at least one found there was no record of that kind to fetch, so the record this verdict is checked against was never available to the analyst.`;
    }
    if (ex.examinationClass === 'UNREACHABLE') {
      return ` ${n} record check${plural} were run on this case and none of them answered: the sources could not be reached or their records were incomplete. The effort was spent and nothing about the case came back.`;
    }
    return '';
  }

  function narrate(verdict, recorded, alignment, examined) {
    if (alignment === 'UNSCORABLE') {
      return `No answer key is held for this case's signals, so this verdict cannot be checked against anything.${examined}`;
    }
    if (alignment === 'AMBIGUOUS') {
      return `The records account for ${recorded.explained} of ${recorded.total} signals on this case and leave the rest unaccounted for. Neither closing verdict is unreasonable on that evidence, so this one is not scored either way.${examined}`;
    }
    if (verdict === 'CONFIRMED' && alignment === 'ALIGNED') {
      return `No documented benign cause exists for any of the ${recorded.total} signals on this case. That is consistent with the call, though an absence of explanation is still not proof of an act.${examined}`;
    }
    if (verdict === 'CONFIRMED' && alignment === 'OVERCALLED') {
      return `The simulation held a documented benign cause for all ${recorded.total} signals on this case (${recorded.causes.join('; ')}). Escalating it was an over-call against the record.${examined}`;
    }
    if (verdict === 'FALSE_POSITIVE' && alignment === 'ALIGNED') {
      return `Every signal on this case had a documented benign cause on record (${recorded.causes.join('; ')}), consistent with clearing it.${examined}`;
    }
    return `No documented benign cause existed for any of the ${recorded.total} signals on this case, yet it was cleared. That is an under-call against the record — which is not the same as saying something happened.${examined}`;
  }

  // Called when an analyst sets a terminal status on a case. Returns the
  // ledger entry, or null if the status asserts nothing checkable.
  function recordVerdict(state, mo, status) {
    if (!state || !state.outcomeEngine || !mo) return null;
    const engine = state.outcomeEngine;
    const isVerdict = VERDICT_STATUSES.has(status);
    if (!isVerdict && !PROCESS_STATUSES.has(status)) return null;

    const inv = FWInvestigationEngine.summary(mo);
    // Snapshot of how far the case had been taken at the moment it was
    // closed, in the shared vocabulary rather than in flags local to here.
    const ex = FWInvestigationEngine.examination(mo);
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
      answeredChecks: ex.answeredChecks,
      inconclusiveChecks: ex.inconclusiveChecks,
      // Which of the four shared classes this closure was reached in.
      examinationClass: ex.examinationClass,
      examinationNote: ex.note,
      everAnswered: ex.everAnswered,
      // Looked, and every check found there was structurally nothing to
      // look at. A strict subset of the NOTHING_TO_FETCH class, kept
      // because it is a stronger statement than the class is, and never
      // added to the class counts.
      checksAllUnseeable: inv.checksRun > 0 && inv.noRecordChecks === inv.checksRun,
      effortSeconds: inv.effortSeconds,
      confidenceAtClose: mo.confidence,
      at: FWSimRunner.absoluteNow(state.clock),
      narrative: isVerdict
        ? narrate(status, recorded, alignment, examinationSentence(ex))
        : `Closed as ${status.replace(/_/g, ' ').toLowerCase()} — a process outcome, which makes no claim about what the case was, so nothing is scored.`
    };

    const previous = engine.byMo.get(mo.id);
    if (previous) engine.ledger = engine.ledger.filter(e => e.moId !== mo.id); // one live verdict per case
    engine.ledger.push(entry);
    engine.byMo.set(mo.id, entry);
    mo.verdictOutcome = entry;
    return entry;
  }

  /* THE FOUR CLASSES OVER ONE BASE. Counts only. A share of the closed
     caseload that got an answer is a real rate with a real denominator, so
     it is offered where the base is large enough, but nothing here is a
     score: a closure nobody could get an answer on is not a bad closure,
     and one that got an answer is not a correct one. Both readings are
     available from this block and both are wrong.

     The classes are asserted to sum to the base, because two overlapping
     flags over two different bases is what this block replaces. */
  function examinationBreakdown(entries) {
    const I = FWInvestigationEngine;
    const byClass = {};
    I.EXAMINATION_CLASSES.forEach(k => { byClass[k] = 0; });
    entries.forEach(e => {
      const cls = e.examinationClass || I.classifyCounts({
        answered: e.answeredChecks, noRecord: e.noRecordChecks, inconclusive: e.inconclusiveChecks
      });
      byClass[cls] = (byClass[cls] || 0) + 1;
    });
    const sorted = I.EXAMINATION_CLASSES.reduce((a, k) => a + byClass[k], 0);
    if (sorted !== entries.length) {
      throw new Error(
        'outcomeEngine: closures do not sort into the examination classes (' + sorted +
        ' sorted vs ' + entries.length + ' closures). Every closure was reached with a check ' +
        'having answered, with nothing to fetch, with the source unreachable, or with no check run.'
      );
    }
    const neverAnswered = byClass.NOTHING_TO_FETCH + byClass.UNREACHABLE + byClass.NEVER_LOOKED;
    return {
      base: entries.length,
      byClass,
      neverAnswered,
      classes: I.EXAMINATION_CLASSES,
      notes: I.EXAMINATION_NOTE,
      // A strict subset of NOTHING_TO_FETCH: every check, not just one,
      // found there was nothing to fetch. Reported alongside, never added.
      allUnseeable: entries.filter(e => e.checksAllUnseeable).length
    };
  }

  // What this panel refuses to report, with the reason, rendered verbatim
  // in the UI at the same weight as the figures (exposureModel's pattern).
  const NOT_MODELLED = [
    {
      figure: 'Alignment rates split by how far the case was examined',
      why: 'Cases are not assigned to be checked at random. The analyst picks which ones to spend hours on, and whether there is a record to pull at all depends on where this port happens to watch — both correlated with what the answer key holds for the case. A side-by-side of aligned shares for answered and never-answered closures would therefore read as "looking harder makes the calls better" from a simulation that cannot support the claim, and the same selection would produce the gap with judgement held constant.'
    },
    {
      figure: 'A calibration rate taken only over the closures a check answered on',
      why: 'That is the exclusion this project has refused three times now, in the same words each time: dropping the cases the port could not see grades calibration only where the port could see, and it shrinks the denominator exactly where watching is thin. The answer key exists whether or not the analyst could reach it, so those closures stay inside the rates and are counted separately instead.'
    },
    {
      figure: 'A minimum standard for how far a case should be taken before closing',
      why: 'Nothing in this simulation says which cases warranted the hours, so there is no fact to take a standard against — the analytics panel refuses a target examination share for the same reason. A standard here would also be reachable by closing the cases that happen to have records to pull, which moves the figure without changing the judgement.'
    }
  ];

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
    const examination = examinationBreakdown(scored);
    return {
      totalClosed: engine.ledger.length,
      scoredCount: scored.length,
      decisiveCount: decisive.length,
      counts,
      blindCount: blind.length,
      unseeableCount: unseeable.length,
      /* Over the scored closures, which is a LARGER base than the
         alignment rates below (they drop the ambiguous ones). Stated here
         because side-by-side figures are read as sharing a base. */
      examination,
      examinationBase: 'closures whose verdict made a claim the record could be checked against',
      examinationBaseIsRateBase: scored.length === decisive.length,
      // The same sort over the rate base, so the two can be connected
      // without either being mistaken for the other.
      decisiveNeverAnswered: decisive.filter(e => !(e.everAnswered === undefined
        ? e.answeredChecks > 0 : e.everAnswered)).length,
      examinationRateEligible: scored.length >= MIN_SAMPLE_FOR_RATES,
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
    examinationBreakdown, NOT_MODELLED,
    VERDICT_STATUSES, PROCESS_STATUSES, MIN_SAMPLE_FOR_RATES
  };
})();
