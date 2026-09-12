/* systems/scenario.js — the taxonomy-driven case generator. Pure logic,
   no Phaser/DOM here, so it's testable the same way data.js is. Every
   case is either a real pattern from freight-fraud-taxonomy, or a clean
   run wearing a borrowed false_positives clue (a "decoy" case) — so
   suspicion is never proof by construction.

   THREE THINGS WERE WRONG HERE AND ALL THREE WERE MEASURABLE.

   1. THE ANSWER WAS IN THE SHAPE OF THE CASE, NOT ITS CONTENT. A fraud
      case mapped one indicator onto each of 3 or 4 of the six check
      buttons. A clean case mapped exactly ONE decoy onto ONE button, and
      every other button returned "Nothing unusual." So over 9,000
      generated cases at three levels the two response counts never once
      overlapped: 1 meant clean, 3 or more meant fraud, always. Counting
      how many checks came back with anything classified every case
      perfectly, without reading a single one of them. In the one part of
      this project that is supposed to teach an analyst to weigh what a
      signal says, the NUMBER of signals was proof by construction — the
      exact inversion of the thing the rest of the app exists to refuse.

      The same mechanism leaked a second time, in colour: game.js pushed a
      real indicator to the radio feed as 'bad' and a decoy as 'warn', so the
      tint of the message answered the question the check was asked. Both are
      observations now and both read the same.

      A clean run does not produce exactly one coincidence. It produces as
      many as a fraudulent one and they are all innocently explainable,
      which is what makes it hard. A clean case now fills the same number
      of buttons as a fraud case of the same level, each with a distinct
      documented false positive, and assertShapeNotSeparable() throws if
      the two distributions ever come apart again.

   2. THE DIFFICULTY RAMP WAS INERT, AND THE REASON WAS NOT WHAT IT LOOKED
      LIKE. indicatorCount climbs 3 -> 6 with level and the cases showed 3,
      or sometimes 4, at every level. The first explanation to reach for is a
      shallow taxonomy — but every pattern in it carries 6 to 9 indicators,
      so min(n, depth) is n for every n this app asks for. The cause was in
      data.pickIndicators: its `while (chosen.length < Math.min(n, top.length))`
      bound re-read top.length after a splice inside the loop had shortened
      it, so the target fell by one for every item taken and the loop met
      itself at about half of n. Fixed there, where it belongs. The budget is
      now also separated from what is deliverable and both are reported on
      every case — the declared/deliverable distinction entityEngine uses for
      status vocabularies. This comment's first draft asserted the shallow
      taxonomy; it was measured and it was false.

   3. THE BASE RATE ROSE TO 70% AND NOTHING SAID SO. fraudChance climbs
      from 0.44 to a 0.70 ceiling, so at level 8 seven cases in ten really
      are fraudulent and a player who learns to press FLAG on everything is
      being rewarded by a pacing knob. The one calibrated constant in this
      codebase points the other way: falsePositiveEngine.LEGITIMATE_CHANCE
      is 0.65, i.e. roughly a third of what looks suspicious in the
      simulation is. Two base rates, opposite directions, one calibrated
      and one arbitrary, and the arbitrary one was invisible. It is kept —
      an arcade needs a pacing knob — and it is now named, reconciled
      against the calibrated constant, and refused as a prevalence. */
const FWScenario = (() => {
  const ACTIONS = ['MANIFEST', 'GPS', 'SEAL', 'NEARBY', 'ROUTE', 'DRIVER'];
  const CARRIERS = ['NordTransit', 'BalticFreight Ltd', 'Meridian Cargo Co', 'Continental Haul',
    'Elbe Logistics', 'Vantage Road Freight', 'Solaris Intermodal', 'Harbourline Transport'];
  const CARGO = ['Consumer Electronics', 'Machine Parts', 'Pharmaceuticals', 'Textiles',
    'Packaged Foodstuffs', 'Automotive Components'];

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  const FRAUD_CHANCE_FLOOR = 0.40;
  const FRAUD_CHANCE_CEILING = 0.70;
  const INDICATOR_BUDGET_FLOOR = 3;
  const INDICATOR_BUDGET_CEILING = 6;

  /* The generator's base rate, stated. It is a pacing parameter and this
     register exists so it can never again be mistaken for, or silently read
     as, how often freight fraud actually happens. */
  const BASE_RATE = {
    label: 'share of generated cases that really are fraudulent',
    floor: FRAUD_CHANCE_FLOOR,
    ceiling: FRAUD_CHANCE_CEILING,
    unit: 'a probability the generator draws against, not a measured prevalence',
    isCalibrated: false,
    why: 'A game needs to get harder. Nothing about this figure is measured, and it is the only base rate ' +
      'in this project that is not: falsePositiveEngine.LEGITIMATE_CHANCE is calibrated and documented in ' +
      'docs/real-world-mo-ingestion.md.',
    consequence: 'Because it rises, a player who learns to flag everything scores better the further they ' +
      'get. That is the pacing knob rewarding them, not their judgement improving, and it trains the ' +
      'opposite of what the rest of this app is for.'
  };

  function fraudChanceForLevel(level) {
    return Math.min(FRAUD_CHANCE_CEILING, FRAUD_CHANCE_FLOOR + level * 0.04);
  }

  // Reconciled against the one calibrated constant, in both directions, and
  // only when it is loaded — this module is also used by tests that do not.
  function baseRateReconciliation(level) {
    const arcade = fraudChanceForLevel(level);
    const calibrated = window.FWFalsePositiveEngine
      ? 1 - FWFalsePositiveEngine.LEGITIMATE_CHANCE : null;
    return {
      level,
      arcadeFraudShare: arcade,
      calibratedFraudShare: calibrated,
      agrees: calibrated == null ? null : Math.abs(arcade - calibrated) < 0.02,
      note: calibrated == null
        ? 'The calibrated constant is not loaded here, so this base rate cannot be reconciled against ' +
          'anything and must not be read as a prevalence.'
        : Math.round(arcade * 100) + '% of cases at this level really are fraudulent. The simulation\'s ' +
          'calibrated constant puts the share of suspicious-looking freight that is actually fraudulent at ' +
          'about ' + Math.round(calibrated * 100) + '%. This number is higher on purpose and is a pacing ' +
          'knob, not a finding: flagging everything scores well here and would not out there.'
    };
  }

  /* What a level ASKS for and what the taxonomy can DELIVER are two
     quantities. pickIndicators returns min(n, pattern.indicators.length), so
     the budget stops reaching anything once it passes the deepest pattern. */
  function indicatorBudgetForLevel(level) {
    return Math.min(INDICATOR_BUDGET_CEILING, INDICATOR_BUDGET_FLOOR + Math.floor(level / 2));
  }

  function deliverableIndicators(pattern, budget) {
    return Math.min(budget, pattern && pattern.indicators ? pattern.indicators.length : 0);
  }

  // MEASURED over the loaded taxonomy: how far the budget actually reaches.
  function budgetReach(level) {
    const budget = indicatorBudgetForLevel(level);
    const patterns = (window.FW && FW.patterns && FW.patterns()) || [];
    const depths = patterns.map(p => (p.indicators || []).length);
    const deepest = depths.length ? Math.max.apply(null, depths) : 0;
    const satisfied = depths.filter(d => d >= budget).length;
    return {
      level,
      budget,
      deepestPattern: deepest,
      patterns: depths.length,
      patternsThatCanSatisfyIt: satisfied,
      reaches: budget <= deepest,
      note: depths.length === 0
        ? 'The taxonomy is not loaded, so what this budget can deliver is unknown.'
        : 'This level asks for ' + budget + ' indicators. ' + satisfied + ' of ' + depths.length +
          ' patterns have that many; the deepest has ' + deepest +
          (budget > deepest
            ? ', so every case at this level shows at most ' + deepest + ' and the budget above that ' +
              'changes nothing.'
            : '.')
    };
  }

  function difficultyForLevel(level) {
    return {
      fraudChance: fraudChanceForLevel(level),
      // Kept under its original name because game.js and the existing suites
      // read it, and it is genuinely the budget. What it delivers is now a
      // separate figure on every case.
      indicatorCount: indicatorBudgetForLevel(level),
      indicatorBudget: indicatorBudgetForLevel(level),
      caseSeconds: Math.max(18, 34 - level * 1.5)
    };
  }

  function generate(level, caseNo) {
    assertShapeNotSeparableOnce();
    const diff = difficultyForLevel(level);
    const isFraud = Math.random() < diff.fraudChance;
    const carrier = pick(CARRIERS);
    const cargo = pick(CARGO);
    const id = 'PM-' + (4000 + caseNo);
    const disclosure = {
      baseRate: baseRateReconciliation(level),
      budget: budgetReach(level)
    };

    if (!isFraud) {
      /* A clean case borrows the SHAPE of a fraud case as well as a clue.
         The donor pattern decides how many buttons come back with something,
         exactly as it would if this case were that pattern, so the count
         carries no information about which kind of case this is. */
      const shapeDonor = FW.randomPattern();
      const responses = deliverableIndicators(shapeDonor, diff.indicatorBudget);
      const decoys = pickDistinctDecoys(responses);
      return {
        id, level, carrier, cargo, type: 'clean',
        decoy: decoys[0],
        decoys,
        pattern: null, indicators: [],
        shapeDonorPattern: shapeDonor ? shapeDonor.id : null,
        respondingChecks: decoys.length,
        indicatorBudget: diff.indicatorBudget,
        indicatorsShown: 0,
        actionMap: buildDecoyActionMap(decoys),
        caseSeconds: diff.caseSeconds,
        disclosure
      };
    }

    const pattern = FW.randomPattern();
    const indicators = FW.pickIndicators(pattern, diff.indicatorBudget, level > 5 ? 'subtle' : 'strong');
    return {
      id, level, carrier, cargo, type: 'fraud', pattern, indicators,
      respondingChecks: indicators.length,
      indicatorBudget: diff.indicatorBudget,
      indicatorsShown: indicators.length,
      budgetUnreached: diff.indicatorBudget - indicators.length,
      actionMap: buildActionMap(indicators),
      caseSeconds: diff.caseSeconds,
      disclosure
    };
  }

  // Distinct by the text the player actually reads, so two buttons never come
  // back with the same sentence and give the shape away a second time.
  function pickDistinctDecoys(n) {
    const out = [];
    const seen = new Set();
    for (let i = 0; i < n * 8 && out.length < n; i++) {
      const d = FW.pickDecoy();
      const key = d && d.fp ? d.fp.looks_like : null;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(d);
    }
    return out;
  }

  // Assign each shown indicator to one investigation action button so
  // the player has to choose what to check, not just wait for a feed.
  function buildActionMap(indicators) {
    const shuffledActions = [...ACTIONS].sort(() => Math.random() - 0.5);
    const map = {};
    indicators.forEach((ind, i) => { map[shuffledActions[i % shuffledActions.length]] = ind; });
    return map;
  }

  function buildDecoyActionMap(decoys) {
    const shuffledActions = [...ACTIONS].sort(() => Math.random() - 0.5);
    const map = {};
    decoys.forEach((d, i) => {
      map[shuffledActions[i % shuffledActions.length]] = { signal: d.fp.looks_like, isDecoy: true };
    });
    return map;
  }

  /* THE CHECK THAT WOULD HAVE CAUGHT THIS. Generates cases and tallies how
     many buttons respond, by kind. If the two sets of counts are disjoint the
     kind of case is readable off its shape and this throws, naming the two
     ranges, because a generator whose answer is in its shape is worse than no
     generator: it teaches the wrong skill and scores it well. */
  function shapeSeparability(level, n) {
    const counts = { clean: {}, fraud: {} };
    const totals = { clean: 0, fraud: 0 };
    for (let i = 0; i < n; i++) {
      const c = generateForMeasurement(level, i);
      const r = Object.keys(c.actionMap).length;
      counts[c.type][r] = (counts[c.type][r] || 0) + 1;
      totals[c.type] += 1;
    }
    const nums = k => Object.keys(counts[k]).map(Number);
    const cleanSet = nums('clean'), fraudSet = nums('fraud');
    const overlap = cleanSet.filter(v => fraudSet.indexOf(v) >= 0);
    return {
      level,
      generated: n,
      byKind: counts,
      totals,
      cleanCounts: cleanSet.sort((a, b) => a - b),
      fraudCounts: fraudSet.sort((a, b) => a - b),
      overlap: overlap.sort((a, b) => a - b),
      separable: totals.clean > 0 && totals.fraud > 0 && overlap.length === 0,
      note: 'Over ' + n + ' generated cases at level ' + level + ', the number of checks that come back ' +
        'with something is ' + (cleanSet.join('/') || 'n/a') + ' for a clean case and ' +
        (fraudSet.join('/') || 'n/a') + ' for a fraudulent one. They overlap at ' +
        (overlap.length ? overlap.join(', ') : 'nothing') + '.'
    };
  }

  // Separate entry point so the assertion cannot recurse through generate().
  let asserting = false;
  function generateForMeasurement(level, i) {
    asserting = true;
    try { return generate(level, i); } finally { asserting = false; }
  }

  let shapeChecked = false;
  /* The memo and the dependency guard both returned a bare `true`, so "checked
     and not separable", "already checked earlier" and "could not check, the
     taxonomy was not loaded" were one value. Those are three different facts
     and the third is the absence of a check. `opts.force` re-runs it, which is
     also the only way to demonstrate this guard can fire at all. Convention
     34. */
  function assertShapeNotSeparableOnce(opts) {
    const force = !!(opts && opts.force);
    const sample = (opts && opts.cases) || 160;
    const level = (opts && opts.level) || 4;
    if ((shapeChecked || asserting) && !force) {
      return { state: shapeChecked ? 'SKIPPED_ALREADY_CHECKED' : 'SKIPPED_REENTRANT',
        note: 'The shape check ran earlier in this session and is not re-run per case. A memo of a check is not a check.' };
    }
    shapeChecked = true;
    if (!window.FW || !FW.patterns || !FW.patterns()) {
      return { state: 'SKIPPED_TAXONOMY_ABSENT',
        note: 'The taxonomy was not loaded, so whether a case\'s kind is readable off its shape was never tested. ' +
          'That is the absence of a result, not a clean one.' };
    }
    const s = shapeSeparability(level, sample);
    if (s.separable) {
      throw new Error(
        'scenario.js: the kind of case is readable off its shape. ' + s.note +
        ' A player who counts responding checks classifies every case without reading one, which is the ' +
        'opposite of what this trains.'
      );
    }
    return { state: 'CHECKED', cases: sample, level: level, note: s.note };
  }

  return {
    generate, ACTIONS, difficultyForLevel,
    BASE_RATE, fraudChanceForLevel, baseRateReconciliation,
    indicatorBudgetForLevel, deliverableIndicators, budgetReach,
    pickDistinctDecoys, shapeSeparability, assertShapeNotSeparableOnce,
    FRAUD_CHANCE_FLOOR, FRAUD_CHANCE_CEILING, INDICATOR_BUDGET_FLOOR, INDICATOR_BUDGET_CEILING
  };
})();
