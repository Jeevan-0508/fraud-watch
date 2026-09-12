/* reconcile.js -- the one owner of what "reconciled" means in this codebase.

   Seventeen places in this app end a tally with a throw whose message says
   the buckets "do not reconcile". They cite one discipline by name. They are
   not one thing. Measured by planting, in each, exactly the failure its own
   message describes:

     A. The bucket key is checked against the declared list BEFORE it is
        indexed, and an undeclared one throws that module's own named error.
        The sum comparison that follows is then an arithmetic identity: every
        record has already been proved to increment exactly one declared
        bucket. It cannot fail. It is documentation, not a check.
          investigationEngine.tallyOutcomes, moEngine.discoverySummary (x2)

     B. The key is absorbed by `byClass[k] = (byClass[k] || 0) + 1`, so an
        undeclared record lands in an undeclared bucket, the sum over the
        DECLARED keys falls short, and the sum comparison catches it with its
        own message. Here the sum branch is the real check.
          outcomeEngine.examinationBreakdown

     C. The key is indexed and then written through -- `buckets[k].push(m)`,
        `acc[k].seconds += n`. An undeclared key is `undefined`, so the write
        raises a bare TypeError ("undefined is not an object") and the
        module's own carefully worded refusal never runs. The reader gets a
        stack trace naming a variable instead of a sentence naming the fault.
          moEngine.standingPartition, exposureModel.effortByExamination
        (facilityEngine.siteSummary looked like a third until the probe was
         corrected: the TypeError came from the probe's own malformed
         registry argument, not from the guard, which fires as written.)

     D. Records are sorted by an if/else chain with a final `else`, so no
        record can miss a bucket and no undeclared key exists. The sum
        comparison is a pure identity over addends accumulated in the same
        loop it is checking. Planting the described failure produces no
        throw of any kind, in any of them.
          adviceEngine.typePartition, awayReport.newCaseScope,
          awayReport closure hands, moEngine.contributionScopes,
          investigationEngine.examinationRollup (no injection point at all:
          the class is derived inside the loop, so no caller can plant one)

   So the word "reconciles" on eight of these sites is a claim no test could
   ever have falsified, three of them cannot report the fault they were
   written for, and nothing on the outside distinguishes any of them from the
   four that work. The distinction has to be declared, not left to whoever
   reads the throw.

   This module owns the vocabulary and one honest helper. It has no
   cross-module dependency, so its register is reconciled at load. */
const FWReconcile = (() => {

  /* Two independently derived numbers agreeing is evidence. One number
     agreeing with a restatement of itself is not. Both appear in this
     codebase behind the same word. */
  const KINDS = {
    TWO_INDEPENDENT_DERIVATIONS: {
      means: 'the two sides of the comparison were produced by separate code paths from separate inputs, so a disagreement is real information.',
      doesNotMean: 'that either side is correct -- only that they were not derived from one another.',
      canFail: true
    },
    KEY_DECLARED_THEN_SUMMED: {
      means: 'the bucket key is checked against the declared list before it is used, and the sum comparison that follows restates what the key check already established.',
      doesNotMean: 'that the sum comparison is a second check. It is an identity; the key check is the whole guard.',
      canFail: true
    },
    UNDECLARED_KEY_ABSORBED: {
      means: 'an undeclared key silently creates an undeclared bucket, so the sum over declared keys falls short and the sum comparison is the real check.',
      doesNotMean: 'that the undeclared key is named. The message reports a count that does not add up, not which key was unknown.',
      canFail: true
    },
    SAME_LOOP_RESTATEMENT: {
      means: 'the total on the right of the comparison is accumulated inside the same loop, from the same addends, as the buckets on the left. The comparison is an arithmetic identity.',
      doesNotMean: 'anything at all about whether the partition is sound. It cannot fail, and it has never been shown to fire, because it cannot be.',
      canFail: false
    },
    ROUNDING_DRIFT_ONLY: {
      means: 'the two sides are the same sum at different roundings, so the comparison can only ever detect rounding drift within its tolerance.',
      doesNotMean: 'that any record was counted twice or not at all -- that question is settled by the loop structure and is never asked here.',
      canFail: false
    }
  };

  const KIND_KEYS = Object.keys(KINDS);

  /* What the fault surfaces AS, which is a separate fact from whether the
     guard can fail. A guard can be incapable of firing (kind D) while the
     fault it names still reaches the user -- as a TypeError. */
  const SURFACES = {
    OWN_MESSAGE: 'the module\'s own sentence, naming the fault.',
    BARE_TYPE_ERROR: 'a TypeError from writing through an undefined bucket. The declared message never runs.',
    NOTHING: 'no error of any kind; the fault the message describes cannot occur here.'
  };

  const SURFACE_KEYS = Object.keys(SURFACES);

  /* Every reconciliation guard in the app, its kind, and how the fault its
     message describes actually surfaces -- each entry measured by planting
     that fault, not read off the source. `measuredBy` names the probe. */
  const REGISTER = [
    { site: 'systems/scoring.js:tally', quantities: 'sum over the six declared buckets vs state.resolutions, a separately stored counter',
      kind: 'TWO_INDEPENDENT_DERIVATIONS', undeclaredKeySurfaces: 'OWN_MESSAGE', demonstrated: true },
    { site: 'game.js:tallyResolutions', quantities: 'sum over three buckets vs state.resolved, a separately incremented counter',
      kind: 'TWO_INDEPENDENT_DERIVATIONS', undeclaredKeySurfaces: 'OWN_MESSAGE', demonstrated: false,
      note: 'reads module-private `state` and takes no argument, so nothing outside can trip it (convention 37).' },
    { site: 'simulation/shiftEngine.js:recordedTotals', quantities: 'sum of per-shift observed counts vs tracker.totalObserved',
      kind: 'TWO_INDEPENDENT_DERIVATIONS', undeclaredKeySurfaces: 'OWN_MESSAGE', demonstrated: true },
    { site: 'simulation/shiftEngine.js:shiftHours', quantities: 'hours the clock assigns to each shift vs the 24 hours of a day',
      kind: 'TWO_INDEPENDENT_DERIVATIONS', undeclaredKeySurfaces: 'OWN_MESSAGE', demonstrated: true,
      note: 'memoised: it consults the clock once per run and returns the memo thereafter, so both its guards can fire at most once and a test that ran anything else first could never trip them. Given a clock injection point and an explicit force in Slice 60.' },
    { site: 'simulation/facilityEngine.js:siteSummary', quantities: 'sited records + road records vs tracker.totalRecorded',
      kind: 'TWO_INDEPENDENT_DERIVATIONS', undeclaredKeySurfaces: 'OWN_MESSAGE', demonstrated: true,
      note: 'first probed with a malformed registry and recorded as a bare TypeError; the TypeError was the probe\'s own bad argument, not this guard. Re-measured against a real 24-hour run: it fires with its own sentence.' },
    { site: 'simulation/exposureModel.js:caseSheet ledger vs booked', quantities: 'effort summed off the closure ledger vs effortReconciliation().booked',
      kind: 'TWO_INDEPENDENT_DERIVATIONS', undeclaredKeySurfaces: 'OWN_MESSAGE', demonstrated: false,
      note: 'both sides derive from one state object; no argument isolates them.' },
    { site: 'simulation/awayReport.js:newCaseScope ledger delta', quantities: 'cases opened in the window vs the growth of the case ledger',
      kind: 'TWO_INDEPENDENT_DERIVATIONS', undeclaredKeySurfaces: 'OWN_MESSAGE', demonstrated: true },
    { site: 'ui/calibration-view.js:checksLine', quantities: 'answered + no-record + unreachable vs entry.checksRun',
      kind: 'TWO_INDEPENDENT_DERIVATIONS', undeclaredKeySurfaces: 'OWN_MESSAGE', demonstrated: false,
      note: 'module-private function, reachable only through render().' },

    { site: 'simulation/investigationEngine.js:tallyOutcomes', quantities: 'sum over declared outcomes vs the checks counted',
      kind: 'KEY_DECLARED_THEN_SUMMED', undeclaredKeySurfaces: 'OWN_MESSAGE', demonstrated: true },
    { site: 'simulation/moEngine.js:discoverySummary classes', quantities: 'sum over the four declared classes vs the cases held',
      kind: 'KEY_DECLARED_THEN_SUMMED', undeclaredKeySurfaces: 'OWN_MESSAGE', demonstrated: true },
    { site: 'simulation/moEngine.js:discoverySummary reasons', quantities: 'sum over declared reasons plus the unstated vs the cases held',
      kind: 'KEY_DECLARED_THEN_SUMMED', undeclaredKeySurfaces: 'OWN_MESSAGE', demonstrated: true },

    { site: 'simulation/outcomeEngine.js:examinationBreakdown', quantities: 'sum over the four declared classes vs the closures given',
      kind: 'UNDECLARED_KEY_ABSORBED', undeclaredKeySurfaces: 'OWN_MESSAGE', demonstrated: true },

    { site: 'simulation/moEngine.js:standingPartition', quantities: 'sum of bucket lengths vs the list length, both from one loop',
      kind: 'SAME_LOOP_RESTATEMENT', undeclaredKeySurfaces: 'BARE_TYPE_ERROR', demonstrated: true },
    { site: 'simulation/exposureModel.js:effortByExamination seconds', quantities: 'seconds summed per class vs seconds accumulated in the same loop',
      kind: 'SAME_LOOP_RESTATEMENT', undeclaredKeySurfaces: 'BARE_TYPE_ERROR', demonstrated: true },
    { site: 'simulation/adviceEngine.js:typePartition', quantities: 'four bucket lengths vs the type count, sorted by an if/else with a final else',
      kind: 'SAME_LOOP_RESTATEMENT', undeclaredKeySurfaces: 'NOTHING', demonstrated: true },
    { site: 'simulation/awayReport.js:newCaseScope split', quantities: 'in-window + predating vs the opened count, sorted by one if/else',
      kind: 'SAME_LOOP_RESTATEMENT', undeclaredKeySurfaces: 'NOTHING', demonstrated: true },
    { site: 'simulation/awayReport.js:closure hands', quantities: 'engine-faded + analyst-closed vs the closures counted, sorted by one if/else',
      kind: 'SAME_LOOP_RESTATEMENT', undeclaredKeySurfaces: 'NOTHING', demonstrated: true },
    { site: 'simulation/investigationEngine.js:examinationRollup', quantities: 'sum over four declared classes vs the cases given',
      kind: 'SAME_LOOP_RESTATEMENT', undeclaredKeySurfaces: 'NOTHING', demonstrated: false,
      note: 'the class is derived by examination() inside the loop, so no caller can plant an undeclared one; unfirable AND uninjectable.' },

    { site: 'simulation/moEngine.js:contributionScopes', quantities: 'two rounded sums vs a rounding of their unrounded total, tolerance 0.011',
      kind: 'ROUNDING_DRIFT_ONLY', undeclaredKeySurfaces: 'NOTHING', demonstrated: true }
  ];

  /* Reconciled in both directions and at load, because this module depends on
     nothing: a kind no site claims is a distinction nobody needed, and a site
     claiming an undeclared kind would put an unexplained word on a panel. */
  function assertRegisterDeclared(register, kinds, surfaces) {
    const reg = register || REGISTER;
    const kindTable = kinds || KINDS;
    const surfaceTable = surfaces || SURFACES;
    const kindKeys = Object.keys(kindTable);
    const surfaceKeys = Object.keys(surfaceTable);
    const used = {};
    reg.forEach(r => {
      if (kindKeys.indexOf(r.kind) < 0) {
        throw new Error('reconcile: site ' + r.site + ' declares reconciliation kind "' + r.kind +
          '", which is not one of ' + kindKeys.join('/') + '; a panel would print a word this module never defined');
      }
      if (surfaceKeys.indexOf(r.undeclaredKeySurfaces) < 0) {
        throw new Error('reconcile: site ' + r.site + ' says the fault surfaces as "' + r.undeclaredKeySurfaces +
          '", which is not one of ' + surfaceKeys.join('/'));
      }
      if (!r.quantities) {
        throw new Error('reconcile: site ' + r.site + ' names no two quantities, so there is nothing to say it reconciles');
      }
      if (kindTable[r.kind].canFail === false && r.demonstrated && r.undeclaredKeySurfaces === 'OWN_MESSAGE') {
        throw new Error('reconcile: site ' + r.site + ' is declared incapable of failing yet is also recorded as having ' +
          'issued its own message; one of those two claims is wrong');
      }
      used[r.kind] = (used[r.kind] || 0) + 1;
    });
    const unused = kindKeys.filter(k => !used[k]);
    if (unused.length) {
      throw new Error('reconcile: kind(s) ' + unused.join(', ') + ' are declared but no site claims them; ' +
        'a distinction no code makes is one the reader has to guess at');
    }
    return { state: 'CHECKED', sites: reg.length, kinds: kindKeys.length, byKind: used };
  }

  /* How many of the app's reconciliations are capable of failing, over the
     register as the population -- printed with its base, never as a bare
     count and never as a share on its own. */
  function capability(register, kinds) {
    const reg = register || REGISTER;
    const kindTable = kinds || KINDS;
    const canFail = reg.filter(r => kindTable[r.kind].canFail);
    const cannot = reg.filter(r => !kindTable[r.kind].canFail);
    const silent = reg.filter(r => r.undeclaredKeySurfaces === 'BARE_TYPE_ERROR');
    const undemonstrated = reg.filter(r => !r.demonstrated);
    return {
      base: reg.length,
      canFail: canFail.length,
      cannotFail: cannot.length,
      cannotFailSites: cannot.map(r => r.site),
      faultEscapesUnnamed: silent.length,
      faultEscapesUnnamedSites: silent.map(r => r.site),
      undemonstrated: undemonstrated.length,
      undemonstratedSites: undemonstrated.map(r => r.site),
      note: 'Of the ' + reg.length + ' reconciliation guards in this app, ' + canFail.length +
        ' can fail on some input and ' + cannot.length + ' cannot fail on any input. ' +
        silent.length + ' surface the fault they were written for as an unnamed TypeError rather than ' +
        'as their own sentence. ' + undemonstrated.length + ' have no injection point, so nothing outside ' +
        'the module can trip them and "never reported a problem" cannot be told from "could not report one".'
    };
  }

  /* The honest partition. Every record's key is checked against the declared
     list BEFORE it is used as an index, so the one fault that can actually
     occur -- a key nobody declared -- is refused by name instead of reaching
     a caller as a TypeError. The returned block states which kind of
     reconciliation this is, so a panel cannot present an identity as a check. */
  function partition(records, keyOf, declaredKeys, label) {
    const list = Array.from(records || []);
    const keys = Array.from(declaredKeys || []);
    if (!keys.length) {
      throw new Error('reconcile.partition: ' + (label || 'partition') + ' declares no buckets, so every record ' +
        'would fall outside the declared set and the sum would be trivially zero');
    }
    const seen = {};
    keys.forEach(k => {
      if (seen[k]) {
        throw new Error('reconcile.partition: ' + (label || 'partition') + ' declares bucket "' + k +
          '" twice; a duplicated bucket is counted once and read as two');
      }
      seen[k] = true;
    });
    const buckets = {};
    const counts = {};
    keys.forEach(k => { buckets[k] = []; counts[k] = 0; });
    list.forEach((rec, i) => {
      const k = keyOf(rec, i);
      if (!seen[k]) {
        throw new Error('reconcile.partition: ' + (label || 'partition') + ' record ' + i + ' has key "' + k +
          '", which is not one of the declared buckets ' + keys.join('/') + '. A record with no bucket sits in ' +
          'the denominator of every rate and the numerator of none.');
      }
      buckets[k].push(rec);
      counts[k] += 1;
    });
    return {
      total: list.length,
      counts: counts,
      cases: buckets,
      keys: keys,
      reconciliation: {
        kind: 'KEY_DECLARED_THEN_SUMMED',
        means: KINDS.KEY_DECLARED_THEN_SUMMED.means,
        doesNotMean: KINDS.KEY_DECLARED_THEN_SUMMED.doesNotMean,
        note: 'Every one of the ' + list.length + ' record' + (list.length === 1 ? '' : 's') +
          ' was checked against the ' + keys.length + ' declared buckets before being counted, so the buckets ' +
          'add to the base by construction. That the totals agree is not a second check on this partition.'
      }
    };
  }

  assertRegisterDeclared();

  return {
    KINDS, KIND_KEYS, SURFACES, SURFACE_KEYS, REGISTER,
    assertRegisterDeclared, capability, partition
  };
})();
