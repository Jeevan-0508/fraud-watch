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

  /* THE COLOUR AN UNRECOGNISED TOKEN GETS, AND WHY IT IS NOT A NICE ONE.
     Both colour lookups here used to fall back to '#94a3b8', which is byte-
     identical to `low`'s declared colour -- and `low` is declared but appears
     in zero of the taxonomy's patterns (see SEVERITY.absentFromData). So a
     token this app has no meaning for did not render as unrecognised, it
     rendered as the one harm class the dataset never uses. This colour is
     asserted below to be no declared class's colour in either space, so an
     unrecognised token cannot be mistaken for a declared one on screen. */
  const UNKNOWN_TOKEN_COLOR = '#ff00ff';

  const COLOR_SPACES = {
    category: { map: CATEGORY_COLOR, owner: 'freight-fraud-taxonomy, per-pattern category field' },
    severity: { map: SEVERITY_COLOR, owner: 'freight-fraud-taxonomy, per-pattern severity field' }
  };

  function assertUnknownColorDistinct() {
    Object.keys(COLOR_SPACES).forEach(space => {
      const map = COLOR_SPACES[space].map;
      Object.keys(map).forEach(tok => {
        if (String(map[tok]).toLowerCase() === UNKNOWN_TOKEN_COLOR.toLowerCase()) {
          throw new Error('data.js: the colour for an unrecognised token is the same colour as the declared ' +
            space + ' "' + tok + '", so a token nobody declared would render as that class');
        }
      });
    });
    return true;
  }
  assertUnknownColorDistinct();

  /* The taxonomy's indicator `weight` is an analyst-assigned salience inside
     one pattern. It is a PARAMETER, not a measurement, and it is NOT a second
     copy of the simulation's signal weight (see FWSignalEngine.WEIGHT_SCALE) --
     the two run on different ranges and nothing blends them. This module owns
     the fact, and its range is READ FROM THE LOADED DATA rather than restated
     here, so a taxonomy revision cannot leave a stale number on screen. */
  const INDICATOR_WEIGHT = {
    kind: 'PARAMETER',
    scope: 'taxonomy indicator salience, within one pattern',
    means: 'how much an analyst assessed this observation narrows the field, relative to the other indicators of the SAME pattern.',
    doesNotMean: 'a probability that fraud occurred, a share of anything, and not a score comparable across patterns or against the simulation signal weights.',
    source: 'freight-fraud-taxonomy, per-indicator field',
    min: null,
    max: null
  };

  async function load() {
    if (raw) return raw;
    const res = await fetch('data/fraud-data.json');
    raw = await res.json();
    measureIndicatorWeights();
    checkSeverityTokens();
    checkCategoryTokens();
    measureDeclaredAbsence();
    return raw;
  }

  /* A missing or non-numeric weight used to reach the Field Guide as the
     literal text "wundefined". Refuse at load, naming the indicator, rather
     than letting the panel print a number nobody assigned. */
  function measureIndicatorWeights() {
    let min = Infinity, max = -Infinity, n = 0;
    (raw.patterns || []).forEach(p => {
      (p.indicators || []).forEach((i, k) => {
        if (typeof i.weight !== 'number' || !isFinite(i.weight)) {
          throw new Error('FW.load: indicator ' + p.id + '#' + k + ' has no numeric weight; ' +
            'a salience the taxonomy did not assign would have to be invented to render it');
        }
        n++;
        if (i.weight < min) min = i.weight;
        if (i.weight > max) max = i.weight;
      });
    });
    if (!n) throw new Error('FW.load: taxonomy carries no indicators, so no weight scale can be stated');
    INDICATOR_WEIGHT.min = min;
    INDICATOR_WEIGHT.max = max;
    INDICATOR_WEIGHT.n = n;
  }

  /* The taxonomy's `severity` is an assessed HARM class for a pattern. It is
     not a confidence, and moEngine's confidence band is not a severity --
     three of these four tokens used to appear verbatim as MO confidence bands
     (see FWMoEngine.CONFIDENCE_BAND), so the two are declared and checked
     against each other rather than left to collide on screen. */
  const SEVERITY = {
    kind: 'PARAMETER',
    scope: 'assessed harm of a taxonomy pattern, if it occurs',
    means: 'how much damage this pattern of fraud does when it happens, as assessed in the taxonomy.',
    doesNotMean: 'how likely it is happening here, how sure anyone is, and not a confidence band over any case.',
    source: 'freight-fraud-taxonomy, per-pattern field',
    tokens: Object.keys(SEVERITY_COLOR)
  };

  // Tokens are declared above; this asserts the loaded data uses no others,
  // so a pattern cannot reach a badge with a severity nobody has a colour or
  // a meaning for.
  function checkSeverityTokens() {
    (raw.patterns || []).forEach(p => {
      if (SEVERITY.tokens.indexOf(p.severity) < 0) {
        throw new Error('FW.load: pattern ' + p.id + ' carries severity "' + p.severity +
          '", which is not one of the declared harm classes ' + SEVERITY.tokens.join('/'));
      }
    });
  }

  /* The taxonomy's `category` is what KIND of fraud a pattern is. It had a
     colour map and no check of any sort, while its sibling `severity` had a
     load-time token check -- an asymmetry that was invisible only because the
     dataset happens to use exactly the eight categories declared above. A
     ninth would have reached a badge coloured as an unrecognised token with
     nothing said about it. Declared and checked in both directions now. */
  const CATEGORY = {
    kind: 'CLASSIFICATION',
    scope: 'what kind of fraud a taxonomy pattern is',
    means: 'the family of fraud this pattern belongs to, as classified in the taxonomy.',
    doesNotMean: 'how bad it is, how likely it is happening here, and not an ordering of any sort -- these are names, not a scale.',
    source: 'freight-fraud-taxonomy, per-pattern field',
    tokens: Object.keys(CATEGORY_COLOR)
  };

  /* A declared token that never occurs in the data is not the same fact as a
     token that occurs -- `low` is declared, colour-mapped, multiplied in the
     score, and carried by none of the twelve patterns. Measured at load with
     its denominator so no reader has to assume either way. */
  function measureDeclaredAbsence() {
    const ps = raw.patterns || [];
    const seen = (field) => {
      const set = {};
      ps.forEach(p => { set[p[field]] = (set[p[field]] || 0) + 1; });
      return set;
    };
    [[SEVERITY, 'severity'], [CATEGORY, 'category']].forEach(([reg, field]) => {
      const counts = seen(field);
      reg.patternsMeasured = ps.length;
      reg.countsInData = counts;
      reg.presentInData = reg.tokens.filter(t => counts[t] > 0);
      reg.absentFromData = reg.tokens.filter(t => !counts[t]);
      reg.absenceNote = reg.absentFromData.length
        ? reg.absentFromData.join('/') + ' ' + (reg.absentFromData.length === 1 ? 'is' : 'are') +
          ' declared here and carried by none of the ' + ps.length + ' patterns in the loaded taxonomy, ' +
          'so nothing on screen can be an instance of ' + (reg.absentFromData.length === 1 ? 'it' : 'them') + '.'
        : 'every declared token is carried by at least one of the ' + ps.length + ' patterns in the loaded taxonomy.';
    });
  }

  // The mirror of checkSeverityTokens, which existed alone for eleven phases.
  function checkCategoryTokens() {
    (raw.patterns || []).forEach(p => {
      if (CATEGORY.tokens.indexOf(p.category) < 0) {
        throw new Error('FW.load: pattern ' + p.id + ' carries category "' + p.category +
          '", which is not one of the declared categories ' + CATEGORY.tokens.join('/'));
      }
    });
  }

  /* Why a token got the colour it got. A colour alone cannot say whether a
     class is declared-and-used, declared-and-absent, or not declared at all,
     and those are three different facts about the same badge. */
  const COLOR_BASIS = {
    DECLARED_PRESENT: 'declared in this module and carried by at least one loaded pattern.',
    DECLARED_ABSENT_IN_DATA: 'declared in this module and carried by no loaded pattern, so this colour is reachable only from data this taxonomy does not contain.',
    UNDECLARED: 'not declared in this module at all -- the colour is the unrecognised-token colour and is deliberately no class\u2019s colour.',
    UNKNOWN_SPACE: 'asked about a colour space this module does not have.'
  };

  function colorBasis(space, token) {
    const spec = COLOR_SPACES[space];
    if (!spec) return { basis: 'UNKNOWN_SPACE', why: COLOR_BASIS.UNKNOWN_SPACE, color: UNKNOWN_TOKEN_COLOR };
    if (!Object.prototype.hasOwnProperty.call(spec.map, token)) {
      return { basis: 'UNDECLARED', why: COLOR_BASIS.UNDECLARED, color: UNKNOWN_TOKEN_COLOR };
    }
    const reg = space === 'severity' ? SEVERITY : CATEGORY;
    const absent = (reg.absentFromData || []).indexOf(token) >= 0;
    return {
      basis: absent ? 'DECLARED_ABSENT_IN_DATA' : 'DECLARED_PRESENT',
      why: absent ? COLOR_BASIS.DECLARED_ABSENT_IN_DATA : COLOR_BASIS.DECLARED_PRESENT,
      color: spec.map[token]
    };
  }

  function severityScale() { return raw ? SEVERITY : null; }
  function categoryScale() { return raw ? CATEGORY : null; }

  // null until the taxonomy has arrived -- the range is a property of the
  // loaded data, not of this module.
  function indicatorWeightScale() { return raw ? INDICATOR_WEIGHT : null; }

  /* Null-safe on purpose. `loaded()` is the difference between "the taxonomy
     module is absent" and "the taxonomy has not arrived yet" -- callers that
     guard on the module alone (moEngine.rankPatterns) were checking the first
     and getting the second. Returning null lets them take the same empty path
     either way rather than throwing mid-render. */
  function loaded() { return raw != null; }
  function patterns() { return raw ? raw.patterns : null; }
  function meta() { return raw ? raw.meta : null; }

  function randomPattern() {
    const p = raw.patterns;
    return p[Math.floor(Math.random() * p.length)];
  }

  /* Pick n indicators from a pattern. `bias` 'strong' favours high-weight
     (easier) signals, 'subtle' favours low-weight ones (harder/later levels).

     THE LOOP BOUND USED TO SHRINK AS THE LOOP RAN. It was
     `while (chosen.length < Math.min(n, top.length))` with a
     `top.splice(...)` inside, so every item taken removed one from the
     target as well as one from the pool: the condition met itself at roughly
     half of n and the function returned about ceil(n/2) instead of n. Every
     pattern in the taxonomy carries 6 to 9 indicators, so min(n, pool.length)
     is n for every n this app asks for — and yet asking for 6 returned 3 or
     4, and asking for 3 and asking for 4 both returned 3.

     What that broke: scenario.js ramps its indicator budget 3 -> 6 with
     level, and the ramp was almost entirely inert. Level 1 and level 20
     showed the same three clues. The target is now computed once, before
     anything is consumed. */
  function pickIndicators(pattern, n, bias = 'strong') {
    const pool = [...pattern.indicators];
    pool.sort((a, b) => bias === 'subtle' ? a.weight - b.weight : b.weight - a.weight);
    // take a slightly randomised slice so the same pattern doesn't always
    // show the identical clue set
    const top = pool.slice(0, Math.min(pool.length, n + 2));
    const want = Math.min(n, top.length);
    const chosen = [];
    while (chosen.length < want && top.length) {
      const idx = Math.floor(Math.random() * top.length);
      chosen.push(top.splice(idx, 1)[0]);
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

  /* Countermeasure keyed to the phase of the heaviest clue the player actually
     surfaced (pre_award -> preventive, in_transit -> detective, post_event ->
     responsive). The bucket is picked from the heaviest clue the player actually surfaced.
     With nothing surfaced, `byWeight` is undefined and the bucket silently
     falls back to 'detective' — a default, not a reading of anything. The
     caller was rendering it either way as "Would have caught it (detective)",
     so a fallback read as a finding. The returned object now declares which of
     the two it is, and how much it was derived from. */
  const CM_DEFAULT_BUCKET = 'detective';

  function bestCountermeasure(pattern, shownIndicators) {
    const phaseMap = { pre_award: 'preventive', in_transit: 'detective', post_event: 'responsive' };
    const shown = shownIndicators || [];
    const byWeight = [...shown].sort((a, b) => b.weight - a.weight)[0];
    const derived = !!(byWeight && phaseMap[byWeight.phase]);
    /* If the derived bucket has no entries for this pattern the text is taken
       from the default bucket, and `bucket` used to keep naming the bucket the
       text did NOT come from. No pattern in the shipped taxonomy is missing a
       bucket today, so this has never fired — but a label that can name the
       wrong source is a defect whether or not it is reachable. `bucket` now
       always names where the text came from and `requestedBucket` keeps the
       derivation visible. */
    const requestedBucket = derived ? phaseMap[byWeight.phase] : CM_DEFAULT_BUCKET;
    const requested = pattern.countermeasures[requestedBucket];
    const substituted = !(requested && requested.length);
    const list = substituted ? pattern.countermeasures[CM_DEFAULT_BUCKET] : requested;
    return {
      bucket: substituted ? CM_DEFAULT_BUCKET : requestedBucket,
      requestedBucket,
      text: list[Math.floor(Math.random() * list.length)],
      derived,
      substituted,
      basedOn: shown.length,
      basis: derived
        ? 'Chosen from the heaviest of the ' + shown.length + ' clue' + (shown.length === 1 ? '' : 's') + ' you surfaced.'
        : (shown.length
            ? 'No clue you surfaced carries a phase, so this is the default ' + CM_DEFAULT_BUCKET + ' bucket, not a reading of your checks.'
            : 'You surfaced no clues, so this is the default ' + CM_DEFAULT_BUCKET + ' bucket. It is not derived from anything you found.')
        + (substituted ? ' This pattern lists no ' + requestedBucket + ' countermeasure, so the text below is a ' + CM_DEFAULT_BUCKET + ' one.' : ''),
      DEFAULT_BUCKET: CM_DEFAULT_BUCKET
    };
  }

  function categoryColor(cat) { return CATEGORY_COLOR[cat] || UNKNOWN_TOKEN_COLOR; }
  function severityColor(sev) { return SEVERITY_COLOR[sev] || UNKNOWN_TOKEN_COLOR; }

  return {
    load, loaded, patterns, meta, randomPattern, pickIndicators, pickDecoy,
    bestCountermeasure, categoryColor, severityColor, CATEGORY_COLOR, SEVERITY_COLOR,
    indicatorWeightScale, severityScale, categoryScale,
    UNKNOWN_TOKEN_COLOR, COLOR_BASIS, colorBasis, COLOR_SPACES,
    assertUnknownColorDistinct, checkCategoryTokens
  };
})();
