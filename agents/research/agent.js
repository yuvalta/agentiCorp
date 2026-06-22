import { BaseAgent } from '../baseAgent.js';
import { completeJSON } from '../../lib/llm.js';
import { appendIdea, renderReport } from '../../lib/ideasStore.js';

const SYSTEM = `You are agent-research in an autonomous micro-SaaS factory.
Find ONE profitable micro-SaaS opportunity: a real, narrow problem with a
reachable audience and low competition. Be concrete and skeptical — no hype.`;

const PROMPT = `Identify ONE profitable micro-SaaS opportunity and return it as
structured JSON. Be concrete and skeptical. The "score" is a 0-100 viability
rating combining demand, low-competition signal, and monetization clarity.`;

const IDEA_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Short product name / idea label' },
    problem: { type: 'string' },
    audience: { type: 'string' },
    niche: { type: 'array', items: { type: 'string' }, description: '3-4 demand/low-competition signals' },
    model: { type: 'string', description: 'e.g. SaaS, usage-based' },
    priceRange: { type: 'string', description: 'e.g. $19-49/mo' },
    marketSize: { type: 'string', description: 'reachable market: small/medium/large' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    score: { type: 'integer', description: '0-100 viability rating' },
  },
  required: ['title', 'problem', 'audience', 'niche', 'model', 'priceRange', 'marketSize', 'confidence', 'score'],
  additionalProperties: false,
};

// Deterministic fallback used when no API key is configured (offline / tests).
const STUB_IDEA = {
  title: 'Evergreen Content Scheduler',
  problem: 'Small agencies lack a lightweight tool to schedule + recycle social content.',
  audience: 'Solo marketers and 2-10 person agencies.',
  niche: [
    'Product Hunt: rising "content recycling" launches',
    'GitHub: little maintained OSS in this space',
    'Keyword: "evergreen content scheduler" — high volume, low competition',
  ],
  model: 'SaaS, $19-49/mo tiers',
  priceRange: '$19-49/mo',
  marketSize: 'medium',
  confidence: 'medium',
  score: 64,
};

// agent-research — DISCOVERY. Live structured LLM call, stub fallback.
// Emits TrendReport.md (pipeline input) AND appends to the ideas store.
export class ResearchAgent extends BaseAgent {
  async run() {
    const idea = (await completeJSON({ system: SYSTEM, prompt: PROMPT, schema: IDEA_SCHEMA, source: this.id })) ?? STUB_IDEA;
    const report = renderReport(idea);
    const outputs = [await this.emit('TrendReport.md', report)];

    // Append the structured idea to the persistent ideas store.
    let store;
    try { store = JSON.parse(await this.readArtifact('ideas.json')); } catch { store = { ideas: [] }; }
    const next = appendIdea(store, idea, report);
    await this.emit('ideas.json', next);

    return outputs;
  }
}
