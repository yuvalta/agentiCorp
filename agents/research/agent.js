import { BaseAgent } from '../baseAgent.js';
import { completeJSON } from '../../lib/llm.js';
import { appendIdea, renderReport } from '../../lib/ideasStore.js';

// Research is aimed at the operator's exit plan, not at auto-buildable
// micro-SaaS: the goal is ONE candidate business worth a 9-month full-time bet,
// judged against real constraints (see FTMVaults/ExitPlan-FTM). The two fields
// that do the most work are `distribution` and `monthSixSignal` — an idea that
// cannot answer those is not a candidate, however good the market looks.
const SYSTEM = `You are agent-research, sourcing candidate businesses for a
solo technical founder in Israel planning to leave a salaried job.

His situation, which every idea must be judged against:
- Replacing ~27,000 NIS/month net. 9 months of runway, with a hard go/no-go
  review at month 6.
- Real edge: senior engineering, shipping working software fast, AI/agent
  systems. He builds faster than most.
- Named weaknesses, by his own assessment: selling, and network/connections.
  He has no audience and no warm intro list to lean on.
- He wants a company with durable value, not just freelance income that stops
  when he stops working.

Be concrete and skeptical. Reject ideas whose only path to customers is
"content marketing" or "reach out to my network" — he has neither yet. Prefer
ideas where his building speed is the actual advantage, and where the first
paying customer is reachable by a specific, nameable action within weeks.`;

const PROMPT = `Identify ONE candidate business for this founder and return it
as structured JSON. Be concrete and skeptical — no hype, no generic advice.

Hard requirements for your answer:
- "distribution" must name a specific way to reach the first 10 paying
  customers WITHOUT an existing audience or warm network. Name real channels,
  places, or intermediaries, not "do content marketing".
- "monthSixSignal" must be a single measurable outcome that, if missed by
  month 6, means abandon. A number and a date, not a feeling.
- "revenuePath" must address how this gets toward 27,000 NIS/month, and how
  long until the first shekel.
- "score" is a 0-100 rating combining demand, reachability given his lack of
  network, and fit with his engineering edge.`;

const IDEA_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Short business name / idea label' },
    problem: { type: 'string', description: 'The specific, expensive problem being solved' },
    audience: { type: 'string', description: 'Who pays, specifically enough to go find them' },
    niche: { type: 'array', items: { type: 'string' }, description: '3-4 demand/low-competition signals' },
    model: { type: 'string', description: 'e.g. SaaS, productized service, marketplace' },
    priceRange: { type: 'string', description: 'e.g. 2,000-6,000 NIS/mo per customer' },
    marketSize: { type: 'string', description: 'reachable market: small/medium/large' },
    distribution: { type: 'string', description: 'How to reach the first 10 paying customers with NO audience and NO warm network. Specific channels or intermediaries.' },
    edgeFit: { type: 'string', description: 'Why his building speed is the advantage here, and how much the business leans on selling/network (his weak areas)' },
    revenuePath: { type: 'string', description: 'Path toward 27,000 NIS/mo net, and realistic time to first paying customer' },
    monthSixSignal: { type: 'string', description: 'One measurable outcome by month 6 that decides continue vs abandon. Must include a number.' },
    risks: { type: 'array', items: { type: 'string' }, description: '2-4 concrete ways this fails' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    score: { type: 'integer', description: '0-100 viability rating' },
  },
  required: [
    'title', 'problem', 'audience', 'niche', 'model', 'priceRange', 'marketSize',
    'distribution', 'edgeFit', 'revenuePath', 'monthSixSignal', 'risks',
    'confidence', 'score',
  ],
  additionalProperties: false,
};

// Deterministic fallback used when the CLI is unavailable (offline / tests).
const STUB_IDEA = {
  title: 'Compliance evidence automation for Israeli SaaS vendors',
  problem: 'Small Israeli SaaS companies selling into enterprise burn weeks per deal assembling security questionnaire and SOC2 evidence by hand.',
  audience: 'Israeli B2B SaaS companies of 10-60 people that have started losing deals to security review.',
  niche: [
    'Security questionnaires are a named blocker in enterprise sales cycles',
    'Existing tools price for US mid-market, not 20-person Israeli vendors',
    'Buyers are concentrated in a few Tel Aviv/Herzliya office parks',
  ],
  model: 'Productized service moving to SaaS',
  priceRange: '3,000-8,000 NIS/mo per customer',
  marketSize: 'small',
  distribution: 'Israeli SaaS companies are geographically concentrated and publicly listed on local startup databases; reachable by direct outreach to VP Sales rather than by audience-building.',
  edgeFit: 'The work is document pipeline plumbing plus AI extraction — squarely his engineering edge. Still requires cold outreach, which is his weakest area, so this trades on a skill he must build.',
  revenuePath: 'Six customers at ~5,000 NIS/mo reaches ~30,000 NIS/mo. First paying customer realistically 8-12 weeks in, likely as a paid manual pilot before any product exists.',
  monthSixSignal: 'At least 3 paying customers at 3,000+ NIS/mo by month 6, or abandon.',
  risks: [
    'Cold outreach is the founder\'s named weakness and is the entire distribution model',
    'Incumbents can price down into this segment once it is proven',
    'May stay a services business that does not compound into company value',
  ],
  confidence: 'medium',
  score: 61,
};

// agent-research — DISCOVERY. Live structured LLM call, stub fallback.
// Emits TrendReport.md (pipeline input) AND appends to the ideas store.
export class ResearchAgent extends BaseAgent {
  async run() {
    // Each run is a fresh LLM call with no memory of earlier ones, so without
    // this the agent keeps re-proposing the same few themes. Feed prior titles
    // back in as an exclusion list.
    let prior = [];
    try {
      const seen = JSON.parse(await this.readArtifact('ideas.json'));
      prior = (seen.ideas ?? []).map((i) => i.title).filter(Boolean);
    } catch { /* no store yet — first run */ }

    const prompt = prior.length
      ? [
          PROMPT,
          '',
          'Already proposed in previous runs — do NOT repeat these, and avoid',
          'close variations on the same theme, market, or business model:',
          ...prior.map((t) => `- ${t}`),
          '',
          'Propose something materially different: a different buyer, a',
          'different industry, or a different shape of business.',
        ].join('\n')
      : PROMPT;

    const idea = (await completeJSON({ system: SYSTEM, prompt, schema: IDEA_SCHEMA, source: this.id })) ?? STUB_IDEA;
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
