# Security and simulation boundaries

Fraud Watch is a synthetic, deterministic investigation environment. It has no live carrier feed, no carrier integration, no account system, and no production telemetry.

## Ground truth boundary

The simulation knows the hidden intent and benign causes that generated a movement. Analyst-facing views receive observations, signals, cases, and investigation outcomes without the answer key. The debug surface is explicitly labelled where it exposes simulator truth.

## Data and persistence

The browser stores only the small score, streak, and level persistence described by the architecture audit. Candidate exports are synthetic simulator output and are not uploaded or promoted into accepted risk data.

## Interpretation boundary

Signals are observations, correlation indices are not probabilities, and a simulation classification is not a real-world finding. The model is useful for exploring investigation design and false-positive handling—not for making a carrier decision.
