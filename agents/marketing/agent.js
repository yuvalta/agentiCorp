import { BaseAgent } from '../baseAgent.js';
import { completeJSON } from '../../lib/llm.js';

const SYSTEM = `You are agent-marketing in an autonomous micro-SaaS factory.
Draft launch marketing for this product: SEO metadata, social posts, a cold
email, and landing-page copy. Drafts ONLY — nothing is sent. Be specific and
benefit-driven, no hype filler.`;

const SCHEMA = {
  type: 'object',
  properties: {
    seo: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        metaDescription: { type: 'string' },
        keywords: { type: 'array', items: { type: 'string' } },
      },
      required: ['title', 'metaDescription', 'keywords'],
      additionalProperties: false,
    },
    social: { type: 'array', items: { type: 'string' } },
    coldEmail: {
      type: 'object',
      properties: { subject: { type: 'string' }, body: { type: 'string' } },
      required: ['subject', 'body'],
      additionalProperties: false,
    },
    landingCopy: { type: 'string' },
  },
  required: ['seo', 'social', 'coldEmail', 'landingCopy'],
  additionalProperties: false,
};

const STUB = {
  seo: {
    title: 'Evergreen Content Scheduler for Agencies',
    metaDescription: 'Schedule once, recycle forever. Built for solo marketers and small agencies.',
    keywords: ['evergreen content scheduler', 'content recycling tool'],
  },
  social: [
    'Stop rewriting the same posts. Recycle your best content on autopilot. 🔁',
    'Solo marketer? Reclaim hours every week.',
  ],
  coldEmail: { subject: 'A faster way to keep your socials full', body: 'Hi {{name}}, ...' },
  landingCopy: 'Schedule once. Recycle forever.',
};

// agent-marketing — AUDIT. Drafts campaigns only; no mass-send.
export class MarketingAgent extends BaseAgent {
  async run() {
    const trend = await this.readArtifact('TrendReport.md');
    const tokens = await this.readArtifact('Design_Tokens.json');
    const out = (await completeJSON({
      system: SYSTEM,
      prompt: `Product opportunity:\n${trend}\n\nBrand/design:\n${tokens}\n\nDraft the launch campaigns.`,
      schema: SCHEMA,
      source: this.id,
    })) ?? STUB;
    return [await this.emit('Marketing_Campaigns.json', { ...out, coldEmail: { ...out.coldEmail, status: 'DRAFT' } })];
  }
}
