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

   Deltas below are design-intent calibration, not measured from any real
   dataset. No monetary/exposure figure is produced or implied anywhere in
   this module -- no loss model exists in this codebase yet (Phase 50). */
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
        return {
          key,
          label: def.label,
          question: def.question,
          effortSeconds: def.effortSeconds,
          applicable: covered.length > 0,
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

    const types = Array.from(new Set(covered.map(s => s.type)));
    const now = FWSimRunner.absoluteNow(state.clock);
    const inconclusive = state.rng ? state.rng.chance(def.inconclusiveChance) : false;

    let outcome, delta, narrative;
    if (inconclusive) {
      outcome = 'INCONCLUSIVE';
      delta = 0;
      narrative = narrateInconclusive(def);
    } else {
      const causes = explainedCauses(covered);
      const explained = covered.filter(s => s.groundTruth && s.groundTruth.legitimate).length;
      const fraction = explained / covered.length;
      delta = Math.round(def.exculpatoryDelta * fraction + def.corroboratingDelta * (1 - fraction));
      if (fraction >= 0.5) {
        outcome = 'EXCULPATORY';
        narrative = narrateExculpatory(def, causes, explained, covered.length);
      } else if (fraction > 0) {
        outcome = 'MIXED';
        narrative = narrateMixed(def, causes, explained, covered.length);
      } else {
        outcome = 'CORROBORATING';
        narrative = narrateCorroborating(def, types);
      }
    }

    const finding = {
      actionKey, label: def.label, question: def.question,
      outcome, confidenceDelta: delta, signalTypes: types,
      effortSeconds: def.effortSeconds, at: now, narrative
    };

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
    const byOutcome = { EXCULPATORY: 0, MIXED: 0, CORROBORATING: 0, INCONCLUSIVE: 0 };
    record.findings.forEach(f => { if (byOutcome[f.outcome] != null) byOutcome[f.outcome]++; });
    return {
      checksRun: record.findings.length,
      effortSeconds: record.effortSeconds,
      adjustment: mo.investigationAdjustment || 0,
      byOutcome
    };
  }

  return {
    ACTION_CATALOG, availableActions, performAction, summary, isInvestigable,
    signalsForMo, MAX_UPWARD_ADJUSTMENT, MAX_DOWNWARD_ADJUSTMENT
  };
})();
