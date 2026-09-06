import { BaseAgent } from '../baseAgent.js';
import { completeJSON } from '../../lib/llm.js';
import { appendIdea, renderReport } from '../../lib/ideasStore.js';

// Operator-authored prompt (2026-08-29). Broadened 2026-09-06 at operator
// request — it was converging on B2B micro-SaaS every night because the
// original text explicitly favored software. Category is now an explicit,
// rotated field instead of an implicit default. Global market, execution-
// focused, scored on four equal factors. The two fields that decide whether
// an idea is real are `distribution.first10CustomersTactic` (reachable with
// no audience) and `monthSixSignal.killCondition` (a binary abandon threshold).
const SYSTEM = `You are an exceptionally realistic, skeptical, and execution-focused business research agent. Your goal is to identify viable, high-potential business ideas for a founder who has ~6 months of runway and ~150,000 NIS of capital, can build software fast, but starts with ZERO existing audience and NO warm distribution network.

Do NOT default to software. Software/SaaS is only one possible category among several equally valid ones: a physical product or e-commerce brand, a service business the founder delivers or manages (not necessarily local), a content/media product monetized by sponsorship or subscription, an education/info product, a marketplace, or a licensing/IP play. Across repeated runs, rotate across these categories — do not converge on B2B micro-SaaS just because it's the safest guess.

Reject hand-waving or generic startup advice regardless of category. Dismiss any idea whose primary go-to-market depends on "content marketing," "SEO," "social media growth," or "leveraging a network" — UNLESS the idea's category is itself content/media and audience-building via one specific, named channel and mechanic IS the product (e.g. a niche newsletter monetized by sponsorship still needs a concrete first-100-subscribers tactic, not vague "grow an audience").

The target market is GLOBAL unless a local edge (sourcing, regulation, service delivery, logistics) provides a distinct programmatic advantage.`;

const PROMPT = `### INSTRUCTIONS

Analyze market gaps, painful B2B workflows, or underserved tech niches, and return EXACTLY ONE validated candidate business as structured JSON matching the schema below.

### JSON Schema Requirements

1. "idea":
   - "title": A concise, descriptive name for the product/service.
   - "category": One of "software-saas", "physical-product-ecommerce", "service-business", "content-media", "education-info-product", "marketplace-platform", "licensing-ip". Pick honestly based on what the business actually is — do not force-fit into software-saas.
   - "oneLiner": What the product does, for whom, and the exact problem it solves in one sharp sentence.
   - "valueProposition": Why a buyer pays for this (e.g., saves $X hours, replaces $Y expensive alternative, fixes a compliance/quality/cost problem).

2. "distribution":
   - Name precise, highly targetable global channels to acquire the FIRST 10 PAYING CUSTOMERS without an existing network or content marketing.
   - Tactics must fit the category: for software, scraper target lists, app marketplaces, targeted cold outbound on Apollo/LinkedIn, integration ecosystems, forum/community monitoring; for a physical product, a named paid-ad channel + audience filter, a specific marketplace or wholesale/retail placement, or direct outreach to a named buyer list; for a service business, a scraped prospect list + cold outreach, procurement portals, industry directories, or a specific referral/partnership channel; for content/media, one named channel and monetization mechanic with a concrete first-100-subscriber tactic. Vague "build an audience" or "post content" is not acceptable for any category.

3. "revenuePath":
   - Price point and monetization structure (e.g., $99/mo seat-based, $499 flat rate).
   - Expected time to first dollar (must be achievable within 30-60 days).
   - Realistic path to reaching default profitability/sustainability (e.g., number of customers needed to hit a base target like $5,000/month MRR).

4. "monthSixSignal":
   - A single, binary, measurable survival metric (e.g., "15 paying SMB accounts at minimum $150 MRR each ($2,250/mo total) by Day 180").
   - If this threshold is missed by Month 6, the business MUST be abandoned. No vague milestones like "product-market fit" or "positive feedback."

5. "competition":
   - "existingSolutions": Name at least 3 REAL, existing products that already
     solve this problem, by actual product name. Commercial and open-source.
     If you genuinely cannot name three, say so explicitly and treat that as a
     warning sign that the problem may not be painful enough to have attracted
     anyone — not as evidence of a green field.
   - "whyTheyLose": For each, the specific reason a buyer would switch. Not
     "they are bloated" — a concrete gap (price band, deployment model,
     missing integration, wrong buyer).
   - "saturation": one of "greenfield" | "few players" | "crowded" |
     "commoditized".

6. "score":
   - An overall viability rating from 0 to 100. Start from four factors:
     * Urgent market demand (0-25)
     * Reachability without audience (0-25)
     * Speed-to-launch advantage (0-25) — how fast this founder specifically (fast builder, 6mo runway, 150K NIS capital, no existing audience) could get a sellable version live, whatever the category
     * Speed-to-first-revenue (0-25)
   - THEN apply a competition penalty to the subtotal:
     * greenfield: -0    few players: -10    crowded: -25    commoditized: -40
   - Calibration — be harsh, most ideas are mediocre:
     * 80+ = exceptional. Reserved for a rare idea with an unfair, specific,
       hard-to-copy advantage. Awarding this should feel uncomfortable.
     * 60-79 = genuinely promising, worth a timeboxed test.
     * 40-59 = plausible but unremarkable; most decent-sounding ideas land here.
     * under 40 = do not pursue.
   - Do not inflate. A well-argued write-up is not evidence of a good business.
     If you cannot name what makes this unfair, it is not above 60.

7. "risksAndDefensibility":
   - The biggest reason this could fail immediately.
   - What prevents a larger competitor or clone from killing it once launched.`;

const IDEA_SCHEMA = {
  type: 'object',
  properties: {
    idea: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        category: {
          type: 'string',
          enum: [
            'software-saas',
            'physical-product-ecommerce',
            'service-business',
            'content-media',
            'education-info-product',
            'marketplace-platform',
            'licensing-ip',
          ],
        },
        oneLiner: { type: 'string' },
        valueProposition: { type: 'string' },
      },
      required: ['title', 'category', 'oneLiner', 'valueProposition'],
      additionalProperties: false,
    },
    distribution: {
      type: 'object',
      properties: {
        first10CustomersTactic: { type: 'string' },
        specificChannelsOrPlatforms: { type: 'array', items: { type: 'string' } },
      },
      required: ['first10CustomersTactic', 'specificChannelsOrPlatforms'],
      additionalProperties: false,
    },
    revenuePath: {
      type: 'object',
      properties: {
        pricingModel: { type: 'string' },
        timeToFirstDollarDays: { type: 'integer' },
        path2Profitability: { type: 'string' },
      },
      required: ['pricingModel', 'timeToFirstDollarDays', 'path2Profitability'],
      additionalProperties: false,
    },
    monthSixSignal: {
      type: 'object',
      properties: {
        survivalMetric: { type: 'string' },
        killCondition: { type: 'string' },
      },
      required: ['survivalMetric', 'killCondition'],
      additionalProperties: false,
    },
    competition: {
      type: 'object',
      properties: {
        existingSolutions: { type: 'array', items: { type: 'string' } },
        whyTheyLose: { type: 'array', items: { type: 'string' } },
        saturation: { type: 'string', enum: ['greenfield', 'few players', 'crowded', 'commoditized'] },
      },
      required: ['existingSolutions', 'whyTheyLose', 'saturation'],
      additionalProperties: false,
    },
    score: { type: 'integer' },
    risksAndDefensibility: {
      type: 'object',
      properties: {
        primaryFatalRisk: { type: 'string' },
        defensibilityStrategy: { type: 'string' },
      },
      required: ['primaryFatalRisk', 'defensibilityStrategy'],
      additionalProperties: false,
    },
  },
  required: ['idea', 'distribution', 'revenuePath', 'monthSixSignal', 'competition', 'score', 'risksAndDefensibility'],
  additionalProperties: false,
};

// Deterministic fallback used when the CLI is unavailable (offline / tests).
const STUB_IDEA = {
  idea: {
    title: 'Webhook Replay — durable retry + audit for outbound webhooks',
    category: 'software-saas',
    oneLiner: 'A drop-in webhook delivery layer for B2B SaaS vendors that retries, replays, and audits failed outbound webhooks so their customers stop opening support tickets about missed events.',
    valueProposition: 'Replaces weeks of in-house queue/retry engineering and removes a recurring class of support load; buyers pay to stop losing customer trust on silent delivery failures.',
  },
  distribution: {
    first10CustomersTactic: 'Scrape public API/developer docs for vendors that document outbound webhooks but no retry or replay guarantees; cold-email the named platform/API owner with a diff of their own docs against a working replay demo.',
    specificChannelsOrPlatforms: [
      'Scraped target list from public API docs mentioning "webhook" without "retry"',
      'Apollo filters: Head of Platform / API at 20-200 person B2B SaaS',
      'Integration marketplaces (Zapier, Make) partner directories',
      'Monitoring of vendor status pages and changelogs for webhook incidents',
    ],
  },
  revenuePath: {
    pricingModel: '$199/mo flat for up to 1M deliveries, $499/mo above',
    timeToFirstDollarDays: 45,
    path2Profitability: '25 customers at $199/mo reaches ~$5,000/mo MRR; infra cost scales sublinearly, so gross margin holds above 85%.',
  },
  monthSixSignal: {
    survivalMetric: '12 paying accounts at minimum $199 MRR each ($2,388/mo total) by Day 180.',
    killCondition: 'Fewer than 12 paying accounts or under $2,388 MRR on Day 180 — abandon.',
  },
  competition: {
    existingSolutions: ['Svix', 'Hookdeck', 'Convoy (open-source)'],
    whyTheyLose: [
      'Svix targets the platform-scale buyer and prices above small vendors',
      'Hookdeck is inbound-ingestion first; outbound replay is secondary',
      'Convoy is self-hosted only and needs infra work the buyer is avoiding',
    ],
    saturation: 'crowded',
  },
  score: 41,
  risksAndDefensibility: {
    primaryFatalRisk: 'Buyers treat webhook reliability as a two-sprint internal fix and refuse to add a vendor to a critical delivery path.',
    defensibilityStrategy: 'Delivery history and replay audit trail accumulate per customer, so switching costs grow with retained event data; being in the critical path is itself the moat once trusted.',
  },
};

// agent-research — DISCOVERY. Live structured LLM call, stub fallback.
// Emits TrendReport.md (pipeline input) AND appends to the ideas store.
export class ResearchAgent extends BaseAgent {
  async run() {
    // Each run is a fresh LLM call with no memory of earlier ones, so without
    // this the agent keeps re-proposing the same few themes. Feed prior titles
    // back in as an exclusion list.
    let prior = [];
    let recentCategories = [];
    try {
      const seen = JSON.parse(await this.readArtifact('ideas.json'));
      const ideas = seen.ideas ?? [];
      prior = ideas
        .map((i) => i.idea?.title ?? i.title) // new nested shape, then legacy flat
        .filter(Boolean);
      // Legacy (pre-2026-09-06) ideas have no category field — only the
      // nested shape does, so this naturally ignores them rather than
      // skewing the recent-categories window with unknowns.
      recentCategories = ideas
        .slice(-5)
        .map((i) => i.idea?.category)
        .filter(Boolean);
    } catch { /* no store yet — first run */ }

    let prompt = PROMPT;
    if (prior.length) {
      prompt = [
        prompt,
        '',
        '### ALREADY PROPOSED — DO NOT REPEAT',
        'These were returned by previous runs. Do not repeat them, and avoid',
        'close variations on the same theme, buyer, or business model:',
        ...prior.map((t) => `- ${t}`),
        '',
        'Propose something materially different: a different buyer, a',
        'different vertical, or a different shape of business.',
      ].join('\n');
    }
    if (recentCategories.length) {
      prompt = [
        prompt,
        '',
        '### RECENT CATEGORIES — FAVOR SOMETHING ELSE',
        `The last ${recentCategories.length} ideas used these categories, in order:`,
        ...recentCategories.map((c) => `- ${c}`),
        '',
        'Pick a category NOT in that list unless you have a genuinely',
        'exceptional idea that happens to fall in a repeated one.',
      ].join('\n');
    }

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
