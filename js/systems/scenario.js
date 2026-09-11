/* systems/scenario.js — the taxonomy-driven case generator. Pure logic,
   no Phaser/DOM here, so it's testable the same way data.js is. Every
   case is either a real pattern from freight-fraud-taxonomy, or a clean
   run wearing a borrowed false_positives clue (a "decoy" case) — so
   suspicion is never proof by construction. */
const FWScenario = (() => {
  const ACTIONS = ['MANIFEST', 'GPS', 'SEAL', 'NEARBY', 'ROUTE', 'DRIVER'];
  const CARRIERS = ['NordTransit', 'BalticFreight Ltd', 'Meridian Cargo Co', 'Continental Haul',
    'Elbe Logistics', 'Vantage Road Freight', 'Solaris Intermodal', 'Harbourline Transport'];
  const CARGO = ['Consumer Electronics', 'Machine Parts', 'Pharmaceuticals', 'Textiles',
    'Packaged Foodstuffs', 'Automotive Components'];

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function difficultyForLevel(level) {
    return {
      fraudChance: Math.min(0.7, 0.4 + level * 0.04),
      indicatorCount: Math.min(6, 3 + Math.floor(level / 2)),
      caseSeconds: Math.max(18, 34 - level * 1.5)
    };
  }

  function generate(level, caseNo) {
    const diff = difficultyForLevel(level);
    const isFraud = Math.random() < diff.fraudChance;
    const carrier = pick(CARRIERS);
    const cargo = pick(CARGO);
    const id = 'PM-' + (4000 + caseNo);

    if (!isFraud) {
      const decoy = FW.pickDecoy();
      return {
        id, level, carrier, cargo, type: 'clean', decoy,
        pattern: null, indicators: [],
        actionMap: buildDecoyActionMap(decoy),
        caseSeconds: diff.caseSeconds
      };
    }

    const pattern = FW.randomPattern();
    const indicators = FW.pickIndicators(pattern, diff.indicatorCount, level > 5 ? 'subtle' : 'strong');
    return {
      id, level, carrier, cargo, type: 'fraud', pattern, indicators,
      actionMap: buildActionMap(indicators),
      caseSeconds: diff.caseSeconds
    };
  }

  // Assign each shown indicator to one investigation action button so
  // the player has to choose what to check, not just wait for a feed.
  function buildActionMap(indicators) {
    const shuffledActions = [...ACTIONS].sort(() => Math.random() - 0.5);
    const map = {};
    indicators.forEach((ind, i) => { map[shuffledActions[i % shuffledActions.length]] = ind; });
    return map;
  }

  function buildDecoyActionMap(decoy) {
    const action = pick(ACTIONS);
    const map = {};
    map[action] = { signal: decoy.fp.looks_like, isDecoy: true };
    return map;
  }

  return { generate, ACTIONS, difficultyForLevel };
})();
