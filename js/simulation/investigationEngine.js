/* simulation/investigationEngine.js — investigative actions that actually
   move a case's confidence (mega-spec Phases 28-29). Until this module,
   the analyst could only relabel an MO's *status*; confidence was purely
   a function of how many signals the correlation engine had stacked up.
   Now the player can spend effort checking specific record sources, and
   what comes back is derived from the simulation's own hidden ground
   truth (falsePositiveEngine's answer key), never from a coin flip at
   click time.

   THE ASYMMETRY IS THE POINT (signal != proof):
     - An EXCULPATORY finding is a *positive record*: a documented
       maintenance swap, a logged customs re-seal, a rostered shift
       handover. Records are verifiable, so this evidence is strong and
       pushes confidence down hard.
     - A CORROBORATING finding is only the *absence* of such a record.
       Absence of an innocent explanation is not evidence of fraud, so it
       pushes confidence up by a deliberately much smaller amount, and
       every narrative says so in words.
     - An INCONCLUSIVE finding (records incomplete, contact unreachable)
       costs the same effort and changes nothing. Investigating is not a
       guaranteed oracle -- sometimes you burn the check and learn zero,
       which is why a wrong escalation stays possible.
     - A NO_RECORD_EXISTS finding (Phase 5) is a different animal from
       INCONCLUSIVE and is kept separate for a reason. INCONCLUSIVE is a
       contingent failure: the record probably exists and this attempt did
       not get it. NO_RECORD_EXISTS is structural: the site does not
       produce a record of that kind at that hour, so there is nothing to
       fetch and no repeat attempt will change that. Its delta is exactly
       zero and it is not allowed to be anything else, because an absent
       record at a thinly-watched site is the EXPECTED output of thin
       watching -- reading it as corroboration would charge a carrier for
       the port's own coverage gap. The finding is still worth having: it
       tells the analyst that the corroborating reading is unavailable
       precisely where concealment is most plausible, which is a fact
       about their own blind spot rather than about the case.

   Deltas below are design-intent calibration, not measured from any real
   dataset. This module produces no monetary figure itself: it records
   effortSeconds, which exposureModel.js (Phase 50) later prices as
   measured hours against a stated rate. */
const FWInvestigationEngine = (() => {
  const MAX_UPWARD_ADJUSTMENT = 30;    // absence-of-explanation can only ever nudge
  const MAX_DOWNWARD_ADJUSTMENT = -85; // records can nearly clear a case

  const ACTION_CATALOG = {
    PULL_TELEMATICS_LOG: {
      label: 'Pull telematics log',
      question: 'Does the carrier telematics record account for the position gap or deviation?',
      covers: ['GPS_SIGNAL_LOST', 'ROUTE_DEVIATION', 'DUPLICATE_ASSET_ID', 'UNEXPECTED_STOP'],
      effortSeconds: 1800,
      inconclusiveChance: 0.2,
      exculpatoryDelta: -20,
      corroboratingDelta: 7
    },
    AUDIT_SEAL_AND_TRAILER: {
      label: 'Audit seal & trailer records',
      question: 'Is there a logged reason for the seal or trailer discrepancy?',
      covers: ['SEAL_MISMATCH', 'TRAILER_SWAPPED'],
      effortSeconds: 3600,
      inconclusiveChance: 0.15,
      exculpatoryDelta: -24,
      corroboratingDelta: 9
    },
    VERIFY_DOCUMENTS: {
      label: 'Verify consignment documents',
      question: 'Do the manifest and milestone stamps reconcile with the paperwork on file?',
      covers: ['MANIFEST_CHANGED', 'FALSE_MILESTONE_STAMP'],
      effortSeconds: 2700,
      inconclusiveChance: 0.2,
      exculpatoryDelta: -20,
      corroboratingDelta: 8
    },
    INTERVIEW_DRIVER_DISPATCH: {
      label: 'Interview driver & dispatch',
      question: 'Can dispatch account for the driver change or handover gap?',
      covers: ['DRIVER_CHANGED', 'HANDOVER_GAP'],
      effortSeconds: 5400,
      inconclusiveChance: 0.3,
      exculpatoryDelta: -18,
      corroboratingDelta: 7
    },
    CROSS_CHECK_CARRIER_IDENTITY: {
      label: 'Cross-check carrier identity',
      question: 'Is the operating carrier the contracted one, and is it reachable?',
      covers: ['CARRIER_UNRESPONSIVE', 'EQUIPMENT_CARRIER_MISMATCH'],
      effortSeconds: 4500,
      inconclusiveChance: 0.25,
      exculpatoryDelta: -22,
      corroboratingDelta: 9
    },
    PULL_SITE_ACCESS_RECORD: {
      label: 'Pull site access record',
      question: 'Does the site where this was observed hold a gate, dock or yard record covering it?',
      // Any signal type can in principle be covered by a site record --
      // what decides whether the check is worth anything is WHERE the
      // signal was observed, not what kind it was. So this action is
      // gated on the case having a site at all (requiresSite) rather than
      // on its signal composition.
      covers: ['UNEXPECTED_STOP', 'ROUTE_DEVIATION', 'DRIVER_CHANGED', 'TRAILER_SWAPPED',
        'MANIFEST_CHANGED', 'SEAL_MISMATCH', 'GPS_SIGNAL_LOST', 'FALSE_MILESTONE_STAMP',
        'CARRIER_UNRESPONSIVE', 'EQUIPMENT_CARRIER_MISMATCH', 'DUPLICATE_ASSET_ID',
        'HANDOVER_GAP', 'STAGED_BREAKDOWN'],
      requiresSite: true,
      effortSeconds: 2700,
      inconclusiveChance: 0.1,
      exculpatoryDelta: -18,
      corroboratingDelta: 6
    },
    ROADSIDE_SITE_CHECK: {
      label: 'Roadside / site check',
      question: 'Does the vehicle state on site match the reported breakdown or stop?',
      covers: ['STAGED_BREAKDOWN', 'UNEXPECTED_STOP'],
      effortSeconds: 7200,
      inconclusiveChance: 0.2,
      exculpatoryDelta: -20,
      corroboratingDelta: 8
    }
  };

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  // ---- site-record support (Phase 5) ----

  // The signals in this case that were observed at a site at all. Signals
  // observed on the open road are not something a site record can speak
  // to, and pretending otherwise would manufacture coverage.
  function sitedSignals(signals) {
    return signals.filter(s => s.facilityId);
  }

  // How likely a record covering this case exists, derived from the SAME
  // stated coverage parameters facilityEngine publishes -- weighted by how
  // many of the case's signals each site accounts for, so a case mostly
  // observed at a gatehouse is not judged by its one depot signal.
  function siteRecordChance(state, mo, covered) {
    if (!window.FWFacilityEngine || !state || !state.registry) return null;
    const counts = new Map();
    sitedSignals(covered).forEach(s => counts.set(s.facilityId, (counts.get(s.facilityId) || 0) + 1));
    if (!counts.size) return null;
    let num = 0, den = 0;
    const sites = [];
    counts.forEach((n, id) => {
      const f = FWEntityEngine.get(state.registry, 'facility', id);
      if (!f) return;
      const cov = FWFacilityEngine.meanCoverage(f);
      sites.push({ facilityId: id, name: f.name, kindLabel: FWFacilityEngine.archetype(f.kind).label, coverage: cov, signalCount: n });
      num += cov * n; den += n;
    });
    if (!den) return null;
    sites.sort((a, b) => b.signalCount - a.signalCount);
    return { chance: num / den, sites };
  }

  function narrateNoRecord(def, ctx) {
    const list = ctx.sites.map(s => `${s.name} (${s.kindLabel}, assumed coverage ${Math.round(s.coverage * 100)}%)`).join('; ');
    return `${def.label}: no such record exists. ${list} does not produce a record covering this at the hour it was observed, so there is nothing to fetch and repeating the check will not change that. ` +
      'Confidence is unchanged by design: a missing record at a thinly-watched site is what thin watching produces, so treating its absence as support would be charging the carrier for this port\'s coverage gap. ' +
      'What this does tell you is that the corroborating reading is unavailable here — which is a fact about the blind spot, not about the case.';
  }

  function narrateSiteUnavailable() {
    return 'Every signal in this case was observed on the open road, at no site, so there is no site record to pull. That is an absence of a source, not an inconclusive check, and no effort is spent.';
  }

  // A case an analyst deliberately closed is locked. A case the engine
  // faded on its own is NOT: "the signals stopped before correlation was
  // sustained" is precisely the situation where pulling the records is
  // the only way to find out what it was, and nobody has judged it yet.
  function isInvestigable(mo) {
    if (!mo) return false;
    if (FWMoEngine.OPEN_STATUSES.has(mo.status)) return true;
    return mo.status === 'DISMISSED' && mo.autoFaded === true;
  }

  function ensureRecord(mo) {
    if (!mo.investigation) {
      mo.investigation = { findings: [], completed: [], effortSeconds: 0 };
    }
    if (mo.investigationAdjustment == null) mo.investigationAdjustment = 0;
    return mo.investigation;
  }

  // Signals referenced by an MO are looked up in the signal engine's own
  // log rather than off the entity, so a case stays investigable after
  // its signals have decayed off the truck.
  function signalsForMo(state, mo) {
    if (!state || !state.signalEngine || !mo) return [];
    const wanted = new Set(mo.signals || []);
    return state.signalEngine.log.filter(s => wanted.has(s.id));
  }

  function coveredSignals(state, mo, def) {
    return signalsForMo(state, mo).filter(s => def.covers.includes(s.type));
  }

  // Which actions are worth offering for this case, and which have
  // already been spent. An action is only offered if the MO actually
  // contains a signal type that source can speak to.
  function availableActions(state, mo) {
    if (!mo) return [];
    const record = ensureRecord(mo);
    return Object.keys(ACTION_CATALOG)
      .map(key => {
        const def = ACTION_CATALOG[key];
        const covered = coveredSignals(state, mo, def);
        // An action that needs a site is offered only when the case has
        // one. Offering it on a wholly road-observed case would invite the
        // analyst to spend an hour learning there was never a source.
        const siteCtx = def.requiresSite ? siteRecordChance(state, mo, covered) : null;
        const applicable = covered.length > 0 && (!def.requiresSite || !!siteCtx);
        return {
          key,
          label: def.label,
          question: def.question,
          effortSeconds: def.effortSeconds,
          applicable,
          requiresSite: !!def.requiresSite,
          // Stated up front, before the analyst spends the effort: how
          // likely this source holds anything at all.
          siteRecordLikelihood: siteCtx ? Math.round(siteCtx.chance * 100) : null,
          sites: siteCtx ? siteCtx.sites : null,
          signalTypes: Array.from(new Set(covered.map(s => s.type))),
          done: record.completed.includes(key)
        };
      })
      .filter(a => a.applicable);
  }

  function explainedCauses(signals) {
    const causes = signals
      .filter(s => s.groundTruth && s.groundTruth.legitimate && s.groundTruth.cause)
      .map(s => s.groundTruth.cause);
    return Array.from(new Set(causes));
  }

  function narrateExculpatory(def, causes, explained, total) {
    const list = causes.length ? ` Found on record: ${causes.join('; ')}.` : '';
    const scope = total > 1 ? ` (${explained} of ${total} checked signals accounted for)` : '';
    return `${def.label}: a documented operational explanation exists${scope}.${list} A record like this is verifiable, so it weighs heavily against the fraud reading.`;
  }

  function narrateMixed(def, causes, explained, total) {
    return `${def.label}: partially accounted for — ${explained} of ${total} checked signals have a documented explanation (${causes.join('; ')}), the rest do not. The unexplained remainder is still just unexplained, not proof of anything.`;
  }

  function narrateCorroborating(def, types) {
    return `${def.label}: no documented operational explanation was found for ${types.join(', ').replace(/_/g, ' ')}. This is an absence of an innocent explanation, not evidence of fraud — it raises confidence only slightly.`;
  }

  function narrateInconclusive(def) {
    return `${def.label}: records were incomplete or the source could not be reached. This check neither supports nor rules out the anomaly; the effort is spent and confidence is unchanged.`;
  }

  // Runs one action against the simulation's hidden ground truth and
  // returns the finding. Mutates the MO's investigation record and its
  // confidence adjustment; the caller re-renders.
  function performAction(state, mo, actionKey) {
    const def = ACTION_CATALOG[actionKey];
    if (!state || !mo || !def) return null;
    if (!isInvestigable(mo)) return null;

    const record = ensureRecord(mo);
    if (record.completed.includes(actionKey)) return null;

    const covered = coveredSignals(state, mo, def);
    if (!covered.length) return null;

    // A site-record check on a case with no site is refused outright
    // rather than run and reported as inconclusive, and costs nothing.
    const siteCtx = def.requiresSite ? siteRecordChance(state, mo, covered) : null;
    if (def.requiresSite && !siteCtx) return null;

    const types = Array.from(new Set(covered.map(s => s.type)));
    const now = FWSimRunner.absoluteNow(state.clock);

    // Does a record covering this even exist? Rolled BEFORE the ordinary
    // inconclusive roll, because "there is nothing to fetch" is a
    // different answer from "the fetch failed", and only the first one is
    // guaranteed not to move confidence.
    const noRecord = def.requiresSite && state.rng
      ? !state.rng.chance(siteCtx.chance) : false;
    const inconclusive = !noRecord && state.rng ? state.rng.chance(def.inconclusiveChance) : false;

    // Which types this check could actually ANSWER on, as opposed to
    // which it was run against. The two differ for the site record: it is
    // offered against every signal type, but it can only speak to the
    // signals that were observed at a site, and a check that came back
    // with nothing to fetch or could not be reached spoke to none of
    // them. Kept separate from signalTypes rather than replacing it,
    // because signalTypes is the honest record of what was attempted and
    // is what the findings list narrates.
    let spokenToTypes = [];

    let outcome, delta, narrative;
    if (noRecord) {
      outcome = 'NO_RECORD_EXISTS';
      delta = 0;
      narrative = narrateNoRecord(def, siteCtx);
    } else if (inconclusive) {
      outcome = 'INCONCLUSIVE';
      delta = 0;
      narrative = narrateInconclusive(def);
    } else {
      // A site record can only speak to what was observed at a site.
      const scope = def.requiresSite ? sitedSignals(covered) : covered;
      spokenToTypes = Array.from(new Set(scope.map(s => s.type)));
      const causes = explainedCauses(scope);
      const explained = scope.filter(s => s.groundTruth && s.groundTruth.legitimate).length;
      const fraction = explained / scope.length;
      delta = Math.round(def.exculpatoryDelta * fraction + def.corroboratingDelta * (1 - fraction));
      if (fraction >= 0.5) {
        outcome = 'EXCULPATORY';
        narrative = narrateExculpatory(def, causes, explained, scope.length);
      } else if (fraction > 0) {
        outcome = 'MIXED';
        narrative = narrateMixed(def, causes, explained, scope.length);
      } else {
        outcome = 'CORROBORATING';
        narrative = narrateCorroborating(def, types);
      }
    }

    const finding = {
      actionKey, label: def.label, question: def.question,
      outcome, confidenceDelta: delta, signalTypes: types, spokenToTypes,
      effortSeconds: def.effortSeconds, at: now, narrative,
      sites: siteCtx ? siteCtx.sites : null,
      siteRecordLikelihood: siteCtx ? Math.round(siteCtx.chance * 100) : null
    };

    // Belt and braces on the one invariant this outcome exists to hold.
    if (outcome === 'NO_RECORD_EXISTS' && delta !== 0) {
      throw new Error('NO_RECORD_EXISTS must never move confidence');
    }

    record.findings.push(finding);
    record.completed.push(actionKey);
    record.effortSeconds += def.effortSeconds;
    mo.investigationAdjustment = clamp(
      mo.investigationAdjustment + delta, MAX_DOWNWARD_ADJUSTMENT, MAX_UPWARD_ADJUSTMENT
    );
    FWMoEngine.recomputeConfidence(mo);
    return finding;
  }

  function summary(mo) {
    const record = ensureRecord(mo);
    const byOutcome = { EXCULPATORY: 0, MIXED: 0, CORROBORATING: 0, INCONCLUSIVE: 0, NO_RECORD_EXISTS: 0 };
    record.findings.forEach(f => { if (byOutcome[f.outcome] != null) byOutcome[f.outcome]++; });
    return {
      checksRun: record.findings.length,
      effortSeconds: record.effortSeconds,
      adjustment: mo.investigationAdjustment || 0,
      byOutcome,
      // Checks that came back with nothing to fetch. Surfaced separately
      // from inconclusive ones so "we could not see there" never gets
      // averaged into "we looked and found nothing".
      noRecordChecks: byOutcome.NO_RECORD_EXISTS
    };
  }

  // An outcome either answered on the signals it was run against or it
  // did not, and the two ways of not answering are not the same fact.
  // Exported because the advisory has to tell them apart: a source whose
  // check came back empty bought no coverage, and treating it as covered
  // would let this port's blind spot read as a case having been examined.
  const SUBSTANTIVE_OUTCOMES = ['EXCULPATORY', 'MIXED', 'CORROBORATING'];
  const LEARNED_NOTHING_OUTCOMES = ['NO_RECORD_EXISTS', 'INCONCLUSIVE'];

  /* WAS THIS CASE EXAMINED, AND IF NOT, WHY NOT (Slice 26). Every panel
     that lists a case by its status implies the status was arrived at.
     Some were not: a case can close having had no check run against it at
     all, or having had checks run that came back with nothing to fetch.
     Those are three different facts about the analyst's own work and the
     port's own records, and a status label hides all three.

     The classes are ordered by what they say, not by severity. A case
     with any answered check has been examined to some degree, whatever
     else also failed. Of the two ways of learning nothing, nothing to
     fetch takes precedence in the label because it is the stronger
     statement -- it says the record was never written, where unreachable
     says only that this attempt missed it. */
  const EXAMINATION_CLASSES = ['ANSWERED', 'NOTHING_TO_FETCH', 'UNREACHABLE', 'NEVER_LOOKED'];

  const EXAMINATION_NOTE = {
    ANSWERED: 'at least one check answered on the signals it was run against',
    NOTHING_TO_FETCH: 'checks were run and there was no record of that kind to fetch',
    UNREACHABLE: 'checks were run and the source could not be reached or its records were incomplete',
    NEVER_LOOKED: 'no check was ever run against it'
  };

  function examination(mo) {
    const record = (mo && mo.investigation) || { findings: [], effortSeconds: 0 };
    const findings = record.findings || [];
    let answered = 0, noRecord = 0, inconclusive = 0;
    const answeredTypes = new Set();
    findings.forEach(f => {
      if (SUBSTANTIVE_OUTCOMES.indexOf(f.outcome) >= 0) {
        answered++;
        (f.spokenToTypes || f.signalTypes || []).forEach(t => answeredTypes.add(t));
      } else if (f.outcome === 'NO_RECORD_EXISTS') noRecord++;
      else inconclusive++;
    });
    const cls = answered ? 'ANSWERED'
      : noRecord ? 'NOTHING_TO_FETCH'
      : inconclusive ? 'UNREACHABLE'
      : 'NEVER_LOOKED';
    return {
      checksRun: findings.length,
      answeredChecks: answered,
      noRecordChecks: noRecord,
      inconclusiveChecks: inconclusive,
      answeredTypeCount: answeredTypes.size,
      effortSeconds: record.effortSeconds || 0,
      everLooked: findings.length > 0,
      everAnswered: answered > 0,
      examinationClass: cls,
      note: EXAMINATION_NOTE[cls]
    };
  }

  /* A set of cases sorted into the four classes, asserted to sum to the
     set's own size (reconciled-totals discipline). Deliberately counts
     only: a share of an entity's two or three cases would be a rate on a
     sample the analytics model's own small-sample floor would withhold. */
  function examinationRollup(mos) {
    const list = Array.from(mos || []);
    const byClass = {};
    EXAMINATION_CLASSES.forEach(k => { byClass[k] = 0; });
    let effortSeconds = 0;
    list.forEach(mo => {
      const ex = examination(mo);
      byClass[ex.examinationClass] += 1;
      effortSeconds += ex.effortSeconds;
    });
    const sorted = EXAMINATION_CLASSES.reduce((a, k) => a + byClass[k], 0);
    if (sorted !== list.length) {
      throw new Error(
        'investigationEngine: examination rollup does not reconcile (' + sorted + ' sorted vs ' +
        list.length + ' cases). Every case was answered on, run against with nothing to fetch, ' +
        'run against and unreachable, or never looked at.'
      );
    }
    return { total: list.length, byClass, effortSeconds, classes: EXAMINATION_CLASSES, notes: EXAMINATION_NOTE };
  }

  /* What the site-record checks touching one site actually came back with.
     A real measured count with a real denominator -- the checks run --
     and NOT a measurement of that site's coverage, which is the reading it
     invites. The empty results were generated FROM the site's stated
     coverage parameter, so treating the observed empty share as evidence
     about coverage would be reading the assumption back out of its own
     output, which is the circular arithmetic the facility model already
     refuses. It is a fact about the analyst's own checks here. */
  function siteCheckOutcomes(mos, facilityId) {
    const byOutcome = { EXCULPATORY: 0, MIXED: 0, CORROBORATING: 0, INCONCLUSIVE: 0, NO_RECORD_EXISTS: 0 };
    let checks = 0, cases = 0;
    Array.from(mos || []).forEach(mo => {
      const findings = (mo.investigation && mo.investigation.findings) || [];
      let touched = false;
      findings.forEach(f => {
        if (!(f.sites || []).some(s => s.facilityId === facilityId)) return;
        checks += 1; touched = true;
        if (byOutcome[f.outcome] != null) byOutcome[f.outcome] += 1;
      });
      if (touched) cases += 1;
    });
    return { checks, cases, byOutcome, noRecord: byOutcome.NO_RECORD_EXISTS };
  }

  const OUTCOME_NOTE = {
    EXCULPATORY: 'A documented explanation was found on record. Records are verifiable, so this weighs heavily.',
    MIXED: 'Part of what was checked has a documented explanation and part does not. The remainder is unexplained, which is not the same as suspicious.',
    CORROBORATING: 'No documented explanation was found. That is an absence of an innocent explanation, not evidence of fraud, so it moves confidence only slightly.',
    INCONCLUSIVE: 'The source could not be reached or its records were incomplete. The effort is spent and nothing is learned.',
    NO_RECORD_EXISTS: 'No record of this kind exists at that site and hour, so there was never anything to fetch. Confidence is unchanged by design — a missing record where watching is thin is what thin watching produces.'
  };

  return {
    ACTION_CATALOG, OUTCOME_NOTE, SUBSTANTIVE_OUTCOMES, LEARNED_NOTHING_OUTCOMES,
    EXAMINATION_CLASSES, EXAMINATION_NOTE, examination, examinationRollup, siteCheckOutcomes,
    availableActions, performAction, summary, isInvestigable,
    signalsForMo, sitedSignals, siteRecordChance, narrateSiteUnavailable,
    MAX_UPWARD_ADJUSTMENT, MAX_DOWNWARD_ADJUSTMENT
  };
})();
