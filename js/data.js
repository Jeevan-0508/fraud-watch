/* data.js — loads the freight-fraud-taxonomy dataset as-is and exposes
   small pure helpers over it. No fraud content is invented anywhere in
   this file; every string surfaced to the player comes from fraud-data.json. */
const FW = (() => {
  let raw = null;

  const CATEGORY_COLOR = {
    cargo_loss:  '#f87171',
    contractual: '#fb923c',
    digital:     '#a78bfa',
    documentary: '#facc15',
    financial:   '#34d399',
    identity:    '#f472b6',
    insider:     '#fb7185',
    regulatory:  '#60a5fa'
  };

  const SEVERITY_COLOR = {
    low: '#94a3b8', medium: '#facc15', high: '#fb923c', critical: '#f87171'
  };

  async function load() {
    if (raw) return raw;
    const res = await fetch('data/fraud-data.json');
    raw = await res.json();
    return raw;
  }

  function patterns() { return raw.patterns; }
  function meta() { return raw.meta; }

  function randomPattern() {
    const p = raw.patterns;
    return p[Math.floor(Math.random() * p.length)];
  }

  // Pick n indicators from a pattern. `bias` 'strong' favours high-weight
  // (easier) signals, 'subtle' favours low-weight ones (harder/later levels).
  function pickIndicators(pattern, n, bias = 'strong') {
    const pool = [...pattern.indicators];
    pool.sort((a, b) => bias === 'subtle' ? a.weight - b.weight : b.weight - a.weight);
    // take a slightly randomised slice so the same pattern doesn't always
    // show the identical clue set
    const top = pool.slice(0, Math.min(pool.length, n + 2));
    const chosen = [];
    while (chosen.length < Math.min(n, top.length)) {
      const idx = Math.floor(Math.random() * top.length);
      const item = top.splice(idx, 1)[0];
      if (item) chosen.push(item);
    }
    return chosen;
  }

  // Pick one "decoy" clue for a clean shipment: a false_positives entry
  // borrowed from a random pattern, phrased as "looks_like" — real data,
  // just reused for noise the way false positives work in practice.
  function pickDecoy() {
    const withFP = raw.patterns.filter(p => p.false_positives && p.false_positives.length);
    const p = withFP[Math.floor(Math.random() * withFP.length)];
    const fp = p.false_positives[Math.floor(Math.random() * p.false_positives.length)];
    return { pattern: p, fp };
  }

  // Countermeasure that "would have caught it": prefer the phase of the
  // highest-weight indicator actually shown to the player (pre_award ->
  // preventive, in_transit -> detective, post_event -> responsive).
  function bestCountermeasure(pattern, shownIndicators) {
    const phaseMap = { pre_award: 'preventive', in_transit: 'detective', post_event: 'responsive' };
    const byWeight = [...shownIndicators].sort((a, b) => b.weight - a.weight)[0];
    const bucket = phaseMap[byWeight?.phase] || 'detective';
    const list = pattern.countermeasures[bucket] && pattern.countermeasures[bucket].length
      ? pattern.countermeasures[bucket] : pattern.countermeasures.detective;
    return { bucket, text: list[Math.floor(Math.random() * list.length)] };
  }

  function categoryColor(cat) { return CATEGORY_COLOR[cat] || '#94a3b8'; }
  function severityColor(sev) { return SEVERITY_COLOR[sev] || '#94a3b8'; }

  return {
    load, patterns, meta, randomPattern, pickIndicators, pickDecoy,
    bestCountermeasure, categoryColor, severityColor, CATEGORY_COLOR, SEVERITY_COLOR
  };
})();
