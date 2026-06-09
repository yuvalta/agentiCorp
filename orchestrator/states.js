// Workflow state machine definition. Linear pipeline with explicit CEO
// gates. The orchestrator advances only when the current state's agents
// succeed and any required approval is granted.

export const STATES = {
  IDLE: 'IDLE',
  DISCOVERY: 'DISCOVERY',
  KICKOFF_GATE: 'KICKOFF_GATE',
  BLUEPRINTING: 'BLUEPRINTING',
  TRIAGE: 'TRIAGE',
  CONSTRUCTION: 'CONSTRUCTION',
  AUDIT: 'AUDIT',
  FINANCE_GATE: 'FINANCE_GATE',
  DEPLOY_GATE: 'DEPLOY_GATE',
  DELIVERY: 'DELIVERY',
  DEPLOYED: 'DEPLOYED',
  FROZEN: 'FROZEN',
};

// Ordered transitions. A *_GATE state requires explicit CEO approval before
// the engine may proceed to its `next`.
export const TRANSITIONS = {
  IDLE: { next: 'DISCOVERY' },
  DISCOVERY: { next: 'KICKOFF_GATE', agents: ['agent-research'] },
  KICKOFF_GATE: { next: 'BLUEPRINTING', gate: 'PROJECT_KICKOFF' },
  BLUEPRINTING: { next: 'TRIAGE', agents: ['agent-architect', 'agent-designer'] },
  TRIAGE: { next: 'CONSTRUCTION', agents: ['agent-product'] },
  CONSTRUCTION: { next: 'AUDIT', agents: ['agent-developer', 'agent-qa'] },
  AUDIT: { next: 'FINANCE_GATE', agents: ['agent-finance', 'agent-marketing'] },
  FINANCE_GATE: { next: 'DEPLOY_GATE', gate: 'FINANCIAL_CLEARANCE' },
  DEPLOY_GATE: { next: 'DELIVERY', gate: 'DEPLOYMENT' },
  DELIVERY: { next: 'DEPLOYED', agents: ['agent-ops'] },
  DEPLOYED: { next: null },
};

export const GATES = {
  PROJECT_KICKOFF: 'Approve a specific TrendReport to enter development.',
  FINANCIAL_CLEARANCE: 'Approve domain names and hosting fees from agent-finance.',
  DEPLOYMENT: 'Final green light to push the compiled app to public infra.',
};
