/* ui/case-export.js — take a case out of the app.

   Two exports, because two different jobs were being asked for at once: one
   case, for a report somebody reads, and the whole visible queue, for a
   spreadsheet somebody sorts. They get different formats for that reason.

     the queue   CSV, one row per case, the key fields only. No library: a CSV
                 is a join with quoting rules, and the rules are stated below.
     one case    a self-contained HTML file with its stylesheet inside it, which
                 opens in any browser and prints to PDF with Ctrl+P. That is
                 also why there is no PDF writer here: the browser already has
                 one, and a JS PDF library would be a second layout engine to
                 keep in agreement with the panel.
     printing    the same document, opened in a hidden frame and sent straight
                 to the print dialog, so "print this case" does not print the
                 whole dashboard around it.

   WHERE THE CONTENT COMES FROM, and why it is not assembled here. The detail
   export is the MO Intelligence Center's OWN rendered detail block, asked for by
   name and then stripped of the things a file cannot use (its buttons, its
   Tailwind classes, its click hooks). It is a transcription, not a second
   renderer. That is the whole ground-truth argument: this module cannot show a
   fact the panel does not already show, because it does not know any facts. It
   reads no engine, it reaches into no simulation state beyond the case list the
   panel publishes, and if a field is not in the panel's markup it is not in the
   file. A "the reader would understand this better if we also included..."
   change to this module would have to add a new reader of the simulation, which
   is exactly what it is not allowed to become. */
const FWCaseExport = (() => {

  /* THE CSV COLUMNS, declared with where each one is already shown. `surfacedIn`
     is not decoration: it is the check that this export stayed a transcription.
     A column whose fact appears in no panel surface has no business being in a
     file the panel produced. */
  const CASE_LIST_COLUMNS = [
    { key: 'caseId', label: 'Case ID', surfacedIn: 'card header', pick: (mo) => mo.id },
    { key: 'truck', label: 'Truck', surfacedIn: 'card header', pick: (mo) => (mo.entities && mo.entities.truckId) || '' },
    { key: 'driver', label: 'Driver', surfacedIn: 'executive summary', pick: (mo) => (mo.entities && mo.entities.driverId) || '' },
    { key: 'title', label: 'Case title', surfacedIn: 'card title', pick: (mo) => mo.title || '' },
    { key: 'status', label: 'Status', surfacedIn: 'card header badge', pick: (mo) => String(mo.status || '').replace(/_/g, ' ') },
    { key: 'discoveryClass', label: 'Discovery classification', surfacedIn: 'card header badge', pick: (mo) => FWMoEngine.classificationLabel(mo.classification) },
    { key: 'confidenceBand', label: 'Confidence band', surfacedIn: 'card header badge', pick: (mo) => mo.confidenceBand || '' },
    { key: 'confidenceIndex', label: 'Confidence index', surfacedIn: 'card header badge', pick: (mo) => FWMoEngine.formatIndex(mo.confidence) },
    { key: 'signalCombination', label: 'Signal combination it opened on', surfacedIn: 'executive summary', pick: (mo) => String(mo.signature || '').replace(/\+/g, ' + ') },
    { key: 'timesSeen', label: 'Times that combination has been seen', surfacedIn: 'executive summary', pick: (mo) => mo.recurrenceCount },
    { key: 'firstObserved', label: 'First observed', surfacedIn: 'timeline', pick: (mo) => simTime(mo.firstObserved) },
    { key: 'lastObserved', label: 'Last observed', surfacedIn: 'timeline', pick: (mo) => simTime(mo.lastObserved) },
    { key: 'evidenceRows', label: 'Evidence rows', surfacedIn: 'evidence list', pick: (mo) => ((mo.evidence || []).length) },
    { key: 'recordedAt', label: 'Recorded at', surfacedIn: 'case sites line', pick: (mo) => sitesOf(mo) }
  ];

  /* CSV QUOTING, stated because getting it wrong is how an export corrupts a
     spreadsheet silently. A field is quoted when it contains a comma, a quote or
     a line break; an embedded quote is doubled. Nothing is stripped -- a case
     title with a comma in it stays a case title with a comma in it. The leading
     byte-order mark is there so Excel opens the file as UTF-8 instead of
     mangling the non-ASCII characters the panel copy uses. */
  const CSV = {
    delimiter: ',',
    quote: '"',
    lineBreak: '\r\n',
    bom: '\ufeff',
    means: 'RFC 4180 quoting: quote when the field contains a delimiter, a quote or a newline, and double any quote inside.',
    doesNotMean: 'stripping or replacing characters to avoid quoting them.'
  };

  /* WHAT THE STRIPPER TAKES OUT of the panel's markup, and why each one. Nothing
     here removes content: every rule targets interaction or styling that a
     standalone file cannot honour. */
  const STRIPPED = [
    { what: 'buttons', why: 'a file cannot run an investigation action, and a dead button that looks live is worse than no button.' },
    { what: 'class attributes', why: 'they name Tailwind utilities that only exist inside the app\u2019s stylesheet; the exported file brings its own.' },
    { what: 'data attributes', why: 'they are click hooks for handlers that are not in the file.' },
    { what: 'title attributes', why: 'a tooltip has nowhere to appear on paper, and its text is already in the visible copy or is about a control that has been removed.' }
  ];

  function simTime(absSeconds) {
    if (absSeconds == null) return '';
    return (window.FWMoIntelligence && FWMoIntelligence.fmtSimTime)
      ? FWMoIntelligence.fmtSimTime(absSeconds)
      : String(absSeconds);
  }

  function sitesOf(mo) {
    if (!mo.siteSpread) return '';
    if (mo.siteSpread === 'UNSITED') return 'open road, at no site';
    return (mo.sites || []).map(s => s.facilityName).join('; ');
  }

  function csvField(value) {
    const s = value === null || value === undefined ? '' : String(value);
    if (s.indexOf(CSV.delimiter) >= 0 || s.indexOf(CSV.quote) >= 0 || /[\r\n]/.test(s)) {
      return CSV.quote + s.replace(/"/g, '""') + CSV.quote;
    }
    return s;
  }

  function casesToCsv(mos) {
    const head = CASE_LIST_COLUMNS.map(c => csvField(c.label)).join(CSV.delimiter);
    const rows = (mos || []).map(mo => CASE_LIST_COLUMNS.map(c => csvField(c.pick(mo))).join(CSV.delimiter));
    return CSV.bom + [head].concat(rows).join(CSV.lineBreak) + CSV.lineBreak;
  }

  function escapeHtml(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function stripForFile(html) {
    return String(html || '')
      .replace(/<button\b[^>]*>[\s\S]*?<\/button>/gi, '')
      .replace(/\sclass="[^"]*"/gi, '')
      .replace(/\sdata-[a-z-]+="[^"]*"/gi, '')
      .replace(/\stitle="[^"]*"/gi, '')
      .replace(/\s(?:disabled|checked)(?=[\s>])/gi, '');
  }

  /* The exported file's own stylesheet, inside the file. Print rules included,
     because printing this document to PDF is the intended route to a PDF and a
     dark-on-dark screen theme prints as a black page. */
  const DOCUMENT_STYLE = [
    'body{margin:0;padding:28px;background:#fff;color:#111;font:13px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:820px}',
    'h1{font-size:18px;margin:0 0 2px}',
    'h2{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#475569;margin:18px 0 6px}',
    '.fw-meta{color:#475569;font-size:11px;margin:0 0 14px}',
    '.fw-badges span{display:inline-block;border:1px solid #cbd5e1;border-radius:999px;padding:1px 8px;margin:0 6px 6px 0;font-size:11px;color:#334155}',
    '.fw-body div{margin:0 0 4px}',
    '.fw-body ul{margin:4px 0 10px 18px;padding:0}',
    '.fw-body li{margin:0 0 4px}',
    '.fw-note{margin-top:22px;padding-top:10px;border-top:1px solid #e2e8f0;color:#64748b;font-size:10px}',
    '@media print{body{padding:0;max-width:none}h2{page-break-after:avoid}li{page-break-inside:avoid}.fw-note{page-break-before:avoid}}'
  ].join('');

  /* Provenance, on every exported file. Two sentences it must always carry: WHEN
     it was taken (a case moves, so a file is a moment and not the case), and
     WHAT IT IS NOT -- a file that looks like a case report will be read as one,
     including by someone who never saw the panel it came from. */
  function provenance(meta) {
    return `<p class="fw-note">
      Exported from Fraud Watch &mdash; Live Sim, MO Intelligence Center, at
      ${escapeHtml(meta.realTime)} (simulation ${escapeHtml(meta.simTime)}).
      This file is a copy of what that panel was showing at that moment: a case in this
      simulation keeps changing after an export, so nothing here is the current state of it.
      It contains no simulation record beyond what the panel itself displays, and the
      simulation's own answer key is not part of it. It is a training artefact from a
      simulated port, not a document about any real carrier, driver or vehicle.
    </p>`;
  }

  function metaFor(state) {
    const clock = state && state.clock;
    return {
      realTime: new Date().toLocaleString(),
      simTime: clock ? `day ${clock.day}, ${clock.timeOfDay()}` : 'unknown',
      day: clock ? clock.day : null
    };
  }

  function caseDetailDocument(mo, state) {
    const meta = metaFor(state);
    const detail = window.FWMoIntelligence && FWMoIntelligence.detailHtml
      ? FWMoIntelligence.detailHtml(mo) : '';
    const badges = [
      `${mo.confidenceBand} &middot; index ${FWMoEngine.formatIndex(mo.confidence)}`,
      FWMoEngine.classificationLabel(mo.classification),
      String(mo.status || '').replace(/_/g, ' ')
    ].map(b => `<span>${b}</span>`).join('');
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${escapeHtml(mo.id)} — ${escapeHtml(mo.title || 'Case')}</title>
<style>${DOCUMENT_STYLE}</style></head>
<body>
<h1>${escapeHtml(mo.id)} &middot; ${escapeHtml(mo.title || 'Unclassified pattern')}</h1>
<p class="fw-meta">${escapeHtml((mo.entities && mo.entities.truckId) || '')}${mo.entities && mo.entities.driverId ? ' &middot; driver ' + escapeHtml(mo.entities.driverId) : ''}</p>
<p class="fw-badges">${badges}</p>
<div class="fw-body">${stripForFile(detail)}</div>
${provenance(meta)}
</body></html>`;
  }

  function safeName(s) { return String(s || 'case').replace(/[^A-Za-z0-9_.-]+/g, '-'); }

  function download(filename, text, mime) {
    try {
      const blob = new Blob([text], { type: mime + ';charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      // Appended because Firefox ignores a click on a link that is not in the
      // document; removed straight away so the page is unchanged afterwards.
      if (document.body && document.body.appendChild) document.body.appendChild(a);
      a.click();
      if (a.remove) a.remove();
      if (URL.revokeObjectURL) setTimeout(() => URL.revokeObjectURL(url), 1000);
      return { ok: true, filename: filename, bytes: text.length };
    } catch (e) {
      return { ok: false, why: String((e && e.message) || e), filename: filename };
    }
  }

  function note(text) {
    const el = document.getElementById('mo-export-note');
    if (el) el.textContent = text;
    return text;
  }

  function exportCaseList() {
    const state = FWSimRunner.getState();
    if (!state) return note('No run to export.');
    const mos = FWMoIntelligence.visibleCases(state);
    if (!mos.length) return note('This filter is showing no cases, so there is nothing to export.');
    const filter = FWMoIntelligence.filterState();
    const meta = metaFor(state);
    const name = `fraudwatch-cases-day${meta.day}-${filter.status.toLowerCase()}-${filter.classification.toLowerCase()}.csv`;
    const r = download(safeName(name), casesToCsv(mos), 'text/csv');
    return note(r.ok
      ? `Exported ${mos.length} case${mos.length === 1 ? '' : 's'} — the ones this filter is showing, not the whole run — to ${r.filename}.`
      : `Could not save the CSV: ${r.why}`);
  }

  function exportCase(moId) {
    const state = FWSimRunner.getState();
    if (!state) return note('No run to export.');
    const mo = state.moEngine.mos.get(moId);
    if (!mo) return note(`Case ${moId} is not in this run.`);
    const r = download(safeName(`fraudwatch-${mo.id}.html`), caseDetailDocument(mo, state), 'text/html');
    return note(r.ok
      ? `Exported ${mo.id} to ${r.filename}. Open it in a browser, or print it to PDF from there.`
      : `Could not save the case file: ${r.why}`);
  }

  /* Prints the exported document rather than the page. A hidden frame is used
     instead of a popup because a popup is what a blocker blocks, and instead of
     print rules over the live panel because those would have to hide the rest of
     a dashboard by name and would go stale the next time a panel is added. */
  function printCase(moId) {
    const state = FWSimRunner.getState();
    if (!state) return note('No run to print.');
    const mo = state.moEngine.mos.get(moId);
    if (!mo) return note(`Case ${moId} is not in this run.`);
    try {
      const frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.style.position = 'fixed';
      frame.style.width = '0';
      frame.style.height = '0';
      frame.style.border = '0';
      frame.style.left = '-9999px';
      document.body.appendChild(frame);
      frame.srcdoc = caseDetailDocument(mo, state);
      const go = () => {
        try {
          const w = frame.contentWindow;
          if (w && typeof w.print === 'function') { w.focus(); w.print(); }
        } catch (e) { /* a frame that will not print is not a reason to break the panel */ }
        setTimeout(() => { if (frame.remove) frame.remove(); }, 1000);
      };
      if (frame.addEventListener) frame.addEventListener('load', go); else setTimeout(go, 200);
      return note(`Sent ${mo.id} to the print dialog. Choosing "Save as PDF" there is how this build makes a PDF.`);
    } catch (e) {
      return note(`Could not open the print view: ${String((e && e.message) || e)}`);
    }
  }

  function init() {
    const btn = document.getElementById('mo-export-csv');
    if (btn) btn.addEventListener('click', exportCaseList);
  }

  return {
    init, exportCase, exportCaseList, printCase,
    casesToCsv, caseDetailDocument, csvField, stripForFile, download,
    CASE_LIST_COLUMNS, CSV, STRIPPED, DOCUMENT_STYLE
  };
})();
