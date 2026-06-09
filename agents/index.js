// Maps agent ids -> their module classes. Each agent stays an isolated
// module; the orchestrator only sees this registry.
import { ResearchAgent } from './research/agent.js';
import { ArchitectAgent } from './architect/agent.js';
import { DesignerAgent } from './designer/agent.js';
import { ProductAgent } from './product/agent.js';
import { DeveloperAgent } from './dev/agent.js';
import { QaAgent } from './qa/agent.js';
import { FinanceAgent } from './finance/agent.js';
import { MarketingAgent } from './marketing/agent.js';
import { OpsAgent } from './ops/agent.js';

export const AGENT_CLASSES = {
  'agent-research': ResearchAgent,
  'agent-architect': ArchitectAgent,
  'agent-designer': DesignerAgent,
  'agent-product': ProductAgent,
  'agent-developer': DeveloperAgent,
  'agent-qa': QaAgent,
  'agent-finance': FinanceAgent,
  'agent-marketing': MarketingAgent,
  'agent-ops': OpsAgent,
};
