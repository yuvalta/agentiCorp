import { BaseAgent } from '../baseAgent.js';
import { completeJSON } from '../../lib/llm.js';

const SYSTEM = `You are agent-architect in an autonomous micro-SaaS factory.
Turn a trend report into a lean, production-ready system design. Favor
lightweight, cost-effective tech (Node.js, Express, SQLite/Postgres, Docker).
Keep the MVP scope SMALL enough to build and test in a single pass.`;

const SCHEMA = {
  type: 'object',
  properties: {
    product: { type: 'string' },
    stack: {
      type: 'object',
      properties: {
        runtime: { type: 'string' },
        framework: { type: 'string' },
        db: { type: 'string' },
        container: { type: 'string' },
      },
      required: ['runtime', 'framework', 'db', 'container'],
      additionalProperties: false,
    },
    services: { type: 'array', items: { type: 'string' } },
    tables: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          columns: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'columns'],
        additionalProperties: false,
      },
    },
    apiContracts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          method: { type: 'string' },
          path: { type: 'string' },
          auth: { type: 'boolean' },
        },
        required: ['method', 'path', 'auth'],
        additionalProperties: false,
      },
    },
    topology: { type: 'string' },
  },
  required: ['product', 'stack', 'services', 'tables', 'apiContracts', 'topology'],
  additionalProperties: false,
};

const STUB = {
  product: 'evergreen-content-scheduler',
  stack: { runtime: 'Node.js', framework: 'Express', db: 'SQLite (dev) / Postgres (prod)', container: 'Docker' },
  services: ['api', 'scheduler-worker', 'web'],
  tables: [
    { name: 'users', columns: ['id', 'email', 'plan'] },
    { name: 'posts', columns: ['id', 'user_id', 'body', 'recycle_interval', 'next_run_at'] },
  ],
  apiContracts: [
    { method: 'POST', path: '/posts', auth: true },
    { method: 'GET', path: '/posts', auth: true },
  ],
  topology: 'web -> api -> db; scheduler-worker -> db',
};

// agent-architect — BLUEPRINTING. TrendReport -> Architecture_Spec.json.
export class ArchitectAgent extends BaseAgent {
  async run() {
    const trend = await this.readArtifact('TrendReport.md');
    const spec = await completeJSON({
      system: SYSTEM,
      prompt: `Design the MVP system for this opportunity:\n\n${trend}`,
      schema: SCHEMA,
      source: this.id,
    });
    return [await this.emit('Architecture_Spec.json', spec ?? STUB)];
  }
}
