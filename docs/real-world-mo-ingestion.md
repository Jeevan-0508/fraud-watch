# Real-world MO ingestion — provenance note

Slice 5 of the simulation engine added six new disruption/signal
primitives to `behaviorEngine.js` / `signalEngine.js` / `falsePositiveEngine.js`
/ `moEngine.js`:

- `FALSE_MILESTONE_STAMP` — a system delivery/arrival stamp fires with no
  confirmed physical arrival at the destination.
- `CARRIER_UNRESPONSIVE` — a carrier stops responding to calls/notices
  after pickup, escalation stalls on silence rather than evidence.
- `EQUIPMENT_CARRIER_MISMATCH` — a pickup is performed with a
  tractor/trailer registered to a different carrier than the one
  assigned to the run.
- `DUPLICATE_ASSET_ID` — the same trailer/tractor identifier appears
  active in two places at once.
- `HANDOVER_GAP` — a load goes unconfirmed at a leg-to-leg handover
  point in a multi-leg/intermodal run.
- `STAGED_BREAKDOWN` — a driver reports a mechanical issue and
  detaches the trailer at an undocumented, off-site location.

## Source and process

These were generalized from a 38-ticket sample of real ROC/TIO
fraud-investigation records (a CSV export from an internal issue
tracker). The ingestion was manual and one-way:

1. Each ticket's free-text narrative was read for its **behavioral
   shape** only — the sequence of what happened, what was checked,
   how it was resolved.
2. Every identifying detail was discarded before anything was written
   down: carrier names/SCACs, VRIDs, ticket/case IDs, dates, dollar
   amounts, associate names/aliases/logins, GPS coordinates, and the
   source ticket URLs. None of that data exists anywhere in this
   repository, in this file, or in any commit.
3. What remained — six recurring abstract patterns — was written from
   scratch as new simulation primitives, matched by keyword heuristic
   against the existing (already de-identified) `freight-fraud-taxonomy`
   patterns already shipped in `data/fraud-data.json`, exactly like
   every other disruption type in the engine.
4. **Correction (this section originally misread the data — left in
   for the record):** an earlier version of this note claimed ~82% of
   the 38 tickets resolved as "no fraud suspected," and used that to
   push `FWFalsePositiveEngine.LEGITIMATE_CHANCE` from 0.65 to 0.8.
   That was wrong and has been reverted. All 38 tickets in the sample
   are **real, confirmed loss incidents** (missing trailers / theft
   that genuinely happened) — this data source is exclusively
   already-flagged fraud/loss cases, not a mixed population that
   includes benign disruptions. The source system's "Resolve Category:
   False Positive (No Fraud Suspected)" label describes whether a
   *specific named suspect's internal collusion* was substantiated,
   not whether an incident occurred at all — the loss was real in
   every one of those 38 cases regardless of that label. That field
   is simply the wrong axis to calibrate a "how often is an anomaly
   totally benign" constant against, and no aggregate stat from this
   sample is used for that calibration anymore. `LEGITIMATE_CHANCE`
   is back to its original 0.65 design-intent value. The six
   behavioral primitives above are unaffected by this correction —
   they describe *how* a real incident unfolds, which is a separate
   and valid read of the same free text.

## What this explicitly is not

This is not an automated ingestion pipeline and no raw ticket data was
ever committed, cached, or processed by a script in this repo. The
source CSV lives only in the requester's local Downloads folder and
was read interactively, once, for this generalization. Any future
"ingest an Excel of real cases" request should follow the same
process: read for shape, discard identifiers, write new primitives by
hand, keep only aggregate statistics if any.
