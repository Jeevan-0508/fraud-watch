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
     paragraph -- the geometric sense, in copy no suite had ever scanned,
     because every caller passed dynamically rendered element HTML. Slice 63
     scanned that surface and resolved the paragraph, so every remaining
     occurrence of the circle sense is in source rather than in copy: see
     SURFACES, where the difference between the two is declared. The word stays
     banned and the scan stays sense-blind; what changed is that the surfaces it
     applies to are now named. */
  const SENSE_COLLISIONS = {
    ring: { otherSense: 'a circle: the network diagram lays entities out on concentric rings, and Tailwind\'s focus utility class is `ring-1`.',
      whereItOccurs: 'js/ui/network-view.js comments, js/game.js CSS class, js/ui/mo-intelligence.js button classes -- all of which are SOURCE_TEXT, where the ban does not apply. The one occurrence that WAS copy, a visible paragraph in index.html, was resolved in Slice 63; see CLOSED_SURFACES.' },
    rings: { otherSense: 'the plural of the same circle.', whereItOccurs: 'js/ui/network-view.js comments.' },
    guilt: { otherSense: 'the thing being denied, and one token inside adviceEngine.FORBIDDEN_INPUT.',
      whereItOccurs: 'js/ui/entity-inspector.js and js/simulation/adviceEngine.js, both in the app\'s own voice refusing the reading.' }
  };

  /* Slice 63. Slice 61 declared one open gap -- the static copy in index.html,
     which nothing had ever scanned. Closing it turned out to require answering
     a question the rules had never asked: WHICH SURFACES DOES THIS BAN APPLY
     TO. The list had been pointed at rendered panel HTML by nearly every suite,
     and separately at raw source text by one suite checking that a newly banned
     word was absent from the codebase. Two different surfaces, one list, no
     stated difference -- and the difference decides whether a comment reading
     "each kind gets its own ring" is a violation or is nothing at all.

     So the surfaces are declared, each with whether it is COPY (something a
     reader reads, where the ban applies) or NOT_COPY (where the same token
     carries no claim to a reader because no reader sees it). Measured by
     driving every view module in one pass rather than by scanning whatever a
     suite happened to be holding in a local variable: 12 view modules, 24
     elements with content, zero findings. The catalogue file the app renders
     verbatim -- 978 string fields, 62,775 characters -- had never been scanned
     by anything either, and is also clean. The one finding in the whole project
     was the "outer ring" in index.html, and it is resolved in the copy rather
     than in the rules: the paragraph now says "outermost circle", which is the
     same fact in words that carry no second sense. Neither the ban was widened
     nor the word dropped. */
  const SURFACES = [
    {
      surface: 'RENDERED_PANELS',
      kind: 'COPY',
      scanned: true,
      what: 'the HTML the view modules write into the page at run time.',
      producedBy: '12 view modules, measured at 24 elements carrying content after a 20-day seeded run.',
      scannedBy: 'test_slice63 drives every view module in one pass and scans every element that has content, so coverage is a measurement rather than a by-product of what each suite happened to hold in a variable. Individual suites also scan their own panels.',
      measured: '24 elements, zero findings.'
    },
    {
      surface: 'STATIC_PAGE_COPY',
      kind: 'COPY',
      scanned: true,
      what: 'the copy shipped inside index.html: headings, paragraphs, captions and visible attributes.',
      producedBy: 'index.html itself, written by hand and never rendered by any module.',
      scannedBy: 'test_slice63, via scanDocumentCopy. This was the gap Slice 61 declared and did not close.',
      measured: 'one finding when first scanned -- "outer ring", the geometric sense -- resolved in the copy. Clean now.'
    },
    {
      surface: 'CATALOGUE_COPY',
      kind: 'COPY',
      scanned: true,
      what: 'every string in data/fraud-data.json, which the app renders verbatim as pattern names, descriptions and indicator text.',
      producedBy: 'the taxonomy data file.',
      scannedBy: 'test_slice63, field by field, so a finding names the field it is in.',
      measured: '978 string fields, 62,775 characters, zero findings. It had never been scanned by anything.'
    },
    {
      surface: 'SOURCE_TEXT',
      kind: 'NOT_COPY',
      scanned: false,
      what: 'comments, identifiers, CSS class names and object keys in js/.',
      producedBy: 'the codebase.',
      scannedBy: 'nothing, deliberately.',
      whyNotBanned: 'no reader of the running app sees a comment, so a comment cannot smuggle a claim into a finding. The geometric sense of "ring" lives here legitimately: network-view lays entities out on concentric rings and Tailwind spells its focus utility ring-1. Scanning source with a copy rule would demand renaming a circle.',
      butStillChecked: 'test_slice61 scans source for the words this project ADDED to the ban, to prove each one refuses future copy rather than condemning copy already written. That is a different question from whether source violates the ban, and it is the only reason source is read at all.'
    },
    {
      surface: 'CANVAS_TEXT',
      kind: 'COPY',
      scanned: false,
      what: 'text drawn into the arcade canvas by Phaser -- the per-vehicle labels.',
      producedBy: 'js/entities/vehicle.js, via scene.add.text and setText. Checked rather than assumed: the first draft of this entry named js/core/game.js and js/ui/port-ui.js, and the suite assertion that the surface really exists failed, because those two write HTML and the only true canvas text is the vehicle label.',
      scannedBy: 'nothing.',
      whyNotScanned: 'it never becomes HTML, so an HTML scan cannot reach it. Scanning it means either reading the draw calls out of the source -- which cannot tell a literal a reader sees from one nothing reaches -- or rendering with a real canvas. Declared open rather than reported clean.'
    },
    {
      surface: 'ARCADE_PANELS',
      kind: 'COPY',
      scanned: false,
      what: 'the HTML the arcade side writes: the chase HUD, the investigate prompt and the reveal card.',
      producedBy: 'js/ui/port-ui.js and js/core/game.js.',
      scannedBy: 'nothing in one pass.',
      whyNotScanned: 'driving them needs a Phaser scene, which the one-pass panel scan does not construct, so they are not part of the 24 elements measured under RENDERED_PANELS. Two suites reach into port-ui for other reasons and one of them scans a reveal card it built itself. Naming this separately keeps the RENDERED_PANELS measurement from being read as total coverage of the app.'
    }
  ];

  /* The remaining gap, narrowed from Slice 61's to what is actually still open.
     A surface an HTML scan cannot reach is not a surface this scan can honestly
     call clean. */
  const UNSCANNED_SURFACE = {
    what: 'text drawn into the arcade canvas rather than written as HTML.',
    why: 'every entry point of this scan takes HTML, and a canvas draw call never becomes HTML, so nothing this module can be pointed at will ever see it.',
    knownContent: 'not measured -- and saying so is the point. The HUD and reveal-card literals in js/core/game.js and js/ui/port-ui.js have never been read by this scan.',
    notClosedBecause: 'closing it needs either a real canvas or a source scan that cannot tell a literal a reader sees from one nothing reaches. The static index.html gap declared in Slice 61 IS now closed; see CLOSED_SURFACES.'
  };

  /* Kept as a record, because a gap that quietly disappears from a declaration
     is indistinguishable from a gap nobody ever found. */
  const CLOSED_SURFACES = [
    {
      surface: 'STATIC_PAGE_COPY',
      declaredBy: 'Slice 61',
      wasFound: 'one visible paragraph read "Sites (grey, outer ring) are drawn for orientation", using the geometric sense of a banned word, in copy no suite had ever scanned.',
      howResolved: 'the copy now reads "on the outermost circle", which states the same geometry in words carrying no second sense. The ban was not widened, the word was not dropped from the list, and the scan was not taught a sense it cannot learn.',
      closedBy: 'Slice 63',
      andNow: 'index.html is scanned by test_slice63 on every run, so a banned word added to it in future is caught.'
    }
  ];

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
  /* A page file carries code and copy in one document, and a token scan cannot
     tell them apart: a banned word inside a script literal may be a variable
     nobody reads, and one inside a paragraph is a claim. So script and style
     content is removed before the document is inspected, and that removal is
     stated rather than assumed. Measured in this build: index.html carries zero
     inline script or style blocks with content, so nothing is currently being
     excluded -- the exclusion is here so that adding one does not silently
     start reporting code as copy, or copy as clean. */
  function scanDocumentCopy(html, opts) {
    const src = String(html === undefined || html === null ? '' : html);
    const inlineCode = (src.match(/<script\b[^>]*>[\s\S]*?<\/script>/g) || [])
      .concat(src.match(/<style\b[^>]*>[\s\S]*?<\/style>/g) || [])
      .filter(b => b.replace(/<[^>]*>/g, '').trim().length > 0);
    const copyOnly = src
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, ' ');
    const out = inspect(copyOnly, opts);
    out.inlineCodeBlocksExcluded = inlineCode.length;
    out.excludedBecause = 'a banned word inside a script or style block is not copy a reader reads, and this scan ' +
      'cannot tell a literal that reaches a reader from one that does not. ' + inlineCode.length +
      ' block(s) with content were removed before scanning.';
    return out;
  }

  /* Reported over the declared surfaces as its named base, so the figure cannot
     be read as a share of all the copy in the project. */
  function coverage() {
    const copy = SURFACES.filter(s => s.kind === 'COPY');
    const scanned = copy.filter(s => s.scanned);
    return {
      base: SURFACES.length,
      baseIs: 'the ' + SURFACES.length + ' surfaces declared in this module, which is every surface anyone has ' +
        'thought to name -- not a proof that there are no others',
      copySurfaces: copy.length,
      copySurfacesScanned: scanned.length,
      copySurfacesUnscanned: copy.length - scanned.length,
      notCopy: SURFACES.length - copy.length,
      note: scanned.length + ' of the ' + copy.length + ' declared copy surfaces are scanned; ' +
        (copy.length - scanned.length) + ' is not, and is named in UNSCANNED_SURFACE rather than counted as clean. ' +
        (SURFACES.length - copy.length) + ' declared surface(s) are not copy at all, where the same tokens carry no ' +
        'claim to any reader.',
      doesNotMean: 'that the scanned surfaces contain no misleading copy -- only that they contain none of the ' +
        BANNED_WORDS.length + ' banned tokens and none of the ' + LEAKS.length + ' leak tokens'
    };
  }

  function assertSurfacesDeclared(surfaces, closed) {
    const rows = surfaces || SURFACES;
    const cl = closed || CLOSED_SURFACES;
    rows.forEach(r => {
      ['surface', 'kind', 'what', 'producedBy', 'scannedBy'].forEach(f => {
        if (!r[f]) throw new Error('copy-rules: surface ' + r.surface + ' declares no ' + f);
      });
      /* Whether a surface is scanned is a fact about the surface, so it is a
         field. The first draft read it out of the scannedBy sentence by string
         match, and "nothing in one pass" is not "nothing" -- the sentinel broke
         the moment a second unscanned surface was added with a more precise
         reason. A prose field is not a flag. */
      if (typeof r.scanned !== 'boolean') {
        throw new Error('copy-rules: surface ' + r.surface + ' does not say whether it is scanned as a flag, and a prose sentence cannot be relied on to say it');
      }
      if (r.kind !== 'COPY' && r.kind !== 'NOT_COPY') {
        throw new Error('copy-rules: surface ' + r.surface + ' claims kind ' + r.kind + '; a surface is either copy a reader reads or it is not');
      }
      if (r.kind === 'NOT_COPY' && !r.whyNotBanned) {
        throw new Error('copy-rules: surface ' + r.surface + ' is exempt from the ban and does not say why, which is how an exemption becomes an oversight');
      }
      if (r.kind === 'COPY' && !r.scanned && !r.whyNotScanned) {
        throw new Error('copy-rules: copy surface ' + r.surface + ' is scanned by nothing and does not say why; an unscanned surface reported without a reason reads as a clean one');
      }
      if (r.kind === 'COPY' && r.scanned && !r.measured) {
        throw new Error('copy-rules: copy surface ' + r.surface + ' claims to be scanned and states no measurement, so the claim cannot be checked');
      }
    });
    cl.forEach(r => {
      ['surface', 'declaredBy', 'wasFound', 'howResolved', 'closedBy', 'andNow'].forEach(f => {
        if (!r[f]) throw new Error('copy-rules: closed surface ' + r.surface + ' declares no ' + f);
      });
      if (!rows.filter(x => x.surface === r.surface).length) {
        throw new Error('copy-rules: closed surface ' + r.surface + ' is not in the surface register, so nothing says it is scanned now');
      }
    });
    if (rows.filter(r => r.kind === 'COPY' && !r.scanned).length === 0 && UNSCANNED_SURFACE) {
      throw new Error('copy-rules: UNSCANNED_SURFACE names a gap while every declared copy surface is scanned; one of the two is stale');
    }
    return { state: 'CHECKED', surfaces: rows.length, closed: cl.length };
  }

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
  assertSurfacesDeclared();

  return {
    BANNED, BANNED_WORDS, LEAKS, QUOTED_SOURCES, VISIBLE_ATTRIBUTES,
    SENSE_COLLISIONS, SURFACES, UNSCANNED_SURFACE, CLOSED_SURFACES,
    visibleText, inspect, scanDocumentCopy, coverage,
    assertRulesDeclared, assertSurfacesDeclared
  };
})();
