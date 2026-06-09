import { BaseAgent } from '../baseAgent.js';
import { completeJSON } from '../../lib/llm.js';

const SYSTEM = `You are agent-finance in an autonomous micro-SaaS factory.
Estimate realistic launch costs for this product: domain, hosting, and LLM/API
usage. Be conservative and concrete (USD). You PROPOSE expenses only — you can
never execute payment.`;

const SCHEMA = {
  type: 'object',
  properties: {
    currency: { type: 'string' },
    lineItems: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          item: { type: 'string' },
          est: { type: 'number' },
          recurring: { type: 'string', enum: ['one-time', 'monthly', 'yearly'] },
        },
        required: ['item', 'est', 'recurring'],
        additionalProperties: false,
      },
    },
    monthlyBurn: { type: 'number' },
    oneTime: { type: 'number' },
    runwayNote: { type: 'string' },
  },
  required: ['currency', 'lineItems', 'monthlyBurn', 'oneTime', 'runwayNote'],
  additionalProperties: false,
};

const STUB = {
  currency: 'USD',
  lineItems: [
    { item: 'Domain registration', est: 14.0, recurring: 'yearly' },
    { item: 'VPS hosting (1 vCPU / 1GB)', est: 6.0, recurring: 'monthly' },
    { item: 'LLM API usage (build phase)', est: 25.0, recurring: 'one-time' },
  ],
  monthlyBurn: 6.0,
  oneTime: 39.0,
  runwayNote: 'Approve to proceed to deployment gate.',
};

// agent-finance — AUDIT. Proposes an Expense_Request; never executes payment.
export class FinanceAgent extends BaseAgent {
  async run() {
    const spec = await this.readArtifact('Architecture_Spec.json');
    const est = (await completeJSON({
      system: SYSTEM,
      prompt: `Estimate launch costs for this product:\n\n${spec}`,
      schema: SCHEMA,
      source: this.id,
    })) ?? STUB;
    const request = {
      requestedAt: new Date().toISOString(),
      ...est,
      status: 'PROPOSED',
      canExecutePayment: false, // hardcoded — the Golden Rule
    };
    return [await this.emit('Expense_Request.json', request)];
  }
}
