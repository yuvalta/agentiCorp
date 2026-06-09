import { BaseAgent } from '../baseAgent.js';
import { completeJSON } from '../../lib/llm.js';

const SYSTEM = `You are agent-product in an autonomous micro-SaaS factory.
Cut the architecture into a SMALL, ordered MVP backlog of bite-sized tickets,
each with crisp, testable acceptance criteria. Keep it shippable in one pass.`;

const SCHEMA = {
  type: 'object',
  properties: {
    milestone: { type: 'string' },
    tickets: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          ac: { type: 'array', items: { type: 'string' } },
          points: { type: 'integer' },
        },
        required: ['id', 'title', 'ac', 'points'],
        additionalProperties: false,
      },
    },
  },
  required: ['milestone', 'tickets'],
  additionalProperties: false,
};

const STUB = {
  milestone: 'MVP',
  tickets: [
    { id: 'TCK-1', title: 'Scaffold Express API', ac: ['server boots', '/health returns 200'], points: 2 },
    { id: 'TCK-2', title: 'Posts CRUD', ac: ['create post', 'list posts', 'validation on body'], points: 3 },
    { id: 'TCK-3', title: 'Recycle scheduler', ac: ['due posts re-queue at interval', 'idempotent run'], points: 5 },
  ],
};

// agent-product — TRIAGE. Spec + design -> Product_Backlog.json.
export class ProductAgent extends BaseAgent {
  async run() {
    const spec = await this.readArtifact('Architecture_Spec.json');
    const tokens = await this.readArtifact('Design_Tokens.json');
    const backlog = await completeJSON({
      system: SYSTEM,
      prompt: `Architecture:\n${spec}\n\nDesign tokens:\n${tokens}\n\nProduce the MVP backlog.`,
      schema: SCHEMA,
      source: this.id,
    });
    return [await this.emit('Product_Backlog.json', backlog ?? STUB)];
  }
}
