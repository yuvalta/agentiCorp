# AgentiCorp

Autonomous multi-agent micro-SaaS factory governed by a single Human CEO.

The engine runs a linear pipeline of 8 isolated agents. It is autonomous
**between** gates and **freezes** at every financial / kickoff / deployment
junction until the CEO approves. No agent can touch real money, register
domains, or deploy — the `Gatekeeper` intercepts those and routes them to a
pending-approval queue.

## Layout

```
orchestrator/   state-machine loop + state definitions
agents/         8 isolated agent modules (research…marketing) + base + registry
lib/            Gatekeeper guardrail, central logger
config/         agents.json — per-agent I/O contract + boundaries
workspace/      shared context: specs, reports, generated src, engine state
dashboard/      CEO portal: pending_approvals.json, ceo_actions.json, CLI, web view
```

## Pipeline

```
DISCOVERY ─▶ [KICKOFF GATE] ─▶ BLUEPRINTING ─▶ TRIAGE ─▶ CONSTRUCTION
   research        CEO         architect+designer  product   dev + qa(blocks)
                                                                  │
            ┌─────────────────────────────────────────────────────┘
            ▼
          AUDIT ─▶ [FINANCE GATE] ─▶ [DEPLOY GATE] ─▶ DEPLOYED
       finance+marketing    CEO            CEO
```

## Run

```bash
npm start                 # run the engine; it stops at the first gate
npm run approve -- list   # see what the CEO must decide
npm run approve -- PROJECT_KICKOFF
npm start                 # resume; stops at the next gate
npm run approve -- FINANCIAL_CLEARANCE
npm start
npm run approve -- DEPLOYMENT
npm start                 # pipeline completes -> DEPLOYED

npm run dashboard         # optional read-only web view at :4317
```

State persists in `workspace/.engine_state.json`. Delete it to start a new
project from scratch (also clear generated artifacts in `workspace/`).

## The Golden Rule

`lib/Gatekeeper.js` is the hardcoded guardrail:

- **File writes** are confined to `/workspace`; any write whose path/payload
  smells financial or deploy-related is frozen.
- **Network calls** to payment / registrar / cloud / deploy hosts are frozen.
- `installGlobalNetGuard()` patches `globalThis.fetch` so even an unguarded
  raw request is caught (defense-in-depth).
- Frozen actions append to `dashboard/pending_approvals.json` and raise
  `ApprovalRequiredError`, halting the affected branch.

Approval authority lives only in the CLI (`dashboard/cli.js`), off the network
surface.
