/* systems/scoring.js — Phase 2: score + persistence for Port Meridian.
   Pure logic, no DOM/Phaser, so it can run and be unit-tested under
   plain Node (same pattern as data.js). Persists to localStorage under
   a dedicated key so it never collides with Classic Watch's own state. */
const FWScoring = (() => {
  const KEY = 'fraudwatch_port_progress';

  function defaultState() {
    return {
      totalScore: 0,
      casesSolved: 0,
      casesMissed: 0,
      falseAccusations: 0,
      bestStreak: 0,
      streak: 0,
      level: 1
    };
  }

  function load() {
    try {
      const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem(KEY) : null;
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      return Object.assign(defaultState(), parsed);
    } catch (e) {
      return defaultState();
    }
  }

  function save(state) {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) { /* storage unavailable — non-fatal */ }
    return state;
  }

  function reset() { return save(defaultState()); }

  // outcome: 'caught' (correctly flagged+intercepted a real fraud case),
  // 'missed' (a fraud case escaped uncaught), 'false' (flagged/intercepted
  // a clean vehicle), 'cleared' (correctly let a clean vehicle go).
  function applyOutcome(state, outcome, opts = {}) {
    const s = Object.assign({}, state);
    const severity = opts.severity || 'medium';
    const sevMult = { low: 1, medium: 1.5, high: 2, critical: 3 }[severity] || 1;
    switch (outcome) {
      case 'caught':
        s.casesSolved += 1;
        s.streak += 1;
        s.bestStreak = Math.max(s.bestStreak, s.streak);
        s.totalScore += Math.round(100 * sevMult) + s.streak * 5;
        break;
      case 'missed':
        s.casesMissed += 1;
        s.streak = 0;
        s.totalScore = Math.max(0, s.totalScore - 40);
        break;
      case 'false':
        s.falseAccusations += 1;
        s.streak = 0;
        s.totalScore = Math.max(0, s.totalScore - 25);
        break;
      case 'cleared':
        s.totalScore += 15;
        break;
      default:
        break;
    }
    s.level = 1 + Math.floor(s.casesSolved / 4);
    return save(s);
  }

  return { load, save, reset, applyOutcome, KEY };
})();
