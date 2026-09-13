/* simulation/entityEngine.js — a lightweight registry/population for
   simulation entities. No Phaser/DOM. This is the source-of-truth
   store the event/behavior/signal engines (next slices) will read and
   mutate; the Phaser render layer stays a separate downstream consumer. */
const FWEntityEngine = (() => {
  const KINDS = ['truck', 'driver', 'trailer', 'shipment', 'carrier', 'facility'];

  // Registry keys and UI labels are just kind + 's' for every kind that
  // pluralizes that way; 'facility' does not, and printing "9 facilitys"
  // in an analyst panel is the kind of small sloppiness that makes the
  // careful parts look less trustworthy than they are.
  const PLURALS = { facility: 'facilities' };

  function plural(kind) {
    return PLURALS[kind] || kind + 's';
  }

  /* ---- Lifecycle status vocabulary ------------------------------------

     Every entity carries a `status`, and each entity file declares the
     permitted values in a trailing comment. Nothing ever checked those
     comments against the simulation, and they do not agree with it: of the
     21 values declared across driver/trailer/shipment/carrier/facility,
     13 are never written by any line in this codebase (30 declared and the
     same 13 unreachable once truck's fully exercised 9 are counted in --
     vocabularyCoverage() measures both rather than restating this comment).
     `facility` is the extreme case -- three declared states, one issued --
     and it was read by a filter (`f.status !== 'CLOSED'` in facilityEngine)
     that therefore excluded nothing while reading as an eligibility rule.
     That is Slice 48's fault shape with a literal that IS in the
     vocabulary: real word, unreachable value, silently true of every row.

     Three different facts, deliberately kept apart:
       declared -- values the vocabulary permits
       writable -- values an entity in this simulation can end up HOLDING.
                   Not "values a line names": the shipment factory names
                   BOOKED and no consignment is ever BOOKED, because the one
                   construction site passes ASSIGNED. reconcileWritable()
                   below measures the difference against the source instead
                   of leaving it to this sentence.
       held     -- values entities in a given registry carry right now
     declared is a superset of writable, which is a superset of held. A
     status is only an observation about the world inside `writable`.
     Outside it the value on screen is a default nothing can change, and it
     must not be read as "we looked, and the site is open". `held` narrower
     than `writable` is a different and legitimate thing -- a state no
     entity happens to be in at this moment (truck stages cycle) -- so the
     two gaps are reported separately and never merged. */
  const LIFECYCLE_VOCABULARY = {
    facility: {
      declaredIn: 'entities/facility.js',
      declared: ['OPERATING', 'REDUCED', 'CLOSED'],
      spawnValue: 'OPERATING',
      writable: ['OPERATING'],
      means: 'the site is part of the population this run was seeded with',
      doesNotMean: 'that the site was checked and found open. No code path here ever sets REDUCED or CLOSED (they are declared and never issued), so every site is created OPERATING and keeps it; site coverage figures are computed over a population that is fully operating by construction, not on the day.'
    },
    carrier: {
      declaredIn: 'entities/carrier.js',
      declared: ['ACTIVE', 'SUSPENDED', 'UNDER_REVIEW'],
      spawnValue: 'ACTIVE',
      writable: ['ACTIVE'],
      means: 'the carrier is part of the seeded population',
      doesNotMean: 'that the carrier is in good standing. Nothing in this simulation ever sets SUSPENDED or UNDER_REVIEW, however many cases close against a carrier, so ACTIVE is the value it was created with and the absence of a mark against it is not a clean record.'
    },
    driver: {
      declaredIn: 'entities/driver.js',
      declared: ['OFF_SHIFT', 'CHECKED_IN', 'DRIVING', 'CHECKED_OUT'],
      spawnValue: 'OFF_SHIFT',
      writable: ['OFF_SHIFT', 'CHECKED_IN', 'DRIVING'],
      means: 'whether this driver is currently attached to a movement',
      doesNotMean: 'a completed shift. CHECKED_OUT is declared and never issued: a driver taken off a truck is set back to OFF_SHIFT, so a driver who finished a run and a driver who never started one hold the same value.'
    },
    trailer: {
      declaredIn: 'entities/trailer.js',
      declared: ['IN_STORAGE', 'ASSIGNED', 'IN_TRANSIT', 'SWAPPED'],
      spawnValue: 'IN_STORAGE',
      writable: ['IN_STORAGE', 'ASSIGNED'],
      means: 'whether this trailer is currently attached to a truck',
      doesNotMean: 'that a trailer taken off a movement can be told apart afterwards. SWAPPED and IN_TRANSIT are declared and never issued -- a trailer swapped out mid-run is set back to IN_STORAGE -- so a trailer that was swapped away from a movement and one that has been sitting idle hold the same value. The swap is recorded on the movement, as a signal and a history entry on the truck; the trailer itself carries no record of it.'
    },
    shipment: {
      declaredIn: 'entities/shipment.js',
      declared: ['BOOKED', 'ASSIGNED', 'LOADED', 'IN_TRANSIT', 'DELIVERED', 'DELAYED', 'CANCELLED'],
      spawnValue: 'ASSIGNED',
      writable: ['ASSIGNED'],
      factoryDefault: 'BOOKED',
      means: 'the consignment exists and is attached to a truck',
      doesNotMean: 'a position in a delivery lifecycle. Five of the seven declared states are never issued and the factory default BOOKED is overridden at the only call site, so no consignment here is ever delivered, delayed or cancelled: a cargo exposure band is never settled and never retired, and ASSIGNED on a band is not a live-versus-closed distinction.'
    },
    truck: {
      declaredIn: 'entities/truck.js (FWEntityTruck.STATUSES) and mirrored in behaviorEngine.LIFECYCLE',
      declaredVia: 'FWEntityTruck.STATUSES',
      spawnValue: 'DISPATCHED',
      writableIsWholeVocabulary: true,
      means: 'which lifecycle stage the movement has reached',
      doesNotMean: 'anything about risk. This is the one status field whose whole declared vocabulary is reachable -- behaviorEngine walks the list in order -- so a stage not present in a registry is a stage nothing is in right now, not a stage that cannot happen.'
    }
  };

  /* ======================================================================
     CONVENTIONS 42 AND 43, TURNED ON THIS MODULE'S OWN REGISTER.

     `writable` above is a claim about the SOURCE CODE, and for fifteen slices
     nothing had ever compared it to a line of the codebase. Every check on it
     was internal and passes unchanged if it names a value nothing writes or
     omits one something does: assertLifecycleVocabulary holds `writable`
     inside `declared` and the spawn value inside `writable`; heldStatuses
     holds `held` inside `declared`. Meanwhile three modules make a decision
     off it -- facilityEngine.siteEligibility, exposureModel's
     consignmentStatusIsReachableOnly, behaviorEngine's carrierClauseNarrows --
     and formatStatus prints "the only reachable of 3 declared" on screen.

     Measured by scanStatusWrites() over all 50 source files:
       facility / carrier / driver / trailer -- the scan agrees exactly.
       shipment -- the scan finds BOOKED at a write site (the factory default)
         and `writable` does not list it. Both were right about different
         things and both were being said in one sentence: no line PRODUCES a
         BOOKED consignment, because the one construction site passes
         ASSIGNED, but a line does NAME it, so "declared and never issued by
         any code path" was false as written. LOADED, DELIVERED, DELAYED and
         CANCELLED are named nowhere but in the declaration above. Two
         different absences; this register keeps them apart.
       truck -- writableIsWholeVocabulary claims all 9 values are reachable and
         the scan resolves exactly ONE of them, the factory default. The other
         write site is `truck.status = transition.to`, a variable. There were two
         until slice 72 made the lifecycle stage a function of the journey's real
         position: `truck.status = LIFECYCLE[0]` is gone because the first stage
         is now derived from the node the truck starts at, and adoptStage is the
         single writer of the field. The one kind that claims full
         reachability is the kind a source scan can say almost nothing about,
         so it is reported UNRESOLVED_BY_SCAN rather than as agreement, and the
         claim rests where it already did -- on the mirror check against
         FWBehaviorEngine.LIFECYCLE below, which is a real check of a
         different thing.

     What the scan REFUSES to do: attribute a write to an entity kind by the
     VALUE written. moEngine writes `status` on a case with DISMISSED and NEW
     and mo-intelligence names seven more; those are a different vocabulary
     that shares token shape with this one, and the identity between the two
     spaces does not exist. Attribution is by the target identifier naming a
     kind, or by the enclosing create<Kind> call -- never by the token. Sites
     that resolve to no kind are COUNTED as unattributed, not dropped, because
     "the scan found these values" reads as coverage either way.

     Reads are NOT re-derived here. A declared value that some filter compares
     against while nothing can ever write it is a real and worse fault, and it
     already has an owner: assertStatusLiteral (this module) checks the literal
     is declared, and facilityEngine.siteEligibility reports the count it
     therefore excludes. Duplicating that here would put two answers to one
     question in two modules. Where a value has such a reader, this register
     cites it rather than deriving it.
     ====================================================================== */
  const ABSENCE_KINDS = {
    NAMED_NOWHERE: 'The value appears in no source file except the declaration above. Nothing assigns it and ' +
      'nothing compares against it: it is vocabulary the codebase carries and does not use.',
    NAMED_AT_A_WRITE_SITE: 'A line of this codebase names the value at a real write expression, and no entity ' +
      'ever holds it, because every caller of that write supplies a different value. The write site is not dead ' +
      'code and the value is not reachable, so neither "never issued" nor "writable" is true of it on its own.'
  };

  /* Declared, then checked against the source both directions by
     reconcileWritable(). 13 entries, one for every value in the derived
     neverWritten() sets -- the reconciliation asserts that count, so a value
     that becomes reachable or unreachable cannot leave this register stale. */
  const STATUS_ABSENCE = {
    facility: {
      REDUCED: { kind: 'NAMED_NOWHERE' },
      CLOSED: { kind: 'NAMED_NOWHERE',
        readBy: 'facilityEngine.SITE_INELIGIBLE_STATUSES -- a site-eligibility filter tests for this value, so it ' +
          'excludes nothing while reading as a rule. siteEligibility() reports that as a count; it is not re-derived here.' }
    },
    carrier: {
      SUSPENDED: { kind: 'NAMED_NOWHERE' },
      UNDER_REVIEW: { kind: 'NAMED_NOWHERE' }
    },
    driver: { CHECKED_OUT: { kind: 'NAMED_NOWHERE' } },
    trailer: {
      IN_TRANSIT: { kind: 'NAMED_NOWHERE' },
      SWAPPED: { kind: 'NAMED_NOWHERE' }
    },
    shipment: {
      BOOKED: { kind: 'NAMED_AT_A_WRITE_SITE', site: 'simulation/entities/shipment.js',
        why: 'the factory default. entityEngine.seedPort is the only construction site and it passes ASSIGNED, so ' +
          'the default is evaluated and never produced.' },
      LOADED: { kind: 'NAMED_NOWHERE' },
      IN_TRANSIT: { kind: 'NAMED_NOWHERE' },
      DELIVERED: { kind: 'NAMED_NOWHERE' },
      DELAYED: { kind: 'NAMED_NOWHERE' },
      CANCELLED: { kind: 'NAMED_NOWHERE' }
    },
    truck: {}
  };

  // Not a throw: a doctored table can produce an absence this register has
  // never seen, and the caller (statusNote) has to be able to say so.
  function absenceKind(kind, status) {
    const row = (STATUS_ABSENCE[kind] || {})[status];
    return row ? row.kind : 'UNDECLARED_ABSENCE';
  }

  /* The four ways a status value gets written in this codebase. A scan that
     reported only the ones it can resolve would read as a complete list. */
  const WRITE_CHANNELS = {
    FACTORY_DEFAULT: 'status: opts.status || \'X\' inside simulation/entities/<kind>.js. Kind comes from the file ' +
      'name. Names a value; produces it only when the caller passes nothing.',
    FACTORY_OPTION: 'a status: property in an object literal, attributed to the kind of the nearest enclosing ' +
      'create<Kind>( call within 12 lines. Unattributed if there is none.',
    DIRECT_LITERAL: 'target.status = \'X\'. Kind comes from the target identifier containing a kind name ' +
      '(oldDriver, newTrailer). Unattributed if it names none.',
    DIRECT_UNRESOLVED: 'target.status = someVariable. The scan cannot resolve the value at all. Counted, never ' +
      'read as writing nothing.'
  };

  /* A token scan over source text, which cannot tell code from a comment or
     from a template literal rendering the word `status:` into a paragraph. So
     comment content is blanked (line counts preserved) and the number of sites
     that disappeared with it is REPORTED; anything left whose value will not
     resolve is counted as unresolved rather than guessed at.
     `sources` is a plain object of path -> text, handed in, because a module
     in a browser cannot read its own source tree. */
  function scanStatusWrites(sources) {
    if (!sources || typeof sources !== 'object' || !Object.keys(sources).length) {
      throw new Error('entityEngine.scanStatusWrites: no sources given. This check reads the codebase; with no ' +
        'source text it would report every declared writable value as unconfirmed and nothing as wrong');
    }
    const decomment = (src) => {
      let out = String(src).replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
      return out.split(/\r?\n/).map(L => {
        const i = L.indexOf('//');
        if (i < 0) return L;
        const before = L.slice(0, i);
        const odd = (ch) => ((before.split(ch).length - 1) % 2) === 1;
        return (odd('\'') || odd('"') || odd('`')) ? L : before;
      }).join('\n');
    };
    const SITE_RE = /(?:^|[{,(\s])status:\s*([^,\n}]+)|([A-Za-z_$][\w$]*)\.status\s*=\s*([^=;]+);/g;
    const sites = [];
    let droppedWithComments = 0;
    Object.keys(sources).forEach(file => {
      const rawCount = (String(sources[file]).match(SITE_RE) || []).length;
      const lines = decomment(sources[file]).split(/\n/);
      let kept = 0;
      const factoryKind = (file.match(/entities\/(\w+)\.js$/) || [])[1];
      lines.forEach((line, i) => {
        let m;
        SITE_RE.lastIndex = 0;
        while ((m = SITE_RE.exec(line))) {
          kept++;
          const isDirect = m[2] !== undefined;
          const raw = (isDirect ? m[3] : m[1]).trim();
          const lit = (raw.match(/^'([A-Z_]+)'$/) || raw.match(/^opts\.status\s*\|\|\s*'([A-Z_]+)'$/) || [])[1] || null;
          let kind = null, channel;
          if (isDirect) {
            const t = m[2].toLowerCase();
            kind = KINDS.filter(k => t.indexOf(k) >= 0)[0] || null;
            channel = lit ? 'DIRECT_LITERAL' : 'DIRECT_UNRESOLVED';
          } else if (factoryKind && KINDS.indexOf(factoryKind) >= 0) {
            kind = factoryKind;
            channel = 'FACTORY_DEFAULT';
          } else {
            channel = 'FACTORY_OPTION';
            for (let b = i; b >= Math.max(0, i - 12); b--) {
              const mm = lines[b].match(/create([A-Z]\w+)\s*\(/);
              if (mm) {
                const k = mm[1].toLowerCase();
                if (KINDS.indexOf(k) >= 0) kind = k;
                break;
              }
            }
          }
          sites.push({ file, line: i + 1, channel, kind, value: lit, expression: raw });
        }
      });
      droppedWithComments += rawCount - kept;
    });
    const byKind = {};
    KINDS.forEach(k => {
      const mine = sites.filter(x => x.kind === k);
      byKind[k] = {
        kind: k,
        sites: mine.length,
        resolvedValues: Array.from(new Set(mine.filter(x => x.value).map(x => x.value))).sort(),
        unresolvedSites: mine.filter(x => !x.value).map(x => x.file + ':' + x.line + ' -> ' + x.expression)
      };
    });
    return {
      files: Object.keys(sources).length,
      sites: sites.length,
      byKind,
      unattributed: sites.filter(x => !x.kind).length,
      unresolvedValues: sites.filter(x => !x.value).length,
      droppedWithComments,
      allSites: sites,
      note: sites.length + ' write sites over ' + Object.keys(sources).length + ' files; ' +
        sites.filter(x => !x.kind).length + ' name no entity kind and are attributed to none, ' +
        sites.filter(x => !x.value).length + ' write a value this scan cannot resolve, and ' +
        droppedWithComments + ' more were inside comments and dropped.'
    };
  }

  const WRITABLE_AGREEMENT = {
    AGREES: 'Every value the scan resolves for this kind is listed writable, and every writable value was found.',
    NAMED_NOT_PRODUCED: 'The scan found a value at a write site that is not listed writable, and the difference is ' +
      'declared in STATUS_ABSENCE as NAMED_AT_A_WRITE_SITE.',
    UNRESOLVED_BY_SCAN: 'The scan resolved fewer values than this kind claims writable and the remaining write ' +
      'sites write variables, so the scan neither confirms nor contradicts the claim. This is not agreement.'
  };

  let writableChecked = null;

  /* Both directions, and every branch reachable from a caller: `sources` and
     `table` are both injectable, so a doctored register or a doctored codebase
     can be handed in to show this guard can fire. */
  function reconcileWritable(sources, table) {
    const scan = scanStatusWrites(sources);
    const rows = KINDS.map(kind => {
      const writable = writableStatuses(kind, table);
      const found = scan.byKind[kind].resolvedValues;
      const notListed = found.filter(v => writable.indexOf(v) < 0);
      const notFound = writable.filter(v => found.indexOf(v) < 0);
      const unresolved = scan.byKind[kind].unresolvedSites;
      notListed.forEach(v => {
        if (absenceKind(kind, v) !== 'NAMED_AT_A_WRITE_SITE') {
          throw new Error('entityEngine.reconcileWritable: a line of this codebase writes ' + v + ' to a ' + kind +
            '.status and the vocabulary neither lists it writable nor declares it in STATUS_ABSENCE as named at a ' +
            'write site. Every figure derived from writable is wrong by one value and reads as a measurement');
        }
        if (declaredStatuses(kind, table).indexOf(v) < 0) {
          throw new Error('entityEngine.reconcileWritable: a line of this codebase writes ' + v + ' to a ' + kind +
            '.status and it is not a declared ' + kind + ' status at all');
        }
      });
      if (notFound.length && !unresolved.length) {
        throw new Error('entityEngine.reconcileWritable: ' + kind + ' lists ' + notFound.join(', ') + ' as writable ' +
          'and the scan found no write site naming ' + (notFound.length === 1 ? 'it' : 'them') + ' and no ' +
          'unresolved write site that could. A value nothing assigns is being counted as reachable');
      }
      return {
        kind,
        agreement: notFound.length ? 'UNRESOLVED_BY_SCAN' : (notListed.length ? 'NAMED_NOT_PRODUCED' : 'AGREES'),
        writable, found, notListed, notFound,
        unresolvedSites: unresolved,
        resolvedOfWritable: writable.filter(v => found.indexOf(v) >= 0).length + ' of ' + writable.length
      };
    });

    // The absence register against the derived sets, both directions.
    KINDS.forEach(kind => {
      const gap = neverWritten(kind, table);
      const declaredRows = Object.keys(STATUS_ABSENCE[kind] || {});
      const undeclared = gap.filter(v => declaredRows.indexOf(v) < 0);
      if (undeclared.length) {
        throw new Error('entityEngine.reconcileWritable: ' + kind + ' status ' + undeclared.join(', ') +
          ' is unreachable and STATUS_ABSENCE does not say which kind of absence it is; a value nothing writes and ' +
          'a value a line names and never produces are different facts and were reported in one sentence');
      }
      const stale = declaredRows.filter(v => gap.indexOf(v) < 0);
      if (stale.length) {
        throw new Error('entityEngine.reconcileWritable: STATUS_ABSENCE declares ' + kind + ' status ' +
          stale.join(', ') + ' unreachable and it is reachable now; a stale absence reads as a measurement');
      }
      declaredRows.forEach(v => {
        const row = STATUS_ABSENCE[kind][v];
        if (!ABSENCE_KINDS[row.kind]) {
          throw new Error('entityEngine.reconcileWritable: ' + kind + '.' + v + ' declares absence kind ' +
            row.kind + ', which is not one of ' + Object.keys(ABSENCE_KINDS).join('|'));
        }
        const namedSomewhere = scan.allSites.some(x => x.value === v && x.kind === kind);
        if (row.kind === 'NAMED_AT_A_WRITE_SITE' && !namedSomewhere) {
          throw new Error('entityEngine.reconcileWritable: ' + kind + '.' + v + ' is declared as named at a write ' +
            'site and the scan found no write site naming it. The declaration is the only evidence for it');
        }
        /* The opposite direction -- declared NAMED_NOWHERE while a write site
           names it -- was written here as a second check and cannot fire: to
           reach this loop the value has to be in neverWritten (so not writable)
           and named at a write site, which is precisely the case the throw in
           the rows loop above refuses, and it refuses it whatever this register
           says. One fault, one owner; the check that could not fire was removed
           rather than left in to read as a second layer of protection. */
      });
    });

    const state = {
      state: 'CHECKED',
      scan,
      rows,
      agreementCounts: ['AGREES', 'NAMED_NOT_PRODUCED', 'UNRESOLVED_BY_SCAN']
        .reduce((a, k) => Object.assign(a, { [k]: rows.filter(r => r.agreement === k).length }), {}),
      absenceRows: KINDS.reduce((a, k) => a + Object.keys(STATUS_ABSENCE[k] || {}).length, 0),
      tableChecked: table ? 'SUPPLIED' : 'THE MODULE\'S OWN',
      note: rows.filter(r => r.agreement === 'AGREES').length + ' of ' + KINDS.length + ' kinds have every writable ' +
        'value confirmed at a write site in the source. ' +
        rows.filter(r => r.agreement === 'UNRESOLVED_BY_SCAN').map(r => r.kind + ' resolves ' + r.resolvedOfWritable +
          ' and writes the rest through a variable, so its claim is neither confirmed nor contradicted here').join('; ') + '.'
    };
    if (!table) writableChecked = state;
    return state;
  }

  /* Convention 42: this check cannot run at load, because a module in a page
     cannot read the source tree it was parsed from. So whether it has EVER run
     is a fact about this build and is readable, rather than being assumed by
     anyone reading the register. */
  function writableCheckState() {
    return writableChecked
      ? { state: 'CHECKED', note: 'The writable lists were reconciled against the source: ' + writableChecked.note }
      : { state: 'NOT_CHECKED_SOURCES_ABSENT', note: 'The writable lists have NOT been reconciled against the ' +
          'source in this process. Nothing here has been shown to name a value a line of this codebase writes. ' +
          'That is the absence of a check, not a clean one.' };
  }

  /* `table` exists so this vocabulary can be checked against a DOCTORED copy of
     itself. The guard below reads nothing but these helpers, so with no way to
     hand them a bad table there was no way to show the guard could fire at all
     -- and a guard that has never fired is a guard nobody has tested. Every
     caller in the app passes nothing and gets the real table. */
  function declaredStatuses(kind, table) {
    const v = (table || LIFECYCLE_VOCABULARY)[kind];
    if (!v) throw new Error('entityEngine: no status vocabulary declared for kind ' + kind);
    if (v.declared) return v.declared.slice();
    if (v.declaredVia === 'FWEntityTruck.STATUSES') {
      // Top-level `const` bindings are not properties of window, so this
      // is a bare-identifier check on purpose: it has to work during load
      // order as well as after it.
      if (typeof FWEntityTruck === 'undefined' || !Array.isArray(FWEntityTruck.STATUSES)) {
        throw new Error('entityEngine: truck status vocabulary is owned by FWEntityTruck.STATUSES and it is not loaded');
      }
      return FWEntityTruck.STATUSES.slice();
    }
    throw new Error('entityEngine: status vocabulary for ' + kind + ' declares neither a list nor a source');
  }

  function writableStatuses(kind, table) {
    const v = (table || LIFECYCLE_VOCABULARY)[kind];
    if (!v) throw new Error('entityEngine: no status vocabulary declared for kind ' + kind);
    return v.writableIsWholeVocabulary ? declaredStatuses(kind, table) : v.writable.slice();
  }

  // Declared but unreachable: the part of the vocabulary no line of this
  // codebase can produce. A filter testing one of these is a no-op.
  function neverWritten(kind, table) {
    const w = writableStatuses(kind, table);
    return declaredStatuses(kind, table).filter(s => w.indexOf(s) < 0);
  }

  function statusVocabulary(kind, table) {
    const v = (table || LIFECYCLE_VOCABULARY)[kind];
    if (!v) throw new Error('entityEngine: no status vocabulary declared for kind ' + kind);
    return Object.assign({}, v, {
      kind,
      declared: declaredStatuses(kind, table),
      writable: writableStatuses(kind, table),
      neverWritten: neverWritten(kind, table)
    });
  }

  // MEASURED, per registry: which values entities actually hold now.
  function heldStatuses(reg, kind) {
    const list = all(reg, kind);
    const byStatus = {};
    list.forEach(e => { byStatus[e.status] = (byStatus[e.status] || 0) + 1; });
    const held = Object.keys(byStatus);
    const declared = declaredStatuses(kind);
    const undeclared = held.filter(s => declared.indexOf(s) < 0);
    if (undeclared.length) {
      throw new Error('entityEngine: ' + kind + ' holds status ' + undeclared.join(', ') +
        ' which is not in its declared vocabulary (' + declared.join('|') + ')');
    }
    const writable = writableStatuses(kind);
    return {
      kind, n: list.length, byStatus, held,
      declared, writable,
      neverWritten: neverWritten(kind),
      writableNotHeld: writable.filter(s => held.indexOf(s) < 0)
    };
  }

  // Whole-population rollup. Two gaps, never added together: what the
  // codebase cannot produce, and what nothing happens to be in.
  function vocabularyCoverage(reg) {
    const rows = KINDS.map(k => heldStatuses(reg, k));
    const declaredTotal = rows.reduce((a, r) => a + r.declared.length, 0);
    const writableTotal = rows.reduce((a, r) => a + r.writable.length, 0);
    const neverWrittenTotal = rows.reduce((a, r) => a + r.neverWritten.length, 0);
    const namedAtAWriteSite = rows.reduce((a, r) =>
      a + r.neverWritten.filter(st => absenceKind(r.kind, st) === 'NAMED_AT_A_WRITE_SITE').length, 0);
    return {
      rows, declaredTotal, writableTotal, neverWrittenTotal,
      heldTotal: rows.reduce((a, r) => a + r.held.length, 0),
      namedAtAWriteSiteTotal: namedAtAWriteSite,
      namedNowhereTotal: neverWrittenTotal - namedAtAWriteSite,
      /* Two counts, not one. `neverWrittenTotal` used to be reported as
         'declared and never issued by any code path', which is false of the
         one value a line does name and never produces. */
      note: writableTotal + ' of ' + declaredTotal + ' declared status values are reachable in this build; ' +
        (neverWrittenTotal - namedAtAWriteSite) + ' of ' + declaredTotal + ' are assigned by no line of this codebase and ' +
        namedAtAWriteSite + ' more ' + (namedAtAWriteSite === 1 ? 'is named' : 'are named') + ' at a write site and never produced, so a status ' +
        'reading one of the reachable values is not evidence the unreachable ones were ruled out.'
    };
  }

  // Display string. Carries its own n/N so a constant cannot be read as a
  // finding, and never a % because nothing here is divided.
  function formatStatus(kind, status) {
    const v = statusVocabulary(kind);
    if (typeof status !== 'string' || !status) {
      throw new Error('entityEngine.formatStatus: no status given for ' + kind);
    }
    if (v.declared.indexOf(status) < 0) {
      throw new Error('entityEngine.formatStatus: ' + status + ' is not a declared ' + kind + ' status');
    }
    const human = status.replace(/_/g, ' ').toLowerCase();
    if (v.writable.length === 1) {
      return human + ' — the only reachable of ' + v.declared.length + ' declared ' + kind + ' states';
    }
    if (v.neverWritten.length) {
      return human + ' — one of ' + v.writable.length + ' reachable of ' + v.declared.length + ' declared ' + kind + ' states';
    }
    return human + ' — one of ' + v.declared.length + ' declared ' + kind + ' stages, all reachable';
  }

  /* CONVENTION 44 AGAINST THE FORMATTER, AND CONVENTION 43 AGAINST ITS
     CALLERS. formatStatus above is the declared owner of a status appearing on
     screen, and it had never said which surfaces it owns. Measured over the
     rendered panels:

       facility / driver / trailer -- rendered through formatStatus.
       truck -- rendered RAW in two places, status.replace(/_/g, ' '), in the
         entity inspector title and the sim-debug movement table. Neither
         passed the value to the owner and neither checked it.
       carrier / shipment -- no panel renders their status at all, so the
         formatter's coverage of them is untested by anything on screen.

     What that cost, measured by planting truck.status = 'NOT_A_STAGE' on a
     seeded run: the entity inspector threw out of heldStatuses two lines after
     writing the raw value into the title, so the panel rendered NOTHING and the
     message named this module -- true, and about neither the panel nor whatever
     wrote the value. sim-debug printed NOT A STAGE in the stage column beside
     eight real stages, no complaint, visually a stage like any other. One
     undeclared value, two panels, two opposite outcomes, neither stated
     anywhere. That is the Slice 62 shape again with a status instead of a
     lifetime.

     statusLabel() is the short form and the single owner of that policy: it
     refuses, in the same words and the same way, wherever it is called. It is
     deliberately NOT a second policy beside formatStatus -- both refuse an
     undeclared value, so there is one answer to the question and two lengths of
     sentence, and the choice of length can no longer decide whether the value
     is checked.

     Convention 42, measured rather than assumed: nothing this program does can
     produce the fault. Slice 64's reconciliation shows every truck stage
     written comes out of FWEntityTruck.STATUSES via behaviorEngine, and
     heldStatuses refuses an undeclared value at the registry level. So this
     refusal has no live runtime kind either; it is a boundary check on a
     function two panels call with a value they do not own. */
  const STATUS_RENDER_SURFACES = {
    facility: { renderedBy: ['ui/entity-inspector.js facility card'], through: 'formatStatus' },
    driver: { renderedBy: ['ui/entity-inspector.js links block'], through: 'formatStatus' },
    trailer: { renderedBy: ['ui/entity-inspector.js links block'], through: 'formatStatus' },
    truck: { renderedBy: ['ui/entity-inspector.js panel title', 'ui/sim-debug.js movement table'], through: 'statusLabel',
      wasRenderedRaw: 'the separators were taken out inline at both sites until Slice 65, checked by neither' },
    carrier: { renderedBy: [], through: null,
      notRendered: 'the carrier row shows name and identifier. formatStatus handles the kind and no surface exercises it.' },
    shipment: { renderedBy: [], through: null,
      notRendered: 'no panel shows a consignment status. Slice 64 measured why it would say little: one of seven declared values is reachable.' }
  };

  /* The short form. Same refusals as formatStatus, no basis clause -- a title
     and a table cell have no room for one, and that was the whole reason two
     sites went around the owner. */
  function statusLabel(kind, status, table) {
    const v = statusVocabulary(kind, table);
    if (typeof status !== 'string' || !status) {
      throw new Error('entityEngine.statusLabel: no status given for ' + kind);
    }
    if (v.declared.indexOf(status) < 0) {
      throw new Error('entityEngine.statusLabel: ' + status + ' is not a declared ' + kind + ' status (' +
        v.declared.join('|') + '). Rendering it with the separators taken out prints an undeclared value in the ' +
        'same shape as a declared one');
    }
    return status.replace(/_/g, ' ').toLowerCase();
  }

  // Coverage over the named base: the six kinds, not the surfaces that
  // happened to be rendered by whichever suite was looking.
  function statusRenderCoverage() {
    const kinds = KINDS.slice();
    const rendered = kinds.filter(k => STATUS_RENDER_SURFACES[k].renderedBy.length);
    const surfaces = rendered.reduce((a, k) => a + STATUS_RENDER_SURFACES[k].renderedBy.length, 0);
    const through = {};
    rendered.forEach(k => { through[STATUS_RENDER_SURFACES[k].through] = (through[STATUS_RENDER_SURFACES[k].through] || 0) + 1; });
    return {
      kinds: kinds.length,
      renderedKinds: rendered.length,
      surfaces,
      through,
      notRenderedKinds: kinds.filter(k => !STATUS_RENDER_SURFACES[k].renderedBy.length),
      runtimeKind: 'NONE',
      note: rendered.length + ' of ' + kinds.length + ' entity kinds have their status on screen, over ' + surfaces +
        ' surfaces, and every one goes through the module that owns the vocabulary. The other ' +
        (kinds.length - rendered.length) + ' are not rendered anywhere, so nothing on screen exercises the formatter ' +
        'for them. No path this program takes can hand either formatter an undeclared value; the refusal is a ' +
        'boundary check, not a caught fault.'
    };
  }

  function assertRenderSurfacesDeclared() {
    KINDS.forEach(k => {
      const r = STATUS_RENDER_SURFACES[k];
      if (!r) throw new Error('entityEngine: kind ' + k + ' has no declared status render surface');
      if (!Array.isArray(r.renderedBy)) throw new Error('entityEngine: ' + k + ' render surfaces must be a list');
      if (r.renderedBy.length && !r.through) {
        throw new Error('entityEngine: ' + k + ' is rendered on ' + r.renderedBy.length + ' surface(s) and does not ' +
          'say which formatter it goes through; a surface with no named owner is a surface nobody checked');
      }
      if (!r.renderedBy.length && !r.notRendered) {
        throw new Error('entityEngine: ' + k + ' is rendered nowhere and does not say so; an empty list and an ' +
          'unexamined kind look identical');
      }
      if (r.through && ['formatStatus', 'statusLabel'].indexOf(r.through) < 0) {
        throw new Error('entityEngine: ' + k + ' claims to render through ' + r.through + ', which is not one of ' +
          'this module\'s two status formatters');
      }
    });
    return { state: 'CHECKED', kinds: KINDS.length };
  }

  function statusNote(kind, table) {
    const v = statusVocabulary(kind, table);
    /* Both absences are enumerated, and they are not the same absence: a value
       no line of this codebase assigns, and a value a line does name at a write
       site that no construction ever produces. The second one was being
       reported in the first one's words. Every unreachable value still appears
       by name -- assertLifecycleVocabulary checks that against this output. */
    const named = v.neverWritten.filter(st => absenceKind(kind, st) === 'NAMED_AT_A_WRITE_SITE');
    const nowhere = v.neverWritten.filter(st => named.indexOf(st) < 0);
    let gap;
    if (!v.neverWritten.length) {
      gap = 'Every declared value is reachable. ';
    } else {
      gap = '';
      if (nowhere.length) gap += 'Declared and assigned by no line of this codebase: ' + nowhere.join(', ') + '. ';
      if (named.length) {
        gap += 'Named at a write site and never produced: ' + named.join(', ') +
          ' -- the factory default, overridden at every construction site, so no ' + kind + ' ever holds it. ';
      }
    }
    return gap + 'This field means ' + v.means + '. It does not mean ' + v.doesNotMean;
  }

  // Convention 21, executable: before trusting a status literal in a
  // filter, check it against the vocabulary that owns the field. Returns
  // whether the literal can ever match, so the caller can say so on screen
  // instead of presenting a no-op as a selection rule.
  function assertStatusLiteral(kind, literal, where) {
    const v = statusVocabulary(kind);
    if (v.declared.indexOf(literal) < 0) {
      throw new Error('entityEngine: ' + where + ' compares ' + kind + '.status against ' +
        JSON.stringify(literal) + ', which is not a declared ' + kind + ' status (' + v.declared.join('|') + ')');
    }
    return { kind, literal, declared: true, reachable: v.writable.indexOf(literal) >= 0 };
  }

  /* Every branch below is now reachable from a caller, because the table it
     judges can be handed in. Convention 34: this guard reported nothing wrong
     for ten sessions and nothing had ever demonstrated it COULD report
     something wrong -- the two look identical from outside. */
  function assertLifecycleVocabulary(table, mirror, noteFn) {
    KINDS.forEach(kind => {
      const v = (table || LIFECYCLE_VOCABULARY)[kind];
      if (!v) throw new Error('entityEngine: kind ' + kind + ' has no status vocabulary');
      const declared = declaredStatuses(kind, table);
      if (!declared.length) throw new Error('entityEngine: ' + kind + ' declares an empty status vocabulary');
      if (new Set(declared).size !== declared.length) {
        throw new Error('entityEngine: ' + kind + ' declares a duplicate status');
      }
      const writable = writableStatuses(kind, table);
      writable.forEach(s => {
        if (declared.indexOf(s) < 0) {
          throw new Error('entityEngine: ' + kind + ' lists ' + s + ' as writable but does not declare it');
        }
      });
      if (writable.indexOf(v.spawnValue) < 0) {
        throw new Error('entityEngine: ' + kind + ' spawn value ' + v.spawnValue + ' is not writable');
      }
      if (!v.means || !v.doesNotMean) {
        throw new Error('entityEngine: ' + kind + ' status vocabulary needs both means and doesNotMean');
      }
      if (/%/.test(v.means + v.doesNotMean)) {
        throw new Error('entityEngine: ' + kind + ' status note carries a % and nothing about a status is divided');
      }
      // A declaration that states a contingent fact has to be checked
      // against the fact: prose may only claim a value is never issued
      // when one actually is. The reverse direction is not left to prose at
      // all -- statusNote() enumerates the unreachable values from the
      // derived list, so a gap cannot go unmentioned by omission.
      const gap = neverWritten(kind, table);
      const claimsGap = /never issued|never sets|never written|never suspends/.test(v.doesNotMean);
      if (claimsGap && !gap.length) {
        throw new Error('entityEngine: ' + kind + ' note claims a value is never issued but every declared value is writable');
      }
      /* This branch cannot fire against the vocabulary table, and that was worth
         finding out. `statusNote` builds its first sentence by enumerating the
         SAME derived gap list, so the note names every unreachable status by
         construction and no doctored table can make it omit one. What the check
         actually guards is `statusNote` itself: it fires the day that function
         is rewritten to describe the gap in prose instead of listing it. So the
         note builder is injectable, which is the only way to demonstrate the
         branch can fire at all -- an assertion nothing can trip is an assertion
         nobody has tested. */
      const note = (noteFn || statusNote)(kind, table);
      gap.forEach(u => {
        if (note.indexOf(u) < 0) {
          throw new Error('entityEngine: ' + kind + ' note does not name unreachable status ' + u +
            '. statusNote must LIST the unreachable values, not describe them: a reader cannot check a claim ' +
            'against values they were never shown');
        }
      });
    });
    // truck's vocabulary exists twice -- FWEntityTruck.STATUSES and
    // behaviorEngine.LIFECYCLE -- and a state machine walking one list
    // while the display validates against the other would disagree
    // silently, so the two copies are held equal.
    // behaviorEngine is declared after this module, so at load time the
    // binding is still in its temporal dead zone and `typeof` throws
    // rather than returning 'undefined'. The mirror check therefore runs
    // whenever it can -- on any later call, and from the test suite -- and
    // is skipped, not faked, when it cannot.
    let lifecycle = mirror || null;
    if (!lifecycle) { try { lifecycle = FWBehaviorEngine.LIFECYCLE; } catch (e) { lifecycle = null; } }
    if (Array.isArray(lifecycle)) {
      const a = declaredStatuses('truck', table).join('|');
      const b = lifecycle.join('|');
      if (a !== b) {
        throw new Error('entityEngine: FWEntityTruck.STATUSES and FWBehaviorEngine.LIFECYCLE disagree (' + a + ' vs ' + b + ')');
      }
    }
    /* Not `true`. This guard has two outcomes that used to be one value: it
       compared the two copies of the truck vocabulary, or the binding was in
       its dead zone and it compared nothing. "Checked and agreed" and "never
       compared" are opposite facts and both returned true. */
    return {
      state: 'CHECKED',
      kinds: KINDS.length,
      mirror: Array.isArray(lifecycle) ? 'COMPARED' : 'NOT_COMPARED_BINDING_ABSENT',
      mirrorNote: Array.isArray(lifecycle)
        ? 'The two declarations of the truck vocabulary were compared and agree.'
        : 'The second declaration of the truck vocabulary was not reachable when this ran, so the two copies were ' +
          'not compared. That is the absence of a comparison, not agreement.',
      tableChecked: table ? 'SUPPLIED' : 'THE MODULE\'S OWN'
    };
  }

  function createRegistry() {
    const reg = { nextId: {} };
    KINDS.forEach(k => { reg[plural(k)] = new Map(); reg.nextId[k] = 1; });
    return reg;
  }

  function nextId(reg, kind) {
    const n = reg.nextId[kind]++;
    return kind.slice(0, 3).toUpperCase() + '-' + String(n).padStart(3, '0');
  }

  function add(reg, kind, entity) {
    reg[plural(kind)].set(entity.id, entity);
    return entity;
  }

  function get(reg, kind, id) {
    return reg[plural(kind)].get(id);
  }

  function all(reg, kind) {
    return Array.from(reg[plural(kind)].values());
  }

  // record a bounded history entry on an entity (used by the event engine)
  function recordHistory(entity, event) {
    if (!entity) return;
    entity.history.push({ t: event.timestamp, type: event.type, summary: (event.metadata && event.metadata.summary) || event.type });
    if (entity.history.length > 50) entity.history.shift();
  }

  /* Seeds a population deterministically from an FWRng instance.

     THE COUNTS ARE A MEASURED CHOICE, NOT A PLACEHOLDER (Slice 81). They were
     8 trucks and 6 shipments, described as "intentionally small for Slice 1".
     Measured at that size: over 336 sim-hours only 5.1% of hours had a single
     open case, mean concurrent open cases 0.06, most a player would ever see
     at once 2. The case list -- the app's headline panel -- was therefore
     empty about 95% of the time, which is a property of the population and
     not of any renderer. POPULATION_SCALE records what each count drives so a
     later reader raising one knows what moves.

     Every count is still an `opts` override, and nothing downstream reads
     these numbers: the suites derive their denominators from the registry. */
  const POPULATION_SCALE = {
    kind: 'PARAMETER',
    scope: 'how many of each entity the world starts with',
    drives: {
      trucks: 'journeys in flight, and therefore event volume, signal volume and how many cases exist at once',
      shipments: 'how many trucks carry declared cargo; a truck with none still moves and still emits',
      drivers: 'how many distinct people can be swapped onto a truck',
      trailers: 'how many distinct trailers can be swapped onto a truck',
      carriers: 'how wide the repeat-entity analysis can spread before it sees the same carrier twice'
    },
    doesNotMean: 'anything about fraud rate. Raising the fleet raises the case count because there are more ' +
      'journeys to observe, not because any per-journey probability changed -- falsePositiveEngine.LEGITIMATE_CHANCE ' +
      'is untouched by every number here.'
  };

  function seedPort(rng, opts = {}) {
    const reg = createRegistry();
    const nCarriers = opts.carriers || 8;
    const nDrivers = opts.drivers || 34;
    const nTrailers = opts.trailers || 34;
    const nTrucks = opts.trucks || 24;
    const nShipments = opts.shipments || 20;

    const carrierNames = ['NordTransit', 'BalticFreight Ltd', 'Meridian Cargo Co', 'Continental Haul',
      'Elbe Logistics', 'Vantage Road Freight', 'Solaris Intermodal', 'Harbourline Transport'];

    for (let i = 0; i < nCarriers; i++) {
      const id = nextId(reg, 'carrier');
      add(reg, 'carrier', FWEntityCarrier.createCarrier(id, {
        name: carrierNames[i % carrierNames.length],
        scac: 'SC' + rng.int(1000, 9999)
      }));
    }
    for (let i = 0; i < nDrivers; i++) {
      const id = nextId(reg, 'driver');
      add(reg, 'driver', FWEntityDriver.createDriver(id, { name: 'Driver ' + id }));
    }
    for (let i = 0; i < nTrailers; i++) {
      const id = nextId(reg, 'trailer');
      add(reg, 'trailer', FWEntityTrailer.createTrailer(id, { sealId: 'SEAL-' + rng.int(10000, 99999) }));
    }

    // Facilities exist before trucks do, because a truck's very first
    // lifecycle stage already has to be somewhere.
    const facilitySpec = opts.facilities || [
      { kind: 'GATEHOUSE', name: 'North Gate' },
      { kind: 'GATEHOUSE', name: 'South Gate' },
      { kind: 'CROSS_DOCK', name: 'Cross-dock A' },
      { kind: 'CROSS_DOCK', name: 'Cross-dock B' },
      { kind: 'YARD', name: 'Yard 1 (quayside)' },
      { kind: 'YARD', name: 'Yard 2 (empties)' },
      { kind: 'YARD', name: 'Yard 3 (overflow)' },
      { kind: 'REMOTE_DEPOT', name: 'Inland Depot Ost' },
      { kind: 'REMOTE_DEPOT', name: 'Inland Depot Sud' },
      // Slice 81: the seven places the expanded network added that a gate,
      // yard, regional-hub or depot role requires. worldGraph.NODES joins to
      // these BY NAME, so a name changed here has to be changed there too --
      // assertFacilitiesResolve is what catches it.
      { kind: 'GATEHOUSE', name: 'East Gate' },
      { kind: 'YARD', name: 'Yard 4 (reefer)' },
      { kind: 'YARD', name: 'Yard 5 (bonded)' },
      { kind: 'YARD', name: 'Yard 6 (inspection)' },
      { kind: 'CROSS_DOCK', name: 'Cross-dock C (east)' },
      { kind: 'REMOTE_DEPOT', name: 'Inland Depot Nord' },
      { kind: 'REMOTE_DEPOT', name: 'Inland Depot West' },
      // FC South is where a route ENDS, and journeyEngine refuses a route
      // terminus that carries no site: a truck parked at an unsited node
      // reports a null site indistinguishable from one on the open road, so
      // every journey ending there would be unobservable by construction.
      { kind: 'CROSS_DOCK', name: 'FC South dock' },
      /* Slice 83: nine of the ten new places. worldGraph.NODES joins to these BY
         NAME and assertFacilitiesResolve is what catches a name changed on one
         side only. The tenth, Customs yard, is deliberately left unsited along
         with three of the fulfilment centres, so a movement with no observation
         coverage at all stays reachable -- facilityEngine's unsited bucket has to
         have something in it for the panels that report it to be about anything. */
      { kind: 'GATEHOUSE', name: 'Central Gate' },
      { kind: 'GATEHOUSE', name: 'East Border Gate' },
      { kind: 'CROSS_DOCK', name: 'Cross-dock D (central)' },
      { kind: 'CROSS_DOCK', name: 'Cross-dock E (south)' },
      { kind: 'CROSS_DOCK', name: 'FC West dock' },
      { kind: 'CROSS_DOCK', name: 'FC Northeast dock' },
      { kind: 'REMOTE_DEPOT', name: 'Inland Depot Nordwest' },
      { kind: 'REMOTE_DEPOT', name: 'Inland Depot Sudost' },
      { kind: 'YARD', name: 'Yard 7 (transit north)' }
    ];
    facilitySpec.forEach(spec => {
      const id = nextId(reg, 'facility');
      add(reg, 'facility', FWEntityFacility.createFacility(id, { kind: spec.kind, name: spec.name }));
    });

    const carriers = all(reg, 'carrier');
    const drivers = all(reg, 'driver');
    const trailers = all(reg, 'trailer');

    for (let i = 0; i < nTrucks; i++) {
      const id = nextId(reg, 'truck');
      const carrier = rng.pick(carriers);
      const driver = drivers[i % drivers.length];
      const trailer = trailers[i % trailers.length];
      const truck = FWEntityTruck.createTruck(id, {
        carrierId: carrier.id, driverId: driver.id, trailerId: trailer.id
      });
      add(reg, 'truck', truck);
      driver.assignedTruckId = id;
      driver.status = 'CHECKED_IN';
      trailer.assignedTruckId = id;
      trailer.status = 'ASSIGNED';
    }

    const cargoTypes = ['Consumer Electronics', 'Machine Parts', 'Pharmaceuticals', 'Textiles',
      'Packaged Foodstuffs', 'Automotive Components'];
    const trucks = all(reg, 'truck');
    for (let i = 0; i < nShipments; i++) {
      const id = nextId(reg, 'shipment');
      const truck = trucks[i % trucks.length];
      const shipment = FWEntityShipment.createShipment(id, {
        carrierId: truck.carrierId,
        assignedTruckId: truck.id,
        trailerId: truck.trailerId,
        cargo: rng.pick(cargoTypes),
        sealId: 'SEAL-' + rng.int(10000, 99999),
        status: 'ASSIGNED'
      });
      add(reg, 'shipment', shipment);
      truck.assignedShipmentId = id;
    }

    return reg;
  }

  assertLifecycleVocabulary();
  assertRenderSurfacesDeclared();

  return { createRegistry, nextId, add, get, all, recordHistory, seedPort, POPULATION_SCALE, plural, KINDS, PLURALS,
    LIFECYCLE_VOCABULARY, declaredStatuses, writableStatuses, neverWritten, statusVocabulary,
    heldStatuses, vocabularyCoverage, formatStatus, statusNote, assertStatusLiteral,
    assertLifecycleVocabulary,
    ABSENCE_KINDS, STATUS_ABSENCE, absenceKind, WRITE_CHANNELS, WRITABLE_AGREEMENT,
    scanStatusWrites, reconcileWritable, writableCheckState,
    STATUS_RENDER_SURFACES, statusLabel, statusRenderCoverage, assertRenderSurfacesDeclared };
})();
