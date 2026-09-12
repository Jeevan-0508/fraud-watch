/* simulation/adviceEngine.js — which check is worth the hours (Phase 28-29
   follow-on). Slice 18 gave one control a disclosed likelihood that its
   source holds anything at all, which finally gives an advisory something
   honest to say. This module says only that much, and the restraint is the
   design.

   THE TRAP THIS MODULE IS BUILT TO AVOID. The obvious advisory ranks the
   available checks by how much confidence each is expected to move. Both
   ways of doing that are biased, and the second one is worse because it
   looks careful:

     Ranked by expected confidence GAIN, the advisory recommends whichever
     check is most likely to come back corroborating. That is a machine
     for building a case rather than testing one — confirmation-seeking
     with a button on it.

     Ranked by expected ABSOLUTE movement it looks even-handed and is not.
     The deltas in investigationEngine are deliberately ASYMMETRIC: a
     documented record weighs about three times what its absence does,
     because a record is verifiable and an absence is not. That asymmetry
     is correct as epistemics and becomes a bias the moment it is used to
     ORDER the checks — absolute movement then systematically promotes
     whichever check is most likely to clear the case. Same failure,
     opposite direction, and harder to notice.

   So no delta enters the ranking. Not by convention: scoreInputs() below
   returns a whitelisted object and THROWS if any field naming a delta,
   confidence or adjustment reaches it. The ranking is built from three
   things only, each a count off the case record or a parameter already
   stated in a model file:

     1. how many of this case's signals the source can speak to that no
        completed check has already covered;
     2. the stated chance the source returns anything at all (the site
        coverage disclosure for the site record, the stated inconclusive
        chance for the rest);
     3. the measured effort the check costs.

   That is coverage per hour. It says what is worth the hours. It says
   nothing whatever about what the answer will be, and the ordering is not
   evidence about the case — running the top-ranked check and finding
   nothing is not a finding about a carrier.

   A SPENT CHECK IS NOT COVERAGE (Slice 25). This module predates the
   outcome that says a source had nothing to fetch, and it originally
   counted every completed check as having spoken to the signal types it
   was run against. That is wrong in a way that runs in one direction
   only: a site record that came back with no record existing, or a
   source that could not be reached, learned nothing, and counting it as
   covered demoted every other source that could still speak to those
   signals -- far enough that a case could report that nothing was worth
   the hours because its checks had all failed. The port's own blind spot
   read as the case having been examined. Coverage here now means a type
   a completed check actually ANSWERED on, and the three ways a type can
   be left unanswered are kept apart: nothing to fetch, could not be
   reached, and outside what the source can read at all (the site record
   is offered against every signal type and can only read the ones
   observed at a site).

   AND IT IS ALLOWED TO SAY "NOTHING". When every signal a source could
   speak to has already been checked, this module reports that further
   checks buy second opinions rather than coverage, and recommends none.
   An advisory that always has a next action to sell is selling. */
const FWAdviceEngine = (() => {
  // The only fields permitted to reach the ranking. Anything else is
  // either a fact about the expected answer or a fact about nothing.
  const RANK_INPUTS = ['uncheckedSignals', 'sourceAvailability', 'hours'];
  const FORBIDDEN_INPUT = /delta|confidence|adjust|verdict|guilt|score/i;

  function scoreInputs(cand) {
    const out = {};
    RANK_INPUTS.forEach(k => { out[k] = cand[k]; });
    Object.keys(out).forEach(k => {
      if (FORBIDDEN_INPUT.test(k)) {
        throw new Error(
          'adviceEngine: "' + k + '" may not be a ranking input. Ordering the checks by how ' +
          'much confidence each is expected to move turns the advisory into a machine for ' +
          'confirming or for clearing, depending on which direction the asymmetric deltas point.'
        );
      }
    });
    return out;
  }

  // Both directions are closed. scoreInputs() fires if RANK_INPUTS is
  // ever widened to include a delta-shaped field; scoreOf() fires if a
  // caller hands the score a term that was never on the whitelist, which
  // is the other way an expected-movement factor would get in.
  function scoreOf(inputs) {
    Object.keys(inputs || {}).forEach(k => {
      if (RANK_INPUTS.indexOf(k) < 0) {
        throw new Error(
          'adviceEngine: the ordering may only be computed from ' + RANK_INPUTS.join(', ') +
          '. Received an extra term "' + k + '", and the one thing this ordering must not know ' +
          'is what the check is expected to find.'
        );
      }
    });
    if (!inputs.hours) return 0;
    return (inputs.uncheckedSignals * inputs.sourceAvailability) / inputs.hours;
  }

  const ASSUMPTIONS = [
    'The ordering is coverage per hour: unchecked signals this source can speak to, times the stated chance it returns anything, divided by the measured hours it costs.',
    'No expected confidence movement enters the ordering, in either direction. The deltas are asymmetric on purpose, so ranking by them would promote either the checks most likely to corroborate or the checks most likely to clear, depending only on whether the absolute value was taken.',
    'The chance a source returns anything is a stated model parameter, not a measurement: the disclosed site coverage for the site record, and the stated inconclusive chance for every other source.',
    'A signal already spoken to by a completed check counts for nothing here. A second source on the same signal is a second opinion, which is worth having and is not additional coverage.',
    'Spoken to means a completed check answered on it. A check that came back with nothing to fetch, that could not be reached, or that was run against a signal it cannot read bought no coverage, so those signal types are still counted as unspoken-to and the sources that can still reach them are still ranked on them.',
    'A source is second opinion only when every signal type it covers has actually been answered on. A spent check that learned nothing does not make the ground it touched covered, and treating it as covered would let this port\'s blind spot read as the case having been examined.',
    'Checks that tie on these inputs are reported as tied. An arbitrary order between them would read as a preference this module does not hold.',
    'The ordering is about the hours, never about the case. Which check is worth running is not a claim about what it will find, and the top of this list carries no implication either way.'
  ];

  const NOT_MODELLED = [
    {
      figure: 'Expected confidence movement from a check',
      why: 'Computable, and deliberately not computed. Ordering by expected gain recommends whichever check most likely corroborates, which is confirmation-seeking with a button on it; ordering by absolute movement looks neutral but rides the deliberate asymmetry between a verifiable record and its absence, so it promotes whichever check most likely clears the case. Neither ordering is about the hours, which is the only question an advisory here can answer.'
    },
    {
      figure: 'Which check will resolve this case',
      why: 'Unknowable before it is run. Every source can come back inconclusive, the site record can come back with nothing to fetch at all, and a case can be worked to exhaustion and stay unexplained. Naming a decisive check would be inventing a certainty the simulation does not hold.'
    },
    {
      figure: 'How many checks are enough',
      why: 'There is no threshold in this model at which a case is investigated. What exists is coverage — which signals have been spoken to and which have not — and that is reported as a count rather than converted into a completion percentage that would read as sufficiency.'
    },
    {
      figure: 'The probability that this case is fraud',
      why: 'No such quantity exists anywhere in this project, and confidence is not it. Nothing in an ordering of record checks could produce one.'
    },
    {
      figure: 'The chance that repeating a check that learned nothing would return something',
      why: 'Each source is spendable once per case in this model, so a repeat is not an action the analyst has, and reporting its value would recommend one. For a check that came back with nothing to fetch the question does not arise at all: that absence is structural, and no number of attempts produces a record the site never wrote.'
    },
    {
      figure: 'A discount on a source because an earlier check on the same signals came back empty',
      why: 'Computable, and refused. These are separate record systems and one failing to answer says nothing about the next. Worse as method: lowering the ranking of a case\'s remaining checks because that case has already resisted examination would make the hardest cases to examine look like the least worth the hours, which is the same question-begging the cost model refuses when it declines to split unresolved hours by how resolved cases turned out.'
    },
    {
      figure: 'A work queue or priority order across cases',
      why: 'This ranks checks within one case on the hours they cost. Ranking cases against each other would need a view of which case matters more, which means either exposure — refused as a ranking basis in the cost model — or confidence, which is not a probability of anything.'
    }
  ];

  /* Why a signal type a check was run against still has no answer on it.
     Three different facts, and merging them would hide the one that matters
     most: a structural gap in what this port records is not a failed attempt,
     and neither is a source being asked about ground it cannot read.

     Two of the three keys are check OUTCOMES, owned by investigationEngine.
     This map is therefore a second surface for that vocabulary, and the load
     check below is what stops it becoming a second COPY: if that engine gains
     a way of learning nothing, this module fails loudly at load rather than
     quietly reporting it as one of the two it happens to know. The third key
     is this module's own, and is not an outcome at all -- the check came back
     with something, just not about this type. */
  const OWN_UNREAD_REASON = 'OUT_OF_SOURCE_SCOPE';
  const UNREAD_REASON_NOTE = {
    NO_RECORD_EXISTS: 'a check was run and there was no record of that kind to fetch',
    INCONCLUSIVE: 'a check was run and the source could not be reached or its records were incomplete',
    OUT_OF_SOURCE_SCOPE: 'a check was run against it but that source can only read signals observed at a site, and this one was not'
  };

  // Both directions, at load, against the engine that owns the vocabulary.
  (function checkUnreadReasons() {
    if (typeof FWInvestigationEngine === 'undefined') return;
    FWInvestigationEngine.LEARNED_NOTHING_OUTCOMES.forEach(k => {
      if (!UNREAD_REASON_NOTE[k]) {
        throw new Error(
          'adviceEngine: check outcome ' + k + ' is a way of learning nothing and has no ' +
          'unread-reason note. Reporting it as one of the others would state a fact about ' +
          'the record that nobody established.'
        );
      }
    });
    Object.keys(UNREAD_REASON_NOTE).forEach(k => {
      if (k === OWN_UNREAD_REASON) return;
      if (FWInvestigationEngine.LEARNED_NOTHING_OUTCOMES.indexOf(k) < 0) {
        throw new Error(
          'adviceEngine: unread reason ' + k + ' is neither a learned-nothing outcome nor ' +
          'this module\'s own ' + OWN_UNREAD_REASON + ', so nothing produces it.'
        );
      }
    });
  })();

  // Per signal type: has a completed check ANSWERED on it, and if not,
  // which ways of not answering are on the record. Keyed by signal type
  // because that is the granularity at which the action catalog covers
  // anything.
  function typeLedger(mo) {
    const findings = (mo && mo.investigation && mo.investigation.findings) || [];
    const substantiveOutcomes = (window.FWInvestigationEngine && FWInvestigationEngine.SUBSTANTIVE_OUTCOMES)
      || ['EXCULPATORY', 'MIXED', 'CORROBORATING'];
    const map = new Map();
    const entry = (t) => {
      if (!map.has(t)) map.set(t, { type: t, spokenTo: false, reasons: [] });
      return map.get(t);
    };
    findings.forEach(f => {
      const substantive = substantiveOutcomes.indexOf(f.outcome) >= 0;
      // A finding records what it was RUN against and, separately, what it
      // could answer on. The two differ for the site record.
      const answered = substantive ? (f.spokenToTypes || f.signalTypes || []) : [];
      (f.signalTypes || []).forEach(t => {
        const e = entry(t);
        if (answered.indexOf(t) >= 0) { e.spokenTo = true; return; }
        /* The fallback here used to be `: 'INCONCLUSIVE'`, so any outcome this
           map did not recognise was reported as "the source could not be
           reached or its records were incomplete" -- a specific claim about
           what happened, made about an outcome nobody had classified. The two
           ways of learning nothing are exactly what Slice 35 separated. An
           unclassified one is a third thing and is not guessed at. */
        let reason = OWN_UNREAD_REASON;
        if (!substantive) {
          if (!UNREAD_REASON_NOTE[f.outcome]) {
            throw new Error(
              'adviceEngine.typeLedger: check outcome "' + f.outcome + '" has no unread ' +
              'reason. It is neither substantive nor a known way of learning nothing, and ' +
              'reporting it as unreachable would invent the reason.'
            );
          }
          reason = f.outcome;
        }
        if (e.reasons.indexOf(reason) < 0) e.reasons.push(reason);
      });
    });
    return map;
  }

  // Signal types a completed check has actually spoken to. Named as it
  // always was; what changed in Slice 25 is that a check which learned
  // nothing no longer counts as having checked anything.
  function checkedTypes(mo) {
    const out = new Set();
    typeLedger(mo).forEach(e => { if (e.spokenTo) out.add(e.type); });
    return out;
  }

  /* Every signal type in the case sorted into one of four disjoint
     buckets, summing to the case's signal type count and asserted to
     (reconciled-totals discipline, Slice 23): answered on, attempted and
     still unanswered, never attempted though a source exists, and covered
     by no source in this simulation at all. Reported as counts, never as a
     percentage complete, which would read as sufficiency. */
  function typePartition(caseTypes, ledger, noSourceTypes) {
    const noSource = new Set(noSourceTypes);
    const spokenTo = [], unread = [], neverAttempted = [], unsourced = [];
    caseTypes.forEach(t => {
      const e = ledger.get(t);
      if (e && e.spokenTo) spokenTo.push(t);
      else if (e && e.reasons.length) unread.push({ type: t, reasons: e.reasons });
      else if (noSource.has(t)) unsourced.push(t);
      else neverAttempted.push(t);
    });
    const total = spokenTo.length + unread.length + neverAttempted.length + unsourced.length;
    if (total !== caseTypes.length) {
      throw new Error(
        'adviceEngine: signal type partition does not reconcile (' + total + ' sorted vs ' +
        caseTypes.length + ' in the case). Every type is answered on, attempted and unanswered, ' +
        'unattempted, or unsourced; a type falling outside all four would be a coverage claim ' +
        'with nothing behind it.'
      );
    }
    return { spokenTo, unread, neverAttempted, unsourced, total };
  }

  // Signal types in this case that NO source in the catalog covers. The
  // blind spot per case, and it belongs beside the ranking: a case can
  // have every available check run against it and still be mostly
  // unexaminable, which is a fact about the sources and not about the
  // carrier.
  function uncheckableTypes(state, mo) {
    const signals = FWInvestigationEngine.signalsForMo(state, mo);
    const types = Array.from(new Set(signals.map(s => s.type)));
    const covered = new Set();
    Object.keys(FWInvestigationEngine.ACTION_CATALOG).forEach(k => {
      FWInvestigationEngine.ACTION_CATALOG[k].covers.forEach(t => covered.add(t));
    });
    return types.filter(t => !covered.has(t));
  }

  function advise(state, mo) {
    if (!state || !mo) return null;
    const investigable = FWInvestigationEngine.isInvestigable(mo);
    const actions = FWInvestigationEngine.availableActions(state, mo);
    const ledger = typeLedger(mo);
    const done = checkedTypes(mo);
    const unread = new Set();
    ledger.forEach(e => { if (!e.spokenTo && e.reasons.length) unread.add(e.type); });
    const signals = FWInvestigationEngine.signalsForMo(state, mo);
    const caseTypes = Array.from(new Set(signals.map(s => s.type)));

    const candidates = actions.filter(a => !a.done).map(a => {
      const def = FWInvestigationEngine.ACTION_CATALOG[a.key];
      // Unchecked means unanswered, which includes ground a spent check
      // touched and could not read.
      const unchecked = a.signalTypes.filter(t => !done.has(t));
      const reopens = unchecked.filter(t => unread.has(t));
      // Stated parameters only. For the site record the disclosed
      // coverage is multiplied in, because there the chance of getting
      // nothing at all is published before the hours are spent.
      const holdsChance = a.siteRecordLikelihood != null ? a.siteRecordLikelihood / 100 : null;
      const returnsSomething = (1 - def.inconclusiveChance) * (holdsChance != null ? holdsChance : 1);
      const cand = {
        key: a.key,
        label: a.label,
        question: a.question,
        uncheckedSignals: unchecked.length,
        uncheckedTypes: unchecked,
        // Of the unanswered types this source covers, the ones another
        // source already tried and got nothing from. Not a discount and
        // not a bonus: it is stated so the analyst knows the ground is
        // untouched rather than fresh.
        reopensUnreadTypes: reopens,
        coveredTypes: a.signalTypes,
        repeatTypes: a.signalTypes.filter(t => done.has(t)),
        sourceAvailability: returnsSomething,
        hours: def.effortSeconds / 3600,
        effortSeconds: def.effortSeconds,
        siteRecordLikelihood: a.siteRecordLikelihood,
        statedInconclusiveChance: def.inconclusiveChance,
        secondOpinionOnly: unchecked.length === 0
      };
      cand.inputs = scoreInputs(cand);
      cand.score = scoreOf(cand.inputs);
      return cand;
    });

    candidates.sort((x, y) => y.score - x.score || x.hours - y.hours || x.key.localeCompare(y.key));
    // Ties keep the same rank. Pretending to an order between equals
    // would be a preference this module does not have.
    let rank = 0, lastScore = null;
    candidates.forEach((c, i) => {
      if (lastScore === null || Math.abs(c.score - lastScore) > 1e-9) { rank = i + 1; lastScore = c.score; }
      c.rank = rank;
    });
    candidates.forEach(c => {
      c.tied = candidates.filter(o => o.rank === c.rank).length > 1;
      c.basis = c.secondOpinionOnly
        ? 'Every signal type this source covers has already been spoken to by a completed check. Running it buys a second opinion on the same ground, not more coverage.'
        : c.uncheckedSignals + ' signal type' + (c.uncheckedSignals === 1 ? '' : 's') +
          ' not yet spoken to' +
          (c.reopensUnreadTypes.length
            ? ' (' + c.reopensUnreadTypes.length + ' of them attempted already by a check that came back with nothing)'
            : '') +
          ', ' + Math.round(c.sourceAvailability * 100) + '% stated chance the source returns anything, ' +
          (c.hours < 1 ? Math.round(c.hours * 60) + ' min' : c.hours.toFixed(1) + ' h') + ' of effort.';
    });

    const withCoverage = candidates.filter(c => !c.secondOpinionOnly);
    const uncheckable = uncheckableTypes(state, mo);
    const openTypes = caseTypes.filter(t => !done.has(t));
    const partition = typePartition(caseTypes, ledger, uncheckable);
    const reasonCounts = {};
    partition.unread.forEach(u => u.reasons.forEach(r => { reasonCounts[r] = (reasonCounts[r] || 0) + 1; }));

    return {
      investigable,
      candidates,
      // Named "leading" rather than "recommended": it leads the ordering
      // on the hours, which is not the same as being advised.
      leading: withCoverage.length ? withCoverage[0] : null,
      leadingIsTied: withCoverage.length ? withCoverage[0].tied : false,
      exhausted: candidates.length > 0 && withCoverage.length === 0,
      nothingAvailable: candidates.length === 0,
      caseSignalTypes: caseTypes,
      // Answered on, not merely attempted.
      checkedTypeCount: partition.spokenTo.length,
      openTypeCount: openTypes.length,
      typePartition: partition,
      unreadTypeCount: partition.unread.length,
      unreadReasonCounts: reasonCounts,
      UNREAD_REASON_NOTE,
      // Stated whether or not any check remains, because "every source is
      // spent" and "this case has been examined" are different claims and
      // the gap between them is exactly what this bucket holds.
      unreadNote: partition.unread.length
        ? partition.unread.length + ' signal type' + (partition.unread.length === 1 ? '' : 's') +
          ' had a check run against ' + (partition.unread.length === 1 ? 'it' : 'them') +
          ' and still has no answer: ' +
          Object.keys(reasonCounts).map(r => reasonCounts[r] + ' where ' + UNREAD_REASON_NOTE[r]).join('; ') +
          '. Effort was spent there and no coverage was obtained, so it is not counted as checked.'
        : null,
      uncheckableTypes: uncheckable,
      // Stated as a count of signal types with no source, never as a
      // completion percentage: a percentage would read as sufficiency.
      uncheckableNote: uncheckable.length
        ? uncheckable.length + ' signal type' + (uncheckable.length === 1 ? '' : 's') +
          ' in this case (' + uncheckable.map(t => t.replace(/_/g, ' ').toLowerCase()).join(', ') +
          ') is not covered by any record source in this simulation. Running every check available would leave that part of the case unexamined, which is a limit of the sources and not a fact about the carrier.'
        : null,
      exhaustedNote: partition.unread.length
        ? 'Every remaining source covers only ground a completed check has already answered on, so none is put forward as worth the hours. That is not the same as this case having been examined: ' +
          partition.unread.length + ' signal type' + (partition.unread.length === 1 ? '' : 's') +
          ' had effort spent on ' + (partition.unread.length === 1 ? 'it' : 'them') +
          ' and still has no answer, and no source left can reach ' + (partition.unread.length === 1 ? 'it' : 'them') + '.'
        : 'Every signal type a source can speak to in this case has been spoken to. Further checks are second opinions on ground already covered, so none is put forward as worth the hours.',
      RANK_INPUTS,
      ASSUMPTIONS,
      NOT_MODELLED
    };
  }

  return {
    RANK_INPUTS, FORBIDDEN_INPUT, ASSUMPTIONS, NOT_MODELLED, UNREAD_REASON_NOTE,
    OWN_UNREAD_REASON,
    scoreInputs, scoreOf, typeLedger, checkedTypes, typePartition, uncheckableTypes, advise
  };
})();
