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
      figure: 'A work queue or priority order across cases',
      why: 'This ranks checks within one case on the hours they cost. Ranking cases against each other would need a view of which case matters more, which means either exposure — refused as a ranking basis in the cost model — or confidence, which is not a probability of anything.'
    }
  ];

  // Signals in the case that a completed check has already spoken to.
  // Keyed by signal type, because that is the granularity at which the
  // action catalog covers anything.
  function checkedTypes(mo) {
    const findings = (mo && mo.investigation && mo.investigation.findings) || [];
    const seen = new Set();
    findings.forEach(f => (f.signalTypes || []).forEach(t => seen.add(t)));
    return seen;
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
    const done = checkedTypes(mo);
    const signals = FWInvestigationEngine.signalsForMo(state, mo);
    const caseTypes = Array.from(new Set(signals.map(s => s.type)));

    const candidates = actions.filter(a => !a.done).map(a => {
      const def = FWInvestigationEngine.ACTION_CATALOG[a.key];
      const unchecked = a.signalTypes.filter(t => !done.has(t));
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
          ' not yet spoken to, ' + Math.round(c.sourceAvailability * 100) + '% stated chance the source returns anything, ' +
          (c.hours < 1 ? Math.round(c.hours * 60) + ' min' : c.hours.toFixed(1) + ' h') + ' of effort.';
    });

    const withCoverage = candidates.filter(c => !c.secondOpinionOnly);
    const uncheckable = uncheckableTypes(state, mo);
    const openTypes = caseTypes.filter(t => !done.has(t));

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
      checkedTypeCount: caseTypes.filter(t => done.has(t)).length,
      openTypeCount: openTypes.length,
      uncheckableTypes: uncheckable,
      // Stated as a count of signal types with no source, never as a
      // completion percentage: a percentage would read as sufficiency.
      uncheckableNote: uncheckable.length
        ? uncheckable.length + ' signal type' + (uncheckable.length === 1 ? '' : 's') +
          ' in this case (' + uncheckable.map(t => t.replace(/_/g, ' ').toLowerCase()).join(', ') +
          ') is not covered by any record source in this simulation. Running every check available would leave that part of the case unexamined, which is a limit of the sources and not a fact about the carrier.'
        : null,
      exhaustedNote: 'Every signal type a source can speak to in this case has been spoken to. Further checks are second opinions on ground already covered, so none is put forward as worth the hours.',
      RANK_INPUTS,
      ASSUMPTIONS,
      NOT_MODELLED
    };
  }

  return { RANK_INPUTS, FORBIDDEN_INPUT, ASSUMPTIONS, NOT_MODELLED, scoreInputs, scoreOf, checkedTypes, uncheckableTypes, advise };
})();
