import { BaseAgent } from '../baseAgent.js';
import { completeJSON } from '../../lib/llm.js';

const SYSTEM = `You are agent-ops in an autonomous micro-SaaS factory.
Given a product, recommend 3 brandable, short, available-sounding domain names
(prefer .com / .app / .io) and a one-line deploy summary. Be concrete.`;

const SCHEMA = {
  type: 'object',
  properties: {
    domainRecommendations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          domain: { type: 'string' },
          rationale: { type: 'string' },
        },
        required: ['domain', 'rationale'],
        additionalProperties: false,
      },
    },
    deploySummary: { type: 'string' },
  },
  required: ['domainRecommendations', 'deploySummary'],
  additionalProperties: false,
};

const STUB = {
  domainRecommendations: [
    { domain: 'getrecyql.com', rationale: 'short, brandable, action-oriented' },
    { domain: 'recyql.app', rationale: 'app TLD signals SaaS' },
    { domain: 'recyql.io', rationale: 'dev/startup convention' },
  ],
  deploySummary: 'Dockerized Node service behind a reverse proxy on the product VPS.',
};

// agent-ops — DELIVERY. Runs only after QA PASS + CEO deployment approval.
// Prepares the deploy plan and domain recommendation. The REAL push to live
// infra is frozen by the Golden Rule — this emits a dry-run plan today.
export class OpsAgent extends BaseAgent {
  async run() {
    const audit = JSON.parse(await this.readArtifact('QA_Audit_Log.json'));
    if (audit.verdict !== 'PASS') {
      throw new Error(`agent-ops refuses to deploy: QA verdict is ${audit.verdict}`);
    }
    const spec = JSON.parse(await this.readArtifact('Architecture_Spec.json'));

    const rec = (await completeJSON({
      system: SYSTEM,
      prompt: `Product: ${spec.product}\nStack: ${JSON.stringify(spec.stack)}\nRecommend domains + a deploy summary.`,
      schema: SCHEMA,
      source: this.id,
    })) ?? STUB;

    const plan = {
      preparedAt: new Date().toISOString(),
      product: spec.product,
      target: {
        productVpsHost: process.env.DEPLOY_HOST ?? '<product VPS — provision separately, not the factory VPS>',
        method: 'docker build -> ssh -> docker run behind reverse proxy',
        healthCheck: '/health returns 200',
      },
      domainRecommendations: rec.domainRecommendations,
      deploySummary: rec.deploySummary,
      steps: [
        'docker build -t ' + spec.product + ':latest src/',
        'ssh deploy@<product-vps> "docker load" (image transfer)',
        'docker run -d --restart=always -p 80:3000 ' + spec.product,
        'verify /health, then point recommended domain DNS at the VPS',
      ],
      dryRun: true,
      executed: false,
      note: 'REAL push is frozen by the Golden Rule. Awaiting CEO to run the deploy with credentials.',
    };
    return [await this.emit('Deploy_Plan.json', plan)];
  }
}
