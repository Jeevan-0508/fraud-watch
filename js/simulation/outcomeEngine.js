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
      figure: 'The aligned share read as a calibration rate over the closed caseload',
      why: 'It is a rate over the closures whose record was unmixed, and whether a record is unmixed is decided by the case\'s signal count and nothing else: every signal\'s answer key is drawn independently, so a case is excluded with probability 1 - p^n - (1-p)^n, which rises monotonically with n. Measured across twelve seeded 60-day runs, 199 cases: 73 of 132 two-signal cases reached the denominator, 15 of 57 at three signals, 1 of 7 at four, and 0 of 2 and 0 of 1 at five and six — each row with its own denominator, because the whole finding is that the rows differ and a share pooled across them would erase it. So the figure is a calibration rate over the caseload\'s thinnest cases, and reading it as a rate over the caseload flatters or penalises nothing about the judgement — it reports which cases the record happened to be able to speak to unmixedly. The gradient is published beside it instead.'
    },
    {
      figure: 'A minimum standard for how far a case should be taken before closing',
      why: 'Nothing in this simulation says which cases warranted the hours, so there is no fact to take a standard against — the analytics panel refuses a target examination share for the same reason. A standard here would also be reachable by closing the cases that happen to have records to pull, which moves the figure without changing the judgement.'
    }
  ];

  /* WHICH CASES CAN BE IN THE DENOMINATOR AT ALL (Slice 68). The rates below
     are taken over `decisive` -- the scored closures that are not AMBIGUOUS.
     The reason for that exclusion is stated at the top of this file and it is a
     good reason ABOUT ONE CASE: on a mixed record neither verdict was
     unreasonable, so scoring it would grade a coin toss.

     What was never stated is that the exclusion is not case-random. A case is
     AMBIGUOUS exactly when its signals do not all fall the same way, and each
     signal's answer key is drawn independently at falsePositiveEngine's
     declared chance. So the probability a case is excluded is a function of ONE
     THING -- how many signals it carries -- and it rises monotonically with it:

       P(excluded | n signals) = 1 - p^n - (1-p)^n,  p = LEGITIMATE_CHANCE

     which is exactly 0 at n=1, 0.455 at n=2 and 0.968 at n=8. Measured over 199
     cases across twelve seeded 60-day runs, the share of cases that reach the
     denominator ran 73/132 at two signals, 15/57 at three, 1/7 at four, and
     0/2 and 0/1 at five and six. Since moEngine's confidence rises as signals stack,
     the same gradient runs over the confidence band, and the size of the
     available-action menu -- which the investigation panel shows BEFORE a
     second of effort is spent -- tracked it too: 10/19, 70/145, 9/31 and 0/4
     at two, three, four and five offered actions.

     Two consequences, and the panel used to state neither:
       - `rates.aligned` is not a rate over the closed caseload. It is a rate
         over the caseload's THINNEST cases, and the bigger a case is the less
         likely it is to ever appear in it. A reader comparing the aligned share
         with the case count above it is comparing two different populations.
       - The exclusion is legible from the shape of a case before any record is
         pulled. That is convention 28 against this pipeline: an analyst cannot
         read the answer key off a case's shape, but they can read off whether
         their call on it will ever be counted.

     Nothing here corrects the exclusion -- it is still right, per case. What
     changes is that the rate now carries the fact, its arithmetic and its
     measured gradient, and the arithmetic is derived from the chance the
     generator declares rather than restated here. */
  const AMBIGUITY_BASIS = {
    kind: 'STRUCTURAL_EXCLUSION',
    excludes: 'AMBIGUOUS',
    from: 'the aligned / overcalled / undercalled rates',
    isAFunctionOf: 'the number of signals on the case, and nothing else',
    perCaseReason: 'on a mixed record neither closing verdict was unreasonable, so scoring it would grade a coin toss.',
    populationEffect: 'the chance of exclusion rises monotonically with the case\'s signal count, so the rate is taken over the smallest cases in the caseload.',
    chanceOwner: 'FWFalsePositiveEngine.LEGITIMATE_CHANCE',
    chanceNote: 'the per-signal chance is never restated here — it is read from the module that declares it, or the arithmetic is refused.',
    isNotAFunctionOf: 'the analyst\'s judgement, how far the case was examined, or what the case turned out to be.'
  };

  const AMBIGUITY_STATES = {
    MEASURED: 'the exclusion gradient is measured over the closures in hand, with the count at each signal count as its denominator.',
    REFUSED_NO_CHANCE_DECLARED: 'the module that owns the per-signal chance is absent, so the arithmetic behind the gradient is not being stated. Restating the chance here would put a second copy of it in the program.',
    REFUSED_SAMPLE_TOO_SMALL: 'fewer closures than the minimum sample, so no share is offered at any signal count. The arithmetic is still stated: it does not depend on this run.'
  };

  /* The exact probability a case of n signals is excluded, from the declared
     chance. Returns null rather than a number if the chance is not available:
     an exclusion probability computed off a locally-guessed base rate would be
     a figure with an undisclosed model, which is the one thing this program
     never prints. */
  function ambiguityChance(n) {
    if (!window.FWFalsePositiveEngine) return null;
    const p = FWFalsePositiveEngine.LEGITIMATE_CHANCE;
    if (typeof p !== 'number' || !(n >= 1)) return null;
    return 1 - Math.pow(p, n) - Math.pow(1 - p, n);
  }

  /* The gradient, measured, with a denominator per row. Counts always; a share
     only where the row itself clears the same minimum sample the rates use,
     because a share off two cases is the noise-dressed-as-measurement this
     module withholds everywhere else. */
  function structuralAmbiguity(entries) {
    const list = Array.from(entries || []);
    /* WHICH CLOSURES THIS BLOCK CAN SORT, refused before anything is counted.
       Every closure is either AMBIGUOUS or it is not, so "not AMBIGUOUS" is a
       decisive one -- as long as the caller only ever hands over closures that
       made a checkable claim. calibration() does, but this function is
       exported, and a caller passing the whole ledger would have UNSCORABLE and
       NOT_A_CLAIM entries counted as decisive by falling through the else: a
       closure that asserted nothing landing in a share of the closures the
       record could speak to unmixedly. That is the "an outcome with no bucket"
       fault this file already refuses one closure at a time, so it is refused
       at the entry rather than absorbed. */
    const sortable = new Set(['ALIGNED', 'OVERCALLED', 'UNDERCALLED', 'AMBIGUOUS']);
    const unsortable = list.filter(e => !sortable.has(e.alignment));
    if (unsortable.length) {
      throw new Error('outcomeEngine.structuralAmbiguity: ' + unsortable.length + ' of ' + list.length +
        ' closures carry an alignment this block cannot sort (' +
        Array.from(new Set(unsortable.map(e => String(e.alignment)))).join(', ') +
        '). Only closures whose verdict made a claim the record could be checked against belong here; ' +
        'anything else would be counted as decisive by falling through, which would put a closure that ' +
        'asserted nothing into a share of the closures the record could speak to unmixedly.');
    }
    const bySignalCount = new Map();
    list.forEach(e => {
      const n = e.totalSignals;
      if (!bySignalCount.has(n)) bySignalCount.set(n, { signals: n, closures: 0, decisive: 0, ambiguous: 0 });
      const b = bySignalCount.get(n);
      b.closures++;
      if (e.alignment === 'AMBIGUOUS') b.ambiguous++; else b.decisive++;
    });
    const chanceDeclared = ambiguityChance(2) !== null;
    const rows = Array.from(bySignalCount.values()).sort((a, b) => a.signals - b.signals).map(b => ({
      signals: b.signals, closures: b.closures, decisive: b.decisive, ambiguous: b.ambiguous,
      // Share is withheld per ROW, not for the table: the whole point is that
      // the rows differ, so a share pooled across them would erase the finding.
      decisiveShare: b.closures >= MIN_SAMPLE_FOR_RATES ? b.decisive / b.closures : null,
      shareWithheld: b.closures < MIN_SAMPLE_FOR_RATES,
      expectedAmbiguityChance: ambiguityChance(b.signals)
    }));
    const state = !chanceDeclared ? 'REFUSED_NO_CHANCE_DECLARED'
      : (list.length < MIN_SAMPLE_FOR_RATES ? 'REFUSED_SAMPLE_TOO_SMALL' : 'MEASURED');
    /* Reconciled totals, and they are RECONCILED BY CONSTRUCTION here rather
       than checked: the rows are built by one increment per closure, so the sum
       cannot differ from the base, and each closure increments exactly one of
       decisive/ambiguous. Asserting them would be a guard that no fault can
       reach, which this project counts as a guard not shown to work. The
       reachable fault is the one refused at this function's entry -- an alignment the
       block cannot sort -- and that is where the throw lives. Stated, because a
       reader who finds no reconciliation assert in a file full of them should
       find the reason rather than the omission.

       The two facts are still published, so a caller can reconcile them itself
       against a base it derived some other way. */
    const sorted = rows.reduce((a, r) => a + r.closures, 0);
    return {
      state, note: AMBIGUITY_STATES[state], basis: AMBIGUITY_BASIS,
      base: list.length, rows: rows, minSample: MIN_SAMPLE_FOR_RATES,
      closuresSorted: sorted,
      reconciliation: 'BY_CONSTRUCTION',
      reconciliationNote: 'the rows are built one increment per closure, so they cannot fail to sum to the base; the reachable fault is a closure whose alignment this block cannot sort, and that is refused at the entry.',
      sortableAlignments: Array.from(sortable),
      chanceDeclared: chanceDeclared,
      signalCountsSeen: rows.length,
      /* The claim in one sentence, for a panel that has room for one. Written
         from the arithmetic rather than from this run, because the gradient is
         a property of the model and not of the sample. */
      sentence: 'A case is left out of the percentages when its signals do not all fall the same way, which is likelier the more signals it carries — so these percentages are taken over the caseload\'s smallest cases, and a bigger case is less likely to ever appear in them.'
    };
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
      /* Published with the rates, not below the fold: the gradient says which
         cases the rates above can be about, and a share whose eligible
         population is decided elsewhere is a denominator claim. */
      ambiguity: structuralAmbiguity(scored),
      tendency: enough ? (counts.OVERCALLED === counts.UNDERCALLED ? 'BALANCED'
        : counts.OVERCALLED > counts.UNDERCALLED ? 'LEANS_OVERCALL' : 'LEANS_UNDERCALL') : null
    };
  }

  return {
    createEngine, recordVerdict, recordedState, scoreVerdict, calibration,
    examinationBreakdown, NOT_MODELLED,
    AMBIGUITY_BASIS, AMBIGUITY_STATES, ambiguityChance, structuralAmbiguity,
    VERDICT_STATUSES, PROCESS_STATUSES, MIN_SAMPLE_FOR_RATES
  };
})();
