/* copy-rules.js -- the vocabulary and leak rules for text this app shows a
   reader, owned by the app instead of by the test harness.

   These rules existed. They lived in one class inside the test harness, which
   is not in this repository: six banned words and four leak tokens, with no
   stated reason for any of them, versioned nowhere a reader of this codebase
   could see. Nearly every suite in the project calls them. Measured by
   planting a violation of each:

   1. TAGS WERE STRIPPED BEFORE THE CHECK, SO ATTRIBUTES WERE EXEMPT. The
      strip is `/<[^>]*>/g`, which removes the whole tag including its
      attributes. `title`, `alt` and `aria-label` are text a reader actually
      reads -- a tooltip, an image description, a screen reader's only copy.
      Planted in body text, every leak token and every banned word was caught.
      Planted in `title="..."`, all six were missed. The rendered panels carry
      eight such attributes on a twenty-day run, so this was not hypothetical
      exemption; it was live.

   2. `ringleader` PASSED A LIST THAT BANS `ring`. The scan tokenises on
      `[a-z']+`, so `ringleader` is one token and does not equal `ring` -- the
      single word in English that most plainly asserts an organised group got
      through a rule written to stop exactly that.

   3. THE `null` TEST WAS A SUBSTRING TEST. It rejected "annulled", "nullify"
      and "null hypothesis", all legitimate copy: three measured false
      positives on a check that reports by finding nothing. Word boundaries fix
      the first two and NOT the third -- "null hypothesis" contains the bare
      word, so it still trips, and that is declared below as a known limit
      rather than described as fixed.

   4. VOCABULARY THE APP QUOTES IS NOT VOCABULARY THE APP ASSERTS. This engine
      matches signal types against taxonomy indicator text using keywords that
      include "collusion" (moEngine's PATTERN_KEYWORDS). A word the app uses to
      look something up, or renders inside quotation marks as a dataset's own
      term, is not the app claiming it about a case. A single flat banned list
      cannot tell those apart, so the two are declared separately and the
      distinction is stated rather than resolved by picking whichever answer
      is convenient.

   What has NOT changed: this module bans nothing that appears in the app's
   copy today. Every word added below was first checked to be absent from
   `js/` and `index.html`, so the list refuses future copy rather than
   retroactively condemning existing copy it was never applied to. */
const FWCopyRules = (() => {

  /* Words with no use in this app's own voice, each with the claim it would
     smuggle in. "proof" and "proven" are deliberately NOT here: they appear
     throughout inside negations, which is the whole discipline. */
  const BANNED = {
    ring: { asserts: 'an organised group acting together, from a pattern that is a shape in the data.' },
    rings: { asserts: 'the same, in the plural, and usually as a count of groups nobody has enumerated.' },
    ringleader: { asserts: 'that one named party directs the others -- a hierarchy, from co-occurrence.',
      addedBecause: 'it passed the list that already banned "ring", because the scan tokenises whole words and this is one token.' },
    hub: { asserts: 'a centre, which turns a node with a high edge count into an organising role.' },
    hubs: { asserts: 'the same, and invites counting them.' },
    guilty: { asserts: 'a verdict. Nothing in this simulation issues one.' },
    guilt: { asserts: 'the same as a noun, and reads as a quantity that can be measured.' },
    cartel: { asserts: 'a standing agreement between parties, which no signal here observes.' },
    conspiracy: { asserts: 'an agreement to act together, which is the single hardest thing to observe and the easiest to assume.' },
    conspire: { asserts: 'the verb form of the same assumption.' },
    syndicate: { asserts: 'a durable organisation behind a set of events.' },
    accomplice: { asserts: 'that a second party knew and helped, which is a state of mind.' },
    accomplices: { asserts: 'the same, plural and counted.' },
    mastermind: { asserts: 'intent, planning and a planner, from a sequence of events.' },
    gang: { asserts: 'a group with a membership, from parties that share an attribute.' },
    kingpin: { asserts: 'a top of a hierarchy that has not been shown to exist.' }
  };

  const BANNED_WORDS = Object.keys(BANNED);

  /* Tokens that mean a value reached the screen without being formatted --
     a rendering fault, not a vocabulary one. `null` is word-boundary matched
     because the substring form rejected ordinary English. */
  const LEAKS = [
    { token: '[object Object]', test: (t) => t.indexOf('[object Object]') >= 0,
      means: 'an object was concatenated into a string instead of a field being read off it.' },
    { token: 'undefined', test: (t) => /\bundefined\b/.test(t),
      means: 'a field that does not exist was rendered as though it had a value.' },
    { token: 'NaN', test: (t) => /\bNaN\b/.test(t),
      means: 'arithmetic ran on something that is not a number, most often a missing denominator.' },
    { token: 'null', test: (t) => /\bnull\b/.test(t),
      means: 'a deliberately absent value was printed rather than described.',
      wordBoundaryBecause: 'the substring form rejected "annulled" and "nullify", which are ordinary copy. Both now pass.',
      stillFalsePositiveOn: '"null hypothesis" and any other phrase using the bare word, because the boundary form cannot tell a printed absent value from the word itself. Absent from this app\'s copy, so it is a declared limit and not a live false positive.' }
  ];

  /* Vocabulary this app may render because it is quoting a source, never
     because it is asserting the thing. Declared so the distinction is on the
     record, not so the scan can be talked out of a finding. */
  const QUOTED_SOURCES = {
    collusion: {
      where: 'moEngine PATTERN_KEYWORDS, a keyword this engine matches against the taxonomy\'s indicator text.',
      whyNotBanned: 'it is a term the app looks something up WITH, not a claim the app makes about a case. A keyword used to find a resemblance is not the resemblance being called collusion.',
      stillBannedWhen: 'it appears in a sentence this app wrote in its own voice about a specific case or entity.'
    }
  };

  /* Attributes whose value a reader actually reads. Everything else in a tag
     is markup and is dropped. */
  /* A TOKEN SCAN CANNOT READ A SENSE, AND THREE OF THESE WORDS HAVE A SECOND
     ONE. "ring" is a circle -- the network diagram draws entities on concentric
     rings, and Tailwind\'s focus utility is literally `ring-1`. "guilt" appears
     inside adviceEngine's FORBIDDEN_INPUT regex and inside sentences that deny
     it. None of those is the app asserting an organised group or a verdict, and
     no word-boundary scan can tell them apart.

     Which is why the scan is applied to RENDERED PANEL COPY and not to source
     or to static markup. Measured while writing this module: `index.html` has
     "Sites (grey, outer ring) are drawn for orientation" in a visible
     paragraph -- the geometric sense, in copy no suite has ever scanned,
     because every caller passes dynamically rendered element HTML. That gap is
     recorded here rather than closed by either banning a circle or quietly
     dropping the word from the list. */
  const SENSE_COLLISIONS = {
    ring: { otherSense: 'a circle: the network diagram lays entities out on concentric rings, and Tailwind\'s focus utility class is `ring-1`.',
      whereItOccurs: 'js/ui/network-view.js comments, js/game.js CSS class, js/ui/mo-intelligence.js button classes, and one visible paragraph in index.html.' },
    rings: { otherSense: 'the plural of the same circle.', whereItOccurs: 'js/ui/network-view.js comments.' },
    guilt: { otherSense: 'the thing being denied, and one token inside adviceEngine.FORBIDDEN_INPUT.',
      whereItOccurs: 'js/ui/entity-inspector.js and js/simulation/adviceEngine.js, both in the app\'s own voice refusing the reading.' }
  };

  const UNSCANNED_SURFACE = {
    what: 'the static copy in index.html.',
    why: 'every caller of this scan passes rendered element HTML, so the markup shipped in the page has never been scanned by anything.',
    knownContent: 'one visible paragraph uses "outer ring" in the geometric sense, which a token scan would report as a banned word.',
    notClosedBecause: 'closing it means either banning a circle or teaching the scan a sense it cannot learn. Stated as an open gap instead.'
  };

  const VISIBLE_ATTRIBUTES = ['title', 'alt', 'aria-label', 'aria-description', 'placeholder'];

  /* The text a reader sees: element content PLUS the visible attributes,
     which the old strip removed along with the tag. Returned with the two
     sources kept apart, because a finding in a tooltip and a finding in a
     paragraph are found by the same rule but fixed in different places. */
  function visibleText(html, attributes) {
    const src = String(html == null ? '' : html);
    const attrs = attributes || VISIBLE_ATTRIBUTES;
    const fromAttributes = [];
    attrs.forEach(a => {
      const re = new RegExp('\\b' + a.replace(/[-]/g, '\\-') + '\\s*=\\s*"([^"]*)"', 'gi');
      let m;
      while ((m = re.exec(src)) !== null) fromAttributes.push({ attribute: a, text: m[1] });
    });
    const body = src.replace(/<[^>]*>/g, ' ');
    return {
      body: body,
      attributes: fromAttributes,
      all: body + ' ' + fromAttributes.map(a => a.text).join(' '),
      attributeCount: fromAttributes.length
    };
  }

  function tokens(text) {
    return String(text).toLowerCase().match(/[a-z']+/g) || [];
  }

  /* Every finding, with WHERE it was found, so a tooltip is not reported as a
     paragraph. Returns findings rather than throwing: the caller decides
     whether a finding is a failure, and this module never has to guess. */
  function inspect(html, opts) {
    const o = opts || {};
    const v = visibleText(html, o.attributes);
    const banned = o.banned || BANNED_WORDS;
    const findings = [];
    const scopes = [{ scope: 'body', text: v.body }].concat(
      v.attributes.map(a => ({ scope: 'attribute:' + a.attribute, text: a.text })));
    scopes.forEach(s => {
      const tk = tokens(s.text);
      banned.forEach(w => {
        if (tk.indexOf(w) >= 0) {
          findings.push({ kind: 'BANNED_WORD', word: w, scope: s.scope,
            asserts: (BANNED[w] && BANNED[w].asserts) || 'not declared in this module' });
        }
      });
      LEAKS.forEach(l => {
        if (l.test(s.text)) findings.push({ kind: 'LEAK', token: l.token, scope: s.scope, means: l.means });
      });
    });
    return {
      findings: findings,
      clean: findings.length === 0,
      scopesChecked: scopes.length,
      attributesChecked: v.attributeCount,
      note: 'Checked ' + scopes.length + ' scope' + (scopes.length === 1 ? '' : 's') + ' — the element text and ' +
        v.attributeCount + ' visible attribute' + (v.attributeCount === 1 ? '' : 's') + '. Attribute values used to be ' +
        'dropped with the tag that carried them, so a tooltip could say anything.'
    };
  }

  /* Reconciled at load: this module depends on nothing. A banned word that is
     also declared quotable would make the two tables contradict each other,
     and a banned word already in the app's copy would be a rule applied
     retroactively to text it never governed. */
  function assertRulesDeclared(banned, quoted, leaks) {
    const b = banned || BANNED;
    const q = quoted || QUOTED_SOURCES;
    const l = leaks || LEAKS;
    Object.keys(b).forEach(w => {
      if (!b[w].asserts) {
        throw new Error('copy-rules: banned word "' + w + '" states no claim it would smuggle in; a ban with no reason is a ban a later reader will delete');
      }
      if (Object.prototype.hasOwnProperty.call(q, w)) {
        throw new Error('copy-rules: "' + w + '" is both banned outright and declared quotable; those cannot both be the rule');
      }
      if (w !== w.toLowerCase()) {
        throw new Error('copy-rules: banned word "' + w + '" is not lower case, and the scan lower-cases before comparing, so it could never match');
      }
    });
    Object.keys(q).forEach(w => {
      if (!q[w].whyNotBanned || !q[w].stillBannedWhen) {
        throw new Error('copy-rules: quotable term "' + w + '" does not say both why it is allowed and when it is not');
      }
    });
    l.forEach(x => {
      if (typeof x.test !== 'function' || !x.means) {
        throw new Error('copy-rules: leak token "' + x.token + '" has no test or no stated meaning');
      }
      if (!x.test(x.token) && x.token !== 'null') {
        throw new Error('copy-rules: leak token "' + x.token + '" does not match its own literal, so it could never fire');
      }
    });
    return { state: 'CHECKED', banned: Object.keys(b).length, quotable: Object.keys(q).length, leaks: l.length };
  }

  assertRulesDeclared();

  return {
    BANNED, BANNED_WORDS, LEAKS, QUOTED_SOURCES, VISIBLE_ATTRIBUTES,
    SENSE_COLLISIONS, UNSCANNED_SURFACE,
    visibleText, inspect, assertRulesDeclared
  };
})();
